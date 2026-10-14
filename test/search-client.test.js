import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

// Transform only the service and its small dependencies in memory.
const compiled = await build({ entryPoints: ['src/services/silentSearchEngine.ts'], bundle: true, write: false,
  format: 'esm', platform: 'node', define: { 'import.meta.env.BASE_URL': '"/misty-rain/"' }, logLevel: 'silent' });
const { SilentSearchEngine } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const transferCompiled = await build({ entryPoints: ['src/composables/useQuarkTransfer.ts'], bundle: true, write: false,
  format: 'esm', platform: 'browser', define: { 'import.meta.env.BASE_URL': '"/misty-rain/"', 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent' });
const { useQuarkTransfer } = await import(`data:text/javascript;base64,${Buffer.from(transferCompiled.outputFiles[0].text).toString('base64')}`);
const data = (extra = {}) => ({ total: 1, merged_by_type: { quark: [{ url: 'https://pan.quark.cn/s/abc', note: '测试剧 4K' }] }, ...extra });

test('失败及空结果仅请求本站，浏览器不再重复访问同一公共备用源', async t => {
  const calls = [];
  let mode = 'failed';
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));
    return mode === 'failed' ? Response.json({ code: 'RESOURCE_SEARCH_TIMEOUT', message: '检索来源响应超时，请稍后重试' }, { status: 503 })
      : Response.json({ code: 0, data: { total: 0, merged_by_type: { quark: [] } } });
  });
  const failed = await new SilentSearchEngine().search('测试剧');
  assert.equal(failed.success, false);
  assert.match(failed.message, /超时/);
  mode = 'empty';
  const empty = await new SilentSearchEngine().search('测试剧');
  assert.equal(empty.success, true);
  assert.equal(empty.total, 0);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.startsWith('/misty-rain/api/resource-search?')));
});

test('节流等待期间重复点击和刷新复用请求，所有调用收到一致错误结果', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return Response.json({ code: 'UNAVAILABLE', message: '检索来源暂时不可用' }, { status: 503 }); });
  const service = new SilentSearchEngine();
  await service.search('先前剧');
  const [first, second] = await Promise.all([service.search('测试剧'), service.search('测试剧', { force: true })]);
  assert.equal(calls, 2);
  assert.equal(first.success, false);
  assert.deepEqual(first, second);
});

test('缓存/补充状态传给页面，补充查询只读取服务端缓存并解除旧的客户端结果缓存', async t => {
  const calls = [];
  let complete = false;
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));
    return Response.json({ code: 0, data: data(complete ? { partial: false, refreshing: false }
      : { stale: true, partial: true, refreshing: true, message: '正在补充' }) });
  });
  const service = new SilentSearchEngine();
  const first = await service.search('测试剧');
  assert.equal(first.refreshing, true);
  assert.equal(first.stale, true);
  assert.equal(first.message, '正在补充');
  complete = true;
  const latest = await service.readCached('测试剧');
  assert.equal(latest.refreshing, false);
  assert.match(calls[1], /cached=1/);
  await service.search('测试剧');
  assert.equal(calls.length, 3);
});

test('登录失效直接返回，不绕过本站认证发起公共检索', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls += 1; return Response.json({ code: 'APP_AUTH_REQUIRED', message: '请先登录' }, { status: 401 }); });
  const result = await new SilentSearchEngine().search('测试剧');
  assert.equal(result.success, false);
  assert.equal(result.message, '请先登录');
  assert.equal(calls, 1);
});

test('首批结果立即可用，慢通道候选自动补齐；关闭面板后不再轮询', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10_000 });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));
    const cached = String(url).includes('cached=1');
    const result = data({ partial: !cached, refreshing: !cached, message: cached ? '' : '正在补充' });
    if (cached) result.merged_by_type.quark.push({ url: 'https://pan.quark.cn/s/second', note: '补充来源' });
    return Response.json({ code: 0, data: result });
  });
  const view = useQuarkTransfer();
  await view.openTransferModal({ title: '仙逆渐进测试', category: 'anime' });
  assert.equal(view.isAnalyzing.value, false);
  assert.equal(view.quarkResources.value.length, 1);
  assert.equal(calls.length, 1);
  t.mock.timers.tick(1_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.quarkResources.value.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(view.searchNotice.value, '');
  await view.openTransferModal({ title: '仙逆关闭测试', category: 'anime' });
  view.closeTransferModal();
  t.mock.timers.tick(10_000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3);
});

test('页面等待真正后台完成，超过旧的 8 秒轮询窗口仍接收补齐的正篇候选', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  let polls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    const cached = String(url).includes('cached=1');
    if (cached) polls += 1;
    const complete = polls >= 12;
    const result = data({ partial: !complete, refreshing: !complete, message: complete ? '' : '继续补查' });
    if (complete) result.merged_by_type.quark.push({ url: 'https://pan.quark.cn/s/mainseries', note: '仙逆正篇' });
    return Response.json({ code: 0, data: result });
  });
  const view = useQuarkTransfer();
  await view.openTransferModal({ title: '仙逆长窗口测试', category: 'anime' });
  for (let i = 0; i < 12; i += 1) { t.mock.timers.tick(1_000); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(polls, 12);
  assert.equal(view.quarkResources.value.length, 2);
  assert.equal(view.searchPending.value, false);
  t.mock.timers.tick(10_000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(polls, 12);
});
