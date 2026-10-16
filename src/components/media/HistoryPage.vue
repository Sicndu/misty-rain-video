<script setup lang="ts">
import { computed, ref } from 'vue';
import { History, Trash2 } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import type { PlaybackHistoryEntry } from '../../types/media';
const props = defineProps<{ history: PlaybackHistoryEntry[]; historyError?: string; loadingHistory?: boolean; deletingHistoryId?: string }>();
const emit = defineEmits<{ (e: 'play', entry: PlaybackHistoryEntry): void; (e: 'delete', id: string): void; (e: 'retry'): void; (e: 'discover'): void }>();
const visibleCount = ref(20);
const entries = computed(() => props.history.slice(0,visibleCount.value));
const progress = (entry: PlaybackHistoryEntry) => entry.duration > 0 ? Math.max(0,Math.min(100,entry.position / entry.duration * 100)) : 0;
const meta = (entry: PlaybackHistoryEntry) => [entry.media.category === 'movie' ? '电影' : entry.episodeTitle || (entry.episodeNumber ? `第 ${entry.episodeNumber} 集` : ''), entry.completed ? '已看完' : `看到 ${Math.max(1,Math.floor(entry.position / 60))} 分钟`].filter(Boolean).join(' · ');
</script>
<template>
  <section class="history-page" aria-label="观看记录">
    <header><h1>观看记录</h1><span v-if="history.length">{{ history.length }} 部</span></header>
    <div v-if="historyError" class="inline-feedback" role="alert"><p>{{ historyError }}</p><button type="button" :disabled="loadingHistory" @click="emit('retry')">重试</button></div>
    <p v-else-if="loadingHistory && !history.length" class="history-empty" role="status">正在读取…</p>
    <div v-if="entries.length" class="history-list"><article v-for="entry in entries" :key="entry.id" class="history-row"><button type="button" class="history-main" @click="emit('play',entry)"><MediaPoster :src="entry.media.poster" :alt="`${entry.media.title}封面`" loading="lazy" decoding="async" /><span class="history-copy"><strong>{{ entry.media.title }}</strong><small>{{ meta(entry) }}</small><span v-if="entry.duration > 0" class="history-progress" aria-hidden="true"><i :style="{ width: `${progress(entry)}%` }"></i></span></span><span class="history-play">{{ entry.completed ? '再看' : '继续' }}</span></button><button type="button" class="history-delete" :disabled="!!deletingHistoryId" :aria-label="`删除${entry.media.title}的播放记录`" @click="emit('delete',entry.id)"><Trash2 aria-hidden="true" /></button></article></div>
    <button v-if="history.length > entries.length" type="button" class="load-more" @click="visibleCount += 20">显示更多</button>
    <div v-else-if="!history.length && !loadingHistory && !historyError" class="history-empty"><History aria-hidden="true" /><p>还没有观看记录</p><button type="button" @click="emit('discover')">去发现找一部</button></div>
  </section>
</template>
<style scoped>
header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 24px; }
h1 { font-size: 1.8rem; font-weight: 650; }
header > span { color: var(--text-tertiary); font-size: .8rem; }
.history-list { max-width: 960px; }
.history-row { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--divider); }
.history-main { display: flex; align-items: center; min-width: 0; flex: 1; gap: 14px; padding: 14px 0; border: 0; color: var(--text-primary); background: transparent; text-align: left; }
.history-main :deep(img),.history-main :deep(.poster-placeholder) { width: 50px; height: 68px; flex-shrink: 0; border-radius: 7px; object-fit: cover; }
.history-copy { display: grid; min-width: 0; flex: 1; gap: 5px; }
.history-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9rem; font-weight: 550; }
.history-copy small { color: var(--text-tertiary); font-size: .73rem; }
.history-progress { display: block; width: min(200px,100%); height: 3px; margin-top: 3px; background: var(--divider); border-radius: 4px; overflow: hidden; }
.history-progress i { display: block; height: 100%; background: var(--liquid-accent); }
.history-play { padding: 6px 10px; border-radius: 7px; color: var(--liquid-accent); background: var(--liquid-accent-subtle); font-size: .76rem; }
.history-delete { display: grid; width: 44px; height: 44px; flex-shrink: 0; place-items: center; border: 0; border-radius: 8px; color: var(--text-tertiary); background: transparent; }
.history-delete svg { width: 18px; height: 18px; }
.history-delete:hover { color: var(--danger); background: var(--danger-surface); }
.history-empty { display: grid; justify-items: center; gap: 16px; padding: 64px 16px; color: var(--text-tertiary); font-size: .86rem; }
.history-empty > svg { width: 32px; height: 32px; }
.history-empty button,.load-more { min-height: 44px; padding: 0 16px; border: 0; border-radius: 8px; color: var(--liquid-accent); background: var(--liquid-accent-subtle); }
.load-more { margin-top: 24px; }
@media(max-width:640px) { h1 { font-size: 1.5rem; } .history-main { gap: 11px; } }
</style>
