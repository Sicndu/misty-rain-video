<script setup lang="ts">
import { computed } from 'vue';
import { CATALOG_GENRES, CATALOG_COUNTRIES, catalogYears, hasCatalogFilters, type CatalogFilters } from '../../../server/catalogFacets.js';
const props = defineProps<{ modelValue: CatalogFilters }>();
const emit = defineEmits<{ (event: 'update:modelValue', value: CatalogFilters): void }>();
const years = catalogYears();
const active = computed(() => hasCatalogFilters(props.modelValue));
const update = (key: keyof CatalogFilters, event: Event) => emit('update:modelValue', { ...props.modelValue, [key]: (event.target as HTMLSelectElement).value });
</script>
<template>
  <div class="catalog-filters" role="group" aria-label="影片筛选">
    <label><span>类型</span><select aria-label="类型筛选" :value="modelValue.genre" @change="update('genre', $event)"><option value="">全部类型</option><option v-for="genre in CATALOG_GENRES" :key="genre" :value="genre">{{ genre }}</option></select></label>
    <label><span>国家 / 地区</span><select aria-label="国家地区筛选" :value="modelValue.country" @change="update('country', $event)"><option value="">全部地区</option><option v-for="country in CATALOG_COUNTRIES" :key="country" :value="country">{{ country }}</option></select></label>
    <label><span>年份</span><select aria-label="年份筛选" :value="modelValue.year" @change="update('year', $event)"><option value="">全部年份</option><option v-for="year in years" :key="year" :value="year">{{ year }}</option></select></label>
    <button v-if="active" class="clear-filters" type="button" @click="emit('update:modelValue', { genre: '', country: '', year: '' })">清空筛选</button>
  </div>
</template>
<style scoped>
.catalog-filters { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 10px; margin: 0 0 24px; }
.catalog-filters label { display: flex; flex: 0 1 160px; min-width: 0; flex-direction: column; gap: 7px; }
.catalog-filters label > span { font-size: .72rem; color: var(--text-tertiary); }
.catalog-filters select { width: 100%; min-height: 42px; padding: 0 10px; border: 1px solid var(--divider); border-radius: 8px; background: var(--surface-2); color: var(--text-primary); font: inherit; font-size: .8rem; }
.clear-filters { min-height: 42px; padding: 0 10px; border: 0; background: transparent; color: var(--liquid-accent); font-size: .78rem; }
@media(max-width:640px) { .catalog-filters { gap: 8px; } .catalog-filters label { flex: 1 1 28%; } .catalog-filters select { padding: 0 6px; font-size: .75rem; } .clear-filters { margin-left: auto; min-height: 32px; } }
</style>
