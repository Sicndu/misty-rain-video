import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse, compileScript } from 'vue/compiler-sfc';
import { build } from 'esbuild';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node']) globalThis[key] = dom.window[key];
globalThis.localStorage = dom.window.localStorage;
const { createApp, nextTick, reactive, markRaw, h, ref } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/mobile-player-');
const file = 'src/components/player/MobilePlaybackControls.vue';
const compiled = compileScript(parse(fs.readFileSync(file, 'utf8')).descriptor, { id: 'mobile-player-test', inlineTemplate: true });
const output = path.resolve(folder, 'controls.mjs');
await build({ stdin: { contents: compiled.content, loader: 'ts', resolveDir: path.resolve('src/components/player') }, outfile: output, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const Controls = (await import(pathToFileURL(output))).default;
const fullscreenOutput = path.resolve(folder, 'fullscreen.mjs');
await build({ entryPoints: ['src/composables/useVideoFullscreen.ts'], outfile: fullscreenOutput, bundle: true, format: 'esm', external: ['vue'], logLevel: 'silent' });
const { useVideoFullscreen } = await import(pathToFileURL(fullscreenOutput));
const button = label => document.querySelector(`button[aria-label="${label}"]`);
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
function mount() {
  document.body.innerHTML = '<div id="mount"></div>';
  const media = video(); document.body.appendChild(media);
  const props = reactive({ video: markRaw(media), expanded: false });
  let toggles = 0;
  const app = createApp({ render: () => h(Controls, { ...props, onFullscreen: () => { toggles++; props.expanded = !props.expanded; } }) });
  app.mount('#mount');
  return { app, props, media, get toggles() { return toggles; } };
}

test('mobile controls play, pause, seek without time updates overriding a drag, and toggle one fullscreen entry', async () => {
  const view = mount();
  try {
    button('播放').click(); await nextTick(); assert.equal(view.media.paused, false);
    button('暂停').click(); await nextTick(); assert.equal(view.media.paused, true);
    const range = document.querySelector('input');
    range.value = '65'; range.dispatchEvent(event('input')); await nextTick();
    view.media.currentTime = 10; view.media.dispatchEvent(event('timeupdate')); await nextTick();
    assert.equal(range.value, '65');
    range.dispatchEvent(event('change')); await nextTick(); assert.equal(view.media.currentTime, 65);
    range.value = '80'; range.dispatchEvent(event('input')); await nextTick();
    range.dispatchEvent(event('pointercancel')); await nextTick(); assert.equal(range.value, '65');
    button('全屏播放').click(); await nextTick(); assert.ok(button('退出全屏'));
    button('退出全屏').click(); await nextTick(); assert.equal(view.toggles, 2);
    assert.ok(button('全屏播放'));
  } finally { view.app.unmount(); }
});
test('subtitle selection leaves metadata tracks alone; mute can restore zero volume', async () => {
  const view = mount();
  try {
    const select = document.querySelector('select');
    select.value = 'off'; select.dispatchEvent(event('change')); await nextTick();
    assert.equal(view.media.textTracks[0].mode, 'disabled');
    assert.equal(view.media.textTracks[1].mode, 'hidden');
    select.value = 'native:0'; select.dispatchEvent(event('change')); await nextTick();
    assert.equal(view.media.textTracks[0].mode, 'showing');
    view.media.volume = 0; view.media.dispatchEvent(event('volumechange')); await nextTick();
    button('取消静音').click(); await nextTick();
    assert.equal(view.media.volume, 1); assert.equal(view.media.muted, false);
  } finally { view.app.unmount(); }
});
test('playing fades controls, tapping the video reveals them, and pausing keeps controls visible', async () => {
  const originalTimeout = globalThis.setTimeout;
  let hide;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 3500) { hide = callback; return 0; }
    return originalTimeout(callback, delay, ...args);
  };
  const view = mount();
  try {
    button('播放').click(); await nextTick();
    assert.equal(typeof hide, 'function'); hide(); await nextTick();
    assert.ok(document.querySelector('.mobile-controls').classList.contains('concealed'));
    view.media.dispatchEvent(event('click')); await nextTick();
    assert.ok(!document.querySelector('.mobile-controls').classList.contains('concealed'));
    hide = null; button('暂停').click(); await nextTick();
    assert.equal(hide, null);
    assert.ok(!document.querySelector('.mobile-controls').classList.contains('concealed'));
  } finally { view.app.unmount(); globalThis.setTimeout = originalTimeout; }
});
test('play rejection is visible and replaced video no longer controls the UI', async () => {
  const view = mount();
  try {
    view.media.play = async () => { throw new Error('blocked'); };
    button('播放').click(); await nextTick(); await nextTick();
    assert.match(document.querySelector('[role="status"]').textContent, /未能开始播放/);
    const replacement = video(); replacement.currentTime = 20;
    view.props.video = markRaw(replacement); await nextTick();
    view.media.currentTime = 100; view.media.dispatchEvent(event('timeupdate')); await nextTick();
    assert.equal(document.querySelector('input').value, '20');
    assert.equal(document.querySelector('[role="status"]'), null);
    button('播放').click(); await nextTick();
    assert.equal(replacement.paused, false);
  } finally { view.app.unmount(); }
});
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
