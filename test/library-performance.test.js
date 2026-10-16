import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
const dom = new JSDOM('<div id="app"></div>',{url:'http://localhost/',pretendToBeVisual:true});
for(const key of ['window','document','Element','HTMLElement','SVGElement','Node'])globalThis[key]=dom.window[key];
const {createApp,ref,h,nextTick}=await import('vue');
async function bundle(name){const outfile=path.resolve(`.local-runtime/tests/${name}.mjs`);await build({entryPoints:[`src/composables/${name}.ts`],outfile,bundle:true,format:'esm',external:['vue'],define:{'import.meta.env.BASE_URL':'"/"'},logLevel:'silent'});return import(pathToFileURL(outfile));}
const {useMediaList}=await bundle('useMediaList');
const {usePlaybackHistory}=await bundle('usePlaybackHistory');
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));await nextTick();};
const card={id:'quark:new',quarkFid:'new',title:'影片',category:'tv',poster:''};
test('collection reads coalesce, a late read cannot undo save, delete does not rescan the drive',async t=>{
 let resolveRead,getCount=0;const methods=[];
 t.mock.method(globalThis,'fetch',(_url,options={})=>{const method=options.method||'GET';methods.push(method);if(method==='GET'){getCount++;return new Promise(resolve=>resolveRead=resolve);}return Promise.resolve(Response.json({code:0,data:method==='POST'?[card]:{deletedCount:1}}));});
 let state;const app=createApp({setup(){state=useMediaList(ref(true));return()=>h('div')}});app.mount('#app');
 try {
  const first=state.refreshList(),second=state.refreshList();assert.equal(first,second);await flush();assert.equal(getCount,1);
  await state.saveMedia(card);resolveRead(Response.json({code:0,data:[]}));await first;assert.equal(state.allMediaList.value[0].id,card.id);
  await state.removeMedia(card);assert.equal(state.allMediaList.value.length,0);assert.deepEqual(methods,['GET','POST','DELETE']);
 }finally{app.unmount();}
});
test('history reads coalesce and deletion keeps newer local progress instead of replacing it with stale response',async t=>{
 document.body.innerHTML='<div id="app"></div>';let resolveRead,resolveDelete,reads=0;
 t.mock.method(globalThis,'fetch',(_url,options={})=>options.method==='DELETE'?new Promise(resolve=>resolveDelete=resolve):(reads++,new Promise(resolve=>resolveRead=resolve)));
 let state;const app=createApp({setup(){state=usePlaybackHistory(ref(true));return()=>h('div')}});app.mount('#app');
 try {
  const first=state.refreshHistory();assert.equal(first,state.refreshHistory());await flush();assert.equal(reads,1);
  const old={id:'old',media:card,updatedAt:'2026-10-16T00:00:00Z'};state.updateLocalHistory(old);const removal=state.removeHistory('old');await flush();
  const recent={...old,id:'new',media:{...card,id:'quark:other',quarkFid:'other'}};state.updateLocalHistory(recent);
  resolveDelete(Response.json({code:0,data:[]}));await removal;resolveRead(Response.json({code:0,data:[old]}));await first;
  assert.deepEqual(state.history.value.map(item=>item.id),['new']);
 }finally{app.unmount();}
});
