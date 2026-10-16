import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

export type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };

/** Android can keep controls/captions in one fullscreen container; iOS keeps its native player. */
export function useVideoFullscreen(videoRef: Ref<HTMLVideoElement | null>, containerRef?: Ref<HTMLElement | null>, requestLandscape = true) {
  const fullscreen = ref(false);
  const nativeFullscreen = ref(false);
  const error = ref('');
  let disposed = false;
  let orientationGeneration = 0;
  let orientationOwned = false;
  let restoreControls = () => {};
  let release = () => {};
  const unlock = () => {
    orientationGeneration++;
    if (orientationOwned) window.screen.orientation?.unlock?.();
    orientationOwned = false;
  };
  const lockLandscape = async (container: HTMLElement) => {
    const orientation = window.screen.orientation as LockableOrientation | undefined;
    if (!orientation?.lock) return;
    const generation = ++orientationGeneration;
    try {
      await orientation.lock('landscape');
      if (disposed || generation !== orientationGeneration || document.fullscreenElement !== container) {
        // A delayed lock must not outlive fullscreen. A newer session owns its own lock.
        if (disposed || !containerRef?.value || document.fullscreenElement !== containerRef.value) orientation.unlock();
      } else orientationOwned = true;
    } catch { /* Rotation lock is optional; fullscreen remains usable in portrait. */ }
  };

  watch(videoRef, video => {
    release();
    fullscreen.value = false;
    nativeFullscreen.value = false;
    if (!video) return;
    const sync = () => {
      nativeFullscreen.value = document.fullscreenElement === video
        || Boolean((video as FullscreenVideo).webkitDisplayingFullscreen);
      fullscreen.value = nativeFullscreen.value || Boolean(containerRef?.value && document.fullscreenElement === containerRef.value);
      if (!fullscreen.value) { restoreControls(); unlock(); }
    };
    const begin = () => { fullscreen.value = true; nativeFullscreen.value = true; };
    const end = () => { fullscreen.value = false; nativeFullscreen.value = false; restoreControls(); };
    document.addEventListener('fullscreenchange', sync);
    video.addEventListener('webkitbeginfullscreen', begin);
    video.addEventListener('webkitendfullscreen', end);
    release = () => {
      document.removeEventListener('fullscreenchange', sync);
      video.removeEventListener('webkitbeginfullscreen', begin);
      video.removeEventListener('webkitendfullscreen', end);
      restoreControls();
    };
    sync();
  }, { flush: 'sync', immediate: true });

  async function exit() {
    const video = videoRef.value as FullscreenVideo | null;
    if (video?.webkitDisplayingFullscreen) video.webkitExitFullscreen?.();
    else if (document.fullscreenElement && (document.fullscreenElement === video || document.fullscreenElement === containerRef?.value)) await document.exitFullscreen();
    unlock();
  }

  async function toggle() {
    error.value = '';
    const video = videoRef.value as FullscreenVideo | null;
    if (!video) return;
    try {
      if (fullscreen.value || document.fullscreenElement === video || video.webkitDisplayingFullscreen) {
        await exit();
        return;
      }
      if (video.readyState < 1) {
        error.value = '视频尚未加载，请稍后再进入全屏';
        return;
      }
      const container = containerRef?.value;
      if (container?.requestFullscreen) {
        await container.requestFullscreen({ navigationUI: 'hide' });
        if (requestLandscape && !disposed && document.fullscreenElement === container) void lockLandscape(container);
        return;
      }
      const previous = video.controls;
      restoreControls = () => { video.controls = previous; restoreControls = () => {}; };
      video.controls = true;
      // Invoke synchronously in the click handler; awaiting play() loses user activation on iOS.
      if (typeof video.webkitEnterFullscreen === 'function') video.webkitEnterFullscreen();
      else if (typeof video.requestFullscreen === 'function') await video.requestFullscreen({ navigationUI: 'hide' });
      else {
        restoreControls();
        error.value = '当前浏览器不支持视频全屏';
      }
    } catch {
      restoreControls();
      error.value = '无法进入视频全屏，请稍后重试';
    }
  }

  onBeforeUnmount(() => { disposed = true; unlock(); release(); void exit().catch(() => {}); });
  return { fullscreen, nativeFullscreen, error, toggle, exit };
}
