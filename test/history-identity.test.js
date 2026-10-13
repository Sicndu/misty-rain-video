import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';

const { code } = await transform(fs.readFileSync('src/services/historyIdentity.ts', 'utf8'), { loader: 'ts', format: 'esm' });
const { sameMediaIdentity } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('记录同步删除按目录或媒体ID匹配，不按片名扩大删除范围', () => {
  assert.equal(sameMediaIdentity({ id: 'quark:one' }, { id: 'new-card', quarkFid: 'one' }), true);
  assert.equal(sameMediaIdentity({ id: 'local' }, { id: 'local' }), true);
  assert.equal(sameMediaIdentity({ id: 'same', quarkFid: 'one' }, { id: 'same', quarkFid: 'two' }), false);
  assert.equal(sameMediaIdentity({ id: 'one' }, { id: 'two' }), false);
});
