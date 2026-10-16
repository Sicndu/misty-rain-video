import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { transform } from 'esbuild';

const { code } = await transform(fs.readFileSync('src/services/subtitleTracks.ts', 'utf8'), { loader: 'ts', format: 'esm' });
const { subtitleTrackOptions, selectSubtitleTrack, activeSubtitleTrack, subtitlePreference, managedSubtitleTracks } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const videoFixture = () => ({ textTracks: [
  { kind: 'subtitles', label: '中文', language: 'zh', mode: 'showing' },
  { kind: 'captions', label: 'English', language: 'en', mode: 'disabled' },
  { kind: 'metadata', label: 'timing', language: '', mode: 'hidden' }
], querySelectorAll: () => [] });

test('内嵌字幕可选/关闭，元数据轨道保持不变', () => {
  const video = videoFixture();
  assert.equal(subtitleTrackOptions(video).length, 2);
  selectSubtitleTrack(video, null, 'native:1');
  assert.equal(video.textTracks[0].mode, 'disabled');
  assert.equal(video.textTracks[1].mode, 'showing');
  assert.equal(video.textTracks[2].mode, 'hidden');
  assert.equal(activeSubtitleTrack(video), 'native:1');
  selectSubtitleTrack(video, null, 'off');
  assert.equal(activeSubtitleTrack(video), 'off');
  assert.equal(selectSubtitleTrack(video, null, 'native:2'), false);
});

test('HLS字幕使用流媒体选择接口，并与文件字幕互斥', () => {
  const video = videoFixture();
  const hls = { subtitleTracks: [{ name: '中文字幕', lang: 'zh' }], subtitleTrack: -1, subtitleDisplay: false };
  selectSubtitleTrack(video, hls, 'hls:0');
  assert.equal(hls.subtitleTrack, 0);
  assert.equal(hls.subtitleDisplay, true);
  assert.equal(activeSubtitleTrack(video, hls), 'hls:0');
  selectSubtitleTrack(video, hls, 'native:1');
  assert.equal(hls.subtitleDisplay, false);
  assert.equal(hls.subtitleTrack, -1);
  assert.equal(video.textTracks[1].mode, 'showing');
  assert.notEqual(subtitlePreference({ origin: 'hls', language: 'zh' }), subtitlePreference({ origin: 'sidecar', language: 'zh' }));
});

test('Safari selection marks exactly one HTML default track and leaves a loading track alone', () => {
 const video=videoFixture();const elements=video.textTracks.slice(0,2).map(track=>({track,dataset:{subtitleOrigin:'sidecar'},default:false}));video.querySelectorAll=()=>elements;
 selectSubtitleTrack(video,null,'native:1');assert.equal(elements[1].default,true);assert.equal(elements[0].default,false);
 const loading={kind:'subtitles',label:'加载中',language:'zh',mode:'hidden'};video.textTracks.push(loading);managedSubtitleTracks.set(loading,{active:true,ready:false,origin:'embedded'});
 selectSubtitleTrack(video,null,'off');assert.equal(elements[1].default,false);assert.equal(loading.mode,'hidden');assert.ok(!subtitleTrackOptions(video).some(o=>o.label==='加载中'));
});
