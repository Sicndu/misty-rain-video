<script setup lang="ts">
import { computed } from 'vue';
import { CATALOG_GENRES, CATALOG_COUNTRIES, catalogYears, hasCatalogFilters, type CatalogFilters } from '../../../server/catalogFacets.js';
import type { CatalogSort } from '../../services/catalogSort';
const props = defineProps<{ modelValue: CatalogFilters; sort: CatalogSort }>();
const emit = defineEmits<{ (event: 'update:modelValue', value: CatalogFilters): void; (event: 'update:sort', value: CatalogSort): void }>();
const active = computed(() => hasCatalogFilters(props.modelValue));
const rows: Array<{ key: keyof CatalogFilters; label: string; values: string[] }> = [
  { key: 'genre', label: '类型', values: CATALOG_GENRES },
  { key: 'country', label: '地区', values: CATALOG_COUNTRIES },
  { key: 'year', label: '年份', values: catalogYears() }
];
const sorts: Array<{ value: CatalogSort; label: string }> = [
  { value: 'recommended', label: '推荐' }, { value: 'time', label: '最新' },
  { value: 'popularity', label: '热门' }, { value: 'rating', label: '评分' }
];
const shortName = (value: string) => ({ 中国大陆: '大陆', 中国香港: '香港', 中国台湾: '台湾' }[value] || value);
const update = (key: keyof CatalogFilters, value: string) => emit('update:modelValue', { ...props.modelValue, [key]: value });
</script>
<template>
  <div class="catalog-filters" aria-label="影片筛选">
    <div v-for="row in rows" :key="row.key" class="facet-row">
      <span class="facet-label" aria-hidden="true">{{ row.label }}</span>
      <div class="facet-options" role="group" :aria-label="`${row.label}筛选`">
        <button type="button" :aria-pressed="!modelValue[row.key]" @click="update(row.key, '')">全部</button>
        <button v-for="value in row.values" :key="value" type="button" :aria-label="value" :aria-pressed="modelValue[row.key] === value" @click="update(row.key, value)">{{ shortName(value) }}</button>
      </div>
    </div>
    <div class="facet-row">
      <span class="facet-label" aria-hidden="true">排序</span>
      <div class="facet-options" role="group" aria-label="发现排序">
        <button v-for="option in sorts" :key="option.value" type="button" :aria-pressed="sort === option.value" @click="emit('update:sort', option.value)">{{ option.label }}</button>
      </div>
    </div>
    <button v-if="active" class="clear-filters" type="button" @click="emit('update:modelValue', { genre: '', country: '', year: '' })">清空筛选</button>
  </div>
</template>
<style scoped>
.catalog-filters { min-width: 0; margin-bottom: 24px; padding: 8px 0 10px; border-bottom: 1px solid var(--divider); }
.facet-row { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; align-items: center; }
.facet-label { font-size: .78rem; font-weight: 550; color: var(--text-tertiary); }
.facet-options { display: flex; gap: 4px; overflow-x: auto; overscroll-behavior-x: contain; padding: 3px 1px; scrollbar-width: thin; scrollbar-color: var(--divider) transparent; }
.facet-options button { flex-shrink: 0; min-height: 38px; padding: 0 12px; border: 0; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: .8rem; white-space: nowrap; }
.facet-options button[aria-pressed='true'] { color: var(--liquid-accent); background: var(--liquid-accent-subtle); font-weight: 650; }
.facet-options button:focus-visible { outline: 2px solid var(--liquid-accent); outline-offset: -2px; }
.clear-filters { display: block; min-height: 34px; margin: 6px 0 0 auto; padding: 0 10px; border: 0; background: transparent; color: var(--text-tertiary); font-size: .74rem; }
@media(max-width:640px) { .facet-options { scrollbar-width: none; } .facet-options::-webkit-scrollbar { display: none; } .facet-options button { min-height: 40px; padding: 0 11px; font-size: .78rem; } }
</style>
