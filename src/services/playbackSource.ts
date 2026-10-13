import type { PlaybackSource } from './quarkStreamService';

export const configureVideoRequest = (video: HTMLVideoElement, source: PlaybackSource) => {
  // 原生媒体播放不要求 CORS；TV 的部分 MKV 节点没有 ACAO。
  // hls.js 读取清单/分片仍需 CORS，不能按相同方式绕过。
  if (source.delivery === 'direct' && !source.isHls) video.removeAttribute('crossorigin');
  else video.crossOrigin = 'anonymous';
};

export const playbackSourceLabel = (source: PlaybackSource) => {
  const label = source.resolution === 'dolby_vision' ? `${source.label} 杜比视界` : source.label;
  if (!source.delivery) return label;
  return `${label} · ${source.delivery === 'direct' ? '直连' : '中转'}`;
};

export const selectInitialPlaybackSource = (
  available: PlaybackSource[],
  { preferred = '', preferredDelivery = '', mobile = false, respectPreference = true } = {}
) => {
  // 新版明确手选的画质和传输方式优先；旧版只保存分辨率，不能因此一直中转。
  if (respectPreference && preferredDelivery) {
    const explicit = available.find(source => source.resolution === preferred && source.delivery === preferredDelivery);
    if (explicit) return explicit;
  }
  const direct = available.filter(source => source.delivery === 'direct' && source.resolution !== 'original');
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
