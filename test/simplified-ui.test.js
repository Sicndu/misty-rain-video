import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc';

const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'CustomEvent', 'HTMLMediaElement', 'HTMLVideoElement']) globalThis[key] = dom.window[key];
globalThis.localStorage = dom.window.localStorage;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
window.matchMedia = query => ({ matches: query.includes('max-width'), addEventListener() {}, removeEventListener() {} });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.load = () => {};
window.HTMLMediaElement.prototype.play = async () => {};
const trackLists = new WeakMap();
Object.defineProperty(window.HTMLMediaElement.prototype, 'textTracks', { configurable: true, get() {
  if (!trackLists.has(this)) {
    const list = [], events = new window.EventTarget();
    list.addEventListener = events.addEventListener.bind(events);
    list.removeEventListener = events.removeEventListener.bind(events);
    list.dispatchEvent = events.dispatchEvent.bind(events);
    trackLists.set(this, list);
  }
  return trackLists.get(this);
} });
const { createApp, h, nextTick, reactive } = await import('vue');
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
      if (!descriptor.script && !descriptor.scriptSetup) {
        const template = compileTemplate({ id: args.path, filename: args.path, source: descriptor.template?.content || '' });
        return { contents: template.code.replace('export function render', 'function render') + '\nexport default { render };', loader: 'js' };
      }
      return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content, loader: 'ts', resolveDir: path.dirname(args.path) };
    }); } }] });
  return import(pathToFileURL(outfile));
}
const HistoryPage = (await compile('src/components/media/HistoryPage.vue', 'history-page')).default;
const Details = (await compile('src/components/quark/QuarkResourceDetails.vue', 'resource-details')).default;
const Account = (await compile('src/components/auth/AccountPage.vue', 'account')).default;
const TitleEditor = (await compile('src/components/media/MediaTitleEditor.vue', 'title-editor')).default;
const Sidebar = (await compile('src/components/layout/DesktopSidebar.vue', 'sidebar')).default;
const Subtitles = (await compile('src/components/player/SubtitleControls.vue', 'subtitles')).default;
const Player = (await compile('src/components/player/PlayerPage.vue', 'player')).default;
const Discovery = (await compile('src/components/media/DiscoveryPage.vue', 'discovery')).default;
const Catalog = (await compile('src/components/media/CatalogSearchPage.vue', 'catalog')).default;
const ResourceModal = (await compile('src/components/quark/QuarkTransferModal.vue', 'resource-modal')).default;
const { discoveryMedia, resourcePlaybackMedia } = await compile('src/services/discoveryService.ts', 'discovery-service');
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
const discovered = { id: 'douban-123', provider: 'douban', title: '推荐影片', category: 'movie', year: '2026', rating: 8.1, poster: '/api/discovery/posters/douban-123', subtitle: '', description: '2026 / 剧情', sourceUrl: 'https://movie.douban.com/subject/123/' };
const discoverySection = (category, items = [discovered]) => ({ id: category, category, title: category === 'movie' ? '热门电影' : '近期热播', source: '豆瓣', sourceUrl: 'https://m.douban.com/subject_collection/movie_hot_gaia', updatedAt: '2026-10-16T01:00:00Z', stale: false, refreshing: false, failed: false, items });
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

test('catalog search never searches resources until a card or fallback is selected, ignores late query responses', async t => {
  const pending=new Map(),requests=[];t.mock.method(globalThis,'fetch',url=>{requests.push(String(url));return new Promise(resolve=>pending.set(new URL(String(url),'http://localhost').searchParams.get('q'),resolve))});
  let selected,fallback;const props=reactive({query:'旧片名',active:true,libraryCatalogIds:[],onSelect:item=>selected=item,onSearchResources:q=>fallback=q});const app=mount(Catalog,props);
  try {
    await flush();props.query='新片名';await flush();
    pending.get('新片名')(Response.json({code:0,data:{items:[{...discovered,title:'新片名'}]}}));await flush();
    pending.get('旧片名')(Response.json({code:0,data:{items:[{...discovered,title:'旧片名'}]}}));await flush();
    assert.match(document.querySelector('.catalog-card').textContent,/新片名/);assert.ok(requests.every(url=>url.includes('/api/catalog/search')));assert.equal(selected,undefined);assert.equal(fallback,undefined);
    document.querySelector('.catalog-card').click();assert.equal(selected.title,'新片名');
    document.querySelector('.catalog-fallback button').click();assert.equal(fallback,'新片名');
  } finally {app.unmount();}
});

test('empty catalog and provider failure each provide an explicit direct-resource search action', async t => {
  let fail=false;t.mock.method(globalThis,'fetch',async()=>fail?Response.json({code:503},{status:503}):Response.json({code:0,data:{items:[]}}));
  const props=reactive({query:'未收录',active:true,libraryCatalogIds:[]});const app=mount(Catalog,props);
  try {await flush();assert.match(document.querySelector('.catalog-empty').textContent,/没有找到/);assert.ok(document.querySelector('.catalog-fallback button'));
    fail=true;props.query='接口故障';await flush();assert.match(document.querySelector('[role="alert"]').textContent,/暂时无法加载/);assert.ok(document.querySelector('.catalog-fallback button'));
  }finally{app.unmount();}
});

test('发现页切换分类时丢弃晚到的旧响应，点海报传递准确的元数据身份', async t => {
  const pending = new Map();
  t.mock.method(globalThis, 'fetch', input => {
    const category = new URL(String(input), 'http://localhost').searchParams.get('category');
    if (category === 'all') return Promise.resolve(Response.json({ code: 0, data: { sections: [discoverySection('movie')] } }));
    return new Promise(resolve => pending.set(category, resolve));
  });
  let selected;
  const app = mount(Discovery, { active: true, libraryCatalogIds: [], onSelect: item => { selected = item; } });
  try {
    await flush(); document.querySelector('.discovery-card').click(); assert.equal(selected.id, 'douban-123');
    [...document.querySelectorAll('.discovery-categories button')].find(x => x.textContent === '电影').click(); await nextTick();
    [...document.querySelectorAll('.discovery-categories button')].find(x => x.textContent === '电视剧').click(); await nextTick();
    pending.get('tv')(Response.json({ code: 0, data: { sections: [discoverySection('tv', [{ ...discovered, id: 'douban-456', title: '新的剧集', category: 'tv' }])] } })); await flush();
    pending.get('movie')(Response.json({ code: 0, data: { sections: [discoverySection('movie')] } })); await flush();
    assert.match(document.querySelector('.discovery-title').textContent, /新的剧集/);
    assert.doesNotMatch(document.body.textContent, /推荐影片/);
  } finally { app.unmount(); }
});

test('每周放送按所选星期展示，未评分作品没有零分标签', async t => {
  const entries = [1, 2].map(day => ({ ...discovered, id: 'bangumi-' + day, category: 'anime', weekday: day, rating: null, title: `周${day}新番` }));
  t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 0, data: { sections: [discoverySection('anime'), { ...discoverySection('anime', entries), id: 'calendar', title: '本周放送', source: 'Bangumi' }] } }));
  const app = mount(Discovery, { active: true, libraryCatalogIds: [] });
  try {
    await flush(); [...document.querySelectorAll('.discovery-categories button')].find(x => x.textContent === '动漫').click(); await flush();
    [...document.querySelectorAll('.anime-modes button')].find(x => x.textContent === '每周放送').click(); await nextTick();
    document.querySelector('.weekdays button').click(); await nextTick();
    assert.equal(document.querySelectorAll('.discovery-card').length, 1); assert.equal(document.querySelector('.discovery-title').textContent, '周1新番');
    assert.equal(document.querySelector('.discovery-rating'), null);
  } finally { app.unmount(); }
});

test('打开资源浏览文件后播放所点文件，保留片名、分类和提取码，不触发收藏', async t => {
  t.mock.method(globalThis,'fetch',async()=>Response.json({code:0,data:{title:'测试资源',videoCount:1,episodeCount:1,entries:[{fid:'e2',name:'第2集.mp4',parentFid:'0',ancestorFids:[],isVideo:true,isDirectory:false,size:100,sizeFormatted:'100 MB',episodeNumber:2,episodeTitle:'第2集',videoCount:0}]}}));
  const resource = { id: 'resource', title: '推荐影片 2026 1080p', url: 'https://pan.quark.cn/s/fixture', password: '1234', quality: '1080P', datetime: '2026-10-16', linkStatus: 'available', type: 'quark' };
  let playback, saves = 0, plays = 0;
  const app = mount(ResourceModal, { isOpen: true, isAnalyzing: false, media: discoveryMedia(discovered), currentCategory: 'tv', quarkResources: [resource], searchKeyword: discovered.title,
    onPlayResource: (...args) => { playback = args; plays++; }, onSaveToCards: () => { saves++; } });
  try {
    await flush(); assert.equal(document.querySelector('[aria-label="重新输入片名搜索资源"]').value, discovered.title);
    assert.equal(document.querySelector('.btn-play'),null);
    document.querySelector('.resource-item').click(); await flush();
    assert.equal(document.querySelector('[aria-label="收藏分类"]').value,'movie');
    document.querySelector('.file-open').click();
    assert.equal(playback[3],'e2'); assert.equal(plays,1);
    assert.equal(playback[0].catalogId, discovered.id); assert.equal(playback[1].password, '1234'); assert.equal(playback[2], 'movie');
    assert.equal(saves, 0);
  } finally { app.unmount(); }
});

test('file browser skips wrapper folders, separates checkbox selection from play, preserves folder scope and disables empty saves', async () => {
 const entries=[{fid:'wrap',parentFid:'0',ancestorFids:[],isDirectory:true,name:'影片目录',videoCount:2,size:200,sizeFormatted:'200 MB'},
  {fid:'season',parentFid:'wrap',ancestorFids:['wrap'],isDirectory:true,name:'第一季',videoCount:2,size:200,sizeFormatted:'200 MB'},
  ...[1,2].map(n=>({fid:'ep'+n,parentFid:'season',ancestorFids:['wrap','season'],isVideo:true,isDirectory:false,name:n+'.mp4',size:100,sizeFormatted:'100 MB',thumbnail:'/api/test-thumbnail',updatedAt:'2026-10-16T00:00:00Z'}))];
 let saved,played=0;const props=reactive({resource:{url:'https://pan.quark.cn/s/fixture'},initialDetails:{title:'目录',entries,videoCount:2,episodeCount:2},onSave:fids=>saved=fids,onPlay:()=>played++});const app=mount(Details,props);
 try{await flush();assert.equal(document.querySelectorAll('.file-row').length,2);assert.match(document.querySelector('.breadcrumbs').textContent,/第一季/);assert.ok(document.querySelector('.file-row img'));assert.match(document.querySelector('.file-size').textContent,/100 MB/);
 document.querySelector('.file-row input').click();await nextTick();assert.equal(played,0);document.querySelector('.save-selected').click();assert.deepEqual(saved,['ep1']);
 [...document.querySelectorAll('.breadcrumbs button')].find(b=>b.textContent==='全部文件').click();await nextTick();document.querySelector('.file-row input').click();await nextTick();document.querySelector('.save-selected').click();assert.deepEqual(saved,['wrap']);
 }finally{app.unmount()}
 const empty=mount(Details,{resource:{url:'https://pan.quark.cn/s/empty'},initialDetails:{title:'空',entries:[],videoCount:0,episodeCount:0}});
 try{await flush();assert.equal(document.querySelector('.save-all').disabled,true);assert.equal(document.querySelector('.save-selected').disabled,true);}finally{empty.unmount()}
});

test('直接播放保留发现元数据和提取码，不把替换片库或任意网址当作播放分享', () => {
  const media = discoveryMedia(discovered);
  const resource = { url: 'https://pan.quark.cn/s/valid?pwd=1234', password: '1234', quality: '1080P' };
  const result = resourcePlaybackMedia(media, resource, 'movie');
  assert.equal(result.catalogId, discovered.id); assert.equal(result.quarkPasscode, '1234'); assert.equal(result.quarkShareUrl, 'https://pan.quark.cn/s/valid');
  assert.equal(result.id, 'discovery:douban-123'); assert.equal(result.quarkFid, undefined);
  assert.throws(() => resourcePlaybackMedia({ ...media, quarkFid: 'saved' }, resource, 'movie'));
  assert.throws(() => resourcePlaybackMedia(media, { ...resource, url: 'https://example.com' }, 'movie'));
});

test('观看记录只展示一次，带进度、继续播放与删除；展开不会复制未看完记录', async () => {
  const entries = Array.from({ length: 22 }, (_, index) => ({ id: `history-${index}`, media: { ...media, title: `影片${index}` }, episodeFid: 'ep1', episodeNumber: 1, position: 120, duration: 600, completed: index === 0, updatedAt: '2026-10-14' }));
  let played, deleted;
  const app = mount(HistoryPage, { history: entries, onPlay: entry => { played = entry; }, onDelete: id => { deleted = id; } });
  try {
    assert.equal(document.querySelector('.continue-history-section'), null);
    assert.equal(document.querySelectorAll('.history-row').length, 20);
    assert.equal(document.querySelector('.history-play').textContent, '再看');
    assert.equal(document.querySelector('.history-progress i').style.width, '20%');
    document.querySelector('.load-more').click(); await nextTick();
    assert.equal(document.querySelectorAll('.history-row').length, 22);
    assert.equal(new Set([...document.querySelectorAll('.history-copy strong')].map(item => item.textContent)).size, 22);
    document.querySelectorAll('.history-main')[1].click(); assert.equal(played.id, 'history-1');
    document.querySelectorAll('.history-delete')[1].click(); assert.equal(deleted, 'history-1');
  } finally { app.unmount(); }
});

test('名称编辑保留原值，空名称不能提交，失败可重试，提交时阻止关闭', async () => {
  const state = reactive({ open: false, media, saving: false, error: '' });
  let saved, cancels = 0;
  const app = createApp({ render: () => h(TitleEditor, { ...state, onSave: value => { saved = value; }, onCancel: () => { cancels++; } }) });
  document.body.innerHTML = '<div id="mount"></div>'; app.mount('#mount');
  try {
    state.open = true; await nextTick();
    const input = document.querySelector('#media-title-input');
    assert.equal(input.value, media.title);
    input.value = '  正确名称  '; input.dispatchEvent(new window.Event('input', { bubbles: true })); await nextTick();
    document.querySelector('.title-sheet').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(saved, '正确名称');
    state.error = '网络错误'; await nextTick(); assert.equal(document.querySelector('#media-title-error').textContent, '网络错误');
    assert.equal(input.value, '  正确名称  ');
    state.saving = true; await nextTick();
    document.querySelector('.title-backdrop').click(); assert.equal(cancels, 0);
    assert.equal(input.disabled, true);
    state.saving = false; input.value = '  '; input.dispatchEvent(new window.Event('input', { bubbles: true })); await nextTick();
    assert.equal(document.querySelector('.save-title').disabled, true);
  } finally { app.unmount(); }
});

test('settings show no read-only identity; advanced configuration is an admin-only inner page', async t => {
  mockApi(t);
  for (const role of ['admin', 'user']) {
    const app = mount(Account, { user: user(role) });
    try {
      assert.doesNotMatch(document.body.textContent, /private_name|管理员账户|片库账户/);
      assert.equal(document.querySelectorAll('.theme-switch').length, 1);
      assert.equal(document.querySelector('.history-list'),null);
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

test('desktop library has one selected category and its library heading is not a competing link', () => {
  const app = mount(Sidebar, { user: user('admin'), activePage: 'library', category: 'movie', counts: { tv: 0, movie: 1, anime: 0, variety: 0 } });
  try {
    assert.equal(document.querySelectorAll('.desktop-sidebar .active').length, 1);
    assert.equal(document.querySelectorAll('[aria-current="page"]').length, 1);
    assert.match(document.querySelector('[aria-current="page"]').textContent, /电影/);
    assert.equal(document.querySelector('.nav-label').textContent, '收藏 / 追更');
    assert.ok(![...document.querySelectorAll('nav button')].some(button => button.textContent.trim() === '我的片库'));
  } finally { app.unmount(); }
});

test('one player control bar owns captions, episodes and settings without a duplicate page panel', async t => {
  mockApi(t);
  const app = mount(Player, { isOpen: true, media, username: 'fixture' });
  try {
    await flush();
    const controls = document.querySelector('.video-column > .player-controls');
    assert.ok(controls);
    assert.equal(document.querySelector('.player-panel'), null);
    assert.equal(document.querySelector('#episode-panel'), null);
    assert.equal(document.querySelectorAll('select[aria-label="选择影片字幕"]').length, 1);
    assert.ok(controls.querySelector('select[aria-label="选择影片字幕"]'));
    assert.equal(document.querySelector('.video-stage .mobile-controls'), null, 'inline transport stays below captions');
    const menu = controls.querySelector('#player-settings-menu');
    assert.equal(menu.style.display, 'none');
    const button = controls.querySelector('button[aria-label="播放设置"]');
    button.click(); await nextTick();
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.notEqual(menu.style.display, 'none');
    assert.ok(menu.querySelector('[aria-label="画质选择"]'));
    document.querySelector('[aria-label="画面显示方式"] button:last-child').click(); await nextTick();
    assert.equal(document.querySelector('video').style.objectFit, 'cover');
    assert.equal(document.querySelectorAll('.duration-input input').length, 0);
    document.querySelector('[aria-label="跳过片头片尾"]').click(); await flush();
    assert.equal(document.querySelectorAll('.duration-input input').length, 2);
    assert.equal(document.querySelector('[aria-label="片头时长（秒）"]').value, '30');
    assert.equal(document.querySelector('[aria-label="片尾时长（秒）"]').value, '45');
    menu.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await nextTick();
    assert.equal(menu.style.display, 'none'); assert.equal(document.activeElement,button);
    assert.equal(document.querySelector('[aria-label="选集与片源"]'), null);
    assert.ok(document.querySelector('.watch-details .episode-source-panel'));
    assert.ok(document.querySelector('main.player-page'));
    assert.equal(document.querySelector('[aria-modal="true"]'), null);
    assert.equal(document.querySelector('.rotated-player'), null);
  } finally { app.unmount(); }
});


test('Android player keeps one caption picker, pauses in background except PiP, and resumes without a blocking prompt', async t => {
  const previousAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android Chrome' });
  mockApi(t);
  const app = mount(Player, { isOpen: true, media, username: 'fixture' });
  const video = document.querySelector('video');
  let paused = false;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  video.pause = () => { paused = true; video.dispatchEvent(new window.Event('pause')); };
  video.play = async () => { paused = false; video.dispatchEvent(new window.Event('play')); video.dispatchEvent(new window.Event('playing')); };
  try {
    await flush(); await video.play(); await flush();
    assert.equal(document.querySelectorAll('select[aria-label="选择影片字幕"]').length, 1);
    assert.ok(document.querySelector('.player-controls select[aria-label="选择影片字幕"]'));
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: video });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new window.Event('visibilitychange')); await flush();
    assert.equal(paused, false, 'PiP continues while owning page is hidden');
    Object.defineProperty(document, 'pictureInPictureElement', { configurable: true, value: null });
    video.dispatchEvent(new window.Event('leavepictureinpicture')); await flush();
    assert.equal(paused, true, 'leaving PiP in background pauses playback');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new window.Event('visibilitychange')); await flush();
    document.querySelector('.stage-play-button').click(); await flush();
    assert.equal(paused, false); assert.equal(document.querySelector('.play-prompt'), null);
  } finally {
    app.unmount();
    if (previousAgent) Object.defineProperty(navigator, 'userAgent', previousAgent); else delete navigator.userAgent;
    delete document.visibilityState; delete document.pictureInPictureElement;
  }
});

test('Android settings offer browser installation guidance instead of an iOS profile', async () => {
  const previousAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android Chrome' });
  const app = mount(Account, { user: user('user'), history: [] });
  try {
    assert.equal(document.querySelector('a[href*="mobileconfig"]'), null);
    [...document.querySelectorAll('button')].find(button => button.textContent.includes('安装到桌面')).click(); await flush();
    assert.match(document.querySelector('.install-hint').textContent, /Chrome/);
  } finally {
    app.unmount();
    if (previousAgent) Object.defineProperty(navigator, 'userAgent', previousAgent); else delete navigator.userAgent;
  }
});

test('new viewers get Chinese captions automatically; a manual off choice persists when tracks arrive later', async () => {
  const video = document.createElement('video');
  const props = reactive({ video, username: 'automatic-caption-fixture' });
  const app = mount(Subtitles, props);
  try {
    await flush();
    video.textTracks.push({ kind: 'subtitles', label: 'English', language: 'en', mode: 'disabled' }, { kind: 'subtitles', label: '中文', language: 'zh', mode: 'disabled' }, { kind: 'metadata', mode: 'hidden' });
    video.textTracks.dispatchEvent(new window.Event('addtrack')); await nextTick();
    assert.equal(video.textTracks[1].mode, 'showing'); assert.equal(video.textTracks[2].mode, 'hidden');
    const picker = document.querySelector('select'); picker.value = 'off'; picker.dispatchEvent(new window.Event('change')); await nextTick();
    video.dispatchEvent(new window.Event('subtitletracksupdated')); await nextTick();
    assert.equal(video.textTracks[1].mode, 'disabled'); assert.equal(picker.value, 'off');
  } finally { app.unmount(); }
});

test('movies display named files instead of an episode number or unlabeled dots', async t => {
  mockApi(t); const app = mount(Player, { isOpen: true, media: { ...media, category: 'movie' }, username: 'movie-label-fixture' });
  try {
    await flush();
    assert.ok(document.querySelector('[aria-label="视频列表"]'));
    assert.doesNotMatch(document.querySelector('.title-copy').textContent, /第.*集/);
    assert.match(document.querySelector('.episodes button').textContent, /1.mp4/);
  } finally { app.unmount(); }
});

test('native fullscreen subtitle choices are respected and retained after exiting', async () => {
  const video = document.createElement('video');
  video.textTracks.push({ kind: 'subtitles', label: '中文', language: 'zh', mode: 'disabled' });
  const props = reactive({ video, username: 'native-caption-fixture', nativeFullscreen: true });
  const app = mount(Subtitles, props);
  try {
    await flush();
    video.textTracks[0].mode = 'showing';
    video.textTracks.dispatchEvent(new window.Event('change'));
    await nextTick();
    assert.equal(video.textTracks[0].mode, 'showing', 'page preferences must not override the native picker');
    props.nativeFullscreen = false; await nextTick();
    assert.equal(video.textTracks[0].mode, 'showing');
    assert.equal(document.querySelector('select').value, 'native:0');
    const key = Object.keys(localStorage).find(key => key.includes('native-caption-fixture'));
    const choice = localStorage.getItem(key);
    props.nativeFullscreen = true; await nextTick();
    video.textTracks.splice(0);
    video.textTracks.dispatchEvent(new window.Event('removetrack'));
    await nextTick();
    assert.equal(localStorage.getItem(key), choice, 'an unavailable track list is not a user choice to disable subtitles');
  } finally { app.unmount(); }
});

test('captions arriving during native fullscreen start automatically, while a native off choice stays off', async () => {
  const video = document.createElement('video');
  const props = reactive({ video, username: 'late-native-caption-fixture', nativeFullscreen: true });
  const app = mount(Subtitles, props);
  try {
    await flush();
    video.textTracks.push({ kind: 'subtitles', label: '中文', language: 'zh', mode: 'hidden' });
    video.textTracks.dispatchEvent(new window.Event('addtrack')); await nextTick();
    assert.equal(video.textTracks[0].mode, 'showing');
    video.textTracks[0].mode = 'disabled'; video.textTracks.dispatchEvent(new window.Event('change')); await nextTick();
    video.dispatchEvent(new window.Event('subtitletracksupdated')); await nextTick();
    assert.equal(video.textTracks[0].mode, 'disabled');
  } finally { app.unmount(); }
});

test('a temporary hidden state in native fullscreen does not become a persisted off preference', async () => {
 const video=document.createElement('video');video.textTracks.push({kind:'subtitles',label:'中文',language:'zh',mode:'disabled'});
 const props=reactive({video,username:'native-handoff-fixture',nativeFullscreen:true});const app=mount(Subtitles,props);
 try{await flush();video.textTracks[0].mode='hidden';video.textTracks.dispatchEvent(new window.Event('change'));await nextTick();assert.equal(video.textTracks[0].mode,'hidden');props.nativeFullscreen=false;await nextTick();assert.equal(video.textTracks[0].mode,'showing');assert.notEqual(localStorage.getItem('misty_rain_subtitles:native-handoff-fixture'),'off');}finally{app.unmount()}
});

test('native selection of an equivalent filtered track preserves its language instead of turning all captions off', async () => {
 const video=document.createElement('video');video.textTracks.push({kind:'subtitles',label:'中文',language:'zh',mode:'disabled'});
 const hls={subtitleTracks:[{name:'中文',lang:'zh'}],subtitleTrack:-1,subtitleDisplay:false,constructor:{Events:{SUBTITLE_TRACKS_UPDATED:'updated',SUBTITLE_TRACK_SWITCH:'switch',SUBTITLE_TRACKS_CLEARED:'cleared'}},on(){},off(){}};
 const app=mount(Subtitles,{video,hls,username:'native-equivalent-fixture',nativeFullscreen:true});
 try{await flush();hls.subtitleDisplay=false;hls.subtitleTrack=-1;video.textTracks[0].mode='showing';video.textTracks.dispatchEvent(new window.Event('change'));await nextTick();assert.notEqual(localStorage.getItem('misty_rain_subtitles:native-equivalent-fixture'),'off');assert.equal(hls.subtitleDisplay,true);}finally{app.unmount()}
});

test('searching new content updates the save title; replacing an existing source retains its identity', async t => {
  mockApi(t);
  let transfer;
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ setup() { transfer = useQuarkTransfer(); return () => h('div'); } }); app.mount('#mount');
  try {
    await transfer.openTransferModal({ ...media, id: 'new-search', quarkFid: undefined, title: '首次搜索', poster: 'old-poster', catalogId: 'douban-123', year: '2026' });
    await transfer.refreshResources('新片名');
    assert.equal(transfer.currentMedia.value.title, '新片名');
    assert.equal(transfer.currentMedia.value.poster, '');
    assert.equal(transfer.currentMedia.value.catalogId, undefined);
    assert.equal(transfer.currentMedia.value.year, undefined);
    await transfer.openTransferModal(media);
    await transfer.refreshResources('测试影片的别名');
    assert.equal(transfer.currentMedia.value.title, media.title);
    assert.equal(transfer.currentMedia.value.quarkFid, media.quarkFid);
  } finally { transfer.closeTransferModal(); app.unmount(); }
});

test.after(() => { dom.window.close(); fs.rmSync(folder, { recursive: true, force: true }); });

test('three episode views retain sort and current identity, with only whole-series collection', async t => {
  mockApi(t); const collected=[];
  const item={...media,quarkFid:undefined,quarkShareUrl:'https://pan.quark.cn/s/fixture'};
  const app=mount(Player,{isOpen:true,media:item,username:'panel-fixture',collect:async value=>collected.push(value)});
  try {
    await flush();
    const panel=document.querySelector('.watch-details .episode-source-panel');assert.ok(panel);
    assert.equal(document.querySelector('.episode-actions'),null);assert.doesNotMatch(panel.textContent,/收藏本集/);
    assert.equal(panel.querySelectorAll('.resource-thumbnail').length,2);
    panel.querySelector('[aria-label="紧凑列表"]').click();await nextTick();
    assert.equal(panel.querySelector('.resource-thumbnail'),null);assert.ok(panel.querySelector('.view-compact'));
    panel.querySelector('[aria-label="数字格"]').click();await nextTick();
    assert.equal(panel.querySelector('.resource-thumbnail'),null);assert.equal(panel.querySelector('.episodes button').textContent,'1');
    const order=panel.querySelector('[aria-label="选集排序"]');order.value='desc';order.dispatchEvent(new window.Event('change'));await nextTick();
    assert.equal(panel.querySelector('.episodes button').textContent,'2');
    assert.equal(panel.querySelector('.episodes [aria-selected="true"]').textContent,'1');
    assert.equal(localStorage.getItem('misty_rain_episode_view'),'numbers');
    document.querySelector('.watch-summary .collect-series').click();await flush();
    assert.deepEqual(collected,[item]);
  } finally {app.unmount();localStorage.removeItem('misty_rain_episode_order');localStorage.removeItem('misty_rain_episode_view');}
});

const { findPlaybackCandidates } = await compile('src/services/playbackCandidates.ts','playback-candidates');
const { replacementEpisodeIndex } = await compile('src/services/playbackNavigation.ts','playback-switch-navigation');
test('background source prefetch checks only a bounded batch, excludes cancelled/current shares and never transfers',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options={})=>{
  calls.push(String(url));
  if(String(url).includes('/validate')){const items=JSON.parse(options.body).items;assert.ok(items.length<=12);return Response.json({code:0,data:{pending:false,entries:items.map((item,index)=>({...item,status:index===0?'unavailable':'available'}))}});}
  assert.match(String(url),/background=1/);
  return Response.json({code:0,data:{total:20,refreshing:false,merged_by_type:{quark:Array.from({length:20},(_,i)=>({url:`https://pan.quark.cn/s/source${i}`,note:'测试剧 '+i}))}}});
 });
 const result=await findPlaybackCandidates('测试剧','https://pan.quark.cn/s/source0',new AbortController().signal,()=>{});
 assert.equal(result.length,5);assert.ok(!result.some(item=>/source[01]$/.test(item.url)));assert.equal(calls.length,2);assert.ok(calls.every(url=>url.includes('resource-search')));
});
test('leaving playback cancels the background HTTP request and prevents later publication',async t=>{
 let requested, published=0; t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((_resolve,reject)=>{requested=signal;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});}));
 const controller=new AbortController();const task=findPlaybackCandidates('测试剧','',controller.signal,()=>published++);controller.abort();await task;
 assert.equal(requested.aborted,true);assert.equal(published,0);
});
test('a source switch matches season and episode, refusing a missing episode instead of jumping',()=>{
 const list=[{fileName:'s2e2',seasonNumber:2,episodeNumber:2},{fileName:'s1e2',seasonNumber:1,episodeNumber:2}];
 assert.equal(replacementEpisodeIndex(list,{fileName:'old',seasonNumber:1,episodeNumber:2},'tv'),1);
 assert.equal(replacementEpisodeIndex(list,{fileName:'old',seasonNumber:1,episodeNumber:3},'tv'),-1);
 assert.equal(replacementEpisodeIndex(list,{fileName:'s2e2',episodeNumber:0},'tv'),0);
});

test('background source prefetch aborts a stalled request at its twenty-second deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let requestSignal;
 t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((_resolve,reject)=>{requestSignal=signal;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})}));
 const task=findPlaybackCandidates('测试剧','',new AbortController().signal,()=>assert.fail('no late publication'));
 t.mock.timers.tick(20_001);await task;assert.equal(requestSignal.aborted,true);
});

test('fullscreen moves the same episode panel and restores its compact view when exiting', async t => {
  mockApi(t);
  const original=document.exitFullscreen;
  const originalRequest=window.HTMLElement.prototype.requestFullscreen;
  window.HTMLElement.prototype.requestFullscreen=async function(){Object.defineProperty(document,'fullscreenElement',{configurable:true,value:this});document.dispatchEvent(new window.Event('fullscreenchange'));};
  document.exitFullscreen=async()=>{Object.defineProperty(document,'fullscreenElement',{configurable:true,value:null});document.dispatchEvent(new window.Event('fullscreenchange'));};
  const app=mount(Player,{isOpen:true,media,username:'fullscreen-layout'});
  try{
    await flush();const video=document.querySelector('video');Object.defineProperty(video,'readyState',{configurable:true,value:1});
    const panel=document.querySelector('.episode-source-panel');panel.querySelector('[aria-label="紧凑列表"]').click();await flush();
    document.querySelector('[aria-label="全屏播放"]').click();await flush();
    assert.equal(document.querySelectorAll('.episode-source-panel').length,1);assert.ok(panel.closest('.settings-menu'));
    document.querySelector('[aria-label="选集与片源"]').click();await flush();assert.notEqual(document.querySelector('.settings-menu').style.display,'none');
    await document.exitFullscreen();await flush();assert.equal(document.querySelector('.watch-details .episode-source-panel'),panel);assert.ok(panel.querySelector('.view-compact'));assert.equal(panel.querySelectorAll('[aria-selected="true"]').length,1);
  }finally{app.unmount();document.exitFullscreen=original;window.HTMLElement.prototype.requestFullscreen=originalRequest;localStorage.removeItem('misty_rain_episode_view');}
});
