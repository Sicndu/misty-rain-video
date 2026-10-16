<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ChevronLeft, PictureInPicture2 } from '@lucide/vue';
import MobilePlaybackControls from './MobilePlaybackControls.vue';

const props = defineProps<{
  video: HTMLVideoElement; expanded: boolean; title: string;
  episodes: Array<{ fid: string; episodeTitle: string }>; currentIndex: number;
}>();
const emit = defineEmits<{
  (event: 'fullscreen'): void;
  (event: 'episode', index: number): void;
  (event: 'inset', pixels: number): void;
}>();
const root = ref<HTMLElement | null>(null);
const visible = ref(true);
const feedback = ref('');
const pip = ref(false);
const rate = ref(1);
const canPip = computed(() => document.pictureInPictureEnabled && typeof props.video.requestPictureInPicture === 'function' && !props.video.disablePictureInPicture);
let release = () => {};
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let tapTimer: ReturnType<typeof setTimeout> | undefined;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
let down: { x: number; y: number; id: number; at: number } | null = null;
let lastTap: { x: number; y: number; at: number } | null = null;
const measure = () => emit('inset', props.expanded && visible.value ? root.value?.getBoundingClientRect().height || 0 : 0);
const scheduleHide = () => {
  clearTimeout(hideTimer);
  if (props.expanded && !props.video.paused) hideTimer = setTimeout(() => {
    if (root.value?.contains(document.activeElement) && document.activeElement?.matches(':focus-visible')) return;
    visible.value = false;
  }, 3500);
};
const reveal = () => { visible.value = true; scheduleHide(); };
const tell = (message: string) => {
  feedback.value = message; clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { feedback.value = ''; }, 1400);
};
const cancelGesture = () => { down = null; lastTap = null; clearTimeout(tapTimer); };
const pointerDown = (event: PointerEvent) => {
  if (!event.isPrimary || event.button !== 0) { cancelGesture(); return; }
  down = { x: event.clientX, y: event.clientY, id: event.pointerId, at: Date.now() };
};
const pointerUp = (event: PointerEvent) => {
  const start = down; down = null;
  if (!start || event.pointerId !== start.id || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 18 || Date.now() - start.at > 500) { cancelGesture(); return; }
  const now = Date.now();
  if (lastTap && now - lastTap.at < 300 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 48) {
    lastTap = null; clearTimeout(tapTimer);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    if (x < .4 || x > .6) {
      if (Number.isFinite(props.video.duration) && props.video.duration > 0) {
        const offset = x < .4 ? -10 : 10;
        props.video.currentTime = Math.max(0, Math.min(props.video.duration, props.video.currentTime + offset));
        tell(offset < 0 ? '后退 10 秒' : '快进 10 秒');
      }
    } else if (props.video.paused) void props.video.play().catch(() => tell('请轻触播放按钮重试'));
    else props.video.pause();
    reveal();
  } else {
    lastTap = { x: event.clientX, y: event.clientY, at: now };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      lastTap = null;
      if (props.expanded && !props.video.paused) {
        (document.activeElement as HTMLElement | null)?.blur?.();
        visible.value = !visible.value;
      }
      scheduleHide();
    }, 300);
  }
};
async function togglePip() {
  try {
    if (document.pictureInPictureElement === props.video) await document.exitPictureInPicture();
    else await props.video.requestPictureInPicture();
  } catch { tell('当前无法进入画中画'); reveal(); }
}
const changeRate = (event: Event) => { props.video.playbackRate = Number((event.target as HTMLSelectElement).value); };
watch([() => props.expanded, visible], () => { measure(); scheduleHide(); }, { flush: 'post' });
watch([() => props.video, root], ([video, element]) => {
  release(); cancelGesture(); feedback.value = ''; visible.value = true;
  const sync = () => {
    rate.value = video.playbackRate;
    pip.value = document.pictureInPictureElement === video;
    if (video.paused) visible.value = true;
    scheduleHide();
  };
  const events = ['play', 'pause', 'ended', 'ratechange', 'enterpictureinpicture', 'leavepictureinpicture'];
  events.forEach(event => video.addEventListener(event, sync));
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
  if (element) observer?.observe(element);
  sync(); measure();
  release = () => { observer?.disconnect(); events.forEach(event => video.removeEventListener(event, sync)); clearTimeout(hideTimer); };
}, { immediate: true, flush: 'post' });
onBeforeUnmount(() => { release(); cancelGesture(); clearTimeout(feedbackTimer); emit('inset', 0); });
</script>
<template>
  <Teleport v-if="video.parentElement" :to="video.parentElement">
    <div class="android-gesture" aria-hidden="true" @pointerdown="pointerDown" @pointerup="pointerUp" @pointercancel="cancelGesture" />
    <span v-if="feedback" class="gesture-feedback" role="status">{{ feedback }}</span>
    <div v-if="expanded && visible" class="fullscreen-heading"><button type="button" aria-label="退出全屏" @click="emit('fullscreen')"><ChevronLeft /></button><span>{{ title }}</span></div>
  </Teleport>
  <div ref="root" class="android-controls" :class="{ expanded, concealed: expanded && !visible }" :inert="expanded && !visible" @pointerdown="reveal" @focusin="reveal" @focusout="scheduleHide">
    <MobilePlaybackControls :video="video" :expanded="expanded" @fullscreen="emit('fullscreen')" />
    <div class="secondary-controls">
      <slot />
      <select v-if="episodes.length > 1" aria-label="快速选集" :value="currentIndex" @change="emit('episode', Number(($event.target as HTMLSelectElement).value))">
        <option v-for="(episode, index) in episodes" :key="episode.fid" :value="index">{{ episode.episodeTitle }}</option>
      </select>
      <select aria-label="播放速度" :value="rate" @change="changeRate"><option v-for="speed in [.5, .75, 1, 1.25, 1.5, 2]" :key="speed" :value="speed">{{ speed }}×</option></select>
      <button v-if="canPip" type="button" :aria-label="pip ? '退出画中画' : '画中画'" @click="togglePip"><PictureInPicture2 /></button>
    </div>
  </div>
</template>
<style scoped>
.android-controls { --text-primary: #fff; --text-tertiary: #c6c6cc; --surface-2: #242428; --divider: #444; --liquid-accent: #a8c8ff; flex: 0 0 auto; background: #151518; color: white; border-radius: 0 0 12px 12px; }
.android-controls.expanded { position: absolute; z-index: 7; bottom: 0; left: 0; right: 0; border-radius: 0; padding: 8px max(16px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); background: linear-gradient(transparent, #000d); }
.android-controls.expanded :deep(.mobile-controls) { background: transparent; }
.concealed { opacity: 0; pointer-events: none; }
.secondary-controls { display: flex; gap: 4px; align-items: center; padding: 0 4px 4px; }
.secondary-controls > :deep(.subtitle-controls) { flex: 1; min-width: 0; }
.secondary-controls :deep(select), .secondary-controls > select { color-scheme: dark; color: white; background: transparent; border: 0; border-radius: 6px; height: 44px; min-width: 0; max-width: 100%; font-size: 14px; }
.secondary-controls > select { padding: 0 8px; max-width: 28%; }
.secondary-controls :deep(option) { background: #151518; color: white; }
.secondary-controls :deep(p) { margin: 4px 8px; }
button { width: 44px; height: 44px; flex-shrink: 0; display: grid; place-items: center; padding: 10px; border: 0; color: inherit; background: transparent; }
button svg { width: 22px; height: 22px; }
button:focus-visible, select:focus-visible { outline: 2px solid white; outline-offset: -2px; }
.android-gesture { position: absolute; inset: 0; z-index: 2; touch-action: pan-y; }
.gesture-feedback { position: absolute; z-index: 8; left: 50%; top: 45%; transform: translate(-50%, -50%); padding: 8px 14px; border-radius: 8px; background: #000b; color: white; font-size: 14px; pointer-events: none; }
.fullscreen-heading { position: absolute; z-index: 6; inset: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: env(safe-area-inset-top) 16px 16px max(8px, env(safe-area-inset-left)); color: white; background: linear-gradient(#0009, transparent); }
.fullscreen-heading span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
