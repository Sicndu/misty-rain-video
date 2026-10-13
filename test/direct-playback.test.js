import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApiRequest } from '../server/api.js';
import { QuarkGateway } from '../server/quarkGateway.js';
import { TvPlaybackClient } from '../server/tvPlaybackClient.js';

const makeGateway = ({ format = 'mp4', download = true } = {}) => {
  const gateway = new QuarkGateway({
    credentialStore: { getCookie: () => 'private-cookie', getTvAuth: () => ({ refreshToken: 'private-token' }) },
    tvPlaybackClient: {
      getStreaming: async () => ({ video_list: [{ resolution: '4k', video_info: { url: `https://media.example.test/video.${format}`, format, width: 3840, height: 2160 } }] }),
      getDownload: async () => {
        if (!download) throw new Error('download denied');
        return { download_url: 'https://media.example.test/original.mkv', file_name: 'original.mkv' };
      }
    }
  });
  gateway.directPlaybackEnabled = true;
  gateway.sessions.set('session', {
    id: 'session', ownerUsername: 'admin', kind: 'drive', episodes: [{ fid: 'episode' }],
    sources: new Map(), assets: new Map(), assetIndex: new Map(), touchedAt: Date.now()
  });
  return gateway;
};

const responseSink = () => ({
  statusCode: 0, headersSent: false, headers: new Map(), body: '',
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
  end(body = '') { this.body = String(body); this.headersSent = true; }
});

const admin = { username: 'admin', role: 'admin', folder: 'admin' };
const api = async ({ gateway, url, method = 'GET', user = admin, tvPlaybackClient }) => {
  const response = responseSink();
  await handleApiRequest({ method, url, headers: { host: 'localhost' } }, response, {
    authService: { authenticate: () => user, assertSameOrigin() {} },
    userContext: () => ({}), quarkGateway: gateway, tvPlaybackClient
  });
  return response;
};

test('TV MP4 优先直连，公开数据不包含上游地址或网盘凭证', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  assert.equal(result.sources[0].delivery, 'direct');
  assert.equal(result.sources[0].isHls, false);
  assert.ok(result.sources[0].url.startsWith('/api/player/sessions/session/streams/'));
  assert.doesNotMatch(JSON.stringify(result), /private-cookie|private-token|media\.example|upstreamUrl|requestCookie/);
});

test('直连 GET 和 HEAD 只返回 302，不请求或转发媒体内容', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  gateway.fetchMedia = () => { throw new Error('must not proxy'); };
  for (const method of ['GET', 'HEAD']) {
    const response = await api({ gateway, url: result.sources[0].url, method });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.get('location'), 'https://media.example.test/video.mp4');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.body, '');
  }
});

test('其他用户无法通过直连端点获取上游地址', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  const response = await api({ gateway, url: result.sources[0].url, user: { username: 'other', folder: 'other', role: 'user' } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.headers.has('location'), false);
});

test('非 HTTPS 或本机上游地址不能作为直连目标', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  const { source } = gateway.getStreamSource('session', result.sources[0].id);
  for (const url of ['http://media.example.test/video.mp4', 'https://127.0.0.1/video.mp4']) {
    source.upstreamUrl = url;
    const response = await api({ gateway, url: result.sources[0].url });
    assert.equal(response.statusCode, 502);
    assert.equal(response.headers.has('location'), false);
  }
});

test('较旧的直连地址重新解析后再签发', async () => {
  const gateway = makeGateway();
  const result = await gateway.prepareEpisode('session', 'episode');
  const { source } = gateway.getStreamSource('session', result.sources[0].id);
  source.resolvedAt = Date.now() - 11 * 60 * 1000;
  gateway.tvPlaybackClient.getStreaming = async () => ({ video_list: [{ resolution: '4k', video_info: { url: 'https://media.example.test/fresh.mp4', format: 'mp4' } }] });
  assert.equal(await gateway.getDirectStreamUrl('session', source.id), 'https://media.example.test/fresh.mp4');
});

test('缺少 CORS 的 TV HLS 不会被标记为直连，并单独提供原文件选项', async () => {
  const gateway = makeGateway({ format: 'm3u8' });
  const result = await gateway.prepareEpisode('session', 'episode');
  assert.equal(result.sources[0].isHls, true);
  assert.equal(result.sources[0].delivery, 'proxy');
  const original = result.sources.find(source => source.resolution === 'original');
  assert.equal(original.delivery, 'direct');
  assert.equal(original.mimeType, 'video/x-matroska');
  assert.equal(await gateway.getDirectStreamUrl('session', result.sources[0].id), null);
});

test('没有原文件下载权限时仍保留 HLS 播放源', async () => {
  const gateway = makeGateway({ format: 'm3u8', download: false });
  const result = await gateway.prepareEpisode('session', 'episode');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].delivery, 'proxy');
});

test('TV 失效时回退网页源且继续代理，绝不把 Cookie 地址当成直链', async () => {
  const gateway = makeGateway();
  gateway.tvPlaybackClient.getStreaming = async () => { throw new Error('TV expired'); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 0, data: { video_list: [{ resolution: 'super', video_info: { url: 'https://media.example.test/web.mp4', format: 'mp4' } }] } });
  try {
    const result = await gateway.prepareEpisode('session', 'episode');
    assert.equal(result.sources[0].delivery, 'proxy');
  } finally { globalThis.fetch = originalFetch; }
});

test('强制代理模式不会优先使用 TV 或返回直连来源', async () => {
  const gateway = makeGateway();
  gateway.directPlaybackEnabled = false;
  gateway.tvPlaybackClient.getStreaming = async () => { throw new Error('must use web first'); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 0, data: { video_list: [{ resolution: 'super', video_info: { url: 'https://media.example.test/web.mp4', format: 'mp4' } }] } });
  try {
    const result = await gateway.prepareEpisode('session', 'episode');
    assert.equal(result.sources[0].delivery, 'proxy');
  } finally { globalThis.fetch = originalFetch; }
});

test('只有管理员可以创建与确认 TV 认证会话', async () => {
  for (const url of ['/api/player/tv-auth/sessions', '/api/player/tv-auth/sessions/qr']) {
    const response = await api({ url, method: 'POST', user: { username: 'user', role: 'user' }, tvPlaybackClient: {} });
    assert.equal(response.statusCode, 403);
  }
  const calls = [];
  const tvPlaybackClient = {
    createQrSession: async owner => { calls.push(['create', owner]); return { sessionId: 'qr' }; },
    pollQrSession: async (id, owner) => { calls.push(['poll', id, owner]); return { state: 'pending' }; }
  };
  await api({ url: '/api/player/tv-auth/sessions', method: 'POST', tvPlaybackClient });
  await api({ url: '/api/player/tv-auth/sessions/qr', method: 'POST', tvPlaybackClient });
  assert.deepEqual(calls, [['create', 'admin'], ['poll', 'qr', 'admin']]);
});

test('TV 二维码会话绑定管理员，过期会话不能兑换令牌', async () => {
  const client = new TvPlaybackClient({});
  client.authSessions.set('qr', { ownerUsername: 'admin', createdAt: Date.now() });
  await assert.rejects(client.pollQrSession('qr', 'other'), error => error.code === 'TV_QR_FORBIDDEN');
  client.authSessions.get('qr').createdAt -= 6 * 60 * 1000;
  assert.deepEqual(await client.pollQrSession('qr', 'admin'), { state: 'expired' });
});
