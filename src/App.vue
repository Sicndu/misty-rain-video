<script setup lang="ts">
import { shallowRef, computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Plus, RefreshCw } from '@lucide/vue';
import LoginScreen from './components/auth/LoginScreen.vue';
import AccountPage from './components/auth/AccountPage.vue';
import { QuarkStreamService, type QuarkPlaybackSession, type QuarkEpisode } from './services/quarkStreamService';
import { replacementEpisodeIndex } from './services/playbackNavigation';
import HistoryPage from './components/media/HistoryPage.vue';
import Navbar from './components/layout/Navbar.vue';
import DesktopSidebar from './components/layout/DesktopSidebar.vue';
import MobileTabBar, { type MobileTab as MobileDockTab } from './components/layout/MobileTabBar.vue';
import CategoryTabs from './components/media/CategoryTabs.vue';
import MediaGrid from './components/media/MediaGrid.vue';
import DiscoveryPage from './components/media/DiscoveryPage.vue';
import CatalogSearchPage from './components/media/CatalogSearchPage.vue';
import { savePlaybackPage, loadPlaybackPage, clearPlaybackPages } from './services/playbackNavigation';
import { discoveryMedia, resourcePlaybackMedia, type DiscoveryItem } from './services/discoveryService';
import DeleteMediaConfirm from './components/media/DeleteMediaConfirm.vue';
import CategoryPickerSheet from './components/media/CategoryPickerSheet.vue';
import MediaActionSheet from './components/media/MediaActionSheet.vue';
import MediaTitleEditor from './components/media/MediaTitleEditor.vue';
import Toast from './components/common/Toast.vue';
import { useMediaList } from './composables/useMediaList';
import { useQuarkTransfer } from './composables/useQuarkTransfer';
import { useAuth } from './composables/useAuth';
import { useToast } from './composables/useToast';
import { usePlaybackHistory } from './composables/usePlaybackHistory';
import { MediaStore } from './services/mediaStore';
import { sameMediaIdentity } from './services/historyIdentity';
import { getLibrarySaveFeedback, type LibrarySaveFeedback } from './services/libraryFeedback';
import type { MediaItem, CategoryType, PlaybackHistoryEntry } from './types/media';
import type { ResourceItem } from './types/search';

// HLS 播放器和资源检索面板只会在用户主动打开时使用；按需加载可显著
// 缩小移动端首屏 JS，避免登录后先下载整个播放器运行时。
const QuarkTransferModal = defineAsyncComponent({
  loader: () => import('./components/quark/QuarkTransferModal.vue'),
  delay: 0,
  suspensible: false
});
const PlayerPage = defineAsyncComponent({
  loader: () => import('./components/player/PlayerPage.vue'),
  delay: 0,
  suspensible: false
});

const { user, authenticated, checking, loggingIn, errorMessage, login, logout } = useAuth();
const toast = useToast();
const { history, historyError, loadingHistory, deletingHistoryId, refreshHistory, updateLocalHistory, removeHistory, removeLocalMediaHistory } = usePlaybackHistory(authenticated);
const isEmbedPlayerOpen = ref(false);
const restoringPlayer = ref(false);

const {
  currentCategory,
  mediaList,
  enrichedMediaList,
  allMediaList,
  isLoading,
  loadError,
  categoryCounts,
  categoryNames,
  saveMedia,
  removeMedia,
  updateMediaCategory,
  updateMediaTitle,
  refreshList,
  setLibraryUpdates
} = useMediaList(authenticated, isEmbedPlayerOpen);

const {
  isOpen: isTransferOpen,
  isAnalyzing,
  currentMedia: selectedMedia,
  quarkResources,
  searchError,
  searchNotice,
  searchPending,
  searchKeyword,
  openTransferModal,
  closeTransferModal,
  retrySearch,
  refreshResources,
  rejectResource
} = useQuarkTransfer();

const navbarRef = ref<InstanceType<typeof Navbar> | null>(null);
const embedPlayingMedia = ref<MediaItem | null>(null);
const accountPageRef = ref<InstanceType<typeof AccountPage> | null>(null);
const deletingMedia = ref<MediaItem | null>(null);
const isDeletingMedia = ref(false);
const categoryMedia = ref<MediaItem | null>(null);
const isSavingCategory = ref(false);
const isSavingTransfer = ref(false);
const savingResourceId = ref('');
const saveError = ref<LibrarySaveFeedback | null>(null);
const failedResourceId = ref('');
const actionMedia = ref<MediaItem | null>(null);
const titleMedia = ref<MediaItem | null>(null);
const isSavingTitle = ref(false);
const titleError = ref('');
const displayHistory = computed(() => history.value.map(entry => {
  const media = allMediaList.value.find(item => sameMediaIdentity(item, entry.media));
  return media ? { ...entry, media: { ...entry.media, ...media } } : entry;
}));
type MobileTab = MobileDockTab | 'search' | 'catalog';
const catalogQuery = ref('');
const playbackPageKey = ref('');
const preparedPageSession = shallowRef<{ key: string; session: QuarkPlaybackSession } | null>(null);
const mobileTab = ref<MobileTab>('discover');
const lastContentTab = ref<'discover' | 'library' | 'history' | 'catalog'>('discover');
const currentPage = computed(() => mobileTab.value === 'search' ? lastContentTab.value : mobileTab.value);
const selectedHistoryEntry = ref<PlaybackHistoryEntry | null>(null);
const isCheckingUpdates = ref(false);
const isApplyingUpdates = ref(false);
let autoCheckedUsername = '';
type AppHistoryLayer = 'catalog' | 'history' | 'discover' | 'library' | 'search' | 'account' | 'player' | 'transfer' | 'delete' | 'category' | 'actions' | 'title';
let handlingPopState = false;

const historyEnabled = () => typeof window !== 'undefined';
const currentHistoryLayer = () => window.history.state?.mistyRainLayer as AppHistoryLayer | undefined;

const setAppHistoryLayer = (layer: AppHistoryLayer, replace = false) => {
  if (!historyEnabled() || handlingPopState) return;
  const state = { mistyRainLayer: layer, query: catalogQuery.value, category: currentCategory.value,
    playbackKey: layer === 'player' ? playbackPageKey.value : '', scrollY: 0 };
  const hash = layer === 'player' ? `#/watch/${playbackPageKey.value}`
    : layer === 'catalog' ? `#/search?q=${encodeURIComponent(catalogQuery.value)}`
    : ['discover', 'library', 'history', 'account'].includes(layer) ? `#/${layer}` : window.location.hash;
  if (replace || (currentHistoryLayer() === layer && layer !== 'player')) window.history.replaceState(state, '', hash);
  else {
    window.history.replaceState({ ...window.history.state, scrollY: window.scrollY }, '');
    window.history.pushState(state, '', hash);
  }
};

const restorePage = async (state = window.history.state) => {
  const owner = user.value?.username; if (!owner) return;
  const watchKey = window.location.hash.match(/^#\/watch\/([a-zA-Z0-9-]+)$/)?.[1];
  if (watchKey) {
    const saved = loadPlaybackPage(owner, watchKey);
    if (saved) {
      playbackPageKey.value = watchKey; embedPlayingMedia.value = saved.media;
      selectedHistoryEntry.value = history.value.find(entry => sameMediaIdentity(entry.media, saved.media)) || saved.historyEntry;
      isEmbedPlayerOpen.value = true;
      window.history.replaceState({ ...state, mistyRainLayer: 'player', playbackKey: watchKey }, '');
      window.scrollTo({ top: 0, behavior: 'instant' }); return;
    }
  }
  isEmbedPlayerOpen.value = false;
  const layer = state?.mistyRainLayer;
  const search = window.location.hash.match(/^#\/search\?(.*)$/);
  if (search) { catalogQuery.value = (new URLSearchParams(search[1]).get('q') || '').slice(0,100); mobileTab.value = 'catalog'; }
  else if (['discover','library','history','account','search','catalog'].includes(layer)) mobileTab.value = layer;
  else mobileTab.value = window.location.hash === '#/library' ? 'library' : window.location.hash === '#/account' ? 'account' : window.location.hash === '#/history' ? 'history' : 'discover';
  if (state?.query) catalogQuery.value = state.query;
  if (['tv','movie','anime','variety'].includes(state?.category)) currentCategory.value = state.category;
  if (['discover','library','history','catalog'].includes(mobileTab.value)) lastContentTab.value = mobileTab.value as 'discover' | 'library' | 'history' | 'catalog';
  await nextTick();
  if (watchKey) { toast.show('播放页已失效，请重新选择影片', '!'); setAppHistoryLayer('discover', true); }
  else if (!layer) setAppHistoryLayer(mobileTab.value as AppHistoryLayer, true);
  window.scrollTo({ top: state?.scrollY || 0, behavior: 'instant' });
};

const openPlayerPage = (replace = false, prepared?: QuarkPlaybackSession) => {
  if (!embedPlayingMedia.value || !user.value) return;
  playbackPageKey.value = savePlaybackPage(user.value.username, embedPlayingMedia.value, selectedHistoryEntry.value);
  preparedPageSession.value = prepared ? { key: playbackPageKey.value, session: prepared } : null;
  isEmbedPlayerOpen.value = true;
  setAppHistoryLayer('player', replace);
  window.scrollTo({ top: 0, behavior: 'instant' });
};

const requestLayerClose = (layer: AppHistoryLayer, closeDirectly: () => void) => {
  if (historyEnabled() && !handlingPopState && currentHistoryLayer() === layer) {
    window.history.back();
    return;
  }
  closeDirectly();
};

const handlePopState = async (event: PopStateEvent) => {
  if (isSavingTransfer.value || isDeletingMedia.value || isSavingCategory.value || isSavingTitle.value) {
    setAppHistoryLayer(isSavingTitle.value ? 'title' : isTransferOpen.value ? 'transfer' : isDeletingMedia.value ? 'delete' : 'category'); return;
  }
  handlingPopState = true;
  closeTransferModal(); deletingMedia.value = null; categoryMedia.value = null; titleMedia.value = null; actionMedia.value = null;
  await restorePage(event.state);
  handlingPopState = false;
};

onMounted(() => {
  window.addEventListener('popstate', handlePopState);
});

onBeforeUnmount(() => window.removeEventListener('popstate', handlePopState));

const availableUpdateMedia = computed(() => enrichedMediaList.value.filter(media => (media.newEpisodeCount || 0) > 0));
const currentCategoryUpdateCount = computed(() => mediaList.value.filter(media => (media.newEpisodeCount || 0) > 0).length);

watch(user, async () => {
  isEmbedPlayerOpen.value = false;
  embedPlayingMedia.value = null;
  isTransferOpen.value = false;
  mobileTab.value = 'discover';
  lastContentTab.value = 'discover';
  deletingMedia.value = null;
  categoryMedia.value = null;
  actionMedia.value = null;
  titleMedia.value = null;
  selectedHistoryEntry.value = null;
  isSavingTransfer.value = false;
  savingResourceId.value = '';
  saveError.value = null;
  failedResourceId.value = '';
  autoCheckedUsername = '';
  const owner = user.value?.username;
  restoringPlayer.value = Boolean(owner && window.location.hash.startsWith('#/watch/'));
  if (restoringPlayer.value) await refreshHistory(true);
  if (owner !== user.value?.username) return;
  if (user.value) await restorePage();
  restoringPlayer.value = false;
});

const checkLibraryUpdates = async (force = false, notify = false) => {
  if (isCheckingUpdates.value || isApplyingUpdates.value) return;
  isCheckingUpdates.value = true;
  try {
    const summary = await MediaStore.checkLibraryUpdates(force);
    setLibraryUpdates(summary.items);
    if (notify) {
      const count = summary.items.filter(item => item.newEpisodeCount > 0).length;
      const unavailableCount = summary.items.filter(item => item.updateCheckAvailable === false).length;
      const message = count
        ? `发现 ${count} 部影片有新内容${unavailableCount ? `，另有 ${unavailableCount} 部未能检查更新` : ''}`
        : unavailableCount
          ? `${unavailableCount} 部未能检查更新，可在影片“更多操作”中查看原因`
          : '收藏已是最新';
      toast.show(message, count ? '↻' : unavailableCount ? '!' : '✓', 3200);
    }
  } catch (error) {
    if (notify) toast.show(error instanceof Error ? error.message : '检查更新失败', '!', 3200);
  } finally {
    isCheckingUpdates.value = false;
  }
};

const applyLibraryUpdates = async (mediaItems: MediaItem[]) => {
  const quarkFids = mediaItems.map(item => item.quarkFid || '').filter(Boolean);
  if (!quarkFids.length || isApplyingUpdates.value || isCheckingUpdates.value) return;
  isApplyingUpdates.value = true;
  try {
    const summary = await MediaStore.applyLibraryUpdates(quarkFids);
    setLibraryUpdates(summary.items);
    await refreshList(true);
    const message = summary.transferredCount
      ? `已补充 ${summary.transferredCount} 个新正片文件${summary.failedCount ? `，${summary.failedCount} 部未完成` : ''}`
      : summary.failedCount
        ? `${summary.failedCount} 部未完成剧集补充，请稍后重试或查看具体原因`
        : '当前来源暂无待补剧集';
    toast.show(message, summary.failedCount ? '!' : '✓', 3600);
  } catch (error) {
    toast.show(error instanceof Error ? error.message : '片库更新失败', '!', 3600);
  } finally {
    isApplyingUpdates.value = false;
  }
};

watch(
  [authenticated, () => user.value?.username || '', () => allMediaList.value.length],
  ([isAuthenticated, username, itemCount]) => {
    if (!isAuthenticated || !username || !itemCount || autoCheckedUsername === username) return;
    autoCheckedUsername = username;
    void checkLibraryUpdates(false, false);
  }
);

/** 打开独立播放页。 */
const handleSelectMedia = (media: MediaItem) => {
  if (isSavingTransfer.value) { toast.show('正在添加影片，请稍候', '↻'); return; }
  embedPlayingMedia.value = media;
  selectedHistoryEntry.value = history.value.find(entry => sameMediaIdentity(entry.media, media)) || null;
  openPlayerPage();
};

const continuePlayback = (entry: PlaybackHistoryEntry) => {
  selectedHistoryEntry.value = entry;
  embedPlayingMedia.value = entry.media;
  openPlayerPage();
};

const closeEmbedPlayer = () => {
  requestLayerClose('player', () => { isEmbedPlayerOpen.value = false; navigateContent(lastContentTab.value); });
};

const closeTransferPanel = () => {
  if (isSavingTransfer.value) return;
  requestLayerClose('transfer', closeTransferModal);
};

watch(isTransferOpen, () => { saveError.value = null; failedResourceId.value = ''; });

// 换源
const handleReSearch = (media: MediaItem) => {
  if (isSavingTransfer.value) return;
  const replaceHistory = currentHistoryLayer() === 'player' || currentHistoryLayer() === 'actions';
  isEmbedPlayerOpen.value = false;
  openTransferModal(media);
  setAppHistoryLayer('transfer', replaceHistory);
};

// 无目录匹配或主动换源时，才进入真实网盘检索。
const searchResources = (kw: string) => {
  const replaceHistory = currentHistoryLayer() === 'search';
  mobileTab.value = lastContentTab.value;
  openTransferModal({ id: 'search-' + Date.now(), title: kw, category: currentCategory.value,
    tag: '', poster: '', quarkShareUrl: '' });
  setAppHistoryLayer('transfer', replaceHistory);
};

const handleSearchMedia = (keyword: string) => {
  const query = keyword.trim(); if (!query) return;
  catalogQuery.value = query;
  mobileTab.value = 'catalog'; lastContentTab.value = 'catalog';
  setAppHistoryLayer('catalog', currentHistoryLayer() === 'search');
  window.scrollTo({ top: 0, behavior: 'instant' });
};

// 保存片单
const handleSaveCard = async (media: MediaItem, targetCat?: CategoryType, bestRes?: ResourceItem, selectedFids?: string[]) => {
  if (isSavingTransfer.value) return false;
  const cat = targetCat || media.category || currentCategory.value;
  const cardToSave: MediaItem = {
    ...media,
    category: cat,
    quarkSelectionFids: selectedFids,
    tag: bestRes?.quality || media.tag || '',
    quarkQuality: bestRes?.quality || media.quarkQuality || '',
    quarkShareUrl: bestRes?.url || media.quarkShareUrl,
    quarkPasscode: bestRes?.password || media.quarkPasscode
  };
  isSavingTransfer.value = true;
  savingResourceId.value = bestRes?.id || 'direct';
  saveError.value = null;
  failedResourceId.value = '';
  try {
    await saveMedia(cardToSave);
    currentCategory.value = cat;
    mobileTab.value = 'library';
    lastContentTab.value = 'library';
    const replaceLayer = isTransferOpen.value || currentHistoryLayer() === 'search';
    closeTransferModal();
    setAppHistoryLayer('library', replaceLayer);
    return true;
  } catch (error) {
    if (bestRes && error && typeof error === 'object' && 'code' in error && error.code === 'QUARK_SHARE_UNAVAILABLE') rejectResource(bestRes.url);
    saveError.value = getLibrarySaveFeedback(error);
    failedResourceId.value = bestRes?.id || 'direct';
    return false;
  } finally {
    isSavingTransfer.value = false;
    savingResourceId.value = '';
  }
};

// 移除片单
const handleDeleteCard = (media: MediaItem) => {
  deletingMedia.value = media;
  setAppHistoryLayer('delete');
};

const openMediaActions = (media: MediaItem) => {
  if (isSavingTransfer.value) { toast.show('正在添加影片，请稍候', '↻'); return; }
  actionMedia.value = media;
  setAppHistoryLayer('actions');
};

const openCategoryPicker = (media: MediaItem) => {
  categoryMedia.value = media;
  setAppHistoryLayer('category');
};

const closeDeleteDialog = () => {
  if (!isDeletingMedia.value) requestLayerClose('delete', () => { deletingMedia.value = null; });
};

const closeCategoryPicker = () => {
  if (!isSavingCategory.value) requestLayerClose('category', () => { categoryMedia.value = null; });
};

const closeMediaActions = () => {
  requestLayerClose('actions', () => { actionMedia.value = null; });
};

const editActionMediaCategory = () => {
  const media = actionMedia.value;
  actionMedia.value = null;
  if (media) {
    categoryMedia.value = media;
    setAppHistoryLayer('category', true);
  }
};

const editActionMediaTitle = () => {
  titleMedia.value = actionMedia.value;
  actionMedia.value = null;
  titleError.value = '';
  setAppHistoryLayer('title', true);
};
const closeTitleEditor = () => {
  if (!isSavingTitle.value) requestLayerClose('title', () => { titleMedia.value = null; });
};
const saveMediaTitle = async (title: string) => {
  if (!titleMedia.value || isSavingTitle.value) return;
  if (title === titleMedia.value.title) { closeTitleEditor(); return; }
  isSavingTitle.value = true;
  titleError.value = '';
  try {
    await updateMediaTitle(titleMedia.value, title);
    requestLayerClose('title', () => { titleMedia.value = null; });
    void refreshHistory(true);
  } catch (error) {
    titleError.value = error instanceof Error ? error.message : '名称修改失败';
  } finally { isSavingTitle.value = false; }
};

const reSearchActionMedia = () => {
  const media = actionMedia.value;
  actionMedia.value = null;
  if (media) handleReSearch(media);
};

const deleteActionMedia = () => {
  const media = actionMedia.value;
  actionMedia.value = null;
  if (media) {
    deletingMedia.value = media;
    setAppHistoryLayer('delete', true);
  }
};

const updateActionMedia = () => {
  const media = actionMedia.value;
  closeMediaActions();
  if (media) void applyLibraryUpdates([media]);
};

const receivePlaybackHistory = (entry: PlaybackHistoryEntry, username?: string) => {
  if (!authenticated.value || username !== user.value?.username) return;
  updateLocalHistory(entry);
  if (isEmbedPlayerOpen.value && playbackPageKey.value && embedPlayingMedia.value
    && sameMediaIdentity(entry.media, embedPlayingMedia.value)
    && entry.media.quarkShareUrl === embedPlayingMedia.value.quarkShareUrl) {
    preparedPageSession.value = null;
    if (embedPlayingMedia.value.startEpisodeFid) embedPlayingMedia.value = { ...embedPlayingMedia.value, startEpisodeFid: undefined };
    savePlaybackPage(username!, embedPlayingMedia.value, entry, sessionStorage, playbackPageKey.value);
  }
};

const confirmDeleteMedia = async () => {
  if (!deletingMedia.value || isDeletingMedia.value) return;
  isDeletingMedia.value = true;
  try {
    const media = deletingMedia.value;
    await removeMedia(media);
    removeLocalMediaHistory(media);
    requestLayerClose('delete', () => { deletingMedia.value = null; });
  } catch {
    // 保留确认窗供重试，错误由片库操作提示。
  } finally {
    isDeletingMedia.value = false;
  }
};

const selectMediaCategory = async (category: CategoryType) => {
  if (!categoryMedia.value || isSavingCategory.value) return;
  if (categoryMedia.value.category === category) {
    requestLayerClose('category', () => { categoryMedia.value = null; });
    return;
  }
  isSavingCategory.value = true;
  try {
    await updateMediaCategory(categoryMedia.value, category);
    requestLayerClose('category', () => { categoryMedia.value = null; });
  } catch {
    // 保存失败时保留原分类和选择面板。
  } finally {
    isSavingCategory.value = false;
  }
};

const handlePlaybackAuthUpdated = () => undefined;

const openPlaybackAuth = async () => {
  const replaceHistory = currentHistoryLayer() === 'player' || currentHistoryLayer() === 'transfer';
  isEmbedPlayerOpen.value = false;
  closeTransferModal();
  mobileTab.value = 'account';
  setAppHistoryLayer('account', replaceHistory);
  await nextTick();
  accountPageRef.value?.focusAuth();
  if (user.value?.role !== 'admin') toast.show('播放服务需要管理员重新认证', '!', 3000);
};

const handleLogout = async () => {
  clearPlaybackPages();
  window.history.replaceState(null, '', '#/discover');
  await logout();
};

const focusMobileSearch = () => {
  if (currentPage.value !== 'account') lastContentTab.value = currentPage.value;
  mobileTab.value = 'search';
  setAppHistoryLayer('search');
  nextTick(() => navbarRef.value?.focusSearch());
};

const finishMobileSearch = () => {
  if (mobileTab.value === 'search') {
    requestLayerClose('search', () => { mobileTab.value = lastContentTab.value; });
  }
};

const navigateContent = (tab: 'discover' | 'library' | 'history' | 'catalog') => {
  if (isSavingTransfer.value) return;
  mobileTab.value = tab;
  lastContentTab.value = tab;
  setAppHistoryLayer(tab);
  nextTick(() => navbarRef.value?.scrollToTop());
};
const showMobileLibrary = () => navigateContent('library');
const showDiscovery = () => navigateContent('discover');
const showDesktopLibrary = (category?: CategoryType) => {
  if (category) currentCategory.value = category;
  showMobileLibrary();
};
const showMobileAccount = () => {
  if (isSavingTransfer.value) return;
  if (currentPage.value !== 'account') lastContentTab.value = currentPage.value;
  mobileTab.value = 'account';
  setAppHistoryLayer('account', currentHistoryLayer() === 'search');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
const navigateMobileTab = (tab: MobileDockTab) => tab === 'account' ? showMobileAccount() : navigateContent(tab);
const openDiscoveryItem = (item: DiscoveryItem) => {
  if (isSavingTransfer.value) return;
  const saved = allMediaList.value.find(media => media.catalogId === item.id);
  if (saved) { handleSelectMedia(saved); return; }
  openTransferModal(discoveryMedia(item));
  setAppHistoryLayer('transfer');
};
const playingCollection = computed(() => allMediaList.value.find(item => embedPlayingMedia.value && sameMediaIdentity(item,embedPlayingMedia.value)));
const collectPlayingMedia = async (media: MediaItem, selectedFids?: string[]) => {
  const existing = allMediaList.value.find(item => sameMediaIdentity(item,media));
  if (media.quarkFid || existing && existing.quarkSelectionFids === undefined) return;
  if (existing?.quarkShareUrl && existing.quarkShareUrl !== media.quarkShareUrl) throw new Error('已收藏其他片源，可在收藏中管理');
  const selection = selectedFids && existing?.quarkSelectionFids ? [...new Set([...existing.quarkSelectionFids,...selectedFids])] : selectedFids;
  await saveMedia({ ...media, quarkFid: undefined, startEpisodeFid: undefined, quarkSelectionFids: selection });
};
const switchPlayingSource = async (resource: ResourceItem, episode: QuarkEpisode, position: number, signal: AbortSignal) => {
  const media = embedPlayingMedia.value, key = playbackPageKey.value;
  if (!media) return;
  const next = resourcePlaybackMedia({ ...media,quarkFid:undefined,startEpisodeFid:undefined },resource,media.category);
  const result = await QuarkStreamService.createPlaybackSession({shareUrl:next.quarkShareUrl,passcode:next.quarkPasscode,title:next.title},signal);
  if (signal.aborted || key !== playbackPageKey.value || !isEmbedPlayerOpen.value) return;
  const index = replacementEpisodeIndex(result.episodes,episode,media.category);
  if (index < 0) throw new Error('这个片源没有当前集，请选择其他片源');
  const target = result.episodes[index]!;
  embedPlayingMedia.value = next;
  selectedHistoryEntry.value = { id:'source-switch',media:next,episodeFid:target.fid,episodeNumber:target.episodeNumber,episodeTitle:target.episodeTitle,position,duration:target.duration || 0,completed:false,updatedAt:new Date().toISOString() };
  openPlayerPage(true,result);
};
const playResource = (media: MediaItem, resource: ResourceItem, category: CategoryType, episodeFid?: string) => {
  if (isSavingTransfer.value) return;
  try {
    const playable = resourcePlaybackMedia(media, resource, category);
    playable.startEpisodeFid = episodeFid;
    closeTransferModal();
    embedPlayingMedia.value = playable;
    selectedHistoryEntry.value = history.value.find(entry => sameMediaIdentity(entry.media, playable)) || null;
    openPlayerPage(true);
  } catch (error) { toast.show(error instanceof Error ? error.message : '无法打开资源', '!'); }
};
</script>

<template>
  <!-- 静态石墨背景，播放时由播放器管理画面周围的材质。 -->
  <div v-show="!isEmbedPlayerOpen" class="liquid-spatial-canvas" aria-hidden="true"></div>

  <LoginScreen
    v-if="checking || !authenticated"
    :checking="checking"
    :submitting="loggingIn"
    :error-message="errorMessage"
    @login="login"
  />

  <template v-else-if="user">
    <main v-if="restoringPlayer" class="restoring-player" role="status">正在恢复播放…</main>
    <div v-show="!isEmbedPlayerOpen && !restoringPlayer" class="content-pages">
    <DesktopSidebar :active-page="currentPage === 'catalog' ? 'discover' : currentPage" :category="currentCategory"
      :counts="categoryCounts" :user="user" :disabled="isSavingTransfer"
      @library="showDesktopLibrary" @account="showMobileAccount" @discover="showDiscovery" @history="navigateContent('history')" />
    <!-- 片库页面 -->
    <Navbar
      v-if="mobileTab !== 'account'"
      ref="navbarRef"
      :query="currentPage === 'catalog' ? catalogQuery : ''"
      class="app-navbar"
      :current-category="currentCategory"
      :current-category-name="categoryNames[currentCategory]"
      :user="user"
      :add-media="handleSaveCard"
      :is-saving="isSavingTransfer"
      :save-error="failedResourceId === 'direct' ? saveError : null"
      @search-media="handleSearchMedia"
      @search-blur="finishMobileSearch"
      @open-auth-settings="openPlaybackAuth"
      @clear-save-error="saveError = null; failedResourceId = ''"
      @open-account="showMobileAccount"
    />

    <main v-show="currentPage === 'discover'" class="page-container discovery-container">
      <DiscoveryPage :active="currentPage === 'discover' && !isEmbedPlayerOpen && !isTransferOpen" :library-catalog-ids="allMediaList.map(item => item.catalogId || '').filter(Boolean)" @select="openDiscoveryItem" @search="focusMobileSearch" />
    </main>
    <main v-show="currentPage === 'catalog'" class="page-container">
      <CatalogSearchPage :active="currentPage === 'catalog' && !isEmbedPlayerOpen && !isTransferOpen" :query="catalogQuery" :library-catalog-ids="allMediaList.map(item => item.catalogId || '').filter(Boolean)" @select="openDiscoveryItem" @search-resources="searchResources" @back="showDiscovery" />
    </main>
    <!-- 核心主区域 -->
    <main v-if="currentPage === 'library'" class="page-container">
    <header class="library-intro">
      <div class="library-title">
        <h1>收藏与追更</h1>
        <p>{{ !allMediaList.length && isLoading ? '正在读取…' : !allMediaList.length && loadError ? '等待重新加载' : `${allMediaList.length} 部收藏` }}</p>
      </div>
      <div class="library-actions">
        <button
          v-if="allMediaList.length"
          type="button"
          class="check-updates-button"
          :class="{ checking: isCheckingUpdates }"
          :disabled="isCheckingUpdates || isApplyingUpdates"
          aria-label="检查收藏更新"
          title="检查收藏更新"
          @click="checkLibraryUpdates(true, true)"
        >
          <RefreshCw aria-hidden="true" />
          <span v-if="currentCategoryUpdateCount" class="update-count-dot">{{ currentCategoryUpdateCount }}</span>
        </button>
        <button type="button" class="add-library-button" aria-label="添加影片" @click="focusMobileSearch">
          <Plus aria-hidden="true" /><span>添加</span>
        </button>
      </div>
    </header>

    <div class="category-toolbar">
      <CategoryTabs v-model="currentCategory" :counts="categoryCounts" />
    </div>

    <button
      v-if="availableUpdateMedia.length"
      type="button"
      class="apply-updates-button"
      :disabled="isApplyingUpdates || isCheckingUpdates"
      @click="applyLibraryUpdates(availableUpdateMedia)"
    >
      {{ isApplyingUpdates ? '正在补充新剧集…' : `${availableUpdateMedia.length} 部影片发现新剧集，可立即补集` }}
    </button>

    <!-- 影视卡片网格 -->
    <div v-if="loadError" class="inline-feedback library-load-error" role="alert">
      <strong>暂时无法读取收藏</strong>
      <p>{{ loadError }}{{ allMediaList.length ? ' 当前保留上次加载的内容。' : '' }}</p>
      <button type="button" :disabled="isLoading" @click="refreshList()">{{ isLoading ? '正在重试…' : '重新加载收藏' }}</button>
    </div>
    <MediaGrid
      v-if="!loadError || allMediaList.length > 0 || isLoading"
      :media-list="mediaList"
      :loading="isLoading"
      :current-category="currentCategory"
      :current-category-name="categoryNames[currentCategory]"
      @select-media="handleSelectMedia"
      @delete-card="handleDeleteCard"
      @re-search="handleReSearch"
      @edit-category="openCategoryPicker"
      @open-actions="openMediaActions"
      @start-search="focusMobileSearch"
      @discover="showDiscovery"
    />
    </main>

    <main v-if="currentPage === 'history'" class="page-container"><HistoryPage :history="displayHistory" :history-error="historyError" :loading-history="loadingHistory" :deleting-history-id="deletingHistoryId" @retry="refreshHistory()" @play="continuePlayback" @delete="removeHistory" @discover="showDiscovery" /></main>
    <AccountPage v-if="currentPage === 'account'" ref="accountPageRef" :user="user" @auth-updated="handlePlaybackAuthUpdated" @back="navigateContent(lastContentTab)" @logout="handleLogout" />

    <MobileTabBar
      v-if="!isEmbedPlayerOpen && !isTransferOpen && !deletingMedia && !categoryMedia && !actionMedia && !titleMedia"
      :active-tab="currentPage === 'catalog' ? 'discover' : currentPage"
      :disabled="isSavingTransfer"
      @navigate="navigateMobileTab"
    />

    </div>

  <!-- 独立播放页 -->
    <PlayerPage
      v-if="isEmbedPlayerOpen"
      :key="playbackPageKey"
      :is-open="isEmbedPlayerOpen"
      :media="embedPlayingMedia"
      :username="user.username"
      :history-entry="selectedHistoryEntry"
      :initial-session="preparedPageSession?.key === playbackPageKey ? preparedPageSession.session : undefined"
      :collection="playingCollection" :collect="collectPlayingMedia" :switch-source="switchPlayingSource"
      @close="closeEmbedPlayer"
      @re-search="handleReSearch"
      @open-auth-settings="openPlaybackAuth"
      @history-updated="receivePlaybackHistory"
    />

  <!-- 网盘资源检索与换源面板 -->
    <QuarkTransferModal
    v-if="isTransferOpen"
    :is-open="isTransferOpen"
    :is-analyzing="isAnalyzing"
    :media="selectedMedia"
    :current-category="currentCategory"
    :quark-resources="quarkResources"
    :search-error="searchError"
    :search-notice="searchNotice"
    :search-pending="searchPending"
    :search-keyword="searchKeyword"
    :is-saving="isSavingTransfer"
    :saving-resource-id="savingResourceId"
    :save-error="saveError"
    :failed-resource-id="failedResourceId"
    @open-auth-settings="openPlaybackAuth"
    @close="closeTransferPanel"
    @retry-search="retrySearch"
    @search="refreshResources"
    @resource-unavailable="rejectResource"
    @save-to-cards="handleSaveCard"
    @play-resource="playResource"
    />

    <DeleteMediaConfirm
    :open="!!deletingMedia"
    :media="deletingMedia"
    :deleting="isDeletingMedia"
    @cancel="closeDeleteDialog"
    @confirm="confirmDeleteMedia"
    />

    <CategoryPickerSheet
    :open="!!categoryMedia"
    :media="categoryMedia"
    :saving="isSavingCategory"
    @cancel="closeCategoryPicker"
    @select="selectMediaCategory"
    />

    <MediaActionSheet
      :open="!!actionMedia"
      :media="actionMedia"
      @cancel="closeMediaActions"
      @edit-category="editActionMediaCategory"
      @edit-title="editActionMediaTitle"
      @re-search="reSearchActionMedia"
      @update-library="updateActionMedia"
      @delete="deleteActionMedia"
    />

    <MediaTitleEditor :open="!!titleMedia" :media="titleMedia" :saving="isSavingTitle" :error="titleError" @cancel="closeTitleEditor" @save="saveMediaTitle" />

  </template>

  <!-- 轻量通知浮层 -->
  <Toast />
</template>

<style scoped>
.restoring-player { display: grid; min-height: 100dvh; place-items: center; color: var(--text-secondary); }
.page-container { position: relative; z-index: 1; width: 100%; max-width: 1280px; margin: 0 auto; padding: 36px 40px 90px; }
.library-intro { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.library-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; min-width: 0; }
.library-title h1 { font-size: 1.85rem; font-weight: 700; letter-spacing: -.03em; line-height: 1.3; }
.library-title p { color: var(--text-tertiary); font-size: .78rem; font-weight: 500; }
.library-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.add-library-button { display: flex; min-height: 40px; align-items: center; justify-content: center; gap: 6px; padding: 0 16px; border: 0; border-radius: 9999px; color: var(--text-primary); background: var(--glass-bg-active); font-size: .84rem; font-weight: 600; transition: transform .15s var(--spring-ease), background .2s; }
.add-library-button:hover { background: rgb(255 255 255 / .16); }
.add-library-button:active { transform: scale(.95); }
.add-library-button svg { width: 17px; height: 17px; stroke-width: 2.2; }
.category-toolbar { display: flex; margin-bottom: 28px; border-bottom: 1px solid var(--divider); }
.check-updates-button { position: relative; display: grid; width: 44px; height: 44px; place-items: center; border: 0; border-radius: 50%; color: var(--text-tertiary); background: transparent; transition: transform .15s var(--spring-ease), background .2s, color .2s; }
.check-updates-button:hover { color: var(--text-primary); background: var(--glass-bg); }
.check-updates-button:active { transform: scale(.92); }
.check-updates-button svg { width: 18px; height: 18px; }
.apply-updates-button { display: block; width: 100%; min-height: 48px; margin-bottom: 20px; padding: 12px 16px; border: var(--glass-border); border-radius: 14px; color: var(--text-primary); background: var(--glass-bg); text-align: left; font-size: .84rem; font-weight: 500; transition: background .2s, transform .15s; }
.apply-updates-button:hover { background: var(--glass-bg-hover); }
.apply-updates-button:active { transform: scale(.99); }
.update-count-dot { position: absolute; top: 2px; right: 2px; display: grid; min-width: 17px; height: 17px; padding: 0 4px; place-items: center; border-radius: 9999px; color: var(--accent-ink); background: var(--liquid-accent); font-size: .6rem; font-weight: 650; }
.check-updates-button.checking svg { animation: update-spin .9s linear infinite; }
@keyframes update-spin { to { transform: rotate(360deg); } }
@media (min-width: 1024px) {
  .app-navbar { width: calc(100% - 240px); margin-left: 240px; }
  .page-container { width: calc(100% - 240px); max-width: none; margin-left: 240px; padding: 36px clamp(28px, 3vw, 56px) 72px; }
  .category-toolbar { display: none; }
}
@media (max-width: 640px) {
  .page-container { padding: 14px calc(var(--mobile-gutter) + var(--safe-area-right)) var(--mobile-content-bottom) calc(var(--mobile-gutter) + var(--safe-area-left)); }
  .library-intro { margin-bottom: 14px; }
  .library-title { display: grid; gap: 2px; }
  .library-title h1 { font-size: 1.65rem; font-weight: 700; }
  .library-title p { font-size: .72rem; }
  .library-actions { gap: 6px; }
  .add-library-button { padding: 0 14px; min-height: 38px; }
  .category-toolbar { margin-bottom: 20px; }
}
</style>
