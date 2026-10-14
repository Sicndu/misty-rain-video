import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApiRequest } from '../server/api.js';

const createResponse = () => ({
  statusCode: 0,
  headersSent: false,
  headers: new Map(),
  body: '',
  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), value);
  },
  end(body = '') {
    this.body = String(body);
    this.headersSent = true;
  }
});

const createContext = calls => {
  const userData = {
    mediaRepository: {
      remove: id => calls.push(['remove', id]),
      removeFid: fid => calls.push(['removeFid', fid])
    },
    playbackHistory: {
      removeByMediaFid: fid => calls.push(['removeHistoryFid', fid]),
      removeByMediaId: id => calls.push(['removeHistoryId', id])
    }
  };
  return {
    authService: {
      authenticate: () => ({ username: 'admin', folder: 'admin', role: 'admin' }),
      assertSameOrigin: () => calls.push(['assertSameOrigin'])
    },
    userContext: () => userData,
    quarkGateway: {
      trashLibraryItem: async fid => {
        calls.push(['trashLibraryItem', fid]);
        return { deletedCount: 1, deletedFid: fid };
      }
    }
  };
};

const deleteMedia = async url => {
  const calls = [];
  const response = createResponse();
  const handled = await handleApiRequest({
    method: 'DELETE',
    url,
    headers: { host: 'localhost' },
    socket: { remoteAddress: '127.0.0.1' }
  }, response, createContext(calls));
  return { handled, calls, response, payload: JSON.parse(response.body) };
};

test('删除云端卡片只使用明确的目录 FID', async () => {
  const result = await deleteMedia('/api/media-cards?id=quark%3Alegacy-fid&quarkFid=exact-fid&title=重复片名');

  assert.equal(result.handled, true);
  assert.equal(result.response.statusCode, 200);
  assert.equal(result.payload.code, 0);
  assert.deepEqual(result.calls, [
    ['assertSameOrigin'],
    ['trashLibraryItem', 'exact-fid'],
    ['removeFid', 'exact-fid'],
    ['removeHistoryFid', 'exact-fid']
  ]);
});

test('旧客户端的 quark:<fid> 卡片标识仍执行精确删除', async () => {
  const result = await deleteMedia('/api/media-cards?id=quark%3Alegacy-fid&title=重复片名');

  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.calls, [
    ['assertSameOrigin'],
    ['trashLibraryItem', 'legacy-fid'],
    ['removeFid', 'legacy-fid'],
    ['removeHistoryFid', 'legacy-fid']
  ]);
});

test('仅本地卡片不会调用云端目录删除', async () => {
  const result = await deleteMedia('/api/media-cards?id=local-card');

  assert.equal(result.response.statusCode, 200);
  assert.deepEqual(result.calls, [
    ['assertSameOrigin'],
    ['remove', 'local-card'],
    ['removeHistoryId', 'local-card']
  ]);
});

test('维护状态只按当前登录用户读取，不接受查询参数选择其他用户', async () => {
  const calls = [];
  const context = createContext(calls);
  context.libraryMaintenance = { status: user => ({ folder: user.folder, items: [] }) };
  const response = createResponse();
  await handleApiRequest({ method: 'GET', url: '/api/library-maintenance?user=someone-else', headers: { host: 'localhost' } }, response, context);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).data, { folder: 'admin', items: [] });
});

test('未登录不能读取维护状态', async () => {
  const context = createContext([]);
  context.authService.authenticate = () => { throw Object.assign(new Error('请登录'), { statusCode: 401, code: 'APP_AUTH_REQUIRED' }); };
  context.libraryMaintenance = { status: () => assert.fail('Unauthenticated status access') };
  const response = createResponse();
  await handleApiRequest({ method: 'GET', url: '/api/library-maintenance', headers: { host: 'localhost' } }, response, context);
  assert.equal(response.statusCode, 401);
});
