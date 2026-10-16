<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type Hls from 'hls.js';
import { Captions, ChevronDown } from '@lucide/vue';
import { activeSubtitleTrack, selectSubtitleTrack, subtitleTrackOptions, subtitlePreference, subtitlePreferenceKey, subtitleLanguageKey, centerSubtitleCue, subtitleEvents, type SubtitleTrackOption } from '../../services/subtitleTracks';
const props = defineProps<{ video: HTMLVideoElement; hls?: Hls | null; compact?: boolean; notice?: string; username?: string; nativeFullscreen?: boolean; loading?: boolean; readError?: string; mobileControlsVisible?: boolean }>();
const emit = defineEmits<{ (event: 'retry-embedded'): void }>();
const options = ref<SubtitleTrackOption[]>([]);
const selected = ref('off');
const error = ref('');
const preferenceKey = subtitlePreferenceKey(props.username);
let preference = 'auto';
try { preference = localStorage.getItem(preferenceKey) || 'auto'; } catch { /* Current session remains usable. */ }
let release = () => {};
let applying = false;
let generation = 0;
let lastActive = 'off';
const positionCues = () => {
  for (const track of Array.from(props.video.textTracks)) {
    if (!['subtitles', 'captions'].includes(track.kind) || track.mode !== 'showing') continue;
    let changed = false;
    for (const item of Array.from(track.activeCues || [])) {
      if (!('position' in item)) continue;
      const cue = item as VTTCue;
      changed = centerSubtitleCue(cue, props.mobileControlsVisible && !props.nativeFullscreen ? -5 : -2) || changed;
    }
    // Chromium can retain the old cue box after pausing. Refresh only changed
    // inline captions; preserve the selected track and native fullscreen picker.
    if (changed && props.video.paused && !props.nativeFullscreen) { track.mode = 'hidden'; track.mode = 'showing'; }
  }
};
watch([() => props.mobileControlsVisible, () => props.nativeFullscreen], positionCues);
const rememberNativeChoice = () => {
  const id = activeSubtitleTrack(props.video, props.hls);
  selected.value = id;
  if (!options.value.length) return;
  preference = subtitlePreference(options.value.find(option => option.id === id));
  try { localStorage.setItem(preferenceKey, preference); } catch { /* Native playback remains usable. */ }
};
const sync = () => {
  if (applying) return;
  try { preference = localStorage.getItem(preferenceKey) || 'auto'; } catch { /* Keep this session's preference. */ }
  options.value = subtitleTrackOptions(props.video, props.hls);
  const automatic = options.value.find(option => /^(zh|chi|zho)/i.test(option.language)) || options.value[0];
  const preferred = options.value.find(option => subtitlePreference(option) === preference)
    || (preference.includes(':language:') ? options.value.find(option => subtitleLanguageKey(option.language) === subtitleLanguageKey(preference.split(':language:')[1])) : undefined);
  const desired = preference === 'auto' ? automatic?.id : preference === 'off' ? 'off' : preferred?.id;
  if (desired && desired !== activeSubtitleTrack(props.video, props.hls)) {
    applying = true;
    selectSubtitleTrack(props.video, props.hls, desired);
    applying = false;
  }
  lastActive = activeSubtitleTrack(props.video, props.hls);
  selected.value = preference === 'auto' ? 'auto' : lastActive;
  positionCues();
};
watch(() => props.nativeFullscreen, (fullscreen, wasFullscreen) => {
  if (wasFullscreen && !fullscreen) {
    options.value = subtitleTrackOptions(props.video, props.hls);
    rememberNativeChoice();
  }
  sync();
});
const choose = (event: Event) => {
  const id = (event.target as HTMLSelectElement).value;
  const option = options.value.find(item => item.id === id);
  preference = id === 'auto' ? 'auto' : subtitlePreference(option);
  try { localStorage.setItem(preferenceKey, preference); } catch { /* Keep the active selection. */ }
  error.value = '';
  applying = true;
  if (id !== 'auto') selectSubtitleTrack(props.video, props.hls, id);
  applying = false;
  selected.value = id;
  sync();
};
const retry = () => {
  const element = Array.from(props.video.querySelectorAll('track')).find(item => item.track.mode === 'showing');
  if (!element) return;
  const url = new URL(element.src, location.href); url.searchParams.set('_retry', String(Date.now()));
  error.value = ''; element.src = url.toString();
};
watch([() => props.video, () => props.hls] as const, async ([video, hls]) => {
  release(); const seq = ++generation;
  await nextTick(); if (seq !== generation) return;
  const failed = () => { error.value = '字幕加载失败，可重试或选择其他字幕；影片仍可继续播放。'; };
  const loaded = () => { error.value = ''; sync(); };
  const tracks = Array.from(video.querySelectorAll('track'));
  const textTracks = new Set<TextTrack>();
  const bindCues = () => { for (const track of Array.from(video.textTracks)) if (!textTracks.has(track)) { track.addEventListener?.('cuechange', positionCues); textTracks.add(track); } };
  bindCues();
  const modeChanged = () => {
    if (applying) return;
    const current = activeSubtitleTrack(video, hls);
    const available = subtitleTrackOptions(video, hls);
    // A retired track or a temporary hidden track is not a native picker choice.
    if (props.nativeFullscreen && current !== lastActive
      && (available.some(item => item.id === current) || available.some(item => item.id === lastActive))) {
      options.value = available; rememberNativeChoice();
    }
    sync();
  };
  video.textTracks.addEventListener('change', modeChanged);
  const events = ['addtrack', 'removetrack'];
  events.forEach(event => video.textTracks.addEventListener(event, sync));
  video.textTracks.addEventListener('addtrack', bindCues);
  video.addEventListener('loadedmetadata', sync);
  video.addEventListener('subtitletracksupdated', sync);
  tracks.forEach(track => { track.addEventListener('load', loaded); track.addEventListener('error', failed); });
  const hlsEvents = hls ? subtitleEvents(hls) : [];
  hlsEvents.forEach(event => hls?.on(event, sync));
  sync();
  release = () => {
    video.textTracks.removeEventListener('change', modeChanged);
    events.forEach(event => video.textTracks.removeEventListener(event, sync));
    video.textTracks.removeEventListener('addtrack', bindCues);
    textTracks.forEach(track => track.removeEventListener?.('cuechange', positionCues));
    video.removeEventListener('loadedmetadata', sync);
    video.removeEventListener('subtitletracksupdated', sync);
    tracks.forEach(track => { track.removeEventListener('load', loaded); track.removeEventListener('error', failed); });
    hlsEvents.forEach(event => hls?.off(event, sync));
  };
}, { immediate: true });
onBeforeUnmount(() => { generation += 1; release(); });
</script>
<template>
  <div class="subtitle-controls" :class="{ compact }">
    <div class="subtitle-picker"><Captions class="captions-icon" aria-hidden="true" /><select aria-label="选择影片字幕" :value="selected" @change="choose">
      <option value="auto">{{ loading ? '正在读取字幕…' : options.length ? '字幕 · 自动' : '字幕 · 暂无可用轨道' }}</option>
      <option value="off">字幕关闭</option>
      <option v-for="option in options" :key="option.id" :value="option.id">{{ option.label }}</option>
    </select><ChevronDown aria-hidden="true" /></div>
    <template>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="error" role="alert">{{ error }} <button type="button" @click="retry">重试字幕</button></p>
      <p v-if="readError" role="status">{{ readError }} <button type="button" @click="emit('retry-embedded')">重试</button></p>
    </template>
  </div>
</template>
<style scoped>
.subtitle-picker { position: relative; }
.subtitle-picker > svg { position: absolute; right: 12px; top: 14px; width: 16px; height: 16px; pointer-events: none; color: var(--text-tertiary); }
.subtitle-picker > .captions-icon { right: auto; left: 10px; width: 18px; height: 18px; top: 13px; }
select { appearance: none; -webkit-appearance: none; box-sizing: border-box; display: block; width: 100%; height: 44px; padding: 0 32px 0 36px; border: 1px solid var(--divider); border-radius: 8px; color: var(--text-primary); background: var(--surface-2); font: inherit; font-size: 14px; line-height: normal; }
p { margin-top: 8px; color: var(--text-tertiary); font-size: .73rem; line-height: 1.5; }
button { border: 0; padding: 4px; color: var(--liquid-accent); background: transparent; }
.compact select { max-width: 220px; border-color: transparent; background: transparent; font-size: 13px; }
@media (max-width: 820px) { select { font-size: 16px; } }
</style>
