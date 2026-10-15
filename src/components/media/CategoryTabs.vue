<script setup lang="ts">
import type { CategoryType } from '../../types/media';

defineProps<{
  modelValue: CategoryType;
  counts: Record<CategoryType, number>;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: CategoryType): void;
}>();

const categories: { id: CategoryType; label: string }[] = [
  { id: 'tv', label: '电视剧' },
  { id: 'movie', label: '电影' },
  { id: 'variety', label: '综艺' },
  { id: 'anime', label: '动漫' }
];
</script>

<template>
  <nav class="category-segments" aria-label="影片分类">
    <button
      v-for="cat in categories"
      :key="cat.id"
      type="button"
      class="segment-item"
      :class="{ active: modelValue === cat.id }"
      :aria-current="modelValue === cat.id ? 'page' : undefined"
      @click="emit('update:modelValue', cat.id)"
    >
      <span class="segment-label">{{ cat.label }}</span>
      <span v-if="counts[cat.id] > 0" class="segment-count">{{ counts[cat.id] }}</span>
    </button>
  </nav>
</template>

<style scoped>
.category-segments { position: relative; display: inline-grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 0; border: 0; background: transparent; }
.segment-item { position: relative; display: flex; min-width: 0; min-height: 44px; align-items: center; justify-content: center; gap: 6px; padding: 0 16px; border: 0; border-radius: 8px; color: var(--text-tertiary); background: transparent; font-size: .88rem; font-weight: 550; white-space: nowrap; transition: color .2s, background .2s, opacity .15s; }
.segment-item:hover { color: var(--text-primary); }
.segment-item:active { opacity: .7; }
.segment-item.active { color: var(--text-primary); background: transparent; font-weight: 650; }
.segment-item.active::after { content: ''; position: absolute; bottom: -1px; left: 14px; right: 14px; height: 2.5px; border-radius: 9999px; background: var(--text-primary); }
.segment-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9999px; background: var(--glass-bg); color: var(--text-tertiary); font-size: .68rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.segment-item.active .segment-count { color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
@media (max-width: 640px) {
  .category-segments { width: 100%; gap: 2px; }
  .segment-item { padding: 0 2px; gap: 4px; font-size: .84rem; }
  .segment-item.active::after { left: 6px; right: 6px; }
  .segment-count { min-width: 16px; height: 16px; padding: 0 4px; font-size: .62rem; }
}
@media (max-width: 360px) { .segment-count { display: none; } }
</style>
