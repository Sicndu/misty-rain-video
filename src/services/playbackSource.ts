import type { PlaybackSource } from './quarkStreamService';

export const configureVideoRequest = (video: HTMLVideoElement, source: PlaybackSource) => {
  // 原生媒体（含 Safari HLS）不要求 CORS；hls.js 读取分片仍需 CORS。
  const nativeMedia = !source.isHls || Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
  if (source.delivery === 'direct' && nativeMedia) video.removeAttribute('crossorigin');
  else video.crossOrigin = 'anonymous';
};

export const playbackSourceLabel = (source: PlaybackSource) => {
  const label = source.resolution === 'dolby_vision' ? `${source.label} 杜比视界` : source.label;
  if (!source.delivery) return label;
  return `${label} · ${source.delivery === 'direct' ? '直连' : '中转'}`;
};

export const selectInitialPlaybackSource = (
  available: PlaybackSource[],
  { preferred = '', preferredDelivery = '', mobile = false, respectPreference = true, preferNativeHls = false } = {}
) => {
  const nativeHls = preferNativeHls ? available.filter(source => source.delivery === 'direct' && source.isHls) : [];
  // 原生 HLS 设备优先转码流，不能被历史上的杜比 MKV 选择锁定。
  const preferredPool = nativeHls.length && preferredDelivery !== 'proxy' ? nativeHls : available;
  // 新版明确手选的画质和传输方式优先；旧版只保存分辨率，不能因此一直中转。
  if (respectPreference && preferredDelivery) {
    const explicit = preferredPool.find(source => source.resolution === preferred && source.delivery === preferredDelivery);
    if (explicit) return explicit;
  }
  const direct = nativeHls.length ? nativeHls : available.filter(source => source.delivery === 'direct' && source.resolution !== 'original');
  const pool = direct.length ? direct : available;
  const efficient = pool.filter(source => source.width || source.height
    ? source.width <= 1920 && source.height <= 1080
    : !['2k', '4k', 'dolby_vision', 'source', 'original'].includes(source.resolution));
  const candidates = mobile && efficient.length ? efficient : pool;
  return (respectPreference ? candidates.find(source => source.resolution === preferred) : undefined)
    || candidates.find(source => source.height === 1080 || source.resolution === 'super')
    || (mobile ? candidates.find(source => source.resolution === 'high') : undefined)
    || candidates[0];
};
