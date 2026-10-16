<script setup lang="ts">
import { computed } from 'vue';
import { getLibraryUpdateFeedback } from '../../services/libraryUpdateFeedback';
import { ChevronDown, Ellipsis, Play, X } from '@lucide/vue';
import MediaPoster from '../common/MediaPoster.vue';
import type { MediaItem } from '../../types/media';

const props = defineProps<{ media: MediaItem }>();
const updateFeedback = computed(() => getLibraryUpdateFeedback(props.media));
const qualityLabel = computed(() => {
  const value = `${props.media.tag || ''} ${props.media.quarkQuality || ''}`;
  return value.match(/(?:4K|8K|2160P|1080P|720P|HDR|杜比)/i)?.[0].toUpperCase() || '';
});

const emit = defineEmits<{
  (e: 'click-card', media: MediaItem): void;
  (e: 'delete-card', media: MediaItem): void;
  (e: 're-search', media: MediaItem): void;
  (e: 'edit-category', media: MediaItem): void;
  (e: 'open-actions', media: MediaItem): void;
}>();

const categoryLabels: Record<MediaItem['category'], string> = {
  tv: '电视剧',
  movie: '电影',
  variety: '综艺',
  anime: '动漫'
};
</script>

<template>
  <article class="media-card">
    <button
      type="button"
      class="card-play-target"
      :aria-label="`播放《${media.title}》${media.category !== 'movie' && media.latestEpisodeNumber ? `，更新至第 ${media.latestEpisodeNumber} 集` : ''}${updateFeedback ? `，${updateFeedback.label}` : ''}`"
      @click="emit('click-card', media)"
    >
      <span class="poster-viewport">
<MediaPoster :src="media.poster" alt="" class="poster-image" loading="lazy" decoding="async" />
        <span v-if="qualityLabel" class="quality-tag">{{ qualityLabel }}</span>

        <span class="hover-play" aria-hidden="true">
          <span class="play-disk"><Play fill="currentColor" /></span>
        </span>

      </span>

      <span class="card-caption">
        <span class="media-title" :title="media.title">{{ media.title }}</span>
        <span class="media-subtitle" :title="updateFeedback?.detail" :class="{ 'has-update': (media.newEpisodeCount || 0) > 0 }">
          <template v-if="(media.newEpisodeCount || 0) > 0">新增 {{ media.newEpisodeCount }} {{ media.category === 'movie' ? '个视频' : '集' }}</template>
          <template v-else-if="updateFeedback">{{ updateFeedback.label }}</template>
          <template v-else-if="media.category !== 'movie' && media.latestEpisodeNumber">更新至 {{ media.latestEpisodeNumber }} 集</template>
          <template v-else>{{ media.status || categoryLabels[media.category] }}</template>
        </span>
      </span>
    </button>

    <button
      type="button"
      class="more-trigger"
      :aria-label="`打开《${media.title}》的更多操作`"
      @click="emit('open-actions', media)"
    >
      <Ellipsis aria-hidden="true" />
    </button>

    <button
      type="button"
      class="category-trigger"
      :aria-label="`修改《${media.title}》的分类`"
      title="修改分类"
      @click="emit('edit-category', media)"
    >
      <span>{{ categoryLabels[media.category] }}</span>
      <ChevronDown aria-hidden="true" />
    </button>

    <div class="hover-actions">
      <button type="button" class="card-action" title="更换资源" @click="emit('re-search', media)">换源</button>
      <button
        type="button"
        class="card-action danger"
        title="删除影片"
        :aria-label="`删除《${media.title}》`"
        @click="emit('delete-card', media)"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  </article>
</template>

<style scoped>
.media-card { position: relative; min-width: 0; }
.card-play-target { display: flex; width: 100%; min-width: 0; flex-direction: column; gap: 10px; padding: 0; border: 0; color: var(--text-primary); background: transparent; text-align: left; border-radius: 14px; transition: transform .15s var(--spring-ease); }
.card-play-target:active { transform: scale(.97); }
.poster-viewport { position: relative; display: block; width: 100%; aspect-ratio: 2 / 3; overflow: hidden; border-radius: 14px; background: var(--surface-2); box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, .12), 0 4px 14px rgba(0, 0, 0, .22); }
.poster-image { width: 100%; height: 100%; object-fit: cover; transition: transform .3s; }
.quality-tag { position: absolute; top: 8px; left: 8px; max-width: calc(100% - 16px); overflow: hidden; padding: 2px 6px; border-radius: 6px; color: #fff; background: rgb(0 0 0 / .68); font-size: .62rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.card-caption { display: grid; min-width: 0; width: 100%; gap: 3px; padding: 0 28px 0 2px; }
.media-title { display: block; overflow: hidden; color: var(--text-primary); font-size: .92rem; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -.01em; line-height: 1.35; }
.media-subtitle { overflow: hidden; color: var(--text-tertiary); font-size: .74rem; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
.media-subtitle.has-update { color: var(--text-primary); }
.more-trigger { position: absolute; bottom: -3px; right: -8px; display: grid; width: 44px; height: 44px; place-items: center; padding: 0; border: 0; border-radius: 50%; color: var(--text-tertiary); background: transparent; transition: color .15s, background .15s; }
.more-trigger::before { display: none; }
.more-trigger:hover, .more-trigger:active { color: var(--text-primary); background: var(--glass-bg); }
.more-trigger svg { position: relative; width: 19px; height: 19px; }
.category-trigger, .hover-actions { display: none; }
.hover-play { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; transition: opacity .2s; }
.play-disk { display: grid; width: 52px; height: 52px; place-items: center; border: 1px solid var(--divider); border-radius: 50%; color: #fff; background: var(--glass-bg); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.play-disk svg { width: 22px; height: 22px; margin-left: 2px; }
@media (hover: hover) { .card-play-target:hover .poster-image { transform: scale(1.035); } .card-play-target:hover .hover-play { opacity: 1; } }
.card-play-target:focus-visible .hover-play { opacity: 1; }
@media (max-width: 640px) { .media-title { font-size: .88rem; } .poster-viewport { border-radius: 14px; } .card-play-target { gap: 8px; } }
</style>
