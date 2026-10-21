<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowLeft, ArrowUpRight, Search, Star, Play } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import { loadCatalogDetails, type CatalogDetails } from '../../services/catalogDetails';
import { withAppBase } from '../../services/appUrl';
import type { DiscoveryItem } from '../../services/discoveryService';
const props = defineProps<{ id: string; seed?: DiscoveryItem | null; collected?: boolean }>();
const emit = defineEmits<{ (e: 'back'): void; (e: 'search', item: DiscoveryItem): void; (e: 'play-collection'): void }>();
const detail = ref<CatalogDetails | null>(null), loading = ref(false), failure = ref(''), expanded = ref(false), allCredits = ref(false);
const missingPortraits = ref(new Set<string>());
const item = computed(() => detail.value || (props.seed?.id === props.id ? props.seed : null));
const provider = computed(() => props.id.startsWith('bangumi-') ? 'Bangumi' : '豆瓣');
const sourceUrl = computed(() => props.id.startsWith('bangumi-') ? `https://bgm.tv/subject/${props.id.slice(8)}` : `https://movie.douban.com/subject/${props.id.slice(7)}/`);
const categories = { tv: '电视剧', movie: '电影', anime: '动漫', variety: '综艺' };
const meta = computed(() => item.value ? [item.value.year, ...(item.value.countries || []), categories[item.value.category]].filter(Boolean).join(' · ') : '');
const facts = computed(() => detail.value ? [
  ['导演', detail.value.directors.join(' / ')], ['类型', detail.value.genres?.join(' / ')],
  ['语言', detail.value.languages.join(' / ')], ['上映', detail.value.premieres.join(' / ')],
  ['片长', detail.value.durations.join(' / ')], ['集数', detail.value.episodeCount ? `${detail.value.episodeCount} 集` : ''],
  ['别名', detail.value.aliases.join(' / ')]
].filter(([, value]) => value) : []);
const credits = computed(() => allCredits.value ? detail.value?.credits : detail.value?.credits.slice(0, 8));
let controller: AbortController | undefined, sequence = 0;
async function load() {
  controller?.abort(); const seq = ++sequence; controller = new AbortController();
  loading.value = true; failure.value = '';
  try { const result = await loadCatalogDetails(props.id, controller.signal); if (seq === sequence) detail.value = result; }
  catch (error) { if (seq === sequence) failure.value = error instanceof Error ? error.message : '详情暂时无法加载'; }
  finally { if (seq === sequence) loading.value = false; }
}
watch(() => props.id, () => { detail.value = null; expanded.value = false; allCredits.value = false; missingPortraits.value = new Set(); void load(); }, { immediate: true });
onBeforeUnmount(() => { sequence++; controller?.abort(); });
function search() {
  if (!item.value) return;
  // Use the durable poster identity in saved items/history, not the short-lived detail image handle.
  emit('search', { ...item.value, poster: withAppBase(`/api/discovery/posters/${props.id}`) });
}
</script>

<template>
  <article class="film-detail" aria-label="影片详情" :aria-busy="loading">
    <nav class="detail-nav"><button type="button" @click="emit('back')"><ArrowLeft aria-hidden="true" />返回</button><a :href="sourceUrl" target="_blank" rel="noopener noreferrer">{{ provider }}<ArrowUpRight aria-hidden="true" /></a></nav>
    <div v-if="item" class="detail-layout">
      <aside class="detail-aside"><div class="detail-cover"><MediaPoster :src="item.poster" :alt="item.title + '海报'" /></div>
      <div class="detail-actions"><button type="button" class="search-resources" @click="search"><Search aria-hidden="true" />搜索资源</button><button v-if="collected" type="button" class="play-collection" @click="emit('play-collection')"><Play aria-hidden="true" />播放收藏</button></div>
      </aside>
      <header class="detail-heading">
        <p class="film-kind">{{ meta }}</p>
        <h1>{{ item.title }}</h1>
        <p v-if="detail?.originalTitle && detail.originalTitle !== item.title" class="original-title">{{ detail.originalTitle }}</p>
        <p v-if="item.genres?.length" class="genre-line">{{ item.genres.join(' / ') }}</p>
        <div class="rating-line"><template v-if="item.rating"><Star aria-hidden="true" /><strong>{{ item.rating.toFixed(1) }}</strong><span>{{ provider }}评分<span v-if="item.ratingCount"> · {{ item.ratingCount.toLocaleString() }} 人评价</span></span></template><span v-else>暂无评分</span></div>
        <p v-if="detail?.episodeCount || item.subtitle" class="release-line">{{ item.subtitle || `全 ${detail?.episodeCount} 集` }}</p>
      </header>

      <div class="detail-body">
        <p v-if="loading" class="detail-notice" role="status">正在加载详情…</p>
        <p v-else-if="failure" class="detail-notice" role="alert">{{ failure }}<button type="button" @click="load">重试</button></p>
        <p v-else-if="detail?.stale" class="detail-notice" role="status">当前展示上次获取的信息<button type="button" @click="load">刷新</button></p>
        <section v-if="detail?.description" class="detail-section synopsis"><h2>剧情简介</h2><p :class="{ collapsed: !expanded }">{{ detail.description }}</p><button v-if="detail.description.length > 140" type="button" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? '收起' : '展开全部' }}</button></section>
        <section v-if="detail?.credits.length" class="detail-section"><div class="section-heading"><h2>演职员</h2><button v-if="detail.credits.length > 8" type="button" :aria-expanded="allCredits" @click="allCredits = !allCredits">{{ allCredits ? '收起' : '展开' }}</button></div>
          <div class="credit-grid" :class="{ expanded: allCredits }"><div v-for="person in credits" :key="person.name" class="credit"><a v-if="person.url" :href="person.url" target="_blank" rel="noopener noreferrer" :aria-label="person.name + '的豆瓣资料'"><img v-if="person.image && !missingPortraits.has(person.name)" :src="person.image" alt="" loading="lazy" @error="missingPortraits.add(person.name)" /><span v-else class="portrait-fallback">{{ person.name.slice(0, 1) }}</span></a><span v-else class="portrait-fallback">{{ person.name.slice(0, 1) }}</span><strong>{{ person.name }}</strong><small>{{ person.role }}</small></div></div>
          <a v-if="detail.creditCount" class="section-more" :href="sourceUrl + 'celebrities'" target="_blank" rel="noopener noreferrer">豆瓣完整演职员 · {{ detail.creditCount }} 人<ArrowUpRight aria-hidden="true" /></a>
        </section>
        <section v-if="detail?.photos.length" class="detail-section"><div class="section-heading"><h2>剧照</h2><a :href="sourceUrl + 'photos?type=S'" target="_blank" rel="noopener noreferrer">{{ detail.photoCount ? `全部 ${detail.photoCount} 张` : '更多' }}<ArrowUpRight aria-hidden="true" /></a></div><div class="photo-row"><a v-for="(photo, index) in detail.photos" :key="photo.image" :href="photo.url" target="_blank" rel="noopener noreferrer"><img :src="photo.image" :alt="photo.description || `${item.title}剧照 ${index + 1}`" loading="lazy" /></a></div></section>
        <section v-if="facts.length" class="detail-section"><h2>影片信息</h2><dl><template v-for="[label, value] in facts" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></template></dl><p v-if="detail?.honors.length" class="honors">{{ detail.honors.join(' · ') }}</p></section>
        <section v-if="detail?.comments.length" class="detail-section"><div class="section-heading"><h2>热门短评</h2><a :href="sourceUrl + 'comments'" target="_blank" rel="noopener noreferrer">更多<ArrowUpRight aria-hidden="true" /></a></div><div v-for="(comment, index) in detail.comments" :key="index" class="short-comment"><header><strong>{{ comment.author }}</strong><span v-if="comment.rating" :aria-label="`${comment.rating} 星`">{{ '★'.repeat(comment.rating) }}</span><time>{{ comment.date }}</time></header><p>{{ comment.text }}</p></div></section>
        <footer v-if="detail" class="detail-attribution">影片信息来自 {{ provider }}<span v-if="detail.partial"> · 部分资料暂未取得</span><a :href="sourceUrl" target="_blank" rel="noopener noreferrer">查看完整资料<ArrowUpRight aria-hidden="true" /></a></footer>
      </div>
    </div>
    <div v-else class="detail-empty" :role="failure ? 'alert' : 'status'"><h1>{{ failure || '正在加载影片…' }}</h1><button v-if="failure" type="button" @click="load">重新加载</button><a v-if="failure" :href="sourceUrl" target="_blank" rel="noopener noreferrer">在 {{ provider }} 查看</a></div>
  </article>
</template>

<style scoped>
.film-detail { max-width: 1080px; margin: 0 auto; color: var(--text-primary); }
.detail-nav { display:flex; justify-content:space-between; align-items:center; margin-bottom:28px; }
.detail-nav button, .detail-nav a { display:inline-flex; align-items:center; gap:8px; min-height:44px; }
button, a { -webkit-tap-highlight-color:transparent; }
button { cursor:pointer; }
a { color:inherit; text-decoration:none; }
.detail-nav button, .detail-section button, .detail-notice button { border:0; background:transparent; color:var(--text-secondary); padding:0; }
svg { width:18px; height:18px; flex-shrink:0; }
.detail-nav a, .section-heading a, .section-more, .detail-attribution { color:var(--text-tertiary); font-size:.8rem; }
.detail-layout { display:grid; grid-template-columns:210px minmax(0,1fr); grid-template-rows:auto 1fr; column-gap:40px; align-items:start; }
.detail-aside { grid-column:1; grid-row:1 / 3; }
.detail-cover { grid-column:1; grid-row:1; }
.detail-cover img { display:block; width:100%; aspect-ratio:2/3; object-fit:cover; border-radius:10px; background:var(--surface-2); }
.detail-heading { grid-column:2; grid-row:1; padding:8px 0 24px; }
.film-kind, .original-title, .genre-line, .release-line { color:var(--text-secondary); font-size:.87rem; line-height:1.7; }
h1 { font-size:clamp(1.5rem,3vw,2.25rem); font-weight:650; line-height:1.35; margin:8px 0; overflow-wrap:anywhere; }
.original-title { color:var(--text-tertiary); margin-bottom:14px; }
.rating-line { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:20px 0 10px; }
.rating-line svg { color:var(--liquid-accent); width:16px; }
.rating-line strong { font-size:1.5rem; line-height:1; }
.rating-line span { color:var(--text-tertiary); font-size:.78rem; line-height:1.5; }
.detail-actions { grid-column:1; grid-row:2; display:grid; gap:8px; padding-top:16px; }
.detail-actions button { display:flex; align-items:center; justify-content:center; gap:8px; border:0; border-radius:9px; min-height:46px; font-weight:600; font-size:.95rem; }
.search-resources { background:var(--liquid-accent); color:var(--accent-ink); }
.play-collection { background:var(--surface-2); color:var(--text-secondary); }
.detail-body { grid-column:2; grid-row:2; min-width:0; }
.detail-section { padding:24px 0; border-top:1px solid var(--divider); }
h2 { margin:0 0 16px; font-size:1rem; font-weight:650; }
.synopsis p { white-space:pre-line; font-size:.9rem; line-height:1.9; color:var(--text-secondary); }
.synopsis p.collapsed { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:4; overflow:hidden; }
.synopsis button { margin-top:8px; min-height:32px; font-size:.8rem; color:var(--liquid-accent); }
.section-heading { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:16px; }
.section-heading h2 { margin:0; }
.section-heading a, .section-more { display:inline-flex; align-items:center; gap:2px; }
.section-heading button { min-height:32px; font-size:.8rem; }
.credit-grid { display:flex; gap:16px; overflow-x:auto; padding-bottom:10px; }
.credit-grid.expanded { display:grid; grid-template-columns:repeat(auto-fill,minmax(80px,1fr)); }
.credit { flex:0 0 80px; min-width:0; }
.credit img, .portrait-fallback { display:grid; width:80px; height:104px; object-fit:cover; border-radius:6px; background:var(--surface-2); place-items:center; color:var(--text-tertiary); font-size:1.6rem; }
.credit strong, .credit small { display:block; margin-top:7px; font-size:.76rem; line-height:1.5; overflow-wrap:anywhere; font-weight:500; }
.credit small { margin-top:3px; color:var(--text-tertiary); font-size:.7rem; }
.section-more { margin-top:10px; min-height:32px; }
.photo-row { display:flex; gap:12px; overflow-x:auto; padding-bottom:8px; }
.photo-row a { flex:0 0 220px; }
.photo-row img { display:block; width:100%; height:136px; object-fit:cover; border-radius:6px; background:var(--surface-2); }
dl { display:grid; grid-template-columns:50px minmax(0,1fr); gap:12px 16px; font-size:.84rem; line-height:1.7; }
dt { color:var(--text-tertiary); } dd { margin:0; color:var(--text-secondary); overflow-wrap:anywhere; }
.honors { color:var(--liquid-accent); margin-top:20px; font-size:.8rem; }
.short-comment + .short-comment { margin-top:24px; }
.short-comment header { display:flex; align-items:center; gap:10px; font-size:.75rem; }
.short-comment header strong { font-weight:550; } .short-comment header span { color:var(--liquid-accent); letter-spacing:1px; }
.short-comment time { margin-left:auto; color:var(--text-tertiary); font-size:.7rem; }
.short-comment p { margin-top:8px; color:var(--text-secondary); font-size:.83rem; line-height:1.8; white-space:pre-line; }
.detail-attribution { padding:12px 0 24px; line-height:1.8; }
.detail-attribution a { display:flex; align-items:center; gap:2px; margin-top:8px; }
.detail-notice { display:flex; gap:14px; align-items:center; color:var(--text-tertiary); font-size:.8rem; padding:16px 0; }
.detail-notice button { color:var(--liquid-accent); min-height:36px; }
.detail-empty { padding:60px 0; text-align:center; color:var(--text-secondary); }
.detail-empty h1 { font-size:1.2rem; } .detail-empty button, .detail-empty a { display:inline-block; margin:16px; padding:10px; color:var(--liquid-accent); background:transparent; border:0; }
@media(max-width:767px) {
  .detail-nav { margin-bottom:20px; }
  .detail-aside { display:contents; }
  .detail-layout { grid-template-columns:112px minmax(0,1fr); column-gap:18px; }
  .detail-cover img { border-radius:7px; }
  .detail-heading { padding:0; min-height:168px; }
  h1 { font-size:1.4rem; margin:4px 0 8px; }
  .film-kind, .genre-line, .original-title, .release-line { font-size:.72rem; line-height:1.6; }
  .original-title { margin-bottom:6px; }
  .rating-line { gap:5px; margin:12px 0 7px; }
  .rating-line strong { font-size:1.2rem; }
  .rating-line span { font-size:.68rem; }
  .rating-line > span { flex-basis:100%; }
  .rating-line span span { white-space:nowrap; }
  .detail-body { grid-column:1 / -1; padding-top:24px; padding-bottom:70px; }
  .detail-section { padding:22px 0; }
  .detail-actions { position:fixed; z-index:30; bottom:0; left:0; right:0; display:flex; padding:12px max(16px,env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); background:var(--nav-background); border-top:1px solid var(--divider); backdrop-filter:blur(20px); }
  .detail-actions .search-resources { flex:1; } .play-collection { padding:0 14px; }
  .credit-grid { gap:14px; } .photo-row a { flex-basis:200px; } .photo-row img { height:122px; }
}
</style>
