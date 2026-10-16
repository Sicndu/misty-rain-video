<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ChevronLeft, PictureInPicture2, X, ListVideo, Settings2 } from '@lucide/vue';
import MobilePlaybackControls from './MobilePlaybackControls.vue';

const props = defineProps<{
  video: HTMLVideoElement; expanded: boolean; title: string; nativeFullscreen?: boolean; pictureMode?: 'contain' | 'cover' | 'crop';
  episodes: Array<{ fid: string; episodeTitle: string }>; currentIndex: number;
}>();
const emit = defineEmits<{
  (event: 'fullscreen'): void;
  (event: 'inset', pixels: number): void;
  (event: 'picture-mode', value: 'contain' | 'cover' | 'crop'): void;
}>();
const root = ref<HTMLElement | null>(null);
const visible = ref(true);
type Menu = 'quality' | 'preferences' | 'episodes';
const menu = ref<Menu | null>(null);
const qualityButton = ref<HTMLButtonElement | null>(null);
const settingsButton = ref<HTMLButtonElement | null>(null);
const episodesButton = ref<HTMLButtonElement | null>(null);
const panelMaxHeight = ref(320);
const menuTitle = computed(() => menu.value === 'quality' ? '清晰度' : menu.value === 'episodes' ? '选集与片源' : '播放偏好');
const closeSettings = () => { const trigger = menu.value === 'episodes' ? episodesButton : menu.value === 'quality' ? qualityButton : settingsButton; menu.value = null; trigger.value?.focus({ preventScroll:true }); reveal(); };
const toggleMenu = (value: Menu) => { menu.value = menu.value === value ? null : value; reveal(); };
const outside = (event: PointerEvent) => { if (!root.value?.contains(event.target as Node)) menu.value = null; };
const panelKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && menu.value) { event.preventDefault(); event.stopPropagation(); closeSettings(); } };
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
const measure = () => {
  const height = root.value?.getBoundingClientRect().height || 0;
  emit('inset', props.expanded && visible.value ? height : 0);
  panelMaxHeight.value = Math.min(520, Math.max(140, Math.min(window.innerHeight - 24, (props.video.parentElement?.getBoundingClientRect().height || 240) + height - 16)));
};
const scheduleHide = () => {
  clearTimeout(hideTimer);
  if (props.expanded && !props.video.paused && !menu.value) hideTimer = setTimeout(() => {
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
watch(() => props.expanded, expanded => { if (!expanded && menu.value === 'episodes') menu.value = null; });
watch([() => props.expanded, visible, menu], () => { measure(); scheduleHide(); }, { flush: 'post' });
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
  document.addEventListener('pointerdown', outside); window.addEventListener('resize', measure);
  sync(); measure();
  release = () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', measure); observer?.disconnect(); events.forEach(event => video.removeEventListener(event, sync)); clearTimeout(hideTimer); };
}, { immediate: true, flush: 'post' });
onBeforeUnmount(() => { release(); cancelGesture(); clearTimeout(feedbackTimer); emit('inset', 0); });
</script>
<template>
  <Teleport v-if="video.parentElement && !nativeFullscreen" :to="video.parentElement">
    <div class="player-gesture" aria-hidden="true" @pointerdown="pointerDown" @pointerup="pointerUp" @pointercancel="cancelGesture" @pointermove="$event.pointerType === 'mouse' && reveal()" />
    <span v-if="feedback" class="gesture-feedback" role="status">{{ feedback }}</span>
    <div v-if="expanded && visible" class="fullscreen-heading"><button type="button" aria-label="退出全屏" @click="emit('fullscreen')"><ChevronLeft /></button><span>{{ title }}</span></div>
  </Teleport>
  <div v-show="!nativeFullscreen" ref="root" class="player-controls" aria-label="播放器控制栏" @keydown="panelKeydown" :class="{ expanded, concealed: expanded && !visible }" :inert="expanded && !visible" @pointerdown="reveal" @pointermove="$event.pointerType === 'mouse' && reveal()" @focusin="reveal" @focusout="scheduleHide">
    <MobilePlaybackControls :video="video" :expanded="expanded" @fullscreen="emit('fullscreen')">
      <div class="transport-tools">
        <slot />
        <button v-if="expanded" ref="episodesButton" type="button" aria-label="选集与片源" :aria-expanded="menu === 'episodes'" aria-controls="player-settings-menu" @click="toggleMenu('episodes')"><ListVideo /></button>
        <select class="speed-picker" aria-label="播放速度" :value="rate" @change="changeRate"><option v-for="speed in [.5,.75,1,1.25,1.5,2]" :key="speed" :value="speed">{{ speed }}×</option></select>
        <button ref="qualityButton" type="button" class="quality-button" aria-label="选择画质" :aria-expanded="menu === 'quality'" aria-controls="player-settings-menu" @click="toggleMenu('quality')">画质</button>
        <button type="button" class="fit-button" aria-label="切换画面模式" :title="pictureMode === 'crop' ? '放大裁切 125%；点击恢复完整画面' : pictureMode === 'cover' ? '铺满播放区；点击放大裁切' : '完整画面；点击铺满播放区'" @click="emit('picture-mode',pictureMode === 'cover' ? 'crop' : pictureMode === 'crop' ? 'contain' : 'cover')">{{ pictureMode === 'crop' ? '裁切' : pictureMode === 'cover' ? '铺满' : '适应' }}</button>
        <button ref="settingsButton" type="button" aria-label="播放偏好" :aria-expanded="menu === 'preferences'" aria-controls="player-settings-menu" @click="toggleMenu('preferences')"><Settings2 /></button>

      </div>
    </MobilePlaybackControls>
    <section v-show="menu" id="player-settings-menu" class="settings-menu" :class="{ 'quality-menu':menu === 'quality' }" :aria-label="menuTitle" :inert="!menu" :style="{ maxHeight: `${panelMaxHeight}px` }">
      <header><strong>{{ menuTitle }}</strong><button type="button" aria-label="关闭播放器菜单" @click="closeSettings"><X /></button></header>
      <div class="settings-body">
        <div v-show="menu === 'quality'"><slot name="quality" :close="closeSettings" /></div>
        <div v-show="menu === 'preferences'">
          <div class="preference-shortcuts"><label class="small-speed">倍速<select aria-label="偏好播放速度" :value="rate" @change="changeRate"><option v-for="speed in [.5,.75,1,1.25,1.5,2]" :key="speed" :value="speed">{{ speed }}×</option></select></label><button v-if="canPip" type="button" class="pip-action" :aria-label="pip ? '退出画中画' : '画中画'" @click="togglePip"><PictureInPicture2 />{{ pip ? '退出画中画' : '画中画' }}</button></div>
          <slot name="settings" />
        </div>
        <div v-show="menu === 'episodes'"><slot name="episodes" :active="menu === 'episodes'" /></div>
      </div>
    </section>
  </div>
</template>
<style scoped>
.player-controls { position:relative; flex:0 0 auto; color:#fff; background:#101114; border-radius:0 0 10px 10px; }
.player-controls.expanded { position:absolute; z-index:7; bottom:0; left:0; right:0; border-radius:0; padding:8px max(12px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left)); background:linear-gradient(transparent,#000d); }
.concealed { opacity:0; pointer-events:none; }
.transport-tools { display:flex; gap:2px; align-items:center; flex-shrink:0; }
.transport-tools :deep(.subtitle-controls) { width:36px; flex:0 0 36px; }
.transport-tools :deep(.subtitle-picker>svg) { color:#ddd; }
.transport-tools>select { appearance:auto; color-scheme:dark; color:white; background:transparent; border:0; border-radius:6px; height:40px; width:52px; padding:0 2px; font-size:12px; }
.transport-tools>select option { background:#151518; color:white; }
button { width:36px; height:40px; flex-shrink:0; display:grid; place-items:center; padding:8px; border:0; color:inherit; background:transparent; cursor:pointer; }
button svg { width:20px; height:20px; }
.quality-button,.fit-button { width:36px; padding:0; font-size:12px; }.fit-button[aria-pressed=true] { color:#a8c8ff; }
button:focus-visible,select:focus-visible { outline:2px solid currentColor; outline-offset:-2px; }
.player-gesture { position:absolute; inset:0; z-index:2; touch-action:pan-y; }
.gesture-feedback { position:absolute; z-index:8; left:50%; top:45%; transform:translate(-50%,-50%); padding:8px 14px; border-radius:8px; background:#000b; color:white; font-size:14px; pointer-events:none; }
.fullscreen-heading { position:absolute; z-index:6; inset:0 0 auto; display:flex; align-items:center; gap:8px; padding:env(safe-area-inset-top) 16px 16px max(8px,env(safe-area-inset-left)); color:white; background:linear-gradient(#0009,transparent); }
.fullscreen-heading span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.settings-menu { position:absolute; z-index:12; right:4px; bottom:4px; display:flex; flex-direction:column; width:min(380px,calc(100% - 8px)); overflow:hidden; border:1px solid var(--divider); border-radius:12px; background:var(--surface-elevated,var(--surface-1)); color:var(--text-primary); box-shadow:0 8px 28px #0003; color-scheme:inherit; }
.settings-menu header { display:flex; justify-content:space-between; align-items:center; flex-shrink:0; min-height:44px; padding-left:16px; border-bottom:1px solid var(--divider); }
.settings-menu strong { font-size:14px; font-weight:600; }
.settings-body { min-height:0; overflow-y:auto; overscroll-behavior:contain; }
@media(max-width:820px) { .player-controls:not(.expanded) .settings-menu { position:fixed; left:8px; right:8px; bottom:max(8px,env(safe-area-inset-bottom)); width:auto; max-height:min(520px,calc(100dvh - 120px)) !important; } }
@media(max-width:360px) { .transport-tools>select { width:46px; } .transport-tools button,.transport-tools :deep(.subtitle-controls) { width:32px; flex-basis:32px; } }
</style>

<style scoped>
.quality-menu { width:min(280px,calc(100% - 8px)); }.preference-shortcuts { display:flex; align-items:center; padding:6px 16px; border-bottom:1px solid var(--divider); }.pip-action { display:flex; align-items:center; gap:8px; width:auto; padding:0 8px; color:var(--text-secondary); font-size:13px; }.small-speed { display:none; align-items:center; gap:12px; font-size:13px; }.small-speed select { min-height:40px; color:var(--text-primary); background:var(--surface-2); border:0; border-radius:6px; }
@media(max-width:480px) { .transport-tools { gap:0; }.transport-tools>select { width:44px; }.transport-tools button { width:32px; }.transport-tools :deep(.subtitle-controls) { width:32px; flex-basis:32px; } }
@media(max-width:360px) { .speed-picker { display:none; }.small-speed { display:flex; }.preference-shortcuts { justify-content:space-between; } }
</style>
