import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
globalThis.localStorage = dom.window.localStorage;
const { createApp, markRaw, h, ref } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/mobile-player-');
const fullscreenOutput = path.resolve(folder, 'fullscreen.mjs');
await build({ entryPoints: ['src/composables/useVideoFullscreen.ts'], outfile: fullscreenOutput, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const { useVideoFullscreen } = await import(pathToFileURL(fullscreenOutput));
const event = name => new dom.window.Event(name);

function video() {
  const element = document.createElement('video');
  let paused = true;
  Object.defineProperty(element, 'paused', { get: () => paused });
  Object.defineProperty(element, 'duration', { value: 120 });
  element.play = async () => { paused = false; element.dispatchEvent(event('play')); };
  element.pause = () => { paused = true; element.dispatchEvent(event('pause')); };
  const tracks = [{ kind: 'subtitles', label: '中文', mode: 'showing' }, { kind: 'metadata', mode: 'hidden' }];
  const events = new dom.window.EventTarget();
  tracks.addEventListener = events.addEventListener.bind(events);
  tracks.removeEventListener = events.removeEventListener.bind(events);
  Object.defineProperty(element, 'textTracks', { value: tracks });
  return element;
}
function mountFullscreen(media) {
  document.body.innerHTML = '<div id="mount"></div>';
  let controls, current;
  const app = createApp({ setup() { current = ref(null); controls = useVideoFullscreen(current); current.value = markRaw(media); return () => h('div'); } });
  app.mount('#mount');
  return { app, controls, current };
}

test('iOS enters native video fullscreen synchronously and restores inline controls on exit', async () => {
  const media = video();
  Object.defineProperty(media, 'readyState', { value: 1 });
  let entered = 0;
  media.webkitEnterFullscreen = () => { entered++; media.webkitDisplayingFullscreen = true; media.dispatchEvent(event('webkitbeginfullscreen')); };
  media.webkitExitFullscreen = () => { media.webkitDisplayingFullscreen = false; media.dispatchEvent(event('webkitendfullscreen')); };
  const view = mountFullscreen(media);
  try {
    const pending = view.controls.toggle();
    assert.equal(entered, 1); assert.equal(view.controls.fullscreen.value, true); assert.equal(media.controls, true);
    await pending; await view.controls.toggle();
    assert.equal(view.controls.fullscreen.value, false); assert.equal(media.controls, false);
    await view.controls.toggle();
  } finally { view.app.unmount(); }
  assert.equal(media.controls, false);
  media.dispatchEvent(event('webkitendfullscreen'));
  assert.equal(view.controls.fullscreen.value, true, 'unmount removes fullscreen listeners');
});

test('standard fullscreen targets only the video and handles native Escape/exit', async () => {
  const media = video();
  Object.defineProperty(media, 'readyState', { value: 1 });
  media.requestFullscreen = async options => {
    assert.deepEqual(options, { navigationUI: 'hide' });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: media });
    document.dispatchEvent(event('fullscreenchange'));
  };
  document.exitFullscreen = async () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    document.dispatchEvent(event('fullscreenchange'));
  };
  const view = mountFullscreen(media);
  try {
    await view.controls.toggle(); assert.equal(document.fullscreenElement, media); assert.equal(media.controls, true);
    await view.controls.toggle(); assert.equal(view.controls.fullscreen.value, false); assert.equal(media.controls, false);
    await view.controls.toggle(); await document.exitFullscreen(); assert.equal(media.controls, false);
  } finally { view.app.unmount(); }
});

test('loading, unsupported and rejected fullscreen requests never simulate a rotated web player', async () => {
  const media = video();
  let ready = 0;
  Object.defineProperty(media, 'readyState', { get: () => ready });
  const view = mountFullscreen(media);
  try {
    await view.controls.toggle(); assert.match(view.controls.error.value, /尚未加载/); assert.equal(media.controls, false);
    ready = 1; await view.controls.toggle(); assert.match(view.controls.error.value, /不支持/); assert.equal(media.controls, false);
    media.requestFullscreen = async () => { throw new Error('denied'); };
    await view.controls.toggle(); assert.match(view.controls.error.value, /无法进入/); assert.equal(media.controls, false);
    assert.equal(view.controls.fullscreen.value, false);
  } finally { view.app.unmount(); }
});
test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });
