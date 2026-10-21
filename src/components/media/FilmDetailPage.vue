<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowLeft, Search, Star, Play } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import { loadCatalogDetails, loadCatalogContent, type CatalogDetails, type CatalogPhoto, type CatalogComment } from '../../services/catalogDetails';
import FilmPhotoViewer from './FilmPhotoViewer.vue';
import { withAppBase } from '../../services/appUrl';
import type { DiscoveryItem } from '../../services/discoveryService';
const props = defineProps<{ id: string; seed?: DiscoveryItem | null; collected?: boolean }>();
const emit = defineEmits<{ (e: 'back'): void; (e: 'search', item: DiscoveryItem): void; (e: 'play-collection'): void }>();
const detail = ref<CatalogDetails | null>(null), loading = ref(false), failure = ref(''), expanded = ref(false), allCredits = ref(false);
const missingPortraits = ref(new Set<string>());
const photos = ref<CatalogPhoto[]>([]), comments = ref<CatalogComment[]>([]);
const photoNext = ref<number | null>(0), commentNext = ref<number | null>(0);
const photoTotal = ref(0), commentTotal = ref(0), photoLoading = ref(false), commentLoading = ref(false);
const photoError = ref(''), commentError = ref(''), photoStale = ref(false), commentStale = ref(false);
const photoExpanded = ref(false), commentExpanded = ref(false), photoIndex = ref(-1);
const contentControllers = new Map<string, AbortController>();
let viewerHistoryKey = '', viewerStartIndex = 0;
function closePhoto() {
  if (viewerHistoryKey && window.history.state?.mistyRainPhoto === viewerHistoryKey) window.history.back();
  else photoIndex.value = -1;
}
function openPhoto(index: number) {
  photoIndex.value = index; viewerStartIndex = index;
  viewerHistoryKey = `${props.id}:${Date.now()}`;
  window.history.pushState({ ...window.history.state, mistyRainPhoto: viewerHistoryKey }, '');
}
function photoPop(event: PopStateEvent) {
  if (photoIndex.value >= 0) photoIndex.value = -1;
  else if (event.state?.mistyRainPhoto === viewerHistoryKey) photoIndex.value = Math.min(viewerStartIndex, photos.value.length - 1);
}
window.addEventListener('popstate', photoPop);
async function more(section: 'photos' | 'comments', advance = false) {
  const next = section === 'photos' ? photoNext : commentNext;
  const busy = section === 'photos' ? photoLoading : commentLoading;
  const message = section === 'photos' ? photoError : commentError;
  if (busy.value || next.value === null) return;
  const id = props.id, start = next.value, previousLength = photos.value.length, requestedIndex = photoIndex.value;
  const controller = new AbortController(); contentControllers.get(section)?.abort(); contentControllers.set(section, controller);
  busy.value = true; message.value = '';
  try {
    if (section === 'photos') {
      const page = await loadCatalogContent<CatalogPhoto>(id, section, start, controller.signal);
      if (id !== props.id || controller.signal.aborted) return;
      const merged = new Map(photos.value.map(item => [item.id, item])); page.items.forEach(item => merged.set(item.id, item));
      photos.value = [...merged.values()]; photoTotal.value = page.total; photoStale.value = page.stale;
      next.value = start > 0 && photos.value.length === previousLength ? null : page.nextStart;
      if (advance && requestedIndex >= 0 && photoIndex.value === requestedIndex && photos.value.length > previousLength) photoIndex.value++;
    } else {
      const page = await loadCatalogContent<CatalogComment>(id, section, start, controller.signal);
      if (id !== props.id || controller.signal.aborted) return;
      const previous = comments.value.length, merged = new Map(comments.value.map(item => [item.id, item]));
      page.items.forEach(item => merged.set(item.id, item)); comments.value = [...merged.values()]; commentTotal.value = page.total; commentStale.value = page.stale;
      next.value = start > 0 && comments.value.length === previous ? null : page.nextStart;
    }
  } catch (error) { if (!controller.signal.aborted && id === props.id) message.value = error instanceof Error ? error.message : '加载失败'; }
  finally { if (contentControllers.get(section) === controller) { busy.value = false; contentControllers.delete(section); } }
}
function expandPhotos() { photoExpanded.value = !photoExpanded.value; if (photoExpanded.value && photoNext.value === 0) void more('photos'); }
function expandComments() { commentExpanded.value = !commentExpanded.value; if (commentExpanded.value && commentNext.value === 0) void more('comments'); }

const item = computed(() => detail.value || (props.seed?.id === props.id ? props.seed : null));
const provider = computed(() => props.id.startsWith('bangumi-') ? 'Bangumi' : '豆瓣');
const sourceUrl = computed(() => props.id.startsWith('bangumi-') ? `https://bgm.tv/subject/${props.id.slice(8)}` : `https://movie.douban.com/subject/${props.id.slice(7)}/`);
const categories = { tv: '电视剧', movie: '电影', anime: '动漫', variety: '综艺' };
const meta = computed(() => item.value ? [item.value.year, ...(item.value.countries || []), categories[item.value.category]].filter(Boolean).join(' · ') : '');
const facts = computed(() => detail.value ? [
  ['导演', detail.value.directors.join(' / ')], ['编剧', (detail.value.writers || []).join(' / ')], ['类型', detail.value.genres?.join(' / ')],
  ['语言', detail.value.languages.join(' / ')], ['上映', detail.value.premieres.join(' / ')],
  ['片长', detail.value.durations.join(' / ')], ['集数', detail.value.episodeCount ? `${detail.value.episodeCount} 集` : ''],
  ['别名', detail.value.aliases.join(' / ')], ['IMDb', detail.value.imdb || '']
].filter(([, value]) => value) : []);
const credits = computed(() => allCredits.value ? detail.value?.credits : detail.value?.credits.slice(0, 8));
let controller: AbortController | undefined, sequence = 0;
async function load() {
  controller?.abort(); const seq = ++sequence; controller = new AbortController();
  loading.value = true; failure.value = '';
  try { const result = await loadCatalogDetails(props.id, controller.signal); if (seq === sequence) { detail.value = result; if (!photos.value.length) photos.value = result.photos; if (!comments.value.length) comments.value = result.comments; photoTotal.value = result.photoCount; commentTotal.value = result.commentCount; } }
  catch (error) { if (seq === sequence) failure.value = error instanceof Error ? error.message : '详情暂时无法加载'; }
  finally { if (seq === sequence) loading.value = false; }
}
watch(() => props.id, () => { for (const controller of contentControllers.values()) controller.abort(); contentControllers.clear();
  photos.value = []; comments.value = []; photoNext.value = 0; commentNext.value = 0; photoLoading.value = false; commentLoading.value = false; photoError.value = ''; commentError.value = ''; photoStale.value = false; commentStale.value = false; photoExpanded.value = false; commentExpanded.value = false; photoIndex.value = -1;
  detail.value = null; expanded.value = false; allCredits.value = false; missingPortraits.value = new Set(); void load(); }, { immediate: true });
onBeforeUnmount(() => { sequence++; controller?.abort(); for (const request of contentControllers.values()) request.abort(); window.removeEventListener('popstate', photoPop); });
function search() {
  if (!item.value) return;
  // Use the durable poster identity in saved items/history, not the short-lived detail image handle.
  emit('search', { ...item.value, poster: withAppBase(`/api/discovery/posters/${props.id}`) });
}
</script>

<template>
  <article class="film-detail" aria-label="影片详情" :aria-busy="loading">
    <nav class="detail-nav"><button type="button" @click="emit('back')"><ArrowLeft aria-hidden="true" />返回</button><span>影片详情</span></nav>
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
          <div class="credit-grid" :class="{ expanded: allCredits }"><div v-for="person in credits" :key="person.name" class="credit"><img v-if="person.image && !missingPortraits.has(person.name)" :src="person.image" alt="" loading="lazy" @error="missingPortraits.add(person.name)" /><span v-else class="portrait-fallback">{{ person.name.slice(0, 1) }}</span><strong>{{ person.name }}</strong><small>{{ person.role }}</small></div></div>
        </section>
        <section v-if="detail?.provider === 'douban' && (photos.length || detail.photoCount)" class="detail-section"><div class="section-heading"><h2>剧照 <small v-if="photoTotal">{{ photoTotal }}</small></h2><button type="button" :aria-expanded="photoExpanded" @click="expandPhotos">{{ photoExpanded ? '收起' : '展开' }}</button></div>
          <div class="photo-row" :class="{ expanded: photoExpanded }"><button v-for="(photo, index) in photoExpanded ? photos : photos.slice(0, 6)" :key="photo.id" type="button" :aria-label="`查看剧照 ${index + 1}`" @click="openPhoto(index)"><img :src="photo.image" :alt="photo.description || `${item.title}剧照 ${index + 1}`" loading="lazy" /></button></div>
          <div v-if="photoExpanded" class="content-pagination"><p v-if="photoError" role="alert">{{ photoError }}</p><small v-else-if="photoStale">当前展示已缓存的剧照</small><button v-if="photoNext !== null" type="button" :disabled="photoLoading" @click="more('photos')">{{ photoLoading ? '加载中…' : photoError ? '重试加载剧照' : '加载更多剧照' }}</button></div>
        </section>
        <section v-if="facts.length" class="detail-section"><h2>影片信息</h2><dl><template v-for="[label, value] in facts" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></template></dl><p v-if="detail?.honors.length" class="honors">{{ detail.honors.join(' · ') }}</p></section>
        <section v-if="detail?.provider === 'douban' && (comments.length || detail.commentCount)" class="detail-section"><div class="section-heading"><h2>热门短评 <small v-if="commentTotal">{{ commentTotal.toLocaleString() }}</small></h2><button type="button" :aria-expanded="commentExpanded" @click="expandComments">{{ commentExpanded ? '收起' : '更多短评' }}</button></div><div v-for="comment in commentExpanded ? comments : comments.slice(0, 3)" :key="comment.id" class="short-comment"><header><strong>{{ comment.author }}</strong><span v-if="comment.rating" :aria-label="`${comment.rating} 星`">{{ '★'.repeat(comment.rating) }}</span><time>{{ comment.date }}</time></header><p>{{ comment.text }}</p><small v-if="comment.votes">{{ comment.votes.toLocaleString() }} 人觉得有用</small></div>
          <div v-if="commentExpanded" class="content-pagination"><p v-if="commentError" role="alert">{{ commentError }}</p><small v-else-if="commentStale">当前展示已缓存的短评</small><button v-if="commentNext !== null" type="button" :disabled="commentLoading" @click="more('comments')">{{ commentLoading ? '加载中…' : commentError ? '重试加载短评' : '加载更多短评' }}</button></div>
        </section>
        <footer v-if="detail" class="detail-attribution"><a :href="sourceUrl" target="_blank" rel="noopener noreferrer">资料来源 · {{ provider }}</a><span v-if="detail.partial"> · 部分资料暂未取得</span></footer>
      </div>
    </div>
    <div v-else class="detail-empty" :role="failure ? 'alert' : 'status'"><h1>{{ failure || '正在加载影片…' }}</h1><button v-if="failure" type="button" @click="load">重新加载</button></div>
    <FilmPhotoViewer :photos="photos" :index="photoIndex" :total="photoTotal" :loading="photoLoading" :has-more="photoNext !== null" :error="photoError" @close="closePhoto" @select="photoIndex = $event" @more="more('photos', true)" />
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
.photo-row button { flex:0 0 220px; }
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
  .detail-body { grid-column:1 / -1; padding-top:24px; padding-bottom:calc(90px + env(safe-area-inset-bottom)); }
  .detail-section { padding:22px 0; }
  .detail-actions { position:fixed; z-index:30; bottom:0; left:0; right:0; display:flex; padding:12px max(16px,env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); background:var(--nav-background); border-top:1px solid var(--divider); backdrop-filter:blur(20px); }
  .detail-actions .search-resources { flex:1; } .play-collection { padding:0 14px; }
  .credit-grid { gap:14px; } .photo-row button { flex-basis:200px; } .photo-row img { height:122px; }
}
.detail-nav > span { color:var(--text-tertiary); font-size:.8rem; }
.section-heading h2 small { color:var(--text-tertiary); font-size:.72rem; font-weight:400; margin-left:6px; }
.photo-row button { padding:0; border:0; background:transparent; text-align:left; }
.photo-row.expanded { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); }
.photo-row.expanded img { height:auto; aspect-ratio:1.6; }
.content-pagination { display:grid; gap:10px; justify-items:center; padding-top:14px; color:var(--text-tertiary); font-size:.8rem; }
.content-pagination button { min-height:44px; padding:0 18px; border:1px solid var(--divider); border-radius:8px; color:var(--text-secondary); }
.content-pagination button:disabled { opacity:.5; }
.short-comment > small { display:block; color:var(--text-tertiary); font-size:.7rem; margin-top:8px; }
.detail-attribution a { display:inline-flex; margin:0; }
</style>
