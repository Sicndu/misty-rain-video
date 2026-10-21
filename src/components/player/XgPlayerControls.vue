<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { ListVideo, Settings2, PictureInPicture2, X } from '@lucide/vue';
import { createDirectPlayer } from '../../services/xgplayerAdapter';
import type { PlaybackSource } from '../../services/quarkStreamService';
import 'xgplayer/dist/index.min.css';

const props = defineProps<{
  video: HTMLVideoElement; ready: boolean; expanded: boolean; nativeFullscreen: boolean;
  pictureMode: 'contain' | 'cover' | 'crop'; sources: PlaybackSource[]; selectedSourceId: string;
}>();
const emit = defineEmits<{
  (event: 'fullscreen'): void;
  (event: 'quality', source: PlaybackSource): void;
  (event: 'picture-mode', mode: 'contain' | 'cover' | 'crop'): void;
  (event: 'inset', pixels: number): void;
}>();
const tools = shallowRef<HTMLElement>();
const stage = shallowRef<HTMLElement>();
const menu = ref<'episodes' | 'preferences' | null>(null);
const panel = ref<HTMLElement>();
const buttons = ref<HTMLElement>();
const feedback = ref('');
const canPip = ref(false);
let adapter: ReturnType<typeof createDirectPlayer> | undefined;
let release = () => {};
let timer: ReturnType<typeof setTimeout> | undefined;
let trigger: HTMLElement | null = null;
const tell = (message: string) => { feedback.value = message; clearTimeout(timer); timer = setTimeout(() => { feedback.value = ''; }, 1400); };
const closeMenu = () => { menu.value = null; trigger?.focus({ preventScroll: true }); };
const toggleMenu = (value: 'episodes' | 'preferences', event: MouseEvent) => { trigger = event.currentTarget as HTMLElement; menu.value = menu.value === value ? null : value; };
watch(() => props.video, video => {
  release(); adapter?.destroy(); menu.value = null;
  const root = video.parentElement!;
  stage.value = root;
  adapter = createDirectPlayer(root, video, {
    fullscreen: () => emit('fullscreen'),
    quality: id => { const source = props.sources.find(item => item.id === id && item.delivery === 'direct'); if (source) emit('quality', source); },
    feedback: tell,
  });
  tools.value = adapter.tools;
  canPip.value = adapter.canPip;
  const measure = () => emit('inset', root.classList.contains('xgplayer-inactive') || props.nativeFullscreen ? 0 : 56);
  const outside = (event: PointerEvent) => { if (!panel.value?.contains(event.target as Node) && !buttons.value?.contains(event.target as Node)) menu.value = null; };
  const escape = (event: KeyboardEvent) => { if (menu.value && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); } };
  document.addEventListener('pointerdown', outside);
  root.addEventListener('keydown', escape, true);
  adapter.player.on('focus', measure); adapter.player.on('blur', measure);
  measure();
  release = () => { document.removeEventListener('pointerdown', outside); root.removeEventListener('keydown', escape, true); };
}, { immediate: true, flush: 'post' });
watch([() => props.sources, () => props.selectedSourceId, tools], () => adapter?.setQualities(props.sources, props.selectedSourceId), { immediate: true });
watch([() => props.ready, () => props.nativeFullscreen, stage], () => {
  stage.value?.classList.toggle('misty-controls-disabled', !props.ready || props.nativeFullscreen);
}, { immediate: true });
watch([() => props.expanded, () => props.nativeFullscreen, () => props.ready, tools], () => { menu.value = null; adapter?.setFullscreen(props.expanded || props.nativeFullscreen); }, { immediate: true });
watch(menu, async value => {
  if (value) { adapter?.player.controls?.pauseAutoHide(); await nextTick(); panel.value?.focus({ preventScroll: true }); }
  else adapter?.player.controls?.recoverAutoHide();
});
onBeforeUnmount(() => { release(); adapter?.destroy(); clearTimeout(timer); emit('inset', 0); });
</script>
<template>
  <Teleport v-if="tools" :to="tools">
    <div ref="buttons" class="business-buttons">
      <slot />
      <button v-if="expanded" type="button" aria-label="选集与片源" :aria-expanded="menu === 'episodes'" @click="toggleMenu('episodes', $event)"><ListVideo /></button>
      <button type="button" class="picture-button" aria-label="切换画面模式" :title="pictureMode === 'crop' ? '裁切 125%；点击恢复完整画面' : pictureMode === 'cover' ? '铺满播放区；点击放大裁切' : '完整画面；点击铺满播放区'" @click="emit('picture-mode', pictureMode === 'contain' ? 'cover' : pictureMode === 'cover' ? 'crop' : 'contain')">{{ pictureMode === 'crop' ? '裁切' : pictureMode === 'cover' ? '铺满' : '适应' }}</button>
      <button type="button" aria-label="播放偏好" :aria-expanded="menu === 'preferences'" @click="toggleMenu('preferences', $event)"><Settings2 /></button>
    </div>
  </Teleport>
  <Teleport v-if="stage" :to="stage">
    <span v-if="feedback" class="xg-gesture-feedback" role="status">{{ feedback }}</span>
    <section v-show="menu" ref="panel" class="player-business-menu" :class="{ 'inline-business-menu': !expanded }" tabindex="-1" :aria-label="menu === 'episodes' ? '选集与片源' : '播放偏好'" @pointerdown.stop @click.stop @touchstart.stop @touchend.stop>
      <header><strong>{{ menu === 'episodes' ? '选集与片源' : '播放偏好' }}</strong><button type="button" aria-label="关闭播放器菜单" @click="closeMenu"><X /></button></header>
      <div class="business-menu-body"><div v-show="menu === 'preferences'"><button v-if="canPip" class="mobile-pip-action" type="button" @click="adapter?.togglePip(); closeMenu()"><PictureInPicture2 />画中画</button><slot name="settings" /></div><div v-show="menu === 'episodes'"><slot name="episodes" /></div></div>
    </section>
  </Teleport>
</template>
<style>
/* Player chrome remains legible against video; business menus inherit the app theme. */
.video-stage.xgplayer { display:block; font-family:inherit; }
.video-stage.xgplayer video { position:absolute; inset:0; width:100%; height:100%; }
.misty-controls-disabled > .xgplayer-controls, .misty-controls-disabled > .xgplayer-mobile { display:none !important; }
.video-stage .xgplayer-controls { z-index:8; bottom:0; left:0; right:0; width:100%; padding:0 8px; box-sizing:border-box; }
.video-stage .xgplayer-controls .xgplayer-icons { height:44px; }
.video-stage .xgplayer-controls xg-icon { margin-left:6px; margin-right:6px; }
.video-stage .xgplayer-definition .icon-text { max-width:100px; }
.video-stage .xg-options-list li.selected { color:#a9c9f5; }
.video-stage .xgplayer-controls { color:#fff; }
.video-stage .xgplayer-options-list { max-height:min(260px,55vh); overflow-y:auto; }
.misty-player-tools { display:flex; margin:0 2px; }
.mobile-pip-action { display:none; }
.video-stage .xg-left-grid, .video-stage .xg-right-grid { flex-wrap:nowrap; flex-shrink:0; }
.business-buttons { display:flex; align-items:center; gap:2px; color:white; }
.business-buttons > button { display:grid; place-items:center; width:34px; height:40px; border:0; background:transparent; color:inherit; cursor:pointer; padding:6px; }
.business-buttons svg { width:20px; height:20px; }
.business-buttons .picture-button { font-size:12px; padding:0; }
.business-buttons .subtitle-controls { width:34px; flex:0 0 34px; }
.business-buttons .captions-icon { color:#fff; }
.business-buttons .subtitle-status { left:auto !important; right:0; }
.business-buttons button:focus-visible { outline:2px solid white; outline-offset:-2px; border-radius:4px; }
.player-business-menu { position:absolute; z-index:15; right:12px; bottom:60px; display:flex; flex-direction:column; width:min(380px,calc(100% - 24px)); max-height:calc(100% - 80px); overflow:hidden; border:1px solid var(--divider); border-radius:10px; background:var(--surface-elevated,var(--surface-1)); color:var(--text-primary); box-shadow:0 8px 28px #0004; }
.player-business-menu header { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; padding:0 8px 0 16px; min-height:44px; border-bottom:1px solid var(--divider); }
.player-business-menu strong { font-size:14px; font-weight:600; }
.player-business-menu header button { display:grid; place-items:center; width:36px; height:40px; border:0; background:transparent; color:inherit; cursor:pointer; }
.player-business-menu header svg { width:20px; height:20px; }
.business-menu-body { min-height:0; overflow-y:auto; overscroll-behavior:contain; }
.xg-gesture-feedback { position:absolute; z-index:10; top:40%; left:50%; transform:translateX(-50%); background:#000b; color:white; padding:8px 14px; border-radius:8px; pointer-events:none; }
@media(max-width:820px) {
  .video-stage .xgplayer-controls xg-icon { margin-left:2px; margin-right:2px; }
  .video-stage .xgplayer-playbackrate { width:30px; }
  .video-stage .xgplayer-definition, .video-stage .xgplayer-definition .xgplayer-icon { width:40px; min-width:0; }
  .video-stage .xgplayer-play, .video-stage .xgplayer-fullscreen { width:24px; }
  .video-stage .xgplayer-volume, .video-stage .xgplayer-pip { display:none; }
  .mobile-pip-action { display:flex; align-items:center; gap:8px; width:100%; min-height:44px; padding:8px 16px; border:0; border-bottom:1px solid var(--divider); background:transparent; color:var(--text-primary); font:inherit; font-size:13px; }
  .mobile-pip-action svg { width:18px; height:18px; }
  .video-stage .xgplayer-time { font-size:10px; min-width:64px; white-space:nowrap; }
  .video-stage .xgplayer-definition .icon-text { display:block; max-width:40px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; }
  .video-stage .xgplayer-playbackrate .icon-text { font-size:12px; }
  .player-business-menu.inline-business-menu { position:fixed; left:8px; right:8px; bottom:max(8px,env(safe-area-inset-bottom)); width:auto; max-height:min(520px,calc(100dvh - 100px)); }
}
@media(max-width:380px) { .video-stage .xgplayer-pip { display:none; } .business-buttons>button { width:30px; } }
</style>
