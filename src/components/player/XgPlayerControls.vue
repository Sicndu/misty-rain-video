<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { ListVideo, Settings2, PictureInPicture2, ChevronDown, X } from '@lucide/vue';
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
const overlayHost = shallowRef<HTMLElement>();
const menu = ref<'episodes' | 'settings' | null>(null);
const panel = ref<HTMLElement>();
const closeButton = ref<HTMLButtonElement>();
const buttons = ref<HTMLElement>();
const feedback = ref('');
const canPip = ref(false);
const preferencesOpen = ref(false);
const rate = ref(1);
const speeds = [.5, .75, 1, 1.25, 1.5, 2];
const pictureModes = [{ value: 'contain', label: '适应' }, { value: 'cover', label: '铺满' }, { value: 'crop', label: '裁切' }] as const;
const directSources = computed(() => props.sources.filter(source => source.delivery === 'direct'));
const qualityLabel = (source: PlaybackSource) => source.resolution === 'original' ? '原画' : source.label;
let adapter: ReturnType<typeof createDirectPlayer> | undefined;
let release = () => {};
let timer: ReturnType<typeof setTimeout> | undefined;
let trigger: HTMLElement | null = null;
let keyboardOpen = false;
const tell = (message: string) => { feedback.value = message; clearTimeout(timer); timer = setTimeout(() => { feedback.value = ''; }, 1400); };
const closeMenu = (restoreFocus = true) => { menu.value = null; if (restoreFocus) trigger?.focus({ preventScroll: true }); };
const toggleMenu = (value: 'episodes' | 'settings', event: MouseEvent) => {
  trigger = event.currentTarget as HTMLElement; keyboardOpen = event.detail === 0;
  menu.value = menu.value === value ? null : value;
};
const changeQuality = (event: Event) => {
  const source = directSources.value.find(item => item.id === (event.target as HTMLSelectElement).value);
  if (source && source.id !== props.selectedSourceId) emit('quality', source);
};
const changeRate = (event: Event) => {
  const value = Number((event.target as HTMLSelectElement).value);
  if (adapter && speeds.includes(value)) adapter.player.playbackRate = value;
};
const measure = () => emit('inset', props.nativeFullscreen || !menu.value && stage.value?.classList.contains('xgplayer-inactive') ? 0 : 56);
watch(() => props.video, video => {
  release(); adapter?.destroy(); menu.value = null;
  const root = video.parentElement!;
  stage.value = root; overlayHost.value = root.parentElement!;
  adapter = createDirectPlayer(root, video, { fullscreen: () => emit('fullscreen'), feedback: tell });
  tools.value = adapter.tools; canPip.value = adapter.canPip;
  const syncRate = () => { rate.value = video.playbackRate; };
  const outside = (event: PointerEvent) => { if (!panel.value?.contains(event.target as Node) && !buttons.value?.contains(event.target as Node)) closeMenu(false); };
  const escape = (event: KeyboardEvent) => { if (menu.value && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); } };
  document.addEventListener('pointerdown', outside);
  overlayHost.value.addEventListener('keydown', escape, true);
  video.addEventListener('ratechange', syncRate);
  adapter.player.on('focus', measure); adapter.player.on('blur', measure);
  syncRate(); measure();
  const host = overlayHost.value;
  release = () => { document.removeEventListener('pointerdown', outside); host.removeEventListener('keydown', escape, true); video.removeEventListener('ratechange', syncRate); };
}, { immediate: true, flush: 'post' });
watch([() => props.ready, () => props.nativeFullscreen, stage], () => {
  stage.value?.classList.toggle('misty-controls-disabled', !props.ready || props.nativeFullscreen);
}, { immediate: true });
watch([() => props.expanded, () => props.nativeFullscreen, () => props.ready, tools], () => { menu.value = null; adapter?.setFullscreen(props.expanded || props.nativeFullscreen); }, { immediate: true });
watch(menu, async value => {
  if (value) {
    adapter?.player.controls?.pauseAutoHide();
    if (keyboardOpen) { await nextTick(); if (menu.value) closeButton.value?.focus({ preventScroll: true }); }
  } else { adapter?.player.controls?.recoverAutoHide(); preferencesOpen.value = false; }
  measure();
});
onBeforeUnmount(() => { release(); adapter?.destroy(); clearTimeout(timer); emit('inset', 0); });
</script>
<template>
  <Teleport v-if="tools" :to="tools">
    <div ref="buttons" class="business-buttons">
      <button v-if="expanded" type="button" aria-label="选集与片源" :aria-expanded="menu === 'episodes'" aria-controls="player-options-panel" @click="toggleMenu('episodes', $event)"><ListVideo /></button>
      <button type="button" aria-label="播放设置" :aria-expanded="menu === 'settings'" aria-controls="player-options-panel" @click="toggleMenu('settings', $event)"><Settings2 /></button>
    </div>
  </Teleport>
  <Teleport v-if="stage" :to="stage"><span v-if="feedback" class="xg-gesture-feedback" role="status">{{ feedback }}</span></Teleport>
  <Teleport v-if="overlayHost" :to="overlayHost">
    <div v-if="menu" class="player-menu-backdrop" :class="{ 'inline-menu-backdrop': !expanded }" aria-hidden="true" @pointerdown.stop @touchstart.stop @touchend.stop @click="closeMenu(false)" @touchmove.prevent />
    <section v-show="menu" id="player-options-panel" ref="panel" class="player-business-menu" :class="{ 'inline-business-menu': !expanded }" :aria-label="menu === 'episodes' ? '选集与片源' : '播放设置'" @pointerdown.stop @click.stop @touchstart.stop @touchend.stop>
      <header><strong>{{ menu === 'episodes' ? '选集与片源' : '播放设置' }}</strong><button ref="closeButton" type="button" aria-label="关闭播放器菜单" @click="closeMenu()"><X /></button></header>
      <div class="business-menu-body">
        <div v-show="menu === 'settings'" class="player-settings-content">
          <label v-if="directSources.length" class="player-settings-row"><span>画质</span>
            <select v-if="directSources.length > 1" class="player-setting-select" aria-label="选择画质" :value="selectedSourceId" @change="changeQuality"><option v-for="source in directSources" :key="source.id" :value="source.id">{{ qualityLabel(source) }}</option></select>
            <span v-else class="player-setting-value">{{ qualityLabel(directSources[0]!) }}</span>
          </label>
          <label class="player-settings-row"><span>倍速</span><select class="player-setting-select" aria-label="播放速度" :value="rate" @change="changeRate"><option v-for="speed in speeds" :key="speed" :value="speed">{{ speed }}×{{ speed === 1 ? '（正常）' : '' }}</option></select></label>
          <div class="player-settings-row subtitle-settings-row"><span>字幕</span><div class="player-subtitle-setting"><slot /></div></div>
          <div class="player-settings-row"><span>画面</span><div class="picture-options" role="group" aria-label="画面比例"><button v-for="mode in pictureModes" :key="mode.value" type="button" :aria-pressed="pictureMode === mode.value" :title="mode.value === 'crop' ? '放大裁切 125%' : mode.label" @click="emit('picture-mode', mode.value)">{{ mode.label }}</button></div></div>
          <slot name="audio" />
          <button class="player-preferences-toggle" type="button" :aria-expanded="preferencesOpen" aria-controls="player-preferences-content" @click="preferencesOpen = !preferencesOpen"><span>播放偏好</span><ChevronDown :class="{ rotated: preferencesOpen }" /></button>
          <div v-show="preferencesOpen" id="player-preferences-content" class="player-preferences-content"><slot name="settings" /></div>
          <button v-if="canPip" class="player-pip-action" type="button" @click="adapter?.togglePip(); closeMenu()"><PictureInPicture2 />画中画</button>
        </div>
        <div v-show="menu === 'episodes'"><slot name="episodes" /></div>
      </div>
    </section>
  </Teleport>
</template>
<style>
.video-stage.xgplayer { display:block; font-family:inherit; }
.video-stage.xgplayer video { position:absolute; inset:0; width:100%; height:100%; }
/* Keep the mobile input surface above Vue's video, below captions and transport. */
.video-stage.xgplayer > xg-trigger { z-index:2; }
.misty-controls-disabled > .xgplayer-controls, .misty-controls-disabled > xg-trigger { display:none !important; }
.video-stage .xgplayer-controls { z-index:8; bottom:0; left:0; right:0; width:100%; padding:0 12px; box-sizing:border-box; color:#fff; }
.video-stage .xg-left-grid, .video-stage .xg-right-grid { flex-wrap:nowrap; flex-shrink:0; align-items:center; gap:4px; }
.video-stage .xgplayer-controls .xgplayer-icons { height:44px; }
.video-stage .xgplayer-controls xg-icon { margin:0 2px; }
.video-stage .xgplayer-time { white-space:nowrap; font-size:12px; }
.misty-player-tools, .business-buttons { display:flex; align-items:center; color:white; }
.business-buttons > button { display:grid; place-items:center; width:40px; height:44px; border:0; background:transparent; color:inherit; cursor:pointer; padding:8px; }
.business-buttons svg { width:21px; height:21px; }
.business-buttons button:focus-visible { outline:2px solid white; outline-offset:-3px; border-radius:6px; }
.player-menu-backdrop { position:absolute; z-index:14; inset:0; background:#0006; }
.player-business-menu { position:absolute; z-index:15; right:12px; bottom:58px; display:flex; flex-direction:column; width:min(370px,calc(100% - 24px)); max-height:calc(100% - 76px); overflow:hidden; border:1px solid var(--divider); border-radius:12px; background:var(--surface-elevated,var(--surface-1)); color:var(--text-primary); box-shadow:0 12px 36px #0003; color-scheme:inherit; }
.player-business-menu header { display:flex; align-items:center; justify-content:space-between; flex-shrink:0; padding:2px 8px 2px 16px; min-height:48px; border-bottom:1px solid var(--divider); }
.player-business-menu strong { font-size:15px; font-weight:600; }
.player-business-menu header button { display:grid; place-items:center; width:40px; height:40px; border:0; background:transparent; color:inherit; cursor:pointer; border-radius:6px; }
.player-business-menu header svg { width:20px; height:20px; }
.business-menu-body { min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; }
.player-settings-content { padding:0 16px 8px; }
.player-settings-row { display:grid; grid-template-columns:64px minmax(0,1fr); align-items:center; gap:12px; min-height:56px; border-bottom:1px solid var(--divider); font-size:14px; }
.player-setting-select { width:100%; min-width:0; max-width:100%; height:44px; padding:0 2px 0 8px; border:0; border-radius:6px; background:transparent; color:var(--text-secondary); font:inherit; text-align:right; text-align-last:right; text-overflow:ellipsis; }
.player-setting-select option { background:var(--surface-1); color:var(--text-primary); }
.player-setting-value { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; color:var(--text-secondary); }
.player-subtitle-setting { min-width:0; }
.player-subtitle-setting .subtitle-picker > .captions-icon { display:none; }
.player-subtitle-setting .subtitle-picker > svg { right:0; }
.player-business-menu .player-subtitle-setting select { width:100%; max-width:100%; padding:0 22px 0 8px; border:0; background:transparent; color:var(--text-secondary); text-align:right; text-align-last:right; }
.picture-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; min-width:0; }
.picture-options button { min-width:0; min-height:40px; padding:0 4px; border:1px solid transparent; border-radius:6px; background:transparent; color:var(--text-secondary); font:inherit; font-size:13px; cursor:pointer; }
.picture-options button[aria-pressed=true] { color:var(--liquid-accent-strong); border-color:var(--liquid-accent-muted); background:var(--liquid-accent-subtle); }
.player-preferences-toggle { display:flex; align-items:center; justify-content:space-between; width:100%; min-height:52px; padding:0; border:0; border-bottom:1px solid var(--divider); background:transparent; color:var(--text-primary); font:inherit; font-size:14px; cursor:pointer; }
.player-preferences-toggle svg { width:16px; height:16px; color:var(--text-tertiary); transition:transform .15s; }
.player-preferences-toggle .rotated { transform:rotate(180deg); }
.player-preferences-content { padding:4px 0 8px; border-bottom:1px solid var(--divider); }
.player-pip-action { display:flex; align-items:center; gap:10px; width:100%; min-height:48px; padding:0; border:0; background:transparent; color:var(--text-secondary); font:inherit; font-size:14px; cursor:pointer; }
.player-pip-action svg { width:19px; height:19px; }
.xg-gesture-feedback { position:absolute; z-index:10; top:40%; left:50%; transform:translateX(-50%); background:#000b; color:white; padding:8px 14px; border-radius:8px; pointer-events:none; }
@media(max-width:820px) {
  .video-stage .xgplayer-volume { display:none; }
  .video-stage .xgplayer-controls { padding:0 10px; }
  .video-stage .xgplayer-time { font-size:11px; }
  .player-menu-backdrop.inline-menu-backdrop { position:fixed; }
  .player-business-menu.inline-business-menu { position:fixed; left:8px; right:8px; bottom:max(8px,env(safe-area-inset-bottom)); width:auto; max-height:min(580px,72dvh); }
  .player-setting-select, .player-business-menu .player-subtitle-setting select { font-size:16px; }
}
@media(prefers-reduced-motion:reduce) { .player-preferences-toggle svg { transition:none; } }
</style>
