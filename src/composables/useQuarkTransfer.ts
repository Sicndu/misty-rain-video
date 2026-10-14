import { ref } from 'vue';
import type { MediaItem } from '../types/media';
import type { ResourceItem } from '../types/search';
import { SilentSearchEngine } from '../services/silentSearchEngine';
import { useToast } from './useToast';

const engine = new SilentSearchEngine();

export function useQuarkTransfer() {
  const toast = useToast();

  const isOpen = ref(false);
  const isAnalyzing = ref(false);
  const currentMedia = ref<MediaItem | null>(null);
  const quarkResources = ref<ResourceItem[]>([]);
  const searchError = ref('');
  const searchNotice = ref('');
  const searchPending = ref(false);
  const searchKeyword = ref('');
  let searchSequence = 0;

  const followSearch = async (keyword: string, sequence: number) => {
    const deadline = Date.now() + 35_000;
    for (let attempt = 0; attempt < 35 && Date.now() < deadline; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1_000));
      if (sequence !== searchSequence || !isOpen.value) return;
      try {
        const result = await engine.readCached(keyword);
        if (sequence !== searchSequence || !isOpen.value) return;
        if (!result) break;
        quarkResources.value = result.quarkItems;
        searchNotice.value = result.message || '';
        searchPending.value = Boolean(result.refreshing);
        if (!result.refreshing) return;
      } catch { break; }
    }
    if (sequence === searchSequence && isOpen.value) {
      searchPending.value = false;
      searchNotice.value = quarkResources.value.length
        ? '已展示当前候选；其余来源暂未返回，可稍后重新搜索'
        : '本轮未取得可用候选，来源可能超时；可稍后重新搜索';
    }
  };

  /**
   * 在当前资源面板内执行检索。关键词与媒体标题分离，允许用户使用别名
   * 重搜，同时仍把最终资源保存到原来的媒体卡片。
   */
  const searchResources = async (keyword: string, force = false) => {
    const normalizedKeyword = keyword.trim();
    if (!currentMedia.value || !normalizedKeyword) return;
    const sequence = ++searchSequence;
    searchKeyword.value = normalizedKeyword;
    isOpen.value = true;
    isAnalyzing.value = true;
    searchError.value = '';
    searchNotice.value = '';
    searchPending.value = false;
    quarkResources.value = [];

    try {
      const res = await engine.search(normalizedKeyword, { force });
      if (sequence !== searchSequence || !isOpen.value) return;
      if (!res.success) {
        searchError.value = res.message || '资源检索服务暂时不可用，请稍后重试';
        toast.show(searchError.value, '!', 3800);
        return;
      }
      quarkResources.value = res.quarkItems && res.quarkItems.length > 0
        ? res.quarkItems
        : res.items.filter(i => i.driveType === 'quark');
      searchNotice.value = res.message || '';
      searchPending.value = Boolean(res.refreshing);
      if (res.refreshing) void followSearch(normalizedKeyword, sequence);
    } catch (error) {
      if (sequence !== searchSequence || !isOpen.value) return;
      searchError.value = error instanceof Error ? error.message : '资源检索失败，请稍后重试';
      toast.show(searchError.value, '!', 3800);
    } finally {
      if (sequence === searchSequence) isAnalyzing.value = false;
    }
  };

  /**
   * 打开网盘分析与转存面板
   */
  const openTransferModal = async (media: MediaItem) => {
    currentMedia.value = media;
    await searchResources(media.title);
  };

  const closeTransferModal = () => {
    searchSequence += 1;
    isOpen.value = false;
    isAnalyzing.value = false;
    searchError.value = '';
    searchNotice.value = '';
    searchPending.value = false;
    searchKeyword.value = '';
  };

  const retrySearch = () => {
    if (currentMedia.value && !isAnalyzing.value) {
      void searchResources(searchKeyword.value || currentMedia.value.title, true);
    }
  };

  const refreshResources = (keyword: string) => searchResources(keyword, true);

  return {
    isOpen,
    isAnalyzing,
    currentMedia,
    quarkResources,
    searchError,
    searchNotice,
    searchPending,
    searchKeyword,
    openTransferModal,
    refreshResources,
    closeTransferModal,
    retrySearch
  };
}
