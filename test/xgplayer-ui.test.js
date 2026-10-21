import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const dom = new JSDOM('<html><body></body></html>', { url: 'https://preview.test/', pretendToBeVisual: true });
for (const key of ['window','document','Element','HTMLElement','HTMLMediaElement','HTMLVideoElement','Node','Event','MouseEvent','CustomEvent']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis,'navigator',{ configurable:true, value:dom.window.navigator });
Object.defineProperty(navigator,'userAgent',{ configurable:true, value:'Android Chrome' });
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.localStorage = window.localStorage;
window.HTMLMediaElement.prototype.load = () => {};
window.HTMLMediaElement.prototype.pause = () => {};
const folder=fs.mkdtempSync('.local-runtime/tests/xgplayer-');
const outfile=path.resolve(folder,'adapter.mjs');
await build({ entryPoints:['src/services/xgplayerAdapter.ts'],outfile,bundle:true,format:'esm',platform:'browser',logLevel:'silent',define:{'process.env.NODE_ENV':'"test"'} });
const { createDirectPlayer }=await import(pathToFileURL(outfile));
const tick=async()=>{ await new Promise(resolve=>setImmediate(resolve)); };
function setup() {
 document.body.innerHTML='<div id="column"><div id="stage"><video playsinline><track kind="subtitles" label="中文"></video></div></div>';
 const root=document.querySelector('#stage'),video=root.querySelector('video');
 video.src='https://quark.example/signed.mp4';video.currentTime=42;
 let paused=true;Object.defineProperty(video,'paused',{configurable:true,get:()=>paused});
 Object.defineProperty(video,'duration',{configurable:true,value:600});Object.defineProperty(video,'readyState',{configurable:true,value:4});
 video.play=async()=>{paused=false;video.dispatchEvent(new Event('play'));};
 video.pause=()=>{paused=true;video.dispatchEvent(new Event('pause'));};
 root.getBoundingClientRect=()=>({left:0,top:0,width:800,height:450});
 let full=0;const qualities=[],feedback=[];
 const adapter=createDirectPlayer(root,video,{fullscreen:()=>{full++;},quality:id=>qualities.push(id),feedback:msg=>feedback.push(msg)});
 const sources=[{id:'high',label:'高清',delivery:'direct'},{id:'low',label:'流畅',delivery:'direct'},{id:'relay',label:'中转',delivery:'proxy'}];
 adapter.setQualities(sources,'high');
 return {root,video,adapter,qualities,feedback,sources,get full(){return full;}};
}
test('xgplayer attaches to the existing native video without a second URL loader or CORS/relay mutation',async()=>{
 const view=setup();try{await tick();assert.equal(view.adapter.player.video,view.video);assert.equal(document.querySelectorAll('video').length,1);assert.equal(view.video.src,'https://quark.example/signed.mp4');assert.equal(view.video.currentTime,42);assert.equal(view.video.hasAttribute('crossorigin'),false);assert.equal(view.adapter.player.handleSource,false);assert.equal(view.adapter.player.config.cssFullscreen,false);assert.equal(view.adapter.player.config.fullscreen.rotateFullscreen,false);assert.ok(!view.adapter.player.plugins.hls);assert.ok(!view.adapter.player.plugins.testspeed);assert.equal(view.video.querySelectorAll('track').length,1);}finally{view.adapter.destroy();}
});
test('quality UI survives canplay and delegates one direct-source change without resetting playback',async()=>{
 const view=setup();try{await tick();view.video.dispatchEvent(new Event('canplay'));assert.deepEqual([...view.root.querySelectorAll('[role="option"]')].map(item=>item.textContent),['高清','流畅']);assert.equal(view.root.querySelector('[aria-selected="true"]').textContent,'高清');
 view.adapter.player.plugins.sourcequality.onItemClick(new Event('click'),{to:{id:'low'}});assert.deepEqual(view.qualities,['low']);assert.equal(view.video.currentTime,42);assert.equal(view.video.src,'https://quark.example/signed.mp4');
 view.adapter.setQualities(view.sources,'low');assert.equal(view.root.querySelector('[aria-selected="true"]').textContent,'流畅');
 }finally{view.adapter.destroy();}
});
test('source labels render as text and a single quality hides its redundant selector',async()=>{
 const view=setup();try{await tick();view.adapter.setQualities([{id:'a',label:'<img src=x onerror=alert(1)>',delivery:'direct'}],'a');assert.equal(view.root.querySelector('.xgplayer-definition img'),null);assert.ok(view.root.querySelector('.xgplayer-definition').textContent.includes('<img'));assert.equal(view.root.querySelector('.xgplayer-definition').classList.contains('show'),false);}finally{view.adapter.destroy();}
});
test('library play/pause and playback-rate controls operate the same media element',async()=>{
 const view=setup();try{await tick();const play=view.root.querySelector('[aria-label="播放或暂停"]');play.click();assert.equal(view.video.paused,false);play.click();assert.equal(view.video.paused,true);
 const rate=view.root.querySelector('li[rate="1.5"]');assert.ok(rate);rate.dispatchEvent(new Event('touchend',{bubbles:true}));assert.equal(view.video.playbackRate,1.5);
 }finally{view.adapter.destroy();}
});
test('fullscreen button and keyboard activation use the native fullscreen policy rather than CSS fallback',async()=>{
 const view=setup();try{await tick();const full=view.root.querySelector('[aria-label="全屏播放"]');full.click();assert.equal(view.full,1);full.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal(view.full,2);view.adapter.setFullscreen(true);assert.equal(full.getAttribute('aria-label'),'退出全屏');assert.equal(full.getAttribute('data-state'),'full');view.adapter.setFullscreen(false);assert.equal(full.getAttribute('aria-label'),'全屏播放');assert.equal(view.root.classList.contains('xgplayer-cssfullscreen'),false);}finally{view.adapter.destroy();}
});
test('mobile double taps reuse library recognition and seek ten seconds while center toggles pause',async()=>{
 const view=setup();try{await tick();await view.video.play();const mobile=view.adapter.player.plugins.mobile;
 mobile.onDbClick(new MouseEvent('dblclick',{clientX:760}));await tick();assert.equal(view.video.currentTime,52);
 mobile.onDbClick(new MouseEvent('dblclick',{clientX:20}));await tick();assert.equal(view.video.currentTime,42);
 assert.deepEqual(view.feedback,['快进 10 秒','后退 10 秒']);
 }finally{view.adapter.destroy();}
});
test('destroy and recreate leave one control tree and no stale event handler',async()=>{
 const view=setup();await tick();const old=view.root.querySelector('[aria-label="播放或暂停"]');view.adapter.destroy();
 assert.equal(view.root.querySelectorAll('.xgplayer-controls').length,0);assert.ok(view.root.contains(view.video));
 let requested=0;const next=createDirectPlayer(view.root,view.video,{fullscreen:()=>requested++,quality:()=>{},feedback:()=>{}});
 try{await tick();assert.equal(view.root.querySelectorAll('.xgplayer-controls').length,1);assert.equal(view.root.querySelectorAll('video').length,1);assert.equal(old.isConnected,false);view.root.querySelector('[aria-label="全屏播放"]').click();assert.equal(requested,1);assert.equal(view.full,0);}finally{next.destroy();}
});
test.after(()=>{dom.window.close();fs.rmSync(folder,{recursive:true,force:true});});
