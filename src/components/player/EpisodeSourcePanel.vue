<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Bookmark, RefreshCw } from '@lucide/vue';
import type { QuarkEpisode } from '../../services/quarkStreamService';
import type { ResourceItem } from '../../types/search';
const props = defineProps<{ episodes: QuarkEpisode[]; currentIndex: number; movie: boolean; active: boolean; candidates: ResourceItem[]; searching: boolean; switching: boolean; sourceError: string; collecting: boolean; collectedCurrent: boolean; collectedAll: boolean; collectError: string }>();
const emit = defineEmits<{ (e:'episode',index:number):void; (e:'source',item:ResourceItem):void; (e:'retry'):void; (e:'search'):void; (e:'collect',all:boolean):void }>();
const order = ref('asc');
try { order.value = localStorage.getItem('misty_rain_episode_order') === 'desc' ? 'desc' : 'asc'; } catch {}
const limit = ref(60);
const collator = new Intl.Collator('zh-CN',{numeric:true});
const entries = computed(() => props.episodes.map((episode,index)=>({episode,index})).sort((a,b)=> (order.value==='desc'?-1:1) * ((a.episode.seasonNumber || 1)-(b.episode.seasonNumber || 1) || a.episode.episodeNumber-b.episode.episodeNumber || collator.compare(a.episode.fileName,b.episode.fileName))));
watch(order, value => { try { localStorage.setItem('misty_rain_episode_order',value); } catch {} limit.value=60; });
watch(()=>props.active, active=> { if(active) limit.value=Math.max(60,Math.ceil((entries.value.findIndex(item=>item.index===props.currentIndex)+1)/60)*60); });
</script>
<template>
 <div class="episode-source-panel">
  <div class="episode-actions"><button type="button" :disabled="collecting || collectedCurrent" @click="emit('collect',false)"><Bookmark />{{ collectedCurrent ? '本集已收藏' : collecting ? '收藏中…' : movie ? '收藏当前视频' : '收藏本集' }}</button><button type="button" :disabled="collecting || collectedAll" @click="emit('collect',true)">{{ collectedAll ? '已全部收藏' : '收藏整部' }}</button></div>
  <p v-if="collectError" role="alert">{{ collectError }}</p>
  <div class="section-heading"><strong>{{ movie ? '视频' : '选集' }} · {{ episodes.length }}</strong><select v-model="order" aria-label="选集排序"><option value="asc">正序</option><option value="desc">倒序</option></select></div>
  <div class="episodes" :class="{ files: movie }" role="listbox" :aria-label="movie ? '视频列表' : '剧集列表'"><button v-for="entry in entries.slice(0,limit)" :key="entry.episode.fid" type="button" role="option" :aria-selected="currentIndex===entry.index" :disabled="switching" :title="entry.episode.fileName" @click="emit('episode',entry.index)">{{ movie || !entry.episode.episodeNumber ? entry.episode.fileName : entry.episode.episodeTitle }}</button></div>
  <button v-if="limit < entries.length" type="button" class="more" @click="limit+=60">显示更多</button>
  <div class="section-heading"><strong>片源</strong><button type="button" aria-label="刷新备选片源" :disabled="searching || switching" @click="emit('retry')"><RefreshCw :class="{spin:searching}" /></button></div>
  <p class="source-current">当前片源 · {{ episodes.length }} {{ movie ? '个视频' : '集' }}</p>
  <button v-for="(item,index) in candidates" :key="item.url" type="button" class="source-option" :disabled="switching" @click="emit('source',item)"><span>源 {{ index+2 }}</span><strong>{{ item.title }}</strong></button>
  <p v-if="sourceError" role="status">{{ sourceError }}</p><p v-else-if="searching" role="status">正在查找备选片源…</p><p v-else-if="!candidates.length">暂无备选片源</p>
  <button type="button" class="more" :disabled="switching" @click="emit('search')">搜索其他资源</button>
 </div>
</template>
<style scoped>
.episode-source-panel { padding: 0 14px 14px; }
button,select { min-height:44px; border:0; color:var(--text-primary); background:transparent; font:inherit; font-size:13px; }
button:disabled { opacity:.5; }
.episode-actions { display:flex; gap:8px; padding:12px 0; border-bottom:1px solid var(--divider); }
.episode-actions button { display:flex; align-items:center; justify-content:center; gap:6px; flex:1; border-radius:8px; background:var(--surface-2); }
svg { width:17px; height:17px; }
.section-heading { display:flex; align-items:center; justify-content:space-between; min-height:48px; font-size:13px; }
.section-heading button { width:44px; }.section-heading select { color-scheme:dark; }
.episodes { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; }
.episodes button { padding:8px; border:1px solid var(--divider); border-radius:6px; font-size:12px; overflow-wrap:anywhere; }
.episodes button[aria-selected=true] { background:var(--liquid-accent); color:var(--accent-ink); border-color:var(--liquid-accent); }
.episodes.files { grid-template-columns:1fr; }.files button { text-align:left; }
p { color:var(--text-tertiary); font-size:12px; line-height:1.5; margin:6px 0; }
.source-option { display:flex; gap:10px; align-items:center; width:100%; text-align:left; border-bottom:1px solid var(--divider); }
.source-option span { flex:0 0 32px; color:var(--text-tertiary); font-size:12px; }.source-option strong { overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; font-size:12px; font-weight:400; }
.more { width:100%; color:var(--liquid-accent); }.spin { animation:spin 1s linear infinite; }@keyframes spin { to { transform:rotate(360deg); } }
</style>
