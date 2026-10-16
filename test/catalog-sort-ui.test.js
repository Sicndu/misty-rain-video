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
const folder = fs.mkdtempSync('.local-runtime/tests/catalog-sort-');
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
const Catalog = (await compile('src/components/media/CatalogSearchPage.vue')).default;
const Discovery = (await compile('src/components/media/DiscoveryPage.vue')).default;
const { sortCatalogItems } = await compile('src/services/catalogSort.ts');
const items = [
  { id: 'douban-1', title: '热门旧作', rating: 7.2, ratingCount: 1000, year: '2022' },
  { id: 'douban-2', title: '高分新作', rating: 9.1, ratingCount: 123, year: '2025' },
  { id: 'douban-3', title: '待播', rating: null, ratingCount: 0, year: '2027' },
  { id: 'douban-4', title: '信息未知', rating: null, ratingCount: null, year: '' }
].map(item => ({ ...item, category: 'tv', provider: 'douban', subtitle: '', description: '', poster: '', sourceUrl: '' }));
const flush = async () => { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); await nextTick(); } };

test('rating, real rating count and year sorts put missing values last and preserve ties without mutating source order', () => {
  const keys = sort => sortCatalogItems(items, sort).map(item => item.id);
  assert.deepEqual(keys('rating'), ['douban-2', 'douban-1', 'douban-3', 'douban-4']);
  assert.deepEqual(keys('popularity'), ['douban-1', 'douban-2', 'douban-3', 'douban-4']);
  assert.deepEqual(keys('time'), ['douban-3', 'douban-2', 'douban-1', 'douban-4']);
  assert.deepEqual(keys('recommended'), items.map(item => item.id));
});

for (const [component, label, selector] of [[Catalog, '影片排序', '.catalog-card strong'], [Discovery, '发现排序', '.discovery-title']]) {
  test(`${label} reorders current cards without a network request, and selection still emits the correct item`, async t => {
    let calls = 0, selected;
    t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ code: 0, data: { items, sections: [
      { id: 'tv', category: 'tv', title: '近期热播', source: '豆瓣', sourceUrl: '', items, updatedAt: '', refreshing: false }
    ] } }); });
    document.body.innerHTML = '<div id="mount"></div>';
    const app = createApp({ render: () => h(component, { query: '新作', active: true, libraryCatalogIds: [], onSelect: item => { selected = item; } }) });
    app.mount('#mount');
    try {
      await flush(); const count = calls;
      const select = document.querySelector(`select[aria-label="${label}"]`);
      for (const [sort, first] of [['rating', '高分新作'], ['popularity', '热门旧作'], ['time', '待播']]) {
        select.value = sort; select.dispatchEvent(new window.Event('change', { bubbles: true })); await flush();
        assert.equal(document.querySelector(selector).textContent, first);
      }
      assert.equal(calls, count); assert.match(select.title, /年份/);
      document.querySelector(selector).closest('button').click(); assert.equal(selected.id, 'douban-3');
      assert.match(select.textContent, /评价人数/);
    } finally { app.unmount(); }
  });
}
