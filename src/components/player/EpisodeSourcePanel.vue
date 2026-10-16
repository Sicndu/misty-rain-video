<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { AudioLines, Grid2X2, List, ListVideo, RefreshCw, Search } from '@lucide/vue';
import ResourceThumbnail from '../quark/ResourceThumbnail.vue';
import type { QuarkEpisode } from '../../services/quarkStreamService';
import type { ResourceItem } from '../../types/search';
const props = defineProps<{ episodes: QuarkEpisode[]; currentIndex: number; movie: boolean; active: boolean; candidates: ResourceItem[]; searching: boolean; switching: boolean; sourceError: string }>();
const emit = defineEmits<{ (e:'episode',index:number):void; (e:'source',item:ResourceItem):void; (e:'retry'):void; (e:'search'):void }>();
type EpisodeView = 'thumbnails' | 'compact' | 'numbers';
const views = [{ value: 'thumbnails', label: '缩略图列表', icon: ListVideo }, { value: 'compact', label: '紧凑列表', icon: List }, { value: 'numbers', label: '数字格', icon: Grid2X2 }] as const;
const view = ref<EpisodeView>('thumbnails');
const order = ref('asc');
try {
  order.value = localStorage.getItem('misty_rain_episode_order') === 'desc' ? 'desc' : 'asc';
  const stored = localStorage.getItem('misty_rain_episode_view');
  if (views.some(item => item.value === stored)) view.value = stored as EpisodeView;
} catch { /* Defaults remain usable in private browsing. */ }
const limit = ref(60);
const collator = new Intl.Collator('zh-CN',{numeric:true});
const entries = computed(() => props.episodes.map((episode,index)=>({episode,index})).sort((a,b)=> (order.value==='desc'?-1:1) * ((a.episode.seasonNumber || 1)-(b.episode.seasonNumber || 1) || a.episode.episodeNumber-b.episode.episodeNumber || collator.compare(a.episode.fileName,b.episode.fileName))));
const revealCurrent = () => { limit.value=Math.max(60,Math.ceil((entries.value.findIndex(item=>item.index===props.currentIndex)+1)/60)*60); };
watch(order, value => { try { localStorage.setItem('misty_rain_episode_order',value); } catch {} revealCurrent(); });
watch(view, value => { try { localStorage.setItem('misty_rain_episode_view',value); } catch {} });
watch([()=>props.active,()=>props.currentIndex], () => { if(props.active) revealCurrent(); }, { immediate:true });
const label = (episode: QuarkEpisode) => episode.fileName || episode.episodeTitle;
const meta = (episode: QuarkEpisode) => [episode.sizeFormatted,episode.durationFormatted].filter(Boolean).join(' · ');
const number = (episode: QuarkEpisode,index:number) => episode.episodeNumber > 0 ? episode.episodeNumber : index+1;
</script>
<template>
 <section class="episode-source-panel" aria-label="片源与选集">
  <div class="source-strip"><strong>片源</strong><div class="source-choices" aria-label="可用片源"><button type="button" class="source-chip active" aria-pressed="true">源1</button><button v-for="(item,index) in candidates" :key="item.url" type="button" class="source-chip" :aria-label="`切换片源：${item.title}`" :title="item.title" :disabled="switching" @click="emit('source',item)">源{{ index+2 }}</button></div><button type="button" class="icon-button" aria-label="刷新备选片源" title="刷新片源" :disabled="searching || switching" @click="emit('retry')"><RefreshCw :class="{spin:searching}" /></button><button type="button" class="icon-button" aria-label="搜索其他资源" title="搜索其他资源" :disabled="switching" @click="emit('search')"><Search /></button></div>
  <p v-if="sourceError" class="source-status" role="status">{{ sourceError }}</p><p v-else-if="switching" class="source-status" role="status">正在确认当前集…</p><p v-else-if="searching && !candidates.length" class="source-status" role="status">正在查找备选片源…</p>
  <div class="section-heading"><strong>{{ movie ? '视频' : '选集' }}<small>{{ episodes.length }}</small></strong><div class="view-switch" role="group" aria-label="选集视图"><button v-for="item in views" :key="item.value" type="button" :aria-label="item.label" :title="item.label" :aria-pressed="view===item.value" @click="view=item.value"><component :is="item.icon" /></button></div><select v-model="order" aria-label="选集排序"><option value="asc">正序</option><option value="desc">倒序</option></select></div>
  <div class="episodes" :class="`view-${view}`" role="listbox" :aria-label="movie ? '视频列表' : '剧集列表'"><button v-for="entry in entries.slice(0,limit)" :key="entry.episode.fid" type="button" class="episode-row" role="option" :aria-selected="currentIndex===entry.index" :aria-label="`${label(entry.episode)}${currentIndex===entry.index ? '，正在播放' : ''}`" :disabled="switching" :title="label(entry.episode)" @click="emit('episode',entry.index)"><ResourceThumbnail v-if="view==='thumbnails'" :src="entry.episode.thumbnail" video /><span v-if="view==='numbers'" class="episode-number">{{ number(entry.episode,entry.index) }}</span><span v-else class="episode-copy"><strong>{{ label(entry.episode) }}</strong><small v-if="view==='thumbnails'">{{ meta(entry.episode) }}</small><small v-else class="compact-meta">{{ entry.episode.durationFormatted || entry.episode.sizeFormatted }}</small></span><AudioLines v-if="currentIndex===entry.index && view!=='numbers'" class="playing-icon" aria-hidden="true" /></button></div>
  <button v-if="limit < entries.length" type="button" class="more" @click="limit+=60">显示更多</button>
 </section>
</template>
<style scoped>
.episode-source-panel { min-width:0; }
button,select { min-height:40px; border:0; color:var(--text-primary); background:transparent; font:inherit; font-size:13px; cursor:pointer; }
button:disabled { opacity:.5; cursor:default; }
button:focus-visible,select:focus-visible { outline:2px solid var(--liquid-accent); outline-offset:-2px; }
svg { width:18px; height:18px; flex-shrink:0; }
.source-strip { display:flex; align-items:center; gap:10px; padding:12px 0; border-bottom:1px solid var(--divider); }
.source-strip>strong { font-size:15px; flex-shrink:0; }
.source-choices { display:flex; align-items:center; gap:6px; min-width:0; flex:1; overflow-x:auto; scrollbar-width:thin; }
.source-chip { flex:0 0 auto; min-width:60px; padding:0 14px; border-radius:7px; background:var(--surface-2); color:var(--text-secondary); }
.source-chip.active { background:var(--liquid-accent); color:var(--accent-ink); }
.icon-button { display:grid; place-items:center; flex:0 0 32px; width:32px; padding:0; color:var(--text-secondary); }
.source-status { margin:8px 0 0; color:var(--text-tertiary); font-size:12px; line-height:1.5; }
.section-heading { display:flex; align-items:center; gap:10px; min-height:60px; }
.section-heading>strong { display:flex; align-items:baseline; gap:7px; margin-right:auto; font-size:16px; }
.section-heading small { color:var(--text-tertiary); font-weight:400; font-size:12px; }
.section-heading select { width:60px; padding:0 3px; font-size:13px; color-scheme:inherit; }
.view-switch { display:flex; gap:1px; }
.view-switch button { display:grid; place-items:center; width:34px; min-height:34px; border-radius:6px; color:var(--text-tertiary); padding:0; }
.view-switch button[aria-pressed=true] { color:var(--liquid-accent); background:var(--liquid-accent-subtle); }
.episodes { display:grid; gap:0; }
.episode-row { display:flex; align-items:center; gap:12px; min-width:0; min-height:72px; padding:10px 8px; border-bottom:1px solid var(--divider); border-radius:6px; text-align:left; }
.episode-row[aria-selected=true] { color:var(--liquid-accent); background:var(--liquid-accent-subtle); border-bottom-color:transparent; }
.episode-row:hover { background:var(--surface-2); }
.episode-row[aria-selected=true]:hover { background:var(--liquid-accent-subtle); }
.episode-row :deep(.resource-thumbnail) { width:72px; height:44px; flex-basis:72px; border-radius:5px; }
.episode-copy { display:flex; flex:1; flex-direction:column; gap:5px; min-width:0; }
.episode-copy strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:inherit; font-size:14px; font-weight:500; }
.episode-copy small { color:var(--text-tertiary); font-size:12px; font-variant-numeric:tabular-nums; }
.playing-icon { color:var(--liquid-accent); width:19px; }
.view-compact .episode-row { min-height:46px; padding:9px 8px; }
.view-compact .episode-copy { flex-direction:row; align-items:center; gap:12px; }
.view-compact .episode-copy strong { flex:1; }
.view-compact .compact-meta { flex-shrink:0; }
.view-numbers { grid-template-columns:repeat(auto-fill,minmax(48px,1fr)); gap:8px; }
.view-numbers .episode-row { display:grid; place-items:center; min-height:44px; padding:8px; border:1px solid var(--divider); text-align:center; }
.view-numbers .episode-row[aria-selected=true] { color:var(--accent-ink); background:var(--liquid-accent); border-color:var(--liquid-accent); }
.episode-number { font-size:14px; font-variant-numeric:tabular-nums; }
.more { width:100%; margin-top:10px; color:var(--liquid-accent); }
.spin { animation:spin 1s linear infinite; }@keyframes spin { to { transform:rotate(360deg); } }
@media(max-width:480px) { .source-strip { gap:7px; } .source-chip { min-width:52px; padding:0 10px; } .section-heading { gap:6px; } .section-heading select { font-size:16px; width:64px; } }
</style>
