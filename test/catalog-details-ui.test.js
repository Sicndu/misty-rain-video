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
const { createApp, h, nextTick } = await import('vue');
fs.mkdirSync('.local-runtime/tests', { recursive: true });
const folder = fs.mkdtempSync('.local-runtime/tests/catalog-details-');
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
const Detail = (await compile('src/components/media/FilmDetailPage.vue')).default;
const { subjectIdFromHash } = await compile('src/services/catalogDetails.ts');
const item = (id = 'douban-123') => ({ id, provider: 'douban', title: '测试影片', category: 'tv', poster: '', year: '2026', rating: 8.1, ratingCount: 11, subtitle: '', description: '测试简介', sourceUrl: '' });
const details = (id = 'douban-123') => ({ ...item(id), originalTitle: 'Original', genres: ['剧情'], countries: ['中国大陆'], languages: ['汉语'], premieres: ['2026-01-01'], durations: [], aliases: [], episodeCount: 24, directors: [], credits: [], photos: [], comments: [], honors: [], partial: false, stale: false });
const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick(); } };

test('detail hash routes accept only provider identities, including refresh links', () => {
  assert.equal(subjectIdFromHash('#/subject/douban-123'), 'douban-123');
  assert.equal(subjectIdFromHash('#/subject/bangumi-123'), 'bangumi-123');
  for (const hash of ['#/watch/123', '#/subject/douban-0', '#/subject/https://example.com', '#/subject/douban-123/..']) assert.equal(subjectIdFromHash(hash), '');
});
test('opening details and reading metadata never searches or plays; the explicit button passes correct title and durable poster', async t => {
  const urls = []; let searched, played = 0;
  t.mock.method(globalThis, 'fetch', async url => { urls.push(url); return Response.json({ code: 0, data: details() }); });
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(Detail, { id: 'douban-123', seed: item(), collected: true, onSearch: item => { searched = item; }, onPlayCollection: () => played++ }) });
  app.mount('#mount'); t.after(() => app.unmount()); await flush();
  assert.deepEqual(urls, ['/api/catalog/subjects/douban-123']); assert.equal(searched, undefined); assert.equal(played, 0);
  assert.match(document.body.textContent, /全 24 集/); assert.match(document.body.textContent, /测试简介/);
  document.querySelector('.search-resources').click(); assert.equal(searched.id, 'douban-123'); assert.equal(searched.poster, '/api/discovery/posters/douban-123');
  document.querySelector('.play-collection').click(); assert.equal(played, 1); assert.equal(urls.length, 1);
});
test('late detail response cannot overwrite a newer subject; previous request is cancelled', async t => {
  const { ref } = await import('vue'); const id = ref('douban-123'), requests = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => requests.push({ url, options, resolve })));
  document.body.innerHTML = '<div id="mount"></div>';
  const app = createApp({ render: () => h(Detail, { id: id.value }) }); app.mount('#mount'); t.after(() => app.unmount());
  id.value = 'douban-456'; await nextTick(); assert.equal(requests[0].options.signal.aborted, true);
  requests[1].resolve(Response.json({ code: 0, data: { ...details('douban-456'), title: '新影片' } })); await flush();
  requests[0].resolve(Response.json({ code: 0, data: details() })); await flush();
  assert.equal(document.querySelector('h1').textContent, '新影片');
});
test('metadata failure retains matching seed and manual search, with a retry; no seed renders a clear failure instead of fake content', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  for (const seed of [item(), null]) {
    document.body.innerHTML = '<div id="mount"></div>'; let searched;
    const app = createApp({ render: () => h(Detail, { id: 'douban-123', seed, onSearch: item => { searched = item; } }) });
    app.mount('#mount'); await flush(); assert.match(document.body.textContent, /详情暂时无法加载/);
    if (seed) { document.querySelector('.search-resources').click(); assert.equal(searched.title, '测试影片'); }
    else assert.equal(document.querySelector('.search-resources'), null);
    app.unmount();
  }
});
