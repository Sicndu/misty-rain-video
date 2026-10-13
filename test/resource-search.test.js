import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ResourceSearchService } from '../server/resourceSearch.js';

const payload = (...ids) => ({ code: 0, data: { total: ids.length, merged_by_type: { quark: ids.map(id => ({ url: `https://pan.quark.cn/s/${id}`, note: '测试剧' })) } } });
const reply = (...ids) => Response.json(payload(...ids));
const flush = () => new Promise(resolve => setImmediate(resolve));
const gate = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const create = options => new ResourceSearchService({ urls: ['http://127.0.0.1:8888/api/search'], timeoutMs: 300,
  aggregationMs: 0, ...options });

test('快速通道先返回，慢通道继续补缓存；刷新与普通搜索合并为一份任务', async () => {
  const slow = gate();
  const seen = [];
  const service = create({ fetchImpl: async (url, options) => {
    seen.push({ url, signal: options.signal });
    return url.searchParams.get('src') === 'plugin' ? reply('fast') : slow.promise;
  } });
  const first = service.search('《测试剧》');
  const concurrent = service.search('测试剧', { force: true });
  const result = await first;
  assert.equal(result.total, 1);
  assert.equal(result.partial, true);
  assert.equal(result.refreshing, true);
  assert.equal(service.peek('测试剧').refreshing, true);
  assert.deepEqual(await concurrent, result);
  assert.equal(seen.length, 2);
  assert.ok(seen.every(({ url, signal }) => !signal.aborted && url.searchParams.get('cloud_types') === 'quark'));
  slow.resolve(reply('slow'));
  await flush();
  const cached = await service.search('测试剧');
  assert.equal(cached.total, 2);
  assert.equal(cached.partial, false);
  assert.equal(service.peek('测试剧').refreshing, false);
  assert.equal(service.peek('未知剧'), null);
  assert.equal(seen.length, 2);
});

test('空通道不会掩盖另一通道故障，不缓存成“未收录”；全渠道成功空结果才短暂缓存', async t => {
  t.mock.method(console, 'warn', () => {});
  let clock = 1_000_000;
  let fail = true;
  let calls = 0;
  const service = create({ now: () => clock, fetchImpl: async url => {
    calls += 1;
    return fail && url.searchParams.get('src') === 'tg' ? new Response('', { status: 503 }) : reply();
  } });
  await assert.rejects(service.search('测试剧'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
  assert.equal(service.cache.size, 0);
  fail = false; clock += 10_000;
  assert.equal((await service.search('测试剧')).total, 0);
  const before = calls;
  await service.search('测试剧');
  assert.equal(calls, before);
  clock += 11_000;
  await service.search('测试剧');
  assert.equal(calls, before + 2);
});

test('正文阻塞也受截止时间限制，没有逐级重试；失败渠道冷却时不重新轰炸', async t => {
  t.mock.method(console, 'warn', () => {});
  let clock = 1_000_000;
  let calls = 0;
  const signals = [];
  const service = create({ timeoutMs: 20, now: () => clock, fetchImpl: async (_url, options) => {
    calls += 1;
    signals.push(options.signal);
    return { ok: true, json: () => new Promise(() => {}) };
  } });
  await assert.rejects(service.search('测试剧'), { code: 'RESOURCE_SEARCH_TIMEOUT' });
  assert.equal(calls, 2);
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(service.inFlight.size, 0);
  await assert.rejects(service.search('另一部'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
  assert.equal(calls, 2);
  clock += 9_000;
  await assert.rejects(service.search('另一部'), { code: 'RESOURCE_SEARCH_TIMEOUT' });
  assert.equal(calls, 4);
});

test('限流尊重 Retry-After；故障隔离到单个通道', async t => {
  t.mock.method(console, 'warn', () => {});
  let clock = 1_000_000;
  const calls = [];
  const service = create({ now: () => clock, fetchImpl: async url => {
    const source = url.searchParams.get('src'); calls.push(source);
    return source === 'plugin' ? new Response('', { status: 429, headers: { 'Retry-After': '60' } }) : reply('tg');
  } });
  assert.equal((await service.search('测试剧')).total, 1);
  await flush();
  clock += 10_000;
  await service.search('另一部');
  assert.deepEqual(calls, ['plugin', 'tg', 'tg']);
});

test('过期缓存立即可读并后台刷新；持久化重启恢复，严格后台换源检索不用过期结果', async t => {
  t.mock.method(console, 'warn', () => {});
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-search-cache-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let clock = 1_000_000;
  const service = create({ dataDir, now: () => clock, fetchImpl: async () => reply('saved') });
  await service.search('测试剧'); await flush();
  clock += 6 * 60_000;
  const pending = gate();
  const restarted = create({ dataDir, now: () => clock, fetchImpl: async () => pending.promise });
  const cached = await restarted.search('测试剧');
  assert.equal(cached.stale, true);
  assert.equal(cached.total, 1);
  const strict = restarted.search('测试剧', { force: true });
  pending.resolve(new Response('', { status: 503 }));
  await assert.rejects(strict, { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
  const fallback = await restarted.search('测试剧', { force: true, allowStale: true });
  assert.equal(fallback.stale, true);
  assert.equal(fallback.cachedAt, cached.cachedAt);
});

test('并发有上限且给手动搜索预留容量，任务结束后释放名额', async () => {
  const pending = gate();
  const service = create({ fetchImpl: async () => pending.promise });
  const jobs = [service.search('一'), service.search('二')];
  await assert.rejects(service.search('追更', { priority: 'background' }), { code: 'RESOURCE_SEARCH_BUSY' });
  jobs.push(service.search('三'), service.search('四'));
  await assert.rejects(service.search('五'), { code: 'RESOURCE_SEARCH_BUSY' });
  pending.resolve({ ok: true, json: async () => payload('done') });
  await Promise.all(jobs); await flush();
  assert.equal(service.inFlight.size, 0);
  assert.equal((await service.search('五')).total, 1);
});

test('无效响应不能误报未收录；非夸克链接不返回给客户端', async t => {
  t.mock.method(console, 'warn', () => {});
  const invalid = create({ fetchImpl: async () => Response.json({ error: 'busy' }) });
  await assert.rejects(invalid.search('测试剧'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
  const service = create({ source: 'plugin', fetchImpl: async () => Response.json({ merged_by_type: { quark: [
    { url: 'https://example.test/s/abc' }, { url: 'https://pan.quark.cn.evil.test/s/abc' },
    { url: 'https://pan.quark.cn/s/valid', note: '正片' }
  ] } }) });
  assert.equal((await service.search('测试剧')).total, 1);
});

test('公共备用源每个关键词只请求一次，不复制本地的分通道请求或并发配置', async () => {
  const calls = [];
  const service = create({ urls: ['https://search.example/api/search'], fetchImpl: async (url, options) => {
    assert.equal(options.headers['Accept-Encoding'], undefined);
    calls.push(url); return reply('public');
  } });
  assert.equal((await service.search('仙逆')).total, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('src'), 'all');
  assert.equal(calls[0].searchParams.has('conc'), false);
});

test('复现第 228 字符后的重复 JSON，内置请求禁用压缩后正常返回', async () => {
  // Shape and byte-for-byte duplication captured from production; share ID
  // replaced with a synthetic ID of the same length.
  const base = { code: 0, message: 'success', data: { total: 1, merged_by_type: { quark: [{
    url: 'https://pan.quark.cn/s/example12345', password: '', note: '《仙逆剧场版 神临之战》夸克网盘下载链接',
    datetime: '2025-05-30T07:35:36Z', source: 'plugin:quark4k'
  }] } } };
  const raw = JSON.stringify(base);
  assert.equal(raw.length, 228);
  // Upstream bodyLogWriter forwards while buffering; the small-body branch
  // then writes the same bytes again. The legacy response.json() rejects it.
  await assert.rejects(new Response(raw + raw).json(), error => error instanceof SyntaxError && /position 228/.test(error.message));
  let requests = 0;
  const service = create({ fetchImpl: async (_url, options) => {
    requests += 1;
    const identity = options.headers['Accept-Encoding'] === 'identity';
    return new Response(identity ? raw : raw + raw, { headers: { 'Content-Type': 'application/json' } });
  } });
  const result = await service.search('仙逆');
  assert.equal(result.total, 1);
  assert.equal(result.partial, false);
  assert.equal(requests, 2);
});

test('忽略 identity 的异常来源仍报错，不截断、拼凑或缓存损坏 JSON', async t => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const raw = JSON.stringify(payload('xianni'));
  for (const suffix of [raw, '<html>upstream failed</html>', '\u001f\u008bgarbled']) {
    const service = create({ fetchImpl: async () => new Response(raw + suffix) });
    await assert.rejects(service.search('仙逆'), { code: 'RESOURCE_SEARCH_UNAVAILABLE' });
    assert.equal(service.cache.size, 0);
  }
  assert.ok(warnings.every(([, detail]) => detail.code === 'RESOURCE_SEARCH_INVALID_RESPONSE'));
});
