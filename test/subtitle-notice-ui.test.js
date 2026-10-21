import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
window.scrollTo = () => {};
globalThis.localStorage = window.localStorage; globalThis.location = window.location;
const { createApp, h, nextTick } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/subtitle-notice-');
const compile = async entry => {
  const outfile = path.resolve(folder, path.basename(entry) + '.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'browser', external: ['vue'],
    define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
    plugins: [{ name: 'vue', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, args => {
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'));
      if (!descriptor.script && !descriptor.scriptSetup) {
        const template = compileTemplate({ id: args.path, filename: args.path, source: descriptor.template?.content || '' });
        return { contents: template.code.replace('export function render', 'function render') + '\nexport default { render };', loader: 'js' };
      }
      return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
    }); } }] });
  return import(pathToFileURL(outfile));
};
const Controls = (await compile('src/components/player/SubtitleControls.vue')).default;
const { reactive, markRaw } = await import('vue');
const flush = async () => { for(let i=0;i<4;i++){await new Promise(r=>setImmediate(r));await nextTick();} };
const message = '字幕连接中断，正在重试…';
function mount(overrides={}) {
 localStorage.clear(); document.body.innerHTML='<button id="outside">画面</button><div id="mount"></div>';
 const video=document.createElement('video'),tracks=[],events=new window.EventTarget();
 for(const method of ['addEventListener','removeEventListener','dispatchEvent'])tracks[method]=events[method].bind(events);
 Object.defineProperty(video,'textTracks',{value:tracks});
 const props=reactive({video:markRaw(video),username:'notice-fixture',readError:message,loading:false,fullscreen:false,contextKey:'episode-1:source-1',compact:true,iconOnly:true,...overrides});
 let retries=0; const app=createApp({render:()=>h(Controls,{...props,onRetryEmbedded:()=>retries++})});app.mount('#mount');
 return{app,props,video,get retries(){return retries}};
}
const status=()=>document.querySelector('.subtitle-status');
const open=()=>document.querySelector('select').dispatchEvent(new window.Event('pointerdown',{bubbles:true}));
test('caption errors have a close action and remain dismissed throughout the same retry incident',async()=>{
 const view=mount();try{
  await flush();assert.ok(status());document.querySelector('[aria-label="关闭字幕提示"]').click();await flush();assert.equal(status(),null);
  view.props.loading=true;view.props.readError='';await flush();view.props.loading=false;view.props.readError='字幕暂时读取失败';await flush();assert.equal(status(),null);
  open();await flush();assert.ok(status());const picker=document.querySelector('select');assert.equal(picker.value,'auto');
  [...status().querySelectorAll('button')].find(b=>b.textContent==='重试').click();await flush();assert.equal(view.retries,1);assert.equal(status(),null);assert.equal(picker.value,'auto');assert.equal(localStorage.length,0);
  view.props.readError='';await flush();view.props.readError=message;await flush();assert.ok(status(),'a later failure after successful recovery can notify again');
 }finally{view.app.unmount()}
});
test('outside click and Escape dismiss; idle controls do not suppress a future first error',async()=>{
 const view=mount({readError:''});try{
  await flush();document.querySelector('#outside').dispatchEvent(new window.Event('pointerdown',{bubbles:true}));view.props.readError=message;await flush();assert.ok(status());
  document.querySelector('#outside').dispatchEvent(new window.Event('pointerdown',{bubbles:true}));await flush();assert.equal(status(),null);
  open();await flush();assert.ok(status());document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flush();assert.equal(status(),null);
 }finally{view.app.unmount()}
});
test('fullscreen transitions hide notices and fullscreen background errors stay quiet until explicitly inspected',async()=>{
 const view=mount();try{
  await flush();assert.ok(status());view.props.fullscreen=true;await flush();assert.equal(status(),null);
  view.props.readError='字幕暂时读取失败';await flush();assert.equal(status(),null);open();await flush();assert.ok(status());
  view.props.fullscreen=false;await flush();assert.equal(status(),null);
  view.props.readError='';view.props.fullscreen=true;await flush();view.props.readError=message;await flush();assert.equal(status(),null);
 }finally{view.app.unmount()}
});
test('turning subtitles off hides notices; a new source resets the old dismissal',async()=>{
 const view=mount();try{
  await flush();const picker=document.querySelector('select');picker.value='off';picker.dispatchEvent(new window.Event('change',{bubbles:true}));await flush();assert.equal(status(),null);open();await flush();assert.equal(status(),null);
  picker.value='auto';picker.dispatchEvent(new window.Event('change',{bubbles:true}));await flush();open();await flush();assert.ok(status());
  document.querySelector('[aria-label="关闭字幕提示"]').click();await flush();view.props.contextKey='episode-2:source-1';await flush();assert.ok(status());
 }finally{view.app.unmount()}
});
test('a notice expires automatically and timers/listeners are released on unmount',async t=>{
 const original=globalThis.setTimeout;let expiry,cleared=[];
 t.mock.method(globalThis,'setTimeout',(fn,delay,...args)=>{if(delay===6000){expiry=fn;return 12345}return original(fn,delay,...args)});
 const clear=globalThis.clearTimeout;t.mock.method(globalThis,'clearTimeout',id=>{if(id===12345)cleared.push(id);else clear(id)});
 const view=mount();await flush();assert.ok(status());expiry();await flush();assert.equal(status(),null);open();await flush();assert.ok(status());view.app.unmount();assert.ok(cleared.length);document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape'}));
});
