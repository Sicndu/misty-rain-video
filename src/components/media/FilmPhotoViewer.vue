<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { X, ChevronLeft, ChevronRight } from '@lucide/vue';
import { useDialog } from '../../composables/useDialog';
import type { CatalogPhoto } from '../../services/catalogDetails';
const props = defineProps<{ photos: CatalogPhoto[]; index: number; total: number; loading: boolean; hasMore: boolean; error: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'select', index: number): void; (e: 'more'): void }>();
const dialog = ref<HTMLElement | null>(null), failed = ref(false), usePreview = ref(false);
const current = computed(() => props.photos[props.index]);
watch(() => current.value?.id, () => { failed.value = false; usePreview.value = false; });
function imageFailed() {
  if (!usePreview.value && current.value?.fullImage && current.value.fullImage !== current.value.image) usePreview.value = true;
  else failed.value = true;
}
useDialog(dialog, () => props.index >= 0, () => emit('close'));
function next() { if (props.index + 1 < props.photos.length) emit('select', props.index + 1); else if (props.hasMore && !props.loading) emit('more'); }
let touchX = 0, touchY = 0;
function swipe(event: TouchEvent) {
  const point = event.changedTouches[0]; if (!point) return;
  const dx = point.clientX - touchX, dy = point.clientY - touchY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) next(); else if (props.index > 0) emit('select', props.index - 1); }
}
</script>
<template>
  <Teleport to="body">
    <div v-if="index >= 0 && current" ref="dialog" class="photo-viewer" role="dialog" aria-modal="true" aria-label="剧照大图" @keydown.left.prevent="index > 0 && emit('select', index - 1)" @keydown.right.prevent="next">
      <header><span>{{ index + 1 }} / {{ total || photos.length }}</span><button type="button" aria-label="关闭剧照" @click="emit('close')"><X aria-hidden="true" /></button></header>
      <div class="photo-stage" @touchstart.passive="touchX = $event.touches[0]?.clientX || 0; touchY = $event.touches[0]?.clientY || 0" @touchend.passive="swipe">
        <img v-if="!failed" :key="current.id" :src="usePreview ? current.image : current.fullImage || current.image" :alt="current.description || `剧照 ${index + 1}`" @error="imageFailed" />
        <button v-else class="image-retry" type="button" @click="failed = false">图片加载失败，重试</button>
      </div>
      <footer><button type="button" aria-label="上一张" :disabled="index === 0" @click="emit('select', index - 1)"><ChevronLeft aria-hidden="true" /></button><div><p v-if="current.description">{{ current.description }}</p><p v-if="error" role="alert">{{ error }}</p><span v-else-if="loading" role="status">正在加载…</span></div><button type="button" :aria-label="error ? '重试下一张' : '下一张'" :disabled="loading || index + 1 >= photos.length && !hasMore" @click="next"><ChevronRight aria-hidden="true" /></button></footer>
    </div>
  </Teleport>
</template>
<style scoped>
.photo-viewer { position:fixed; inset:0; z-index:1800; display:grid; grid-template-rows:auto minmax(0,1fr) auto; background:#101113; color:#f5f5f7; padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
header, footer { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 20px; }
header span { color:#c6c8cd; font-size:.85rem; }
button { display:grid; width:44px; min-height:44px; place-items:center; border:0; border-radius:50%; background:#ffffff12; color:inherit; cursor:pointer; }
button:disabled { opacity:.3; } svg { width:22px; height:22px; }
.photo-stage { min-height:0; display:grid; place-items:center; touch-action:pan-y pinch-zoom; overflow:auto; }
.photo-stage img { max-width:100%; max-height:100%; min-height:0; object-fit:contain; }
.image-retry { width:auto; border-radius:8px; padding:12px 24px; }
footer div { flex:1; min-width:0; text-align:center; color:#c6c8cd; font-size:.8rem; line-height:1.6; }
footer p { max-height:80px; overflow:auto; }
</style>
