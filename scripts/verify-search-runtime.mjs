import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBundledResourceSearch } from '../server/bundledResourceSearch.js';

// Build-time smoke check, only run by the Docker build. No accounts, searches,
// or production volumes are used. Fail before publishing an unusable engine.
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'misty-search-runtime-'));
let engine;
try {
  engine = await startBundledResourceSearch({ appDir, dataDir, port: 18888 });
  if (!engine?.ready || engine.missingPlugins.length || !engine.plugins.includes('erxiaopan')) {
    throw new Error(`检索引擎启动/插件验证失败：${engine?.missingPlugins?.join(',') || 'erxiaopan unavailable'}`);
  }
  console.log('[resource-search] 生产运行时验证通过，erxiaopan 已加载');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await engine?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
