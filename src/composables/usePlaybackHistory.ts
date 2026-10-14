import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue';
import { sameMediaIdentity } from '../services/historyIdentity';
import type { MediaItem, PlaybackHistoryEntry } from '../types/media';
import { PlaybackHistoryService } from '../services/playbackHistoryService';
import { useToast } from './useToast';

export const usePlaybackHistory = (enabled: Ref<boolean>) => {
  const history = ref<PlaybackHistoryEntry[]>([]);
  const loadingHistory = ref(false);
  const historyError = ref('');
  const deletingHistoryId = ref('');
  const toast = useToast();
  let mounted = false;
  let historyRevision = 0;
  let removedMedia: Array<Pick<MediaItem, 'id' | 'quarkFid'>> = [];

  const refreshHistory = async (silent = false) => {
    if (!enabled.value) return;
    const revision = ++historyRevision;
    if (!silent) loadingHistory.value = true;
    try {
      const entries = await PlaybackHistoryService.list();
      if (revision !== historyRevision || !enabled.value) return;
      history.value = entries.filter(entry => !removedMedia.some(media => sameMediaIdentity(entry.media, media)));
      historyError.value = '';
    } catch (error) {
      if (revision !== historyRevision) return;
      historyError.value = '观看记录加载失败，请检查网络后重试。';
      console.warn('[playback-history] 读取失败:', error);
    } finally {
      if (revision === historyRevision) loadingHistory.value = false;
    }
  };

  const continueWatching = computed(() => history.value
    .filter(entry => !entry.completed && entry.position >= 5 && entry.duration > 0)
    .slice(0, 8));

  const updateLocalHistory = (entry: PlaybackHistoryEntry) => {
    if (!enabled.value || removedMedia.some(media => sameMediaIdentity(entry.media, media))) return;
    history.value = [entry, ...history.value.filter(item => item.id !== entry.id)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  };

  const removeLocalMediaHistory = (media: MediaItem) => {
    historyRevision += 1;
    removedMedia.push({ id: media.id, quarkFid: media.quarkFid });
    history.value = history.value.filter(entry => !sameMediaIdentity(entry.media, media));
    loadingHistory.value = false;
  };

  const removeHistory = async (id: string) => {
    if (deletingHistoryId.value) return;
    deletingHistoryId.value = id;
    try {
      history.value = await PlaybackHistoryService.remove(id);
      toast.show('观看记录已删除', '✓');
    } catch {
      toast.show('观看记录删除失败，请稍后重试', '!');
    } finally {
      deletingHistoryId.value = '';
    }
  };

  const sync = () => {
    if (!enabled.value) {
      historyRevision += 1;
      removedMedia = [];
      history.value = [];
      historyError.value = '';
      return;
    }
    refreshHistory();
  };

  const onFocus = () => enabled.value && refreshHistory(true);

  onMounted(() => {
    mounted = true;
    sync();
    window.addEventListener('focus', onFocus);
  });

  watch(enabled, () => mounted && sync());

  onUnmounted(() => {
    mounted = false;
    window.removeEventListener('focus', onFocus);
  });

  return { history, continueWatching, historyError, deletingHistoryId, loadingHistory, refreshHistory, updateLocalHistory, removeHistory, removeLocalMediaHistory };
};
