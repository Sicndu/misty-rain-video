<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type Hls from 'hls.js';
import { Captions, X } from '@lucide/vue';
import { activeSubtitleTrack, selectSubtitleTrack, setSubtitleDefaults, subtitleTrackOptions, subtitlePreference, subtitlePreferenceKey, subtitleLanguageKey, managedSubtitleTracks, subtitleEvents, type SubtitleTrackOption } from '../../services/subtitleTracks';
const props = defineProps<{ video: HTMLVideoElement; hls?: Hls | null; compact?: boolean; iconOnly?: boolean; notice?: string; username?: string; nativeFullscreen?: boolean; loading?: boolean; readError?: string; fullscreen?: boolean; contextKey?: string }>();
const emit = defineEmits<{ (event: 'retry-embedded'): void }>();
const options = ref<SubtitleTrackOption[]>([]);
const selected = ref('off');
const automaticOption = computed(() => options.value.find(option => /^(zh|chi|zho)/i.test(option.language)) || options.value[0]);
const readyTracks = () => Array.from(props.video.textTracks).filter(track => ['subtitles','captions'].includes(track.kind) && managedSubtitleTracks.get(track)?.ready !== false && managedSubtitleTracks.get(track)?.active !== false);
const error = ref('');
const preferenceKey = subtitlePreferenceKey(props.username);
let preference = 'auto';
try { preference = localStorage.getItem(preferenceKey) || 'auto'; } catch { /* Current session remains usable. */ }
const root = ref<HTMLElement | null>(null);
const picker = ref<HTMLSelectElement | null>(null);
const status = ref<HTMLElement | null>(null);
const subtitlesEnabled = ref(preference !== 'off');
const hasStatus = computed(() => Boolean(props.notice || error.value || props.readError));
const statusVisible = ref(false);
let dismissed = false;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
const clearStatusTimer = () => { clearTimeout(statusTimer); };
const dismissStatus = () => { dismissed = true; statusVisible.value = false; clearStatusTimer(); };
const closeStatus = () => { dismissStatus(); picker.value?.focus({ preventScroll: true }); };
const scheduleStatusHide = () => {
  clearStatusTimer();
  statusTimer = setTimeout(() => {
    if (status.value?.contains(document.activeElement)) return;
    dismissStatus();
  }, 6000);
};
const revealStatus = (manual = false) => {
  if (!hasStatus.value || !subtitlesEnabled.value || (!manual && (props.fullscreen || props.nativeFullscreen))) return;
  dismissed = false; statusVisible.value = true; scheduleStatusHide();
};
const outsideStatus = (event: PointerEvent) => { if (statusVisible.value && !root.value?.contains(event.target as Node)) dismissStatus(); };
const escapeStatus = (event: KeyboardEvent) => { if (statusVisible.value && event.key === 'Escape') dismissStatus(); };
document.addEventListener('pointerdown', outsideStatus);
document.addEventListener('keydown', escapeStatus);
watch([hasStatus, subtitlesEnabled, () => props.loading], ([has, enabled, loading]) => {
  if (!has || !enabled) {
    statusVisible.value = false; clearStatusTimer();
    // A successful read ends this incident. Clearing an error to retry it does not.
    if (!has && !loading) dismissed = false;
    return;
  }
  if (!dismissed && !statusVisible.value) revealStatus();
}, { immediate: true });
watch([() => props.fullscreen, () => props.nativeFullscreen], () => { if (hasStatus.value) dismissStatus(); });
const retryEmbedded = () => { dismissStatus(); emit('retry-embedded'); };
let release = () => {};
let applying = false;
let generation = 0;
let lastActive = 'off';
const rememberNativeChoice = () => {
  const id = activeSubtitleTrack(props.video, props.hls);
  selected.value = id;
  if (!options.value.length) return;
  const native = id.startsWith('native:') ? props.video.textTracks[Number(id.slice(7))] : undefined;
  const option = options.value.find(option => option.id === id) || (native ? options.value.find(option => subtitleLanguageKey(option.language) === subtitleLanguageKey(native.language)) : undefined);
  if (id !== 'off' && !option) return;
  preference = subtitlePreference(option);
  try { localStorage.setItem(preferenceKey, preference); } catch { /* Native playback remains usable. */ }
};
const sync = () => {
  if (applying) return;
  try { preference = localStorage.getItem(preferenceKey) || 'auto'; } catch { /* Keep this session's preference. */ }
  subtitlesEnabled.value = preference !== 'off';
  options.value = subtitleTrackOptions(props.video, props.hls);
  const automatic = automaticOption.value;
  const preferred = options.value.find(option => subtitlePreference(option) === preference)
    || (preference.includes(':language:') ? options.value.find(option => subtitleLanguageKey(option.language) === subtitleLanguageKey(preference.split(':language:')[1])) : undefined);
  const desired = preference === 'auto' ? automatic?.id : preference === 'off' ? 'off' : preferred?.id;
  const showing = Array.from(props.video.textTracks).filter(track => ['subtitles','captions'].includes(track.kind) && track.mode === 'showing');
  if (desired && (desired !== activeSubtitleTrack(props.video, props.hls) || showing.length > 1)) {
    applying = true;
    selectSubtitleTrack(props.video, props.hls, desired);
    applying = false;
  }
  lastActive = activeSubtitleTrack(props.video, props.hls);
  setSubtitleDefaults(props.video, lastActive);
  selected.value = preference === 'auto' ? 'auto' : lastActive;
};
watch(() => props.nativeFullscreen, (fullscreen, wasFullscreen) => {
  if (wasFullscreen && !fullscreen) {
    options.value = subtitleTrackOptions(props.video, props.hls);
    // Hidden or temporarily missing tracks during handoff do not mean off.
    if (activeSubtitleTrack(props.video, props.hls) !== 'off' || options.value.length && readyTracks().every(track => track.mode === 'disabled')) rememberNativeChoice();
  }
  sync();
});
const choose = (event: Event) => {
  const id = (event.target as HTMLSelectElement).value;
  const option = options.value.find(item => item.id === id);
  preference = id === 'auto' ? 'auto' : subtitlePreference(option);
  try { localStorage.setItem(preferenceKey, preference); } catch { /* Keep the active selection. */ }
  dismissStatus();
  error.value = '';
  applying = true;
  if (id !== 'auto') selectSubtitleTrack(props.video, props.hls, id);
  applying = false;
  selected.value = id;
  sync();
};
const retry = () => {
  dismissStatus();
  const element = Array.from(props.video.querySelectorAll('track')).find(item => item.track.mode === 'showing');
  if (!element) return;
  const url = new URL(element.src, location.href); url.searchParams.set('_retry', String(Date.now()));
  error.value = ''; element.src = url.toString();
};
watch([() => props.video, () => props.hls, () => props.contextKey] as const, async ([video, hls]) => {
  release(); const seq = ++generation;
  error.value = ''; dismissed = false; statusVisible.value = false; clearStatusTimer();
  revealStatus();
  await nextTick(); if (seq !== generation) return;
  const failed = () => { error.value = '字幕加载失败，可重试或选择其他字幕；影片仍可继续播放。'; };
  const loaded = () => { error.value = ''; sync(); };
  const tracks = Array.from(video.querySelectorAll('track'));
  const modeChanged = () => {
    if (applying) return;
    const current = activeSubtitleTrack(video, hls);
    const available = subtitleTrackOptions(video, hls);
    if (props.nativeFullscreen && current === 'off' && readyTracks().some(track => track.mode === 'hidden')) return;
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
  video.addEventListener('loadedmetadata', sync);
  video.addEventListener('subtitletracksupdated', sync);
  tracks.forEach(track => { track.addEventListener('load', loaded); track.addEventListener('error', failed); });
  const hlsEvents = hls ? subtitleEvents(hls) : [];
  hlsEvents.forEach(event => hls?.on(event, sync));
  sync();
  release = () => {
    video.textTracks.removeEventListener('change', modeChanged);
    events.forEach(event => video.textTracks.removeEventListener(event, sync));
    video.removeEventListener('loadedmetadata', sync);
    video.removeEventListener('subtitletracksupdated', sync);
    tracks.forEach(track => { track.removeEventListener('load', loaded); track.removeEventListener('error', failed); });
    hlsEvents.forEach(event => hls?.off(event, sync));
  };
}, { immediate: true });
onBeforeUnmount(() => { generation += 1; release(); clearStatusTimer(); document.removeEventListener('pointerdown', outsideStatus); document.removeEventListener('keydown', escapeStatus); });
</script>
<template>
  <div ref="root" class="subtitle-controls" :class="{ compact, 'icon-only':iconOnly }">
    <div class="subtitle-picker"><Captions class="captions-icon" aria-hidden="true" /><select ref="picker" aria-label="选择影片字幕" :value="selected" @pointerdown="revealStatus(true)" @keydown.enter="revealStatus(true)" @keydown.space="revealStatus(true)" @change="choose">
      <option value="auto">{{ loading ? '正在读取字幕…' : options.length ? `自动 · ${automaticOption?.label || '字幕'}` : '字幕 · 暂无可用轨道' }}</option>
      <option value="off">字幕关闭</option>
      <option v-for="option in options" :key="option.id" :value="option.id">{{ option.label }}</option>
    </select></div>
    <div v-if="statusVisible && hasStatus && subtitlesEnabled" ref="status" class="subtitle-status" @pointerenter="clearStatusTimer" @pointerleave="scheduleStatusHide" @focusin="clearStatusTimer" @focusout="scheduleStatusHide">
      <button type="button" class="close-subtitle-status" aria-label="关闭字幕提示" @click="closeStatus"><X aria-hidden="true" /></button>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="error" role="alert">{{ error }} <button type="button" @click="retry">重试字幕</button></p>
      <p v-if="readError" role="status">{{ readError }} <button type="button" @click="retryEmbedded">重试</button></p>
    </div>
  </div>
</template>
<style scoped>
.subtitle-picker { position: relative; }
.subtitle-picker > svg { position: absolute; right: 12px; top: 14px; width: 16px; height: 16px; pointer-events: none; color: var(--text-tertiary); }
.subtitle-picker > .captions-icon { right: auto; left: 10px; width: 18px; height: 18px; top: 13px; }
select { appearance: auto; -webkit-appearance: auto; box-sizing: border-box; display: block; width: 100%; height: 44px; padding: 0 32px 0 36px; border: 1px solid var(--divider); border-radius: 8px; color: var(--text-primary); background: var(--surface-2); font: inherit; font-size: 14px; line-height: normal; }
p { margin-top: 8px; color: var(--text-tertiary); font-size: .73rem; line-height: 1.5; }
button { border: 0; padding: 4px; color: var(--liquid-accent); background: transparent; }
.compact select { max-width: 220px; border-color: transparent; background: transparent; font-size: 13px; }
@media (max-width: 820px) { select { font-size: 16px; } }
.subtitle-status { position:relative; padding-right:36px; }
.subtitle-status .close-subtitle-status { position:absolute; top:4px; right:4px; display:grid; place-items:center; width:32px; height:32px; padding:0; color:var(--text-secondary); border-radius:6px; }
.close-subtitle-status svg { width:16px; height:16px; }
.close-subtitle-status:hover { background:var(--glass-bg-hover); }
</style>

<style scoped>
.icon-only { position:relative; }.icon-only .subtitle-picker { width:36px; height:40px; }.icon-only select { width:36px; max-width:36px; height:40px; padding:0; opacity:0; cursor:pointer; }.icon-only .subtitle-picker>.captions-icon { top:11px; left:8px; width:20px; height:20px; }.icon-only .subtitle-picker>svg:not(.captions-icon) { display:none; }.icon-only:focus-within { outline:2px solid white; outline-offset:-2px; border-radius:4px; }.icon-only .subtitle-status { position:absolute; left:0; bottom:100%; z-index:14; width:min(260px,65vw); padding:8px 40px 8px 12px; border:1px solid var(--divider); border-radius:8px; color:var(--text-primary); background:var(--surface-elevated,var(--surface-1)); }
</style>
