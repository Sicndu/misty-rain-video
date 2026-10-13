import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { ResourceSearchService } from '../server/resourceSearch.js';

const payload = {
  code: 0,
  data: { merged_by_type: { quark: [{ url: 'https://pan.quark.cn/s/example123', note: '测试片源' }] } }
};

test('缓存搜索返回 JSON 后附加 gzip 数据时，请求原始响应避免丢失已有结果', async () => {
  const json = JSON.stringify(payload);
  const malformed = Buffer.concat([Buffer.from(json), gzipSync(json)]);
  let calls = 0;
  const search = new ResourceSearchService({
    urls: ['http://127.0.0.1:8888/api/search'],
    fetchImpl: async (_url, { headers }) => {
      calls += 1;
      // Reproduce the observed PanSou response for clients that negotiate compression.
      return new Response(headers['Accept-Encoding'] === 'identity' ? json : malformed, {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  const result = await search.search('仙逆');
  assert.equal(result.total, 1);
  assert.equal(result.merged_by_type.quark[0].url, 'https://pan.quark.cn/s/example123');
  assert.equal(calls, 1);
});

test('无法避免的非法响应仍按上游故障处理，不截断为成功结果', async () => {
  const search = new ResourceSearchService({
    urls: ['http://127.0.0.1:8888/api/search'],
    fetchImpl: async () => new Response(JSON.stringify(payload) + 'invalid trailing content')
  });
  await assert.rejects(search.search('测试'), error => error.code === 'RESOURCE_SEARCH_UNAVAILABLE');
  assert.equal(search.cache.size, 0);
});
