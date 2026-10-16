<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowUpRight, ChevronRight, RefreshCw, Star } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import { loadDiscovery, type DiscoveryCategory, type DiscoveryItem, type DiscoverySection } from '../../services/discoveryService';

const props = defineProps<{ active: boolean; libraryCatalogIds: string[] }>();
const emit = defineEmits<{ (event: 'select', item: DiscoveryItem): void; (event: 'search'): void }>();
const category = ref<DiscoveryCategory>('all');
const animeMode = ref('anime');
const weekday = ref(new Date().getDay() || 7);
const categories: Array<{ id: DiscoveryCategory; label: string }> = [
  { id: 'all', label: '全部' }, { id: 'tv', label: '电视剧' }, { id: 'movie', label: '电影' },
  { id: 'anime', label: '动漫' }, { id: 'variety', label: '综艺' }
];
const sections = ref<DiscoverySection[]>([]);
const shownSections = computed(() => sections.value.filter(section => category.value !== 'anime' || section.id === animeMode.value));
const loading = ref(false), failure = ref('');
const cache = new Map<DiscoveryCategory, DiscoverySection[]>();
const inLibrary = computed(() => new Set(props.libraryCatalogIds));
let controller: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0, pollCount = 0;
const updatedText = (section: DiscoverySection) => section.updatedAt
  ? `${new Date(section.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 更新` : '';

const stop = () => { generation++; controller?.abort(); clearTimeout(timer); loading.value = false; };
const read = async (poll = false) => {
  if (!props.active) return;
  if (!poll) { stop(); pollCount = 0; }
  const current = ++generation, selected = category.value;
  controller = new AbortController(); loading.value = true; failure.value = '';
  try {
    const result = await loadDiscovery(selected, controller.signal);
    if (current !== generation || !props.active) return;
    sections.value = result; cache.set(selected, result);
    if (result.some(section => section.refreshing) && pollCount++ < 15) timer = setTimeout(() => { void read(true); }, 2_000);
  } catch {
    if (current === generation) failure.value = '推荐暂时无法加载，可以稍后重试。';
  } finally { if (current === generation) loading.value = false; }
};
watch([() => props.active, category], ([active]) => {
  stop();
  if (active) { sections.value = cache.get(category.value) || []; void read(); }
}, { immediate: true });
onBeforeUnmount(stop);
const changeCategory = (value: DiscoveryCategory) => { category.value = value; };
const visibleItems = (section: DiscoverySection) => section.id === 'calendar' ? section.items.filter(item => item.weekday === weekday.value) : category.value === 'all' ? section.items.slice(0, 10) : section.items;
</script>

<template>
  <div class="discovery-page">
    <header class="discovery-heading"><h1>发现</h1></header>
    <nav class="discovery-categories" aria-label="发现分类">
      <button v-for="item in categories" :key="item.id" type="button" :aria-pressed="category === item.id" @click="changeCategory(item.id)">{{ item.label }}</button>
    </nav>
    <div v-if="category === 'anime'" class="anime-modes" aria-label="动漫榜单">
      <button type="button" :aria-pressed="animeMode === 'anime'" @click="animeMode = 'anime'">热门推荐</button><button type="button" :aria-pressed="animeMode === 'calendar'" @click="animeMode = 'calendar'">每周放送</button>
    </div>
    <div v-if="failure" class="discovery-feedback" role="alert"><span>{{ failure }}</span><button type="button" :disabled="loading" @click="read()"><RefreshCw aria-hidden="true" />重试</button></div>
    <div v-if="loading && !sections.length" class="discovery-skeleton" role="status" aria-label="正在加载推荐"><div v-for="n in 6" :key="n"></div></div>
    <section v-for="section in shownSections" :key="section.id" class="discovery-section" :aria-labelledby="`discovery-${section.id}`">
      <header class="section-heading">
        <h2 :id="`discovery-${section.id}`">{{ section.title }}</h2>
        <button v-if="category === 'all' && section.items.length" type="button" :aria-label="`查看更多${categories.find(item => item.id === section.category)?.label}`" @click="changeCategory(section.category)">更多<ChevronRight aria-hidden="true" /></button>
      </header>
      <nav v-if="section.id === 'calendar'" class="weekdays" aria-label="放送日期"><button v-for="(day, index) in ['一', '二', '三', '四', '五', '六', '日']" :key="day" type="button" :aria-pressed="weekday === index + 1" @click="weekday = index + 1">周{{ day }}</button></nav>
      <div v-if="visibleItems(section).length" class="discovery-posters" :class="{ shelf: category === 'all' }">
        <button v-for="item in visibleItems(section)" :key="item.id" class="discovery-card" type="button" :aria-label="`${inLibrary.has(item.id) ? '播放' : '查找片源'}：${item.title}${item.year ? `（${item.year}）` : ''}`" @click="emit('select', item)">
          <span class="discovery-cover"><MediaPoster :src="item.poster" alt="" loading="lazy" decoding="async" /><span v-if="inLibrary.has(item.id)" class="library-badge">片库已有</span><span class="poster-action" aria-hidden="true">{{ inLibrary.has(item.id) ? '播放' : '找片源' }}<ChevronRight /></span></span>
          <strong class="discovery-title">{{ item.title }}</strong>
          <span class="discovery-meta"><span>{{ item.subtitle || item.year }}</span><span v-if="item.rating !== null" class="discovery-rating"><Star aria-hidden="true" />{{ item.rating.toFixed(1) }}</span></span>
        </button>
      </div>
      <div v-else-if="section.refreshing" class="discovery-skeleton" role="status" :aria-label="`正在加载${section.title}`"><div v-for="n in 4" :key="n"></div></div>
      <div v-else class="discovery-empty"><p>{{ section.id === 'calendar' && section.items.length ? '当天暂无放送安排' : '推荐暂时不可用，稍后再来看看' }}</p><button type="button" @click="emit('search')">搜索片名</button></div>
      <footer class="source-note"><a :href="section.sourceUrl" target="_blank" rel="noopener noreferrer">{{ section.source }}<ArrowUpRight aria-hidden="true" /></a><span>{{ section.stale ? '暂用上次推荐 · ' : '' }}{{ updatedText(section) }}</span><span v-if="section.refreshing">更新中</span></footer>
    </section>
  </div>
</template>

<style scoped>
.discovery-heading, .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.discovery-heading h1 { font-size: 2rem; font-weight: 700; letter-spacing: -.035em; }
.discovery-categories { display: flex; gap: 24px; overflow-x: auto; margin: 18px 0 28px; border-bottom: 1px solid var(--divider); }
.discovery-categories button { position: relative; flex: 0 0 auto; min-height: 48px; padding: 0 2px 10px; border: 0; color: var(--text-tertiary); background: transparent; font-size: .86rem; font-weight: 500; }
.discovery-categories button[aria-pressed='true'] { color: var(--text-primary); font-weight: 650; }
.discovery-categories button[aria-pressed='true']::after { content: ''; position: absolute; right: 0; bottom: 0; left: 0; height: 2px; background: currentColor; border-radius: 2px; }
.anime-modes, .weekdays { display: flex; gap: 8px; margin-bottom: 20px; }
.anime-modes button, .weekdays button { min-height: 40px; padding: 0 12px; border: 0; border-radius: 8px; color: var(--text-tertiary); background: transparent; font-size: .8rem; }
.anime-modes button[aria-pressed='true'], .weekdays button[aria-pressed='true'] { color: var(--text-primary); background: var(--glass-bg-active); }
.weekdays { justify-content: space-between; gap: 2px; }
.weekdays button { padding: 0 8px; }
.discovery-section { min-width: 0; margin-bottom: 34px; }
.section-heading { margin-bottom: 16px; }
.section-heading h2 { font-size: 1.12rem; font-weight: 650; letter-spacing: -.02em; }
.section-heading button { display: flex; min-height: 36px; align-items: center; gap: 3px; border: 0; color: var(--text-tertiary); background: transparent; font-size: .76rem; }
.section-heading svg { width: 15px; height: 15px; }
.discovery-posters, .discovery-skeleton { display: grid; grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 24px 18px; }
.discovery-posters.shelf { grid-auto-flow: column; grid-auto-columns: clamp(145px, 15vw, 186px); grid-template-columns: none; gap: 18px; overflow-x: auto; padding: 0 2px 12px; scroll-snap-type: x proximity; }
.discovery-card { display: flex; min-width: 0; flex-direction: column; align-items: stretch; gap: 8px; padding: 0; border: 0; border-radius: var(--radius-sm); color: var(--text-primary); background: transparent; text-align: left; scroll-snap-align: start; }
.discovery-cover { position: relative; display: block; width: 100%; aspect-ratio: 2 / 3; overflow: hidden; border-radius: var(--radius-sm); background: var(--surface-2); }
.discovery-cover img { width: 100%; height: 100%; object-fit: cover; }
.library-badge { position: absolute; top: 8px; left: 8px; padding: 3px 6px; border-radius: 4px; color: #fff; background: rgb(0 0 0 / .65); font-size: .62rem; }
.poster-action { position: absolute; inset: auto 0 0; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 26px 8px 12px; color: #fff; background: linear-gradient(transparent, rgb(0 0 0 / .75)); font-size: .8rem; opacity: 0; transition: opacity .16s; }
.poster-action svg { width: 15px; height: 15px; }
.discovery-card:hover .poster-action, .discovery-card:focus-visible .poster-action { opacity: 1; }
.discovery-title { overflow: hidden; color: var(--text-primary); font-size: .87rem; font-weight: 550; white-space: nowrap; text-overflow: ellipsis; }
.discovery-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 18px; margin-top: -4px; color: var(--text-tertiary); font-size: .7rem; }
.discovery-meta > span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.discovery-rating { display: inline-flex; flex-shrink: 0; align-items: center; gap: 3px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.discovery-rating svg { width: 11px; height: 11px; }
.source-note { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 12px; color: var(--text-tertiary); font-size: .65rem; }
.source-note a { display: flex; align-items: center; gap: 2px; color: inherit; text-decoration: none; }
.source-note svg { width: 11px; height: 11px; }
.discovery-skeleton > div { aspect-ratio: 2 / 3; border-radius: var(--radius-sm); background: var(--surface-2); }
.discovery-feedback, .discovery-empty { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 0; color: var(--text-tertiary); font-size: .82rem; }
.discovery-feedback button, .discovery-empty button { display: flex; align-items: center; gap: 5px; min-height: 44px; border: 0; color: var(--liquid-accent); background: transparent; white-space: nowrap; }
.discovery-feedback svg { width: 16px; height: 16px; }
@media (max-width: 640px) {
  .discovery-heading h1 { font-size: 1.65rem; }
  .discovery-categories { justify-content: space-between; gap: 18px; margin: 10px 0 22px; }
  .discovery-categories button { font-size: .82rem; }
  .discovery-posters, .discovery-skeleton { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 14px; }
  .discovery-posters.shelf { grid-template-columns: none; grid-auto-columns: 42%; gap: 14px; }
  .section-heading h2 { font-size: 1.02rem; }
  .discovery-section { margin-bottom: 28px; }
}
</style>
