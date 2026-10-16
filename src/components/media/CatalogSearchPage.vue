<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowLeft, Search, Star } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import { searchCatalog, type DiscoveryItem } from '../../services/discoveryService';
import { catalogSortOptions, catalogSortDescription, sortCatalogItems, type CatalogSort } from '../../services/catalogSort';
const sort = ref<CatalogSort>('recommended');
const props = defineProps<{ query: string; active: boolean; libraryCatalogIds: string[] }>();
const emit = defineEmits<{ (e: 'select', item: DiscoveryItem): void; (e: 'search-resources', query: string): void; (e: 'back'): void }>();
const items = ref<DiscoveryItem[]>([]), loading = ref(false), error = ref('');
const visibleItems = computed(() => sortCatalogItems(items.value, sort.value));
const categories = { movie: '电影', tv: '电视剧', anime: '动漫', variety: '综艺' };
let controller: AbortController | undefined, sequence = 0, loadedQuery = '';
const search = async () => {
  controller?.abort(); const seq = ++sequence;
  if (!props.query) return;
  controller = new AbortController(); loading.value = true; error.value = ''; items.value = [];
  try {
    const result = await searchCatalog(props.query, controller.signal);
    if (seq !== sequence) return;
    items.value = result; loadedQuery = props.query;
  } catch { if (seq === sequence) error.value = '影片信息暂时无法加载'; }
  finally { if (seq === sequence) loading.value = false; }
};
watch([() => props.query, () => props.active], ([query, active]) => {
  if (active && query && query !== loadedQuery) void search();
  if (!active && loading.value) { controller?.abort(); sequence++; loading.value = false; }
}, { immediate: true });
onBeforeUnmount(() => { controller?.abort(); sequence++; });
</script>
<template>
  <section class="catalog-search" aria-label="影片搜索结果">
    <header class="catalog-heading"><button type="button" class="back" @click="emit('back')"><ArrowLeft aria-hidden="true" />返回</button><h1>“{{ query }}”</h1><span v-if="!loading && items.length">{{ items.length }} 部影片</span><label v-if="items.length" class="catalog-sort"><select v-model="sort" aria-label="影片排序" :title="catalogSortDescription[sort]"><option v-for="option in catalogSortOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label></header>
    <div v-if="loading" class="catalog-grid" role="status" aria-label="正在搜索影片"><div v-for="n in 6" :key="n" class="skeleton"></div></div>
    <div v-else-if="items.length" class="catalog-grid">
      <button v-for="item in visibleItems" :key="item.id" class="catalog-card" type="button" :aria-label="`${libraryCatalogIds.includes(item.id) ? '播放' : '查找片源'}：${item.title}（${item.year || '年份未知'}）`" @click="emit('select', item)">
        <span class="poster"><MediaPoster :src="item.poster" alt="" loading="lazy" /><span v-if="libraryCatalogIds.includes(item.id)" class="saved">已收藏</span></span>
        <strong>{{ item.title }}</strong><span class="meta">{{ item.year }} · {{ categories[item.category] }}<span v-if="item.rating !== null"><Star aria-hidden="true" />{{ item.rating.toFixed(1) }}</span></span>
        <small>{{ item.subtitle || item.description }}</small>
      </button>
    </div>
    <div v-else-if="!loading" class="catalog-empty" :role="error ? 'alert' : 'status'"><Search aria-hidden="true" /><p>{{ error || '没有找到匹配的影片' }}</p><button v-if="error" type="button" @click="search">重新加载</button></div>
    <footer v-if="!loading" class="catalog-fallback"><span>{{ items.length ? '没找到想看的？' : '也可以直接按片名找资源' }}</span><button type="button" @click="emit('search-resources', query)">直接搜索资源</button><small v-if="items.length">影片信息来自豆瓣</small></footer>
  </section>
</template>
<style scoped>
.catalog-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-bottom: 24px; }
.catalog-sort { margin-left: auto; }
.catalog-sort select { min-height: 40px; padding: 0 12px; border: 1px solid var(--divider); border-radius: 8px; color: var(--text-secondary); background: var(--surface-2); font-size: .8rem; }
.catalog-heading h1 { font-size: 1.4rem; font-weight: 650; overflow-wrap: anywhere; }
.catalog-heading > span, .meta, .catalog-card small, .catalog-fallback { color: var(--text-tertiary); font-size: .8rem; }
.back { display: flex; align-items: center; gap: 4px; min-height: 44px; padding: 0; border: 0; color: var(--text-secondary); background: transparent; }
.back svg { width: 18px; }
.catalog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 28px 20px; }
.catalog-card { display: flex; min-width: 0; flex-direction: column; gap: 7px; padding: 0; border: 0; color: var(--text-primary); background: transparent; text-align: left; }
.poster, .skeleton { position: relative; display: block; width: 100%; aspect-ratio: 2/3; overflow: hidden; border-radius: 12px; background: var(--surface-2); }
.poster :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.saved { position: absolute; top: 8px; left: 8px; padding: 3px 6px; border-radius: 4px; color: #fff; background: #0009; font-size: .65rem; }
.catalog-card strong { font-size: .93rem; font-weight: 600; }
.meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.meta > span { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; }
.meta svg { width: 12px; height: 12px; }
.catalog-card small { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: .72rem; }
.catalog-empty { display: grid; justify-items: center; gap: 12px; padding: 64px 16px 24px; color: var(--text-tertiary); }
.catalog-empty button, .catalog-fallback button { min-height: 44px; padding: 0 12px; border: 0; border-radius: 8px; color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.catalog-fallback { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 28px 0; }
.catalog-fallback small { margin-left: auto; font-size: .68rem; }
@media(max-width:640px) { .catalog-grid { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 24px 14px; } .catalog-heading h1 { font-size: 1.15rem; } }
</style>
