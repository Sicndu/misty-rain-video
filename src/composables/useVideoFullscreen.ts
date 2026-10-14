import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

export type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

/** Enter fullscreen on the video itself so the browser owns playback controls. */
export function useVideoFullscreen(videoRef: Ref<HTMLVideoElement | null>) {
  const fullscreen = ref(false);
  const error = ref('');
  let restoreControls = () => {};
  let release = () => {};

  watch(videoRef, video => {
    release();
    fullscreen.value = false;
    if (!video) return;
    const sync = () => {
      fullscreen.value = document.fullscreenElement === video
        || Boolean((video as FullscreenVideo).webkitDisplayingFullscreen);
      if (!fullscreen.value) restoreControls();
    };
    const begin = () => { fullscreen.value = true; };
    const end = () => { fullscreen.value = false; restoreControls(); };
    document.addEventListener('fullscreenchange', sync);
    video.addEventListener('webkitbeginfullscreen', begin);
    video.addEventListener('webkitendfullscreen', end);
    release = () => {
      document.removeEventListener('fullscreenchange', sync);
      video.removeEventListener('webkitbeginfullscreen', begin);
      video.removeEventListener('webkitendfullscreen', end);
      restoreControls();
    };
  }, { flush: 'sync', immediate: true });

  async function exit() {
    const video = videoRef.value as FullscreenVideo | null;
    if (video?.webkitDisplayingFullscreen) video.webkitExitFullscreen?.();
    else if (document.fullscreenElement === video && video) await document.exitFullscreen();
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

  onBeforeUnmount(() => release());
  return { fullscreen, error, toggle, exit };
}
