import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'CustomEvent', 'HTMLMediaElement', 'HTMLVideoElement']) globalThis[key] = dom.window[key];
globalThis.localStorage = dom.window.localStorage;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
window.matchMedia = query => ({ matches: query.includes('max-width'), addEventListener() {}, removeEventListener() {} });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.load = () => {};
window.HTMLMediaElement.prototype.play = async () => {};
const trackLists = new WeakMap();
Object.defineProperty(window.HTMLMediaElement.prototype, 'textTracks', { configurable: true, get() {
  if (!trackLists.has(this)) {
    const list = [], events = new window.EventTarget();
    list.addEventListener = events.addEventListener.bind(events);
    list.removeEventListener = events.removeEventListener.bind(events);
    trackLists.set(this, list);
  }
  return trackLists.get(this);
} });
const { createApp, h, nextTick } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/simplified-ui-');
async function compile(entry, name) {
  const outfile = path.resolve(folder, name + '.mjs');
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'browser', external: ['vue'],
    define: { 'import.meta.env.BASE_URL': '"/"', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
    plugins: [{ name: 'vue', setup(builder) { builder.onLoad({ filter: /\.vue$/ }, args => {
      // Canvas rendering has its own browser/UI tests; this suite observes panel state.
      if (args.path.endsWith('/DanmakuControls.vue')) return { contents: 'export default { render() { return null; } };', loader: 'js' };
      const { descriptor } = parse(fs.readFileSync(args.path, 'utf8'));
      return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
    }); } }] });
  return import(pathToFileURL(outfile));
}
const Account = (await compile('src/components/auth/AccountPage.vue', 'account')).default;
const Sidebar = (await compile('src/components/layout/DesktopSidebar.vue', 'sidebar')).default;
const Player = (await compile('src/components/player/QuarkEmbedPlayerModal.vue', 'player')).default;
const { useQuarkTransfer } = await compile('src/composables/useQuarkTransfer.ts', 'transfer');
const user = role => ({ username: 'private_name', folder: role, role });
const flush = async () => { for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick(); } };
function mount(component, props) {
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(component, props) });
  app.mount('#mount'); return app;
}
const media = { id: 'quark:movie', quarkFid: 'movie', title: '测试影片', category: 'tv', poster: '' };
const episodes = [1, 2].map(n => ({ fid: 'ep' + n, episodeNumber: n, episodeTitle: '第 ' + n + ' 集', fileName: n + '.mp4', duration: 600 }));
const preferences = { skipIntroOutro: false, autoNext: true, introSeconds: 30, outroSeconds: 45 };
function mockApi(t) {
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const url = String(input);
    let data;
    if (url.includes('/player/preferences')) data = options.body ? JSON.parse(options.body) : preferences;
    else if (url.endsWith('/player/sessions')) data = { sessionId: 'fixture', episodes, title: media.title };
    else if (url.includes('/episodes/')) data = { episode: episodes[0], sources: [{ id: 'high', label: '高清', resolution: 'high', delivery: 'direct', mimeType: 'video/mp4', url: '/test.mp4' }], subtitles: [], audioTracks: [] };
    else if (url.includes('/quark/config')) data = { libraryConfigured: true, isAuthenticated: true };
    else if (url.includes('resource-search')) data = { total: 1, merged_by_type: { quark: [{ url: 'https://pan.quark.cn/s/newwork', note: '新片名' }] } };
    else data = { enabled: true, items: [], checkedAt: '', intervalMinutes: 30 };
    return Response.json({ code: 0, data });
  });
}

test('settings show no read-only identity; advanced configuration is an admin-only inner page', async t => {
  mockApi(t);
  for (const role of ['admin', 'user']) {
    const app = mount(Account, { user: user(role), history: [] });
    try {
      assert.doesNotMatch(document.body.textContent, /private_name|管理员账户|片库账户/);
      assert.equal(document.querySelectorAll('.theme-switch').length, 1);
      assert.equal(document.querySelector('.auth-section'), null);
      const advanced = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '高级配置');
      assert.equal(Boolean(advanced), role === 'admin');
      if (advanced) {
        advanced.click(); await flush();
        assert.equal(document.querySelector('h1').textContent, '高级配置');
        assert.ok(document.querySelector('.auth-section'));
        assert.equal(document.querySelector('.theme-switch'), null);
        document.querySelector('[aria-label="返回设置"]').click(); await nextTick();
        assert.ok(document.querySelector('.theme-switch'));
        assert.equal(document.querySelector('.auth-section'), null);
      }
    } finally { app.unmount(); }
  }
});

test('desktop has one settings entry and no identity or theme controls in the sidebar', () => {
  const app = mount(Sidebar, { user: user('admin'), activePage: 'account', category: 'tv', counts: { tv: 2, movie: 0, anime: 0, variety: 0 } });
  try {
    assert.equal(document.querySelectorAll('.sidebar-settings').length, 1);
    assert.equal(document.querySelector('[aria-current="page"]').textContent, '设置');
    assert.equal(document.querySelector('.theme-switch'), null);
    assert.doesNotMatch(document.body.textContent, /private_name|管理员|我的$/);
  } finally { app.unmount(); }
});

test('player tabs are mutually exclusive; settings contain one subtitle and two duration inputs', async t => {
  mockApi(t);
  const app = mount(Player, { isOpen: true, media, username: 'fixture' });
  try {
    await flush();
    assert.ok(document.querySelector('#episode-panel'));
    assert.equal(document.querySelector('#playback-settings'), null);
    document.querySelector('#settings-tab').click(); await nextTick();
    assert.equal(document.querySelector('#episode-panel'), null);
    assert.ok(document.querySelector('#playback-settings'));
    assert.equal(document.querySelectorAll('select[aria-label="选择影片字幕"]').length, 1);
    assert.equal(document.querySelectorAll('.duration-input input').length, 2);
    assert.equal(document.querySelector('[aria-label="片头时长（秒）"]').value, '30');
    assert.equal(document.querySelector('[aria-label="片尾时长（秒）"]').value, '45');
    document.querySelector('#episodes-tab').click(); await nextTick();
    assert.ok(document.querySelector('#episode-panel'));
    assert.equal(document.querySelector('#playback-settings'), null);
    assert.equal(document.querySelectorAll('[role="option"][aria-selected="true"]').length, 1);
    assert.equal(document.querySelector('.rotated-player'), null);
  } finally { app.unmount(); }
});

test('searching new content updates the save title; replacing an existing source retains its identity', async t => {
  mockApi(t);
  let transfer;
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ setup() { transfer = useQuarkTransfer(); return () => h('div'); } }); app.mount('#mount');
  try {
    await transfer.openTransferModal({ ...media, id: 'new-search', quarkFid: undefined, title: '首次搜索', poster: 'old-poster' });
    await transfer.refreshResources('新片名');
    assert.equal(transfer.currentMedia.value.title, '新片名');
    assert.equal(transfer.currentMedia.value.poster, '');
    await transfer.openTransferModal(media);
    await transfer.refreshResources('测试影片的别名');
    assert.equal(transfer.currentMedia.value.title, media.title);
    assert.equal(transfer.currentMedia.value.quarkFid, media.quarkFid);
  } finally { transfer.closeTransferModal(); app.unmount(); }
});

test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });
