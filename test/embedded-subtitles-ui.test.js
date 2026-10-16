import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/'});
for(const key of ['window','document','Element','HTMLElement','SVGElement','Node','Event'])globalThis[key]=dom.window[key];
globalThis.VTTCue=class {constructor(start,end,text){this.startTime=start;this.endTime=end;this.text=text;this.positionAlign='auto';}};
const {createApp,h,ref,nextTick,markRaw}=await import('vue');
const folder=fs.mkdtempSync('.local-runtime/tests/captions-'),output=path.resolve(folder,'hook.mjs');
await build({entryPoints:['src/composables/useEmbeddedSubtitles.ts'],outfile:output,bundle:true,format:'esm',external:['vue'],define:{'import.meta.env.BASE_URL':'"/misty-rain/"'},logLevel:'silent'});
const {useEmbeddedSubtitles}=await import(pathToFileURL(output));
const flush=async()=>{for(let i=0;i<6;i++){await new Promise(r=>setImmediate(r));await nextTick()}};
const result=time=>Response.json({code:0,data:{from:time,to:time+90,tracks:[{id:'zh',label:'中文',language:'zh',cues:[{start:time+1,end:time+4,text:'你好 <b>不是 HTML</b>'}]}]}});
function mount(){
 document.body.innerHTML='<div id="mount"></div>';const video=document.createElement('video');const tracks=[];
 video.addTextTrack=(kind,label,language)=>{const track={kind,label,language,mode:'disabled',cues:[],addCue(c){this.cues.push(c)},removeCue(c){this.cues.splice(this.cues.indexOf(c),1)}};tracks.push(track);return track};
 let endpoint,hook;const app=createApp({setup(){endpoint=ref('/api/player/sessions/fixture/embedded-subtitles/source');hook=useEmbeddedSubtitles(ref(markRaw(video)),()=>endpoint.value);return()=>h('div')}});app.mount('#mount');return{app,video,tracks,get endpoint(){return endpoint},get hook(){return hook}};
}
test('late embedded text becomes a centered real TextTrack, seeks load a new window and old cues stay bounded',async t=>{
 const requests=[];t.mock.method(globalThis,'fetch',async input=>{const time=Number(new URL(String(input),'http://localhost').searchParams.get('time'));requests.push(time);return result(time)});
 const view=mount();try{
 await flush();assert.equal(view.tracks.length,1);const cue=view.tracks[0].cues[0];
 assert.deepEqual([cue.position,cue.align,cue.line,cue.size,cue.positionAlign],[50,'center',-2,90,'center']);assert.match(cue.text,/&lt;b&gt;/);
 view.video.currentTime=50;view.video.dispatchEvent(new Event('timeupdate'));await flush();assert.deepEqual(requests,[0]);
 view.video.currentTime=400;view.video.dispatchEvent(new Event('seeked'));await flush();assert.deepEqual(requests,[0,360]);
 assert.equal(view.tracks[0].cues.length,1);assert.equal(view.tracks[0].cues[0].startTime,361);
 }finally{view.app.unmount()}
 assert.equal(view.tracks[0].mode,'disabled');assert.equal(view.tracks[0].cues.length,0);
});
test('seek while an old window is pending follows the current playhead, not the old request',async t=>{
 let resolve;const requests=[];t.mock.method(globalThis,'fetch',input=>{const time=Number(new URL(String(input),'http://localhost').searchParams.get('time'));requests.push(time);return time===0?new Promise(r=>resolve=r):Promise.resolve(result(time))});
 const view=mount();try{await flush();view.video.currentTime=230;view.video.dispatchEvent(new Event('seeked'));resolve(result(0));await flush();assert.deepEqual(requests,[0,180]);assert.ok(view.tracks[0].cues.some(c=>c.startTime===181));}finally{view.app.unmount()}
});
test('switching episodes ignores late responses and clears retired tracks',async t=>{
 let resolve;t.mock.method(globalThis,'fetch',()=>new Promise(r=>resolve=r));const view=mount();await flush();view.endpoint.value='';await flush();resolve(result(0));await flush();assert.equal(view.tracks.length,0);view.app.unmount();
});
test('a temporary failure offers retry, avoids repeated requests on every timeupdate and resumes after retry',async t=>{
 let fail=true,calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;if(fail)throw new Error('network');return result(0)});const view=mount();
 try{await flush();assert.match(view.hook.error.value,/读取失败/);view.video.dispatchEvent(new Event('timeupdate'));await flush();assert.equal(calls,1);fail=false;view.hook.retry();await flush();assert.equal(view.hook.error.value,'');assert.equal(view.tracks.length,1);}finally{view.app.unmount()}
});
test.after(()=>{dom.window.close();fs.rmSync(folder,{recursive:true,force:true})});
