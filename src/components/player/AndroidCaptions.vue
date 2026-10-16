<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { captionLayout } from '../../services/captionLayout';
const props = defineProps<{ video: HTMLVideoElement; fit: 'contain' | 'cover'; controlsInset: number; nativeFullscreen: boolean }>();
const lines = ref<string[]>([]);
const style = ref({});
const nativePresentation = ref(false);
let release = () => {};
watch([() => props.video, () => props.fit, () => props.controlsInset, () => props.nativeFullscreen], ([video]) => {
  release();
  const tracks = new Set<TextTrack>();
  const sync = () => {
    nativePresentation.value = props.nativeFullscreen || document.pictureInPictureElement === video;
    video.classList.toggle('android-captions-active', !nativePresentation.value);
    lines.value = Array.from(video.textTracks).filter(track => track.mode === 'showing' && ['subtitles', 'captions'].includes(track.kind))
      .flatMap(track => Array.from(track.activeCues || []).map(cue => {
        const vtt = cue as VTTCue;
        return typeof vtt.getCueAsHTML === 'function' ? vtt.getCueAsHTML().textContent || '' : vtt.text || '';
      })).filter(Boolean);
  };
  const measure = () => {
    const rect = video.getBoundingClientRect();
    style.value = captionLayout(rect.width, rect.height, video.videoWidth, video.videoHeight, props.fit, props.controlsInset);
  };
  const bind = () => {
    for (const track of tracks) if (!Array.from(video.textTracks).includes(track)) { track.removeEventListener('cuechange', sync); tracks.delete(track); }
    for (const track of Array.from(video.textTracks)) if (!tracks.has(track)) { track.addEventListener('cuechange', sync); tracks.add(track); }
    sync();
  };
  const trackEvents = ['change', 'addtrack', 'removetrack'];
  const videoEvents = ['loadedmetadata', 'seeked', 'timeupdate', 'enterpictureinpicture', 'leavepictureinpicture', 'subtitletracksupdated'];
  trackEvents.forEach(event => video.textTracks.addEventListener(event, bind));
  videoEvents.forEach(event => video.addEventListener(event, bind));
  video.addEventListener('resize', measure); window.addEventListener('resize', measure);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
  observer?.observe(video); bind(); measure();
  release = () => {
    observer?.disconnect(); video.classList.remove('android-captions-active');
    trackEvents.forEach(event => video.textTracks.removeEventListener(event, bind));
    videoEvents.forEach(event => video.removeEventListener(event, bind));
    video.removeEventListener('resize', measure); window.removeEventListener('resize', measure);
    tracks.forEach(track => track.removeEventListener('cuechange', sync));
  };
}, { immediate: true, flush: 'post' });
onBeforeUnmount(() => release());
</script>
<template>
  <div v-if="!nativePresentation && lines.length" class="android-captions" :style="style" aria-hidden="true"><span v-for="(line, index) in lines" :key="index">{{ line }}</span></div>
</template>
<style>
/* Keep track modes/cue clocks untouched. Native PiP/fullscreen gets its own cue rendering. */
video.android-captions-active::cue { opacity: 0; }
</style>
<style scoped>
.android-captions { position: absolute; left: 50%; transform: translateX(-50%); z-index: 4; pointer-events: none; text-align: center; color: white; line-height: 1.35; font-weight: 600; text-shadow: 0 1px 3px #000, 1px 0 2px #000, -1px 0 2px #000; }
.android-captions span { display: block; white-space: pre-line; overflow-wrap: anywhere; }
</style>
