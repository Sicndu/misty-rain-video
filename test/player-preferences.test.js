import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizePlayerPreferences } from '../server/playerPreferences.js';
import { PlayerPreferencesStore } from '../server/storage.js';

test('片头片尾可分别配置且支持0秒，不接受越界或非法值', () => {
  assert.deepEqual(normalizePlayerPreferences({ introSeconds: 0, outroSeconds: 120 }), {
    skipIntroOutro: false, autoNext: true, introSeconds: 0, outroSeconds: 120
  });
  for (const value of [-1, 601, 1.5, '90', null, NaN]) {
    assert.throws(() => normalizePlayerPreferences({ introSeconds: value }), error => error.code === 'INVALID_PLAYER_PREFERENCES');
  }
  assert.throws(() => normalizePlayerPreferences({ autoNext: 'true' }));
  for (const value of [null, [], 'invalid', 1]) assert.throws(() => normalizePlayerPreferences(value));
});

test('播放偏好按用户目录隔离并可在重启后恢复', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-preferences-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = new PlayerPreferencesStore(path.join(dir, 'first'));
  const second = new PlayerPreferencesStore(path.join(dir, 'second'));
  first.save({ skipIntroOutro: true, introSeconds: 30, outroSeconds: 60 });
  first.save({ introSeconds: 0 });
  assert.equal(second.get().introSeconds, 90);
  const restored = new PlayerPreferencesStore(path.join(dir, 'first')).get();
  assert.equal(restored.introSeconds, 0);
  assert.equal(restored.outroSeconds, 60);
  assert.equal(restored.skipIntroOutro, true);
});
