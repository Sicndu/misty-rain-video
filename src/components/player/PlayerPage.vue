<script setup lang="ts">
import type Hls from 'hls.js';
import DanmakuControls from './DanmakuControls.vue';
import PlaybackControls from './PlaybackControls.vue';
import EpisodeSourcePanel from './EpisodeSourcePanel.vue';
import { findPlaybackCandidates } from '../../services/playbackCandidates';
import type { ResourceItem } from '../../types/search';
import PlayerCaptions from './PlayerCaptions.vue';
import { useAndroidMediaSession } from '../../composables/useAndroidMediaSession';
import { playbackHealth } from '../../services/playbackHealth';
import { configureVideoRequest, playbackSourceLabel, selectInitialPlaybackSource } from '../../services/playbackSource';
import SubtitleControls from './SubtitleControls.vue';
import { PlayerPreferencesService } from '../../services/playerPreferencesService';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { CircleAlert, LoaderCircle, Play, RefreshCw, ChevronLeft, Bookmark, BookmarkCheck } from '@lucide/vue';
import type { MediaItem, PlaybackHistoryEntry, PlaybackHistoryUpdate } from '../../types/media';
import {
  QuarkServiceError,
  QuarkStreamService,
  type PlaybackAudioTrack,
  type PlaybackSource,
  type PreparedPlayback,
  type QuarkEpisode,
  type QuarkPlaybackSession
} from '../../services/quarkStreamService';
import { useToast } from '../../composables/useToast';
import { firstPlayableEpisode, nextPlayableEpisode } from '../../services/playbackNavigation';
import { useVideoFullscreen } from '../../composables/useVideoFullscreen';
import { useEmbeddedSubtitles } from '../../composables/useEmbeddedSubtitles';
import { PlaybackHistoryService } from '../../services/playbackHistoryService';

const props = defineProps<{
  isOpen: boolean;
  username?: string;
  media: MediaItem | null;
  historyEntry?: PlaybackHistoryEntry | null;
  initialSession?: QuarkPlaybackSession;
  collection?: MediaItem;
  collect?: (media: MediaItem) => Promise<void>;
  switchSource?: (resource: ResourceItem, episode: QuarkEpisode, position: number, signal: AbortSignal) => Promise<void>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 're-search', media: MediaItem): void;
  (e: 'open-auth-settings'): void;
  (e: 'history-updated', entry: PlaybackHistoryEntry, username?: string): void;
}>();

type PlayerPhase = 'idle' | 'resolving' | 'preparing' | 'ready' | 'error' | 'auth-required';
type SoundEffectMode = 'original' | 'dialogue' | 'cinema' | 'night';

interface PlaybackAutomationSettings {
  skipIntroOutro: boolean;
  autoNext: boolean;
  introSeconds: number;
  outroSeconds: number;
}

interface SoundEffectOption {
  value: SoundEffectMode;
  label: string;
  hint: string;
}

const toast = useToast();
const videoRef = ref<HTMLVideoElement | null>(null);
const playerContainer = ref<HTMLElement | null>(null);
const androidControlsInset = ref(0);
const inlineEpisodesHost = ref<HTMLElement | null>(null);
const fullscreenEpisodesHost = ref<HTMLElement | null>(null);
const episodeTarget = computed(() => fullscreen.value && !nativeFullscreen.value && fullscreenEpisodesHost.value ? fullscreenEpisodesHost.value : inlineEpisodesHost.value);
const hlsRef = shallowRef<Hls | null>(null);
const phase = ref<PlayerPhase>('idle');
const session = ref<QuarkPlaybackSession | null>(null);
const playback = ref<PreparedPlayback | null>(null);
const currentEpisodeIndex = ref(0);
const selectedSourceId = ref('');
const errorMessage = ref('');
const statusMessage = ref('');
const playbackStarting = ref(false);
const videoAspectRatio = ref(16 / 9);
const pictureFit = ref<'contain' | 'cover'>('contain');
const prolongedBuffering = ref(false);
const interruptionPosition = ref(0);
let playbackWatchdog: number | null = null;
let fullscreenNoticeRevealed = false;
const manualPlayRequired = ref(false);
const playbackHasStarted = ref(false);
const detectedAudioTracks = ref<PlaybackAudioTrack[]>([]);
const selectedAudioIndex = ref(-1);
const playbackAutomationStorageKey = `misty_rain_playback_automation:${encodeURIComponent(props.username || 'guest')}`;
const savingPreferences = ref(false);
const preferencesError = ref('');
const preferencesSaved = ref(false);
const defaultPlaybackAutomation: PlaybackAutomationSettings = {
  skipIntroOutro: false,
  autoNext: true,
  introSeconds: 90,
  outroSeconds: 90
};
const loadPlaybackAutomation = (): PlaybackAutomationSettings => {
  try {
    const saved = JSON.parse(localStorage.getItem(playbackAutomationStorageKey) || '{}') as Partial<PlaybackAutomationSettings>;
    return {
      skipIntroOutro: saved.skipIntroOutro === true,
      autoNext: saved.autoNext !== false,
      introSeconds: Number.isFinite(saved.introSeconds) ? Math.max(0, Math.min(600, Math.trunc(Number(saved.introSeconds)))) : 90,
      outroSeconds: Number.isFinite(saved.outroSeconds) ? Math.max(0, Math.min(600, Math.trunc(Number(saved.outroSeconds)))) : 90
    };
  } catch {
    return { ...defaultPlaybackAutomation };
  }
};
const playbackAutomation = ref<PlaybackAutomationSettings>(loadPlaybackAutomation());
const isIOSPlaybackDevice = typeof navigator !== 'undefined'
  && /iPhone|iPad|iPod/i.test(navigator.userAgent);
const nativeHlsSupported = typeof document !== 'undefined'
  && Boolean(document.createElement('video').canPlayType('application/vnd.apple.mpegurl'));
const storedSoundEffect = localStorage.getItem('misty_rain_sound_effect');
const soundEffectMode = ref<SoundEffectMode>(
  !isIOSPlaybackDevice && ['original', 'dialogue', 'cinema', 'night'].includes(storedSoundEffect || '')
    ? storedSoundEffect as SoundEffectMode
    : 'original'
);
// iOS WebClip 的 HTMLMediaElement 经过 Web Audio 后不再与原生视频时钟硬同步。
// 手机端优先保证音画和画面内字幕同步，音效仍保留在其他平台。
const soundEffectAvailable = ref(!isIOSPlaybackDevice && typeof window !== 'undefined'
  && Boolean(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext));
let requestSequence = 0;
let audioContext: AudioContext | null = null;
let mediaAudioSource: MediaElementAudioSourceNode | null = null;
let dryGain: GainNode | null = null;
let wetGain: GainNode | null = null;
let lowShelf: BiquadFilterNode | null = null;
let presenceFilter: BiquadFilterNode | null = null;
let highShelf: BiquadFilterNode | null = null;
let dynamicsCompressor: DynamicsCompressorNode | null = null;
let lastProgressSavedAt = 0;
let lastSavedPosition = -1;
let savingProgress: Promise<PlaybackHistoryEntry | null> | null = null;
let sourceAttachSequence = 0;
let playAttemptSequence = 0;
let autoNextTimer: number | null = null;
let bufferingTimer: number | null = null;
let hlsNetworkRetryTimer: number | null = null;
let hlsNetworkRetryCount = 0;
let hlsMediaRecoveryCount = 0;
let lastPlaybackPosition = 0;
let lastPlaybackProgressAt = 0;
let lastAudibleVolume = Math.max(0.1, Math.min(1, Number(localStorage.getItem('misty_rain_player_volume')) || 1));
let audioOutputNeedsReset = true;
let pageWasHidden = false;
let backgroundResumeAt = 0;
let mobileQualityManuallySelected = false;
let introSkipped = false;
let episodeCompletionHandled = false;
const videoInstanceKey = ref(0);
const isMobilePlaybackDevice = typeof window !== 'undefined'
  && (window.matchMedia('(max-width: 820px)').matches || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
const isAndroidPlaybackDevice = /Android/i.test(navigator.userAgent);
const { fullscreen, nativeFullscreen, error: fullscreenError, toggle: toggleFullscreen, exit: exitFullscreen } = useVideoFullscreen(videoRef, isIOSPlaybackDevice ? undefined : playerContainer, isAndroidPlaybackDevice);
const embeddedSubtitles = useEmbeddedSubtitles(videoRef, () => playback.value?.embeddedSubtitleUrl);
watch(fullscreenError, message => { if (message) { toast.show(message, '!'); announce(message); } });

const soundEffectOptions: SoundEffectOption[] = [
  { value: 'original', label: '原声', hint: '不做处理' },
  { value: 'dialogue', label: '对白增强', hint: '突出人声' },
  { value: 'cinema', label: '影院', hint: '增强低频与细节' },
  { value: 'night', label: '夜间', hint: '平衡音量起伏' }
];

const episodes = computed(() => session.value?.episodes || []);
const currentEpisode = computed(() => episodes.value[currentEpisodeIndex.value] || null);
const movieMode = computed(() => props.media?.category === 'movie');

const sources = computed(() => playback.value?.sources || []);
const selectedSource = computed(() => sources.value.find(source => source.id === selectedSourceId.value) || sources.value[0]);
const sourceAllowsSoundEffects = computed(() => soundEffectAvailable.value && selectedSource.value?.delivery !== 'direct');
const compatibleSource = computed(() => selectInitialPlaybackSource(
  sources.value.flatMap(source => {
    if (source.delivery === 'proxy' && source.resolution !== 'original') return [source];
    if (source.isHls && source.proxyUrl) return [{ ...source, delivery: 'proxy' as const, url: source.proxyUrl }];
    return [];
  }),
  { mobile: true, respectPreference: false }
));
const audioTracks = computed(() => detectedAudioTracks.value.length
  ? detectedAudioTracks.value
  : (playback.value?.audioTracks || []));
const audioSwitchable = computed(() => detectedAudioTracks.value.length > 1 || getNativeAudioTrackCount() > 1);
const selectedSoundEffect = computed(() => soundEffectOptions.find(option => option.value === soundEffectMode.value));
const episodeStatus = computed(() => {
  const episode = currentEpisode.value;
  if (movieMode.value) return episodes.value.length > 1 ? `${episodes.value.length} 个视频` : '';
  if (!episode) return episodes.value.length ? `共 ${episodes.value.length} 集` : '';
  const currentLabel = episode.episodeNumber > 0 ? `第 ${episode.episodeNumber} 集` : episode.episodeTitle;
  return `${currentLabel} / 共 ${episodes.value.length} 集`;
});
const loadingTitle = computed(() => phase.value === 'resolving'
  ? '正在载入片库'
  : `正在准备${currentEpisode.value?.episodeTitle || '当前剧集'}`);
const loadingHint = computed(() => phase.value === 'resolving'
  ? '正在整理剧集与可用画质'
  : '正在获取最佳画质，请稍候');
const playActionLabel = computed(() => {
  const episode = currentEpisode.value;
  if (!episode) return '开始播放';
  return episode.episodeNumber > 0
    ? `播放第 ${episode.episodeNumber} 集`
    : `播放${episode.episodeTitle}`;
});
const sourceDetail = (source: PlaybackSource) => source.width && source.height ? `${source.width}×${source.height}` : '';

const resetSoundEffectGraph = (replaceVideo = false) => {
  for (const node of [mediaAudioSource, dryGain, wetGain, lowShelf, presenceFilter, highShelf, dynamicsCompressor]) {
    try {
      node?.disconnect();
    } catch {
      // Safari 在页面休眠后可能已经断开节点。
    }
  }
  audioContext?.close().catch(() => {});
  audioContext = null;
  mediaAudioSource = null;
  dryGain = null;
  wetGain = null;
  lowShelf = null;
  presenceFilter = null;
  highShelf = null;
  dynamicsCompressor = null;
  if (replaceVideo) videoInstanceKey.value += 1;
};

const destroyPlaybackEngine = () => {
  if (hlsNetworkRetryTimer !== null) {
    window.clearTimeout(hlsNetworkRetryTimer);
    hlsNetworkRetryTimer = null;
  }
  hlsNetworkRetryCount = 0;
  hlsMediaRecoveryCount = 0;
  hlsRef.value?.destroy();
  hlsRef.value = null;
  detectedAudioTracks.value = [];
  selectedAudioIndex.value = -1;
};

const clearBufferingIndicator = (clearStartingState = true) => {
  if (bufferingTimer !== null) {
    window.clearTimeout(bufferingTimer);
    bufferingTimer = null;
  }
  prolongedBuffering.value = false;
  fullscreenNoticeRevealed = false;
  if (clearStartingState && playbackHasStarted.value) playbackStarting.value = false;
};

const releaseSystemMediaSession = () => {
  if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
  try {
    navigator.mediaSession.playbackState = 'none';
    navigator.mediaSession.metadata = null;
  } catch {
    // iOS 终止 WebClip 时可能已先回收系统媒体会话。
  }
};

const stopVideo = (resetAudioOutput = false) => {
  if (resetAudioOutput) audioOutputNeedsReset = true;
  if (autoNextTimer !== null) {
    window.clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
  clearBufferingIndicator(false);
  lastPlaybackPosition = 0;
  lastPlaybackProgressAt = 0;
  sourceAttachSequence += 1;
  playAttemptSequence += 1;
  playbackStarting.value = false;
  manualPlayRequired.value = false;
  playbackHasStarted.value = false;
  destroyPlaybackEngine();
  releaseSystemMediaSession();
  if (!videoRef.value) return;
  videoRef.value.pause();
  videoRef.value.removeAttribute('src');
  videoRef.value.load();
};

const getNativeAudioTrackCount = () => {
  const tracks = (videoRef.value as (HTMLVideoElement & { audioTracks?: { length: number } }) | null)?.audioTracks;
  return tracks?.length || 0;
};

const announce = (message: string) => {
  statusMessage.value = message;
};

const setAudioParam = (parameter: AudioParam | undefined, value: number, timeConstant = 0.018) => {
  if (!parameter || !audioContext) return;
  parameter.cancelScheduledValues(audioContext.currentTime);
  parameter.setTargetAtTime(value, audioContext.currentTime, timeConstant);
};

const configureSoundEffect = (mode: SoundEffectMode) => {
  if (!audioContext || !dryGain || !wetGain || !lowShelf || !presenceFilter || !highShelf || !dynamicsCompressor) return;

  const settings: Record<Exclude<SoundEffectMode, 'original'>, {
    low: number;
    presence: number;
    high: number;
    threshold: number;
    knee: number;
    ratio: number;
    attack: number;
    release: number;
    output: number;
  }> = {
    dialogue: { low: -2, presence: 5, high: 1, threshold: -30, knee: 16, ratio: 3.5, attack: 0.008, release: 0.22, output: 1.05 },
    cinema: { low: 3.5, presence: 1.5, high: 2.2, threshold: -24, knee: 20, ratio: 2.2, attack: 0.012, release: 0.3, output: 0.94 },
    night: { low: -3.5, presence: 3.2, high: -1.5, threshold: -38, knee: 12, ratio: 9, attack: 0.004, release: 0.42, output: 1.08 }
  };

  if (mode === 'original') {
    setAudioParam(dryGain.gain, 1);
    setAudioParam(wetGain.gain, 0);
    return;
  }

  const effect = settings[mode];
  setAudioParam(lowShelf.gain, effect.low);
  setAudioParam(presenceFilter.gain, effect.presence);
  setAudioParam(highShelf.gain, effect.high);
  setAudioParam(dynamicsCompressor.threshold, effect.threshold);
  setAudioParam(dynamicsCompressor.knee, effect.knee);
  setAudioParam(dynamicsCompressor.ratio, effect.ratio);
  setAudioParam(dynamicsCompressor.attack, effect.attack);
  setAudioParam(dynamicsCompressor.release, effect.release);
  setAudioParam(dryGain.gain, 0);
  setAudioParam(wetGain.gain, effect.output);
};

const ensureSoundEffectGraph = async () => {
  const video = videoRef.value;
  if (!video || !sourceAllowsSoundEffects.value) return false;
  try {
    if (!audioContext) {
      const AudioContextConstructor = window.AudioContext
        || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) return false;
      audioContext = new AudioContextConstructor({ latencyHint: 'interactive' });
      mediaAudioSource = audioContext.createMediaElementSource(video);
      dryGain = audioContext.createGain();
      wetGain = audioContext.createGain();
      lowShelf = audioContext.createBiquadFilter();
      presenceFilter = audioContext.createBiquadFilter();
      highShelf = audioContext.createBiquadFilter();
      dynamicsCompressor = audioContext.createDynamicsCompressor();

      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 140;
      presenceFilter.type = 'peaking';
      presenceFilter.frequency.value = 2800;
      presenceFilter.Q.value = 0.85;
      highShelf.type = 'highshelf';
      highShelf.frequency.value = 6500;
      dryGain.gain.value = 1;
      wetGain.gain.value = 0;

      mediaAudioSource.connect(dryGain).connect(audioContext.destination);
      mediaAudioSource
        .connect(lowShelf)
        .connect(presenceFilter)
        .connect(highShelf)
        .connect(dynamicsCompressor)
        .connect(wetGain)
        .connect(audioContext.destination);
    }
    // iOS WebClip 从后台恢复时可能返回 Safari 私有的 interrupted 状态。
    // 只判断 suspended 会让原声通道继续连在无输出的 AudioContext 上。
    if (audioContext.state !== 'running') await audioContext.resume();
    configureSoundEffect(soundEffectMode.value);
    return true;
  } catch {
    soundEffectAvailable.value = false;
    soundEffectMode.value = 'original';
    localStorage.setItem('misty_rain_sound_effect', 'original');
    return false;
  }
};

const selectSoundEffect = async (mode: SoundEffectMode) => {
  if (!sourceAllowsSoundEffects.value) return;
  if (mode === soundEffectMode.value) return;
  soundEffectMode.value = mode;
  localStorage.setItem('misty_rain_sound_effect', mode);
  if (mode === 'original' && audioContext) {
    const video = videoRef.value;
    const resumeAt = video?.currentTime || 0;
    const shouldPlay = Boolean(video && !video.paused);
    const source = selectedSource.value;
    resetSoundEffectGraph(true);
    await nextTick();
    if (source) await attachSource(source, resumeAt, shouldPlay);
  } else if (!(await ensureSoundEffectGraph())) {
    toast.show('当前浏览器无法启用音效处理，已恢复原声', '!', 3000);
    return;
  }
  announce(`已切换到${soundEffectOptions.find(option => option.value === mode)?.label || '原声'}音效`);
};

const restoreVideoAudioOutput = () => {
  const video = videoRef.value;
  if (!video || !audioOutputNeedsReset) return;
  video.defaultMuted = false;
  video.muted = false;
  video.volume = lastAudibleVolume;
  audioOutputNeedsReset = false;
};

const resumeSoundEffect = () => {
  if (isAndroidPlaybackDevice) hlsRef.value?.startLoad(-1);
  restoreVideoAudioOutput();
  // 即使已切回“原声”，旧媒体节点仍经过 AudioContext，也必须恢复它。
  if (audioContext || soundEffectMode.value !== 'original') void ensureSoundEffectGraph();
};

const handleVolumeChange = () => {
  const video = videoRef.value;
  if (!video || video.muted || video.volume <= 0) return;
  lastAudibleVolume = video.volume;
  localStorage.setItem('misty_rain_player_volume', String(video.volume));
};

const handleServiceError = (error: unknown) => {
  void revealPlaybackNotice();
  stopVideo();
  const serviceError = error instanceof QuarkServiceError ? error : null;
  errorMessage.value = error instanceof Error ? error.message : '播放器加载失败';
  if (serviceError?.code === 'QUARK_AUTH_REQUIRED' || serviceError?.status === 401) {
    phase.value = 'auth-required';
    announce('播放认证已失效，可前往“我的”更新');
  } else {
    phase.value = 'error';
    announce(errorMessage.value);
  }
};

const attemptPlayback = async (attachSequence = sourceAttachSequence, userInitiated = false) => {
  const video = videoRef.value;
  if (!video || attachSequence !== sourceAttachSequence) return;
  restoreVideoAudioOutput();
  const attemptSequence = ++playAttemptSequence;
  lastPlaybackProgressAt = Date.now();
  playbackStarting.value = true;
  manualPlayRequired.value = false;
  try {
    await video.play();
  } catch (error) {
    if (attemptSequence !== playAttemptSequence || attachSequence !== sourceAttachSequence) return;
    playbackStarting.value = false;
    manualPlayRequired.value = true;
    const blockedByBrowser = error instanceof DOMException && error.name === 'NotAllowedError';
    announce(blockedByBrowser
      ? `浏览器已阻止自动播放，轻触按钮播放${currentEpisode.value?.episodeTitle || '当前剧集'}`
      : userInitiated
        ? '暂时无法开始播放，请重试'
        : `轻触按钮播放${currentEpisode.value?.episodeTitle || '当前剧集'}`);
  }
};

const seekAndMaybePlay = (
  time: number,
  shouldPlay: boolean,
  attachSequence: number,
  applyIntroSkip = false
) => {
  const video = videoRef.value;
  if (!video) return;
  const apply = () => {
    if (attachSequence !== sourceAttachSequence) return;
    let targetTime = Number.isFinite(time) ? Math.max(0, time) : 0;
    const automation = playbackAutomation.value;
    const canSkipIntro = applyIntroSkip
      && automation.skipIntroOutro
      && Number.isFinite(video.duration)
      && video.duration > automation.introSeconds + automation.outroSeconds + 60;
    if (canSkipIntro) targetTime = Math.max(targetTime, automation.introSeconds);
    introSkipped = canSkipIntro || targetTime >= automation.introSeconds;
    if (targetTime > 0 && video.duration > targetTime) video.currentTime = targetTime;
    if (shouldPlay) void attemptPlayback(attachSequence);
    else {
      playbackStarting.value = false;
      manualPlayRequired.value = true;
    }
  };
  if (video.readyState >= 1) apply();
  else video.addEventListener('loadedmetadata', apply, { once: true });
};

const attachSource = async (
  source: PlaybackSource,
  resumeAt = 0,
  shouldPlay = false,
  applyIntroSkip = false
) => {
  if (source.delivery === 'direct') {
    // 跨域媒体接入 Web Audio 会输出静音。已有音频节点无法从媒体元素解绑，
    // 从中转音效切换直连时必须更换元素，而不只是 disconnect。
    soundEffectMode.value = 'original';
    if (audioContext || mediaAudioSource) {
      videoRef.value?.pause();
      destroyPlaybackEngine();
      resetSoundEffectGraph(true);
    }
  }
  await nextTick();
  const video = videoRef.value;
  if (!video) return;
  const attachSequence = ++sourceAttachSequence;
  playAttemptSequence += 1;
  destroyPlaybackEngine();
  video.pause();
  video.removeAttribute('src');
  configureVideoRequest(video, source);
  video.load();
  playbackStarting.value = shouldPlay;
  manualPlayRequired.value = false;
  playbackHasStarted.value = false;
  clearBufferingIndicator(false);
  lastPlaybackPosition = resumeAt;
  lastPlaybackProgressAt = Date.now();

  // Safari/iOS 可直接交给原生视频管线；仅在原生不支持 HLS 的浏览器
  // 懒加载 hls.js，避免 WebClip 不必要地下载并初始化解码器。
  if (source.isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
    if (source.delivery === 'direct') throw new Error('当前浏览器无法原生播放此视频，请使用兼容画质');
    const { default: HlsRuntime } = await import('hls.js');
    if (attachSequence !== sourceAttachSequence || video !== videoRef.value) return;
    if (HlsRuntime.isSupported()) {
      const hls = new HlsRuntime({
        enableWorker: true,
        lowLatencyMode: false,
        capLevelToPlayerSize: true,
        backBufferLength: 30,
        maxBufferLength: 20,
        maxMaxBufferLength: 40
      });
      hlsRef.value = hls;
      hls.on(HlsRuntime.Events.MEDIA_ATTACHED, () => hls.loadSource(source.url));
      hls.on(HlsRuntime.Events.MANIFEST_PARSED, () => {
        if (attachSequence !== sourceAttachSequence) return;
        detectedAudioTracks.value = hls.audioTracks.map((track, index) => ({
          id: String(index),
          label: track.name || track.lang || `音轨 ${index + 1}`,
          language: track.lang || '',
          codec: '',
          channels: ''
        }));
        if (detectedAudioTracks.value.length) selectedAudioIndex.value = Math.max(0, hls.audioTrack);
        seekAndMaybePlay(resumeAt, shouldPlay, attachSequence, applyIntroSkip);
      });
      hls.on(HlsRuntime.Events.AUDIO_TRACKS_UPDATED, () => {
        detectedAudioTracks.value = hls.audioTracks.map((track, index) => ({
          id: String(index),
          label: track.name || track.lang || `音轨 ${index + 1}`,
          language: track.lang || '',
          codec: '',
          channels: ''
        }));
      });
      hls.on(HlsRuntime.Events.FRAG_LOADED, () => {
        hlsNetworkRetryCount = 0;
      });
      hls.on(HlsRuntime.Events.ERROR, (_event, data) => {
        if (!data.fatal || attachSequence !== sourceAttachSequence || phase.value !== 'ready') return;
        if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR) {
          if (hlsNetworkRetryTimer !== null) return;
          if (hlsNetworkRetryCount < 3) {
            const retryDelays = [600, 1_500, 3_000];
            const retryDelay = retryDelays[hlsNetworkRetryCount++] ?? 3_000;
            hlsNetworkRetryTimer = window.setTimeout(() => {
              hlsNetworkRetryTimer = null;
              if (attachSequence === sourceAttachSequence && hlsRef.value === hls && phase.value === 'ready') hls.startLoad();
            }, retryDelay);
            return;
          }
          interruptPlayback('网络连接中断，请检查网络后重新连接，继续从当前进度播放');
          return;
        }
        if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR) {
          if (hlsMediaRecoveryCount++ === 0) hls.recoverMediaError();
          else interruptPlayback('视频解码中断，请重新连接后继续播放');
          return;
        }
        interruptPlayback('视频流中断，请重新连接当前剧集');
      });
      hls.attachMedia(video);
      return;
    }
  }

  video.src = source.url;
  video.load();
  seekAndMaybePlay(resumeAt, shouldPlay, attachSequence, applyIntroSkip);
};

const chooseInitialSource = (available: PlaybackSource[]) => {
  return selectInitialPlaybackSource(available, {
    preferred: localStorage.getItem('misty_rain_player_quality') || '',
    preferredDelivery: localStorage.getItem('misty_rain_player_delivery') || '',
    mobile: isMobilePlaybackDevice,
    preferNativeHls: nativeHlsSupported,
    respectPreference: !isMobilePlaybackDevice || mobileQualityManuallySelected
  });
};

const progressPayload = (completed = false): PlaybackHistoryUpdate | null => {
  const media = props.media;
  const episode = currentEpisode.value;
  const video = videoRef.value;
  if (!media || !episode || !video) return null;
  const duration = Number.isFinite(video.duration) ? video.duration : episode.duration || 0;
  const isCompleted = completed || video.ended || episodeCompletionHandled;
  const position = isCompleted ? duration : (Number.isFinite(video.currentTime) ? video.currentTime : 0);
  if (!duration || (!isCompleted && position < 3)) return null;
  return {
    media,
    playbackSessionId: session.value?.sessionId,
    episodeFid: episode.fid,
    episodeNumber: episode.episodeNumber,
    episodeTitle: episode.episodeTitle || episode.fileName,
    position,
    duration,
    completed: isCompleted
  };
};

const persistProgress = async (force = false, completed = false, keepalive = false) => {
  const payload = progressPayload(completed);
  if (!payload) return null;
  const now = Date.now();
  if (!force && (now - lastProgressSavedAt < 10000 || Math.abs(payload.position - lastSavedPosition) < 8)) return null;
  if (savingProgress && !force) return savingProgress;
  lastProgressSavedAt = now;
  lastSavedPosition = payload.position;
  const previousSave = savingProgress;
  let request: Promise<PlaybackHistoryEntry | null>;
  const save = () => PlaybackHistoryService.save(payload, keepalive)
    .then(entry => {
      emit('history-updated', entry, props.username);
      return entry;
    })
    .catch(error => {
      console.warn('[playback-history] 保存失败:', error);
      return null;
    });
  request = (previousSave ? previousSave.then(save) : save())
    .finally(() => {
      if (savingProgress === request) savingProgress = null;
    });
  savingProgress = request;
  return request;
};

const completeCurrentEpisode = (skippedOutro = false) => {
  if (episodeCompletionHandled) return;
  episodeCompletionHandled = true;
  playbackStarting.value = false;
  void persistProgress(true, true);

  const nextIndex = nextEpisodeIndex();
  const nextEpisode = episodes.value[nextIndex];
  if (playbackAutomation.value.autoNext && nextIndex >= 0 && nextEpisode) {
    announce(`${skippedOutro ? '已跳过片尾，' : ''}即将播放${nextEpisode.episodeTitle}`);
    autoNextTimer = window.setTimeout(() => {
      autoNextTimer = null;
      if (props.isOpen) void prepareEpisode(nextIndex);
    }, 900);
    return;
  }

  if (skippedOutro) {
    const video = videoRef.value;
    if (video && Number.isFinite(video.duration)) {
      video.pause();
      video.currentTime = Math.max(0, video.duration - 0.05);
    }
    announce('已跳过片尾，本集播放完毕');
  }
};

const handleTimeUpdate = () => {
  void persistProgress();
  const video = videoRef.value;
  if (video && Number.isFinite(video.currentTime)) {
    if (video.currentTime > lastPlaybackPosition + 0.02) {
      lastPlaybackPosition = video.currentTime;
      lastPlaybackProgressAt = Date.now();
      clearBufferingIndicator();
    } else if (video.currentTime < lastPlaybackPosition - 0.25) {
      lastPlaybackPosition = video.currentTime;
      lastPlaybackProgressAt = Date.now();
    }
  }
  const automation = playbackAutomation.value;
  if (!automation.skipIntroOutro
    || phase.value !== 'ready'
    || !playbackHasStarted.value
    || !video
    || video.paused
    || !Number.isFinite(video.duration)
    || video.duration < automation.introSeconds + automation.outroSeconds + 60) return;

  if (!introSkipped && video.currentTime >= 0 && video.currentTime < automation.introSeconds) {
    introSkipped = true;
    video.currentTime = automation.introSeconds;
    announce(`已跳过 ${automation.introSeconds} 秒片头`);
    return;
  }

  const remaining = video.duration - video.currentTime;
  if (!episodeCompletionHandled
    && video.currentTime > automation.introSeconds + 10
    && remaining > 0
    && remaining <= automation.outroSeconds) {
    completeCurrentEpisode(true);
  }
};

const handlePause = () => {
  const video = videoRef.value;
  clearBufferingIndicator();
  playbackStarting.value = false;
  if (phase.value !== 'ready' || video?.ended) return;
  void persistProgress(true);
};

const nextEpisodeIndex = () => nextPlayableEpisode(episodes.value, currentEpisodeIndex.value, props.media?.category, session.value?.cachedOnly);

const handleEnded = () => {
  completeCurrentEpisode(false);
};

const handlePlaying = () => {
  const video = videoRef.value;
  if (phase.value !== 'ready') { video?.pause(); return; }
  if (episodeCompletionHandled && video && video.currentTime < 1) {
    episodeCompletionHandled = false;
    introSkipped = false;
  }
  clearBufferingIndicator(false);
  playbackStarting.value = false;
  manualPlayRequired.value = false;
  playbackHasStarted.value = true;
  lastPlaybackPosition = video?.currentTime || 0;
  lastPlaybackProgressAt = Date.now();
  announce(`正在播放${currentEpisode.value?.episodeTitle || '当前剧集'}`);
};

const handleVisibilityChange = () => {
  if (!props.isOpen) return;
  const video = videoRef.value;
  // PiP is a visible player even when its owning page is hidden.
  if (isAndroidPlaybackDevice && video && document.pictureInPictureElement === video) return;
  if (document.visibilityState === 'hidden') {
    if (video && !video.paused) {
      backgroundResumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      video.pause();
      manualPlayRequired.value = true;
      void persistProgress(true, false, true);
    }
    hlsRef.value?.stopLoad();
    audioContext?.suspend().catch(() => {});
    return;
  }
  if (!pageWasHidden) {
    hlsRef.value?.startLoad(-1);
    audioOutputNeedsReset = true;
    if (phase.value === 'ready') manualPlayRequired.value = isAndroidPlaybackDevice ? Boolean(video?.paused) : true;
  }
};
const handleLeavePictureInPicture = () => {
  if (document.visibilityState === 'hidden') handleVisibilityChange();
};

const handlePageHide = () => {
  if (!props.isOpen) return;
  const video = videoRef.value;
  backgroundResumeAt = video && Number.isFinite(video.currentTime) ? video.currentTime : backgroundResumeAt;
  void persistProgress(true, false, true);
  pageWasHidden = true;

  stopVideo(true);
  resetSoundEffectGraph(true);
};

const handlePageShow = async () => {
  if (!pageWasHidden) return;
  pageWasHidden = false;
  if (!props.isOpen || phase.value !== 'ready' || !selectedSource.value) return;
  await nextTick();
  await attachSource(selectedSource.value, backgroundResumeAt, false);
  manualPlayRequired.value = true;
  announce('已恢复当前剧集，轻触播放继续');
};

const handleWaiting = () => {
  const video = videoRef.value;
  if (!playbackHasStarted.value || !video || video.paused || video.ended) return;
  clearBufferingIndicator(false);
  const observedAt = Date.now();
  bufferingTimer = window.setTimeout(() => {
    bufferingTimer = null;
    const activeVideo = videoRef.value;
    if (!activeVideo
      || activeVideo.paused
      || activeVideo.ended
      || activeVideo.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      || lastPlaybackProgressAt > observedAt) return;
    playbackStarting.value = true;
  }, 650);
};

const handlePlaybackAvailable = () => {
  // canplay only describes buffered data, not an advancing playback clock.
  if (videoRef.value && !videoRef.value.paused && !videoRef.value.seeking) monitorPlayback();
};

const handleMetadata = () => {
  const video = videoRef.value;
  if (video?.videoWidth && video.videoHeight) videoAspectRatio.value = video.videoWidth / video.videoHeight;
};

const handleSeeking = () => {
  lastPlaybackProgressAt = Date.now();
  lastPlaybackPosition = videoRef.value?.currentTime || 0;
  clearBufferingIndicator();
};

const revealPlaybackNotice = async () => {
  try { await exitFullscreen(); } catch { /* Native playback controls still allow exiting fullscreen. */ }
};

const interruptPlayback = (message: string) => {
  const video = videoRef.value;
  interruptionPosition.value = video && Number.isFinite(video.currentTime) && video.currentTime > 0
    ? video.currentTime : Math.max(interruptionPosition.value, lastPlaybackPosition);
  phase.value = 'error';
  playAttemptSequence += 1;
  errorMessage.value = message;
  playbackStarting.value = false;
  manualPlayRequired.value = false;
  clearBufferingIndicator(false);
  video?.pause();
  hlsRef.value?.stopLoad();
  void persistProgress(true);
  void revealPlaybackNotice();
  announce(message);
};

const monitorPlayback = () => {
  const video = videoRef.value;
  const active = Boolean(props.isOpen && phase.value === 'ready' && video && !video.ended
    && document.visibilityState === 'visible' && !manualPlayRequired.value
    && (!video.paused || playbackStarting.value));
  if (!active || !video) {
    lastPlaybackProgressAt = Date.now();
    return;
  }
  const now = Date.now();
  if (Math.abs(video.currentTime - lastPlaybackPosition) > .05) {
    lastPlaybackPosition = video.currentTime;
    lastPlaybackProgressAt = now;
    interruptionPosition.value = video.currentTime;
    clearBufferingIndicator();
    return;
  }
  if (!lastPlaybackProgressAt) lastPlaybackProgressAt = now;
  const health = playbackHealth({ active, elapsedMs: now - lastPlaybackProgressAt });
  if (health === 'interrupted') {
    interruptPlayback(navigator.onLine
      ? '播放已中断，请重新连接，继续从当前进度播放'
      : '网络已断开，请恢复网络后重新连接');
    return;
  }
  if (health === 'buffering' || health === 'stalled') playbackStarting.value = true;
  prolongedBuffering.value = health === 'stalled';
  if (prolongedBuffering.value && !fullscreenNoticeRevealed) {
    fullscreenNoticeRevealed = true;
    void revealPlaybackNotice();
  }
};

const handleVideoError = () => {
  if (phase.value !== 'ready') return;
  if (selectedSource.value?.resolution === 'original' && videoRef.value?.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    interruptPlayback('当前设备不支持此原画格式，请在播放设置中选择其他画质');
    return;
  }
  interruptPlayback(videoRef.value?.error?.code === MediaError.MEDIA_ERR_NETWORK
    ? '视频连接中断，请检查网络后重新连接'
    : '当前视频无法继续播放，请重新连接后重试');
};

const startPlaybackFromPrompt = () => {
  void attemptPlayback(sourceAttachSequence, true);
};

const prepareEpisode = async (index: number, resumeAt = 0) => {
  const activeSession = session.value;
  const episode = activeSession?.episodes[index];
  if (!activeSession || !episode) return;
  if (currentEpisode.value && currentEpisodeIndex.value !== index && !episodeCompletionHandled) {
    await persistProgress(true);
  }
  interruptionPosition.value = resumeAt;
  if (currentEpisodeIndex.value !== index || !playback.value) {
    videoAspectRatio.value = 16 / 9;
    pictureFit.value = 'contain';
  }
  const sequence = ++requestSequence;
  introSkipped = false;
  episodeCompletionHandled = false;
  currentEpisodeIndex.value = index;
  phase.value = 'preparing';
  playback.value = null;
  selectedSourceId.value = '';
  errorMessage.value = '';
  stopVideo();
  announce(`正在准备${episode.episodeTitle}`);

  try {
    const result = await QuarkStreamService.prepareEpisode(activeSession.sessionId, episode.fid, { nativeHls: nativeHlsSupported });
    if (sequence !== requestSequence || !props.isOpen) return;
    playback.value = result;
    const initialSource = chooseInitialSource(result.sources);
    if (!initialSource) throw new Error('当前剧集没有可播放画质');
    selectedSourceId.value = initialSource.id;
    phase.value = 'ready';
    announce(`${episode.episodeTitle}已就绪，可用画质 ${result.sources.map(item => item.label).join('、')}`);
    await attachSource(initialSource, resumeAt, true, true);
    if (resumeAt > 3) announce(`已续播${episode.episodeTitle} ${Math.floor(resumeAt / 60)} 分钟处`);
  } catch (error) {
    if (sequence === requestSequence) handleServiceError(error);
  }
};

const savePreferences = async () => {
  savingPreferences.value = true;
  preferencesError.value = '';
  preferencesSaved.value = false;
  try { await PlayerPreferencesService.save({ ...playbackAutomation.value }); preferencesSaved.value = true; }
  catch (error) { preferencesError.value = error instanceof Error ? error.message : '播放偏好保存失败'; }
  finally { savingPreferences.value = false; }
};
const updateSkipDuration = (field: 'introSeconds' | 'outroSeconds', event: Event) => {
  const seconds = (event.target as HTMLInputElement).valueAsNumber;
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 600) {
    preferencesError.value = '请输入0～600之间的整数秒数'; return;
  }
  playbackAutomation.value[field] = seconds;
  introSkipped = (videoRef.value?.currentTime || 0) >= playbackAutomation.value.introSeconds;
  void savePreferences();
};

const toggleSkipIntroOutro = () => {
  playbackAutomation.value.skipIntroOutro = !playbackAutomation.value.skipIntroOutro;
  void savePreferences();
  const video = videoRef.value;
  const automation = playbackAutomation.value;
  introSkipped = (video?.currentTime || 0) >= automation.introSeconds;
  if (automation.skipIntroOutro
    && video
    && !introSkipped
    && Number.isFinite(video.duration)
    && video.duration > automation.introSeconds + automation.outroSeconds + 60) {
    video.currentTime = automation.introSeconds;
    introSkipped = true;
  }
  announce(playbackAutomation.value.skipIntroOutro
    ? `已开启跳过片头片尾，片头 ${playbackAutomation.value.introSeconds} 秒、片尾 ${playbackAutomation.value.outroSeconds} 秒`
    : '已关闭跳过片头片尾');
};

const toggleAutoNext = () => {
  playbackAutomation.value.autoNext = !playbackAutomation.value.autoNext;
  void savePreferences();
  if (!playbackAutomation.value.autoNext && autoNextTimer !== null) {
    window.clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
  announce(playbackAutomation.value.autoNext ? '已开启连续播放' : '已关闭连续播放');
};

const loadSession = async () => {
  const media = props.media;
  if (!props.isOpen || !media) return;
  const sequence = ++requestSequence;
  phase.value = 'resolving';
  stopVideo();
  session.value = null;
  playback.value = null;
  currentEpisodeIndex.value = 0;
  mobileQualityManuallySelected = false;
  errorMessage.value = '';
  announce(`正在读取《${media.title}》的云端目录`);

  const shareUrl = media.quarkShareUrl || '';
  if (!media.quarkFid && !/pan\.quark\.cn\/s\/[a-zA-Z0-9]+/i.test(shareUrl)) {
    handleServiceError(new QuarkServiceError('该卡片还没有有效的播放资源，请先换源', 'INVALID_QUARK_SHARE', 400));
    return;
  }

  try {
    const preferences = await PlayerPreferencesService.get().catch(() => {
      preferencesError.value = '播放偏好读取失败，当前使用本机已保存的设置';
      return playbackAutomation.value;
    });
    if (sequence !== requestSequence) return;
    playbackAutomation.value = preferences;
    const result = props.initialSession || await QuarkStreamService.createPlaybackSession({
      quarkFid: media.quarkFid,
      shareUrl,
      title: media.title,
      episodeFid: media.startEpisodeFid,
      passcode: media.quarkPasscode
    });
    if (sequence !== requestSequence || !props.isOpen) return;
    session.value = result;
    announce(`已读取 ${result.episodes.length} 个视频文件`);
    const history = props.historyEntry;
    const matchedHistoryIndex = history
      ? result.episodes.findIndex(episode => episode.fid === history.episodeFid)
      : -1;
    const requestedIndex = media.startEpisodeFid ? result.episodes.findIndex(episode => episode.fid === media.startEpisodeFid) : -1;
    if (media.startEpisodeFid && requestedIndex < 0) throw new QuarkServiceError('所选视频已不存在，请重新选择资源', 'EPISODE_NOT_FOUND', 404);
    const resumeIndex = requestedIndex >= 0 ? requestedIndex : matchedHistoryIndex >= 0 ? matchedHistoryIndex : firstPlayableEpisode(result.episodes, media.category);
    const resumeAt = history && matchedHistoryIndex === resumeIndex && !history.completed ? history.position : 0;
    await prepareEpisode(resumeIndex, resumeAt);
  } catch (error) {
    if (sequence === requestSequence) handleServiceError(error);
  }
};

const changeQuality = async (source: PlaybackSource) => {
  const video = videoRef.value;
  const resumeAt = video?.currentTime || 0;
  const shouldPlay = Boolean(video && !video.paused);
  selectedSourceId.value = source.id;
  mobileQualityManuallySelected = true;
  localStorage.setItem('misty_rain_player_quality', source.resolution);
  if (source.delivery) localStorage.setItem('misty_rain_player_delivery', source.delivery);
  else localStorage.removeItem('misty_rain_player_delivery');
  announce(`已切换到${playbackSourceLabel(source)}`);
  await attachSource(source, resumeAt, shouldPlay);
};

const useCompatibleSource = async () => {
  const source = compatibleSource.value;
  if (!source) return;
  if (playback.value) playback.value.sources = playback.value.sources.map(item => item.id === source.id ? source : item);
  selectedSourceId.value = source.id;
  errorMessage.value = '';
  phase.value = 'ready';
  await attachSource(source, interruptionPosition.value, true);
};

const selectAudioTrack = (index: number) => {
  const hls = hlsRef.value;
  if (hls && index >= 0 && index < hls.audioTracks.length) {
    hls.audioTrack = index;
    selectedAudioIndex.value = index;
    announce(`已切换到${audioTracks.value[index]?.label || `音轨 ${index + 1}`}`);
    return;
  }

  const nativeTracks = (videoRef.value as (HTMLVideoElement & {
    audioTracks?: ArrayLike<{ enabled: boolean }>;
  }) | null)?.audioTracks;
  if (nativeTracks && index < nativeTracks.length) {
    for (let trackIndex = 0; trackIndex < nativeTracks.length; trackIndex += 1) {
      nativeTracks[trackIndex].enabled = trackIndex === index;
    }
    selectedAudioIndex.value = index;
  }
};

const selectEpisode = async (index: number) => {
  await prepareEpisode(index);
  if (phase.value !== 'ready') return;
  videoRef.value?.parentElement?.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start'
  });
};

const retry = () => {
  if (session.value && currentEpisode.value) {
    const video = videoRef.value;
    const resumeAt = video && Number.isFinite(video.currentTime) && video.currentTime > 0
      ? video.currentTime : interruptionPosition.value;
    void prepareEpisode(currentEpisodeIndex.value, resumeAt);
  }
  else loadSession();
};

const close = () => {
  void exitFullscreen().catch(() => {});
  void persistProgress(true, false, true);
  phase.value = 'idle';
  requestSequence += 1;
  stopVideo(true);
  resetSoundEffectGraph(true);
  emit('close');
};


watch(
  [() => props.isOpen, () => props.media?.id],
  ([isOpen]) => {
    if (isOpen) loadSession();
    else {
      phase.value = 'idle';
      requestSequence += 1;
      stopVideo();
    }
  },
  { immediate: true }
);

watch(playbackAutomation, value => {
  try { localStorage.setItem(playbackAutomationStorageKey, JSON.stringify(value)); } catch { /* Server preferences remain available. */ }
}, { deep: true });

onBeforeUnmount(() => {
  if (playbackWatchdog !== null) window.clearInterval(playbackWatchdog);
  void persistProgress(true, false, true);
  phase.value = 'idle';
  stopVideo(true);
  resetSoundEffectGraph();
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('pageshow', handlePageShow);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});

onMounted(() => {
  playbackWatchdog = window.setInterval(monitorPlayback, 1_000);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

useAndroidMediaSession(videoRef, {
  enabled: () => isAndroidPlaybackDevice && props.isOpen && phase.value === 'ready',
  title: () => props.media?.title || '烟雨影视',
  episode: () => currentEpisode.value?.episodeTitle || '',
  nextAvailable: () => nextEpisodeIndex() >= 0,
  next: () => { const index = nextEpisodeIndex(); if (index >= 0) void selectEpisode(index); },
  play: startPlaybackFromPrompt,
});

const candidateSources = ref<ResourceItem[]>([]), searchingSources = ref(false), sourceError = ref('');
const switchingSource = ref(false), collecting = ref(false), collectError = ref('');
const collectedAll = computed(() => Boolean(props.media?.quarkFid || props.collection && props.collection.quarkSelectionFids === undefined));

let candidateController: AbortController | undefined, switchController: AbortController | undefined;
let candidateTimer: ReturnType<typeof setTimeout> | undefined;
let searchedMedia = '';
const searchCandidates = async () => {
  if (!props.media || searchingSources.value) return;
  candidateController?.abort(); const controller = candidateController = new AbortController();
  searchingSources.value = true; sourceError.value = '';
  try { await findPlaybackCandidates(props.media.title, props.media.quarkShareUrl || '', controller.signal, items => { if (!controller.signal.aborted) candidateSources.value = items; }); }
  catch (error) { if (!controller.signal.aborted) sourceError.value = error instanceof Error ? error.message : '备选片源暂不可用'; }
  finally { if (candidateController === controller) searchingSources.value = false; }
};
watch([phase, () => props.media?.id, () => props.media?.quarkShareUrl], () => {
  const key = `${props.media?.id}:${props.media?.quarkShareUrl}`;
  if (phase.value === 'ready' && searchedMedia !== key) { searchedMedia = key; clearTimeout(candidateTimer); candidateTimer = setTimeout(() => { if (document.visibilityState !== 'hidden') void searchCandidates(); }, 2000); }
});
const switchCandidate = async (resource: ResourceItem) => {
  if (switchingSource.value || !currentEpisode.value || !props.switchSource) return;
  switchingSource.value = true; sourceError.value = '';
  const controller = switchController = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try { await persistProgress(true); await props.switchSource(resource,currentEpisode.value,videoRef.value?.currentTime || 0,controller.signal); }
  catch (error) { if (!controller.signal.aborted) sourceError.value = error instanceof Error ? error.message : '换源失败'; else sourceError.value = '换源超时，请重试'; }
  finally { clearTimeout(timer); switchingSource.value = false; }
};
const collectSeries = async () => {
  if (collecting.value || !props.media || !currentEpisode.value || !props.collect) return;
  collecting.value = true; collectError.value = '';
  try { await props.collect(props.media); }
  catch (error) { collectError.value = error instanceof Error ? error.message : '收藏失败，请重试'; }
  finally { collecting.value = false; }
};
onBeforeUnmount(() => { clearTimeout(candidateTimer); candidateController?.abort(); switchController?.abort(); });

defineExpose({ retry });
</script>

<template>
  <main
    class="player-page"
    :aria-label="media ? `播放《${media.title}》` : '视频播放器'"
  >
    <section v-if="media" class="player-window">
      <header class="player-header">
        <button class="back-to-content" type="button" aria-label="返回上一页" @click="close"><ChevronLeft aria-hidden="true" />返回</button>
        <div class="title-block">
          <div class="title-copy">
            <h1>{{ media.title }}</h1>
            <p v-if="episodeStatus">{{ episodeStatus }}</p>
          </div>
        </div>


      </header>

      <p v-if="session?.cachedOnly" class="cached-playback-note">原分享已失效，仍可播放已缓存的视频。其他集数可在片源栏查找。</p>
      <div class="player-layout">
        <div ref="playerContainer" class="video-column" :class="{ 'player-fullscreen': fullscreen && !nativeFullscreen }">
          <div class="video-stage" :class="{ 'has-player-controls': !nativeFullscreen && phase === 'ready' }" :style="{ '--video-ratio': videoAspectRatio }">
            <video
              :key="videoInstanceKey"
              ref="videoRef"
              class="video-element"
              :class="{ 'native-fullscreen': nativeFullscreen }"
              :style="{ objectFit: pictureFit }"
              :controls="nativeFullscreen"
              controlslist="nodownload noremoteplayback"
              playsinline
              :preload="isIOSPlaybackDevice ? 'auto' : 'metadata'"
              :poster="isMobilePlaybackDevice ? undefined : media.poster"
              @play="resumeSoundEffect"
              @volumechange="handleVolumeChange"
              @playing="handlePlaying"
              @waiting="handleWaiting"
              @stalled="handleWaiting"
              @loadedmetadata="handleMetadata"
              @resize="handleMetadata"
              @seeking="handleSeeking"
              @canplay="handlePlaybackAvailable"
              @seeked="handlePlaybackAvailable"
              @timeupdate="handleTimeUpdate"
              @pause="handlePause"
              @ended="handleEnded"
              @error="handleVideoError"
              @leavepictureinpicture="handleLeavePictureInPicture"
            >
              <track
                v-for="subtitle in playback?.subtitles || []"
                :key="subtitle.id"
                kind="subtitles"
                :label="subtitle.label"
                :srclang="subtitle.language || 'und'"
                :data-subtitle-origin="subtitle.origin || 'source'"
                :src="subtitle.url"
              />
            </video>
            <PlayerCaptions v-if="!isIOSPlaybackDevice && videoRef && phase === 'ready'" :video="videoRef" :fit="pictureFit" :controls-inset="androidControlsInset" :native-fullscreen="nativeFullscreen" />
            <div v-if="phase === 'resolving' || phase === 'preparing'" class="stage-state loading-state" role="status" aria-live="polite">
              <img v-if="media.poster && !isMobilePlaybackDevice" class="stage-poster" :src="media.poster" alt="" aria-hidden="true" />
              <div class="loading-content">
                <span class="loading-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
                <strong>{{ loadingTitle }}</strong>
                <p>{{ loadingHint }}</p>
              </div>
            </div>

            <div v-else-if="phase === 'error' || phase === 'auth-required'" class="stage-state error-state" role="alert">
              <CircleAlert class="state-icon" aria-hidden="true" />
              <strong>{{ phase === 'auth-required' ? '播放认证已失效' : interruptionPosition > 0 ? '播放中断' : '暂时无法播放' }}</strong>
              <p>{{ errorMessage }}</p>
              <div class="state-actions">
                <button v-if="phase === 'auth-required'" type="button" class="primary-button" @click="emit('open-auth-settings')">
                  前往设置
                </button>
                <button type="button" class="secondary-button reload-button" @click="retry">
                  <RefreshCw aria-hidden="true" />
                  {{ interruptionPosition > 0 ? '重新连接并续播' : '重新连接' }}
                </button>
                <button
                  v-if="phase === 'error' && selectedSource?.delivery === 'direct' && compatibleSource"
                  type="button" class="secondary-button" @click="useCompatibleSource"
                >
                  使用兼容画质（服务器中转）
                </button>
              </div>
            </div>

            <div
              v-else-if="phase === 'ready' && manualPlayRequired"
              class="play-prompt"
            >
              <button
                type="button"
                class="stage-play-button"
                :aria-label="playActionLabel"
                @click="startPlaybackFromPrompt"
              >
                <span class="stage-play-icon" aria-hidden="true">
                  <Play />
                </span>
                <span class="stage-play-label">{{ playActionLabel }}</span>
                <small>轻触开始播放</small>
              </button>
            </div>

            <div
              v-else-if="phase === 'ready' && playbackStarting"
              class="playback-starting"
              role="status"
              aria-live="polite"
            >
              <span class="playback-starting-pill">
                <LoaderCircle aria-hidden="true" />
                {{ prolongedBuffering ? '网络较慢，正在等待视频…' : playbackHasStarted ? '正在缓冲…' : '正在连接视频…' }}
              </span>
              <button v-if="prolongedBuffering" type="button" class="buffer-retry" @click="retry">重新连接</button>
            </div>
          </div>

          <PlaybackControls v-if="videoRef && phase === 'ready'" :native-fullscreen="nativeFullscreen"
            :video="videoRef" :expanded="fullscreen && !nativeFullscreen" :title="media.title" :episodes="episodes" :current-index="currentEpisodeIndex"
            @fullscreen="toggleFullscreen" @inset="androidControlsInset = $event">
            <SubtitleControls :video="videoRef" :hls="hlsRef" :native-fullscreen="nativeFullscreen" :username="username" :notice="playback?.subtitleNotice" compact icon-only
              :loading="embeddedSubtitles.loading.value" :read-error="embeddedSubtitles.error.value" @retry-embedded="embeddedSubtitles.retry" />
            <template #episodes><div class="fullscreen-episode-panel"><button type="button" class="collect-series" :disabled="collecting || collectedAll" @click="collectSeries"><BookmarkCheck v-if="collectedAll" /><Bookmark v-else />{{ collectedAll ? '已收藏' : collecting ? '收藏中…' : '收藏整部' }}</button><div ref="fullscreenEpisodesHost"></div></div></template>
            <template #settings><div class="playback-settings" id="playback-settings">
            <div class="setting-group">
              <div class="setting-heading"><span>画面比例</span><small></small></div>
              <div class="option-scroll" role="group" aria-label="画面显示方式">
                <button type="button" class="option-chip" :class="{ active: pictureFit === 'contain' }" :aria-pressed="pictureFit === 'contain'" @click="pictureFit = 'contain'">适应</button>
                <button type="button" class="option-chip" :class="{ active: pictureFit === 'cover' }" :aria-pressed="pictureFit === 'cover'" @click="pictureFit = 'cover'">铺满</button>
              </div>
            </div>
            <div class="setting-group">
              <div class="setting-heading">
                <span>画质</span>
                <small>{{ selectedSource ? sourceDetail(selectedSource) : '' }}</small>
              </div>
              <select class="setting-select" aria-label="画质选择" :value="selectedSourceId" @change="changeQuality(sources.find(source => source.id === ($event.target as HTMLSelectElement).value)!)">
                <option v-for="source in sources" :key="source.id" :value="source.id">{{ playbackSourceLabel(source) }}</option>
              </select>
              <p v-if="selectedSource?.delivery === 'proxy'" class="delivery-hint">服务器中转</p>
              <p v-else-if="selectedSource?.resolution === 'original'" class="delivery-hint">原画直连 · 需设备支持</p>
            </div>

            <div v-if="audioSwitchable" class="setting-group">
              <div class="setting-heading">
                <span>音频</span>

              </div>
              <div class="option-scroll">
                <button
                  v-for="(track, index) in audioTracks"
                  :key="track.id"
                  type="button"
                  class="option-chip"
                  :class="{ active: selectedAudioIndex === index }"
                  :disabled="!audioSwitchable"
                  @click="selectAudioTrack(index)"
                >
                  {{ track.label }}{{ track.codec ? ` · ${track.codec}` : '' }}
                </button>
              </div>
            </div>

            <div v-if="sourceAllowsSoundEffects" class="setting-group">
              <div class="setting-heading">
                <span>音效</span>
                <small>{{ selectedSoundEffect?.hint || '设备端实时处理' }}</small>
              </div>
              <div class="option-scroll" role="radiogroup" aria-label="音效选择">
                <button
                  v-for="effect in soundEffectOptions"
                  :key="effect.value"
                  type="button"
                  class="option-chip"
                  :class="{ active: soundEffectMode === effect.value }"
                  role="radio"
                  :aria-checked="soundEffectMode === effect.value"
                  @click="selectSoundEffect(effect.value)"
                >
                  {{ effect.label }}
                </button>
              </div>
            </div>

            <div class="setting-group automation-setting-group">
              <div class="setting-heading">
                <span>播放偏好</span>
              </div>
              <div class="automation-list">
                <div class="automation-row">
                  <span class="automation-copy">
                    <strong>跳过片头片尾</strong>
                  </span>
                  <button
                    type="button"
                    class="setting-switch"
                    role="switch"
                    :aria-checked="playbackAutomation.skipIntroOutro"
                    aria-label="跳过片头片尾"
                    :disabled="savingPreferences"
                    @click="toggleSkipIntroOutro"
                  >
                    <span aria-hidden="true"></span>
                  </button>
                </div>

                <div v-if="playbackAutomation.skipIntroOutro" class="skip-durations">
                  <label><span>片头</span><span class="duration-input"><input type="number" min="0" max="600" step="1" aria-label="片头时长（秒）" :value="playbackAutomation.introSeconds" :disabled="savingPreferences" @change="updateSkipDuration('introSeconds', $event)" /><span>秒</span></span></label>
                  <label><span>片尾</span><span class="duration-input"><input type="number" min="0" max="600" step="1" aria-label="片尾时长（秒）" :value="playbackAutomation.outroSeconds" :disabled="savingPreferences" @change="updateSkipDuration('outroSeconds', $event)" /><span>秒</span></span></label>
                  <p>0 秒表示不跳过</p>
                  <p v-if="preferencesError" role="alert" class="preferences-error">{{ preferencesError }}</p>
                  <p v-else-if="savingPreferences || preferencesSaved" role="status">{{ savingPreferences ? '正在保存…' : '播放偏好已保存' }}</p>
                </div>
                <div class="automation-row">
                  <span class="automation-copy">
                    <strong>连续播放</strong>
                  </span>
                  <button
                    type="button"
                    class="setting-switch"
                    role="switch"
                    :aria-checked="playbackAutomation.autoNext"
                    aria-label="连续播放下一集"
                    :disabled="savingPreferences"
                    @click="toggleAutoNext"
                  >
                    <span aria-hidden="true"></span>
                  </button>
                </div>
              </div>
            </div>
            <div v-if="currentEpisode && media" class="setting-group"><div class="setting-heading"><span>弹幕</span></div><DanmakuControls :video="videoRef!" :input="{ mediaKey: media.id, title: media.title, category: media.category, episodeNumber: currentEpisode.episodeNumber, episodeTitle: currentEpisode.episodeTitle }" /></div>
            </div></template>
          </PlaybackControls>
        </div>
        <section v-show="!fullscreen" class="watch-details">
          <header class="watch-summary"><div><h2>{{ media.title }}</h2><p>{{ episodeStatus }}</p></div><button type="button" class="collect-series" :disabled="collecting || collectedAll || !episodes.length" @click="collectSeries"><BookmarkCheck v-if="collectedAll" /><Bookmark v-else />{{ collectedAll ? '已收藏' : collecting ? '收藏中…' : '收藏整部' }}</button></header>
          <p v-if="collectError" class="collect-error" role="alert">{{ collectError }}</p>
          <div ref="inlineEpisodesHost"></div>
          <div v-if="!episodes.length" class="episode-placeholder">{{ phase === 'error' || phase === 'auth-required' ? '影片连接后显示选集' : '正在读取剧集…' }}</div>
        </section>
        <Teleport v-if="episodeTarget && episodes.length" :to="episodeTarget"><EpisodeSourcePanel :episodes="episodes" :current-index="currentEpisodeIndex" :movie="movieMode" active :candidates="candidateSources" :searching="searchingSources" :switching="switchingSource" :source-error="sourceError" @episode="selectEpisode" @source="switchCandidate" @retry="searchCandidates" @search="emit('re-search',media)" /></Teleport>
      </div>

      <p class="sr-status" aria-live="polite">{{ statusMessage }}</p>
    </section>
  </main>
</template>

<style scoped>
.skip-durations { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; padding: 4px 0 16px; }
.skip-durations label { display: grid; gap: 7px; color: var(--text-secondary); font-size: .75rem; }
.duration-input { display: flex; align-items: center; height: 44px; gap: 8px; padding: 0 10px; border: 1px solid var(--divider); border-radius: 8px; background: var(--surface-2); }
.duration-input input { width: 100%; min-width: 0; height: 100%; padding: 0; border: 0; color: var(--text-primary); background: transparent; font: inherit; font-size: 16px; }
.duration-input > span { color: var(--text-tertiary); font-size: 12px; }
.skip-durations p { grid-column: 1 / -1; color: var(--text-tertiary); font-size: .72rem; line-height: 1.5; }
.skip-durations .preferences-error { color: var(--danger); }
.delivery-hint { margin-top: 9px; color: var(--text-tertiary); font-size: .73rem; line-height: 1.6; }
.player-page { position: relative; z-index: 1; width: 100%; min-height: 100dvh; color: var(--text-primary); background: var(--surface-1); }
.player-window { display: flex; flex-direction: column; width: 100%; height: 100dvh; min-height: 0; overflow: hidden; }
.back-to-content { display: flex; align-items: center; gap: 4px; min-height: 44px; flex-shrink: 0; padding: 0; border: 0; color: var(--text-secondary); background: transparent; font-size: .85rem; }
.back-to-content svg { width: 20px; height: 20px; }
.cached-playback-note { padding: 10px 24px; color: var(--text-secondary); font-size: .8rem; }
.player-header { display:flex; flex-shrink:0; min-height:60px; align-items:center; gap:16px; padding:10px 24px; border-bottom:1px solid var(--divider); background:var(--surface-1); }
.title-block, .header-actions { display: flex; align-items: center; gap: 12px; }
.title-block, .title-copy { min-width: 0; }
.title-block { flex: 1; }
.source-badge { flex: 0 0 auto; padding: 6px 10px; border: var(--glass-border); border-radius: 18px; color: var(--liquid-accent-strong); background: var(--glass-lens); box-shadow: var(--glass-highlight-inner); font-size: .7rem; font-weight: 650; }
.title-copy h1 { overflow: hidden; color: var(--text-primary); font-size: 1.1rem; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; letter-spacing: -.025em; }
.title-copy p { margin-top: 3px; overflow: hidden; color: var(--text-tertiary); font-size: .75rem; text-overflow: ellipsis; white-space: nowrap; }
.header-actions { flex-shrink: 0; gap: 8px; }
.text-action, .icon-button { min-height: 44px; border: 0; color: var(--text-secondary); background: var(--glass-bg); box-shadow: none; }
.text-action { padding: 0 18px; border-radius: 24px; font-size: .82rem; font-weight: 600; }
.icon-button { display: grid; width: 44px; flex-shrink: 0; place-items: center; border-radius: 50%; }
.icon-button svg { width: 19px; height: 19px; }
.text-action:hover, .icon-button:hover { background: var(--glass-bg-active); }
.player-layout { display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,380px); gap:24px; min-height:0; flex:1; overflow-y:auto; padding:24px; align-items:start; }
.video-column { position:sticky; top:0; display:flex; width:100%; min-width:0; flex-direction:column; align-self:start; }
/* Only the stage owns dark tokens. Playback pixels are never blurred or tinted. */
.video-stage { --text-primary: #f6f8ff; --text-secondary: #d0daea; --text-tertiary: #b7c4d9; --liquid-accent: #b6ceff; --liquid-accent-strong: #91b3f7; position: relative; display: grid; width: 100%; min-height: 220px; aspect-ratio: var(--video-ratio, 16 / 9); flex: 0 0 auto; place-items: center; overflow: hidden; border: var(--glass-border); border-radius: 14px; color: var(--text-primary); background: #000; color-scheme: dark; }
.video-element { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; object-fit: contain; background: #000; }
.stage-state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 20px; overflow-y: auto; text-align: center; background: radial-gradient(ellipse at 50% 10%, #222831, #0c1016 75%); }
.loading-state { isolation: isolate; }
.stage-poster { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; object-fit: cover; opacity: .12; }
.loading-content { display: grid; justify-items: center; gap: 8px; }
.stage-state strong { font-size: .97rem; font-weight: 650; }
.stage-state p { max-width: 420px; color: var(--text-secondary); font-size: .8rem; line-height: 1.6; overflow-wrap: anywhere; }
.state-icon { width: 28px; height: 28px; color: #f0c3cc; }
.state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 5px; }
.primary-button, .secondary-button { min-height: 44px; padding: 0 17px; border: 1px solid var(--divider); border-radius: 24px; font-size: .8rem; font-weight: 600; box-shadow: none; }
.primary-button { color: #eff3fa; background: rgb(255 255 255 / .12); }
.secondary-button { color: #f1f5ff; background: rgb(255 255 255 / .045); }
.reload-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.reload-button svg { width: 16px; height: 16px; }
.play-prompt, .playback-starting { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; pointer-events: none; }
.play-prompt { background: rgb(0 0 0 / .2); }
.stage-play-button { display: grid; min-width: 140px; justify-items: center; gap: 7px; padding: 12px 16px; border: 0; border-radius: 26px; color: #fff; background: transparent; pointer-events: auto; }
.stage-play-icon { display: grid; width: 68px; height: 68px; place-items: center; border: 1px solid var(--divider); border-radius: 50%; color: #fff; background: linear-gradient(145deg, rgb(255 255 255 / .4), rgb(255 255 255 / .1)); box-shadow: inset 0 2px 2px rgb(255 255 255 / .6), 0 9px 28px rgb(0 0 0 / .2); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); transition: transform .2s, background .2s; }
.stage-play-icon svg { width: 27px; height: 27px; margin-left: 3px; fill: currentColor; }
.stage-play-button:active .stage-play-icon { transform: scale(.95); }
.stage-play-label { font-size: .86rem; font-weight: 650; text-shadow: 0 2px 6px #000; }
.stage-play-button small { color: #e1e9f8; font-size: .7rem; text-shadow: 0 2px 6px #000; }
.buffer-retry { position: absolute; top: calc(50% + 30px); min-height: 44px; padding: 0 18px; border: var(--glass-border); border-radius: 22px; color: #fff; background: #252529; pointer-events: auto; }
.playback-starting-pill { display: inline-flex; align-items: center; gap: 8px; padding: 10px 15px; border: 1px solid var(--divider); border-radius: 24px; color: #f4f7ff; background: rgb(29 40 59 / .8); box-shadow: inset 0 1px rgb(255 255 255 / .4); font-size: .77rem; }
.playback-starting-pill svg { width: 17px; height: 17px; animation: spin 1s linear infinite; }
.loading-wave { display: flex; height: 30px; align-items: center; gap: 4px; margin-bottom: 2px; }
.loading-wave i { width: 3px; height: 20px; border-radius: 5px; background: #bad2ff; animation: loading-wave 1.2s ease-in-out infinite; }
.loading-wave i:nth-child(2) { animation-delay: .12s; }
.loading-wave i:nth-child(3) { animation-delay: .24s; }
.loading-wave i:nth-child(4) { animation-delay: .36s; }
.playback-settings { display: grid; gap: 0; padding: 0 16px; }
.setting-group { min-width: 0; padding: 12px 0; border-bottom: 1px solid var(--divider); }
.setting-group:last-child { border-bottom: 0; }
.setting-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; font-size: .8rem; font-weight: 600; }
.setting-heading small { overflow: hidden; color: var(--text-tertiary); font-size: .67rem; font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
.setting-select { display: block; box-sizing: border-box; width: 100%; height: 44px; padding: 0 10px; border: 1px solid var(--divider); border-radius: 8px; color: var(--text-primary); background: var(--surface-2); font-size: 14px; }
.option-scroll { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: thin; }
.option-chip { display: inline-flex; min-height: 44px; align-items: center; justify-content: center; gap: 5px; flex: 1 0 auto; padding: 0 10px; border: 1px solid var(--divider); border-radius: 8px; color: var(--text-secondary); background: transparent; font-size: .75rem; }
.option-chip svg { width: 14px; height: 14px; }
.option-chip.active { color: var(--liquid-accent); border-color: var(--liquid-accent); background: var(--liquid-accent-subtle); font-weight: 600; }
.option-chip:disabled { opacity: .65; cursor: default; }
.automation-list { display: grid; }
.automation-row { display: flex; min-width: 0; min-height: 48px; align-items: center; gap: 12px; }
.automation-row + .automation-row { border-top: 1px solid var(--divider); }
.automation-copy { min-width: 0; flex: 1; }
.automation-copy strong { font-size: .8rem; font-weight: 500; }
.setting-switch { position: relative; width: 44px; height: 44px; flex-shrink: 0; border: 0; background: transparent; }
.setting-switch::before { content: ''; position: absolute; inset: 10px 0; border-radius: 16px; background: var(--switch-track); transition: background .15s; }
.setting-switch span { position: absolute; top: 12px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: var(--switch-knob); transition: transform .15s; }
.setting-switch[aria-checked='true']::before { background: var(--liquid-accent); }
.setting-switch[aria-checked='true'] span { transform: translateX(20px); }
.sr-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes loading-wave { 0%, 100% { opacity: .45; transform: scaleY(.45); } 50% { opacity: 1; transform: scaleY(1); } }
@media (max-width: 820px) {
  .player-header { min-height:calc(52px + var(--safe-area-top)); padding:calc(6px + var(--safe-area-top)) 16px 6px; }
  .source-badge { display: none; }
  .title-copy h1 { font-size: 1.06rem; }
  .title-copy p { font-size: .71rem; }
  .header-actions { gap: 6px; }
  .text-action { padding: 0 13px; }
  .player-layout { display:flex; flex-direction:column; gap:0; padding:0; overflow-y:auto; -webkit-overflow-scrolling:touch; }
  .video-column { flex:0 0 auto; position:sticky; top:0; z-index:6; overflow:visible; padding:0; background:#000; }
  .video-stage { min-height: 0; aspect-ratio: var(--video-ratio, 16 / 9); border-radius: 14px; border: 0; }
  .video-stage:last-child { margin-bottom: 12px; }
  .stage-state { gap: 7px; padding: 12px; background: radial-gradient(ellipse at 50% 10%, #222831, #0c1016 75%); }
  .stage-state strong { font-size: .88rem; }
  .stage-state p { font-size: .74rem; line-height: 1.45; }
  .stage-poster { display: none; }
  .stage-play-icon { width: 58px; height: 58px; }
  .stage-play-button small { font-size: .65rem; }
  .setting-select { font-size: 16px; border-radius: 12px; }
}
@media (min-width:821px) { .video-stage { max-height: calc(100dvh - 210px); } .player-fullscreen .video-stage { max-height:none; } }
.video-stage.has-player-controls { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.video-element:fullscreen { width: 100vw; height: 100vh; background: #000; }
.video-element:not(.native-fullscreen)::cue { font-size: clamp(14px, 1.8vw, 24px); }
.video-element::-webkit-media-controls { color-scheme: dark; }

@media (prefers-reduced-motion: reduce) { .loading-wave i, .playback-starting-pill svg, .setting-switch span, .setting-switch::before { transition: none; animation: none; } }
</style>

<style scoped>
/* Real container fullscreen keeps captions, gestures and controls in the same coordinate space. */
.video-column.player-fullscreen { position:relative; top:auto; z-index:auto; width:100%; height:100%; padding:0; overflow:hidden; background:#000; }
.player-fullscreen .video-stage { flex: 1 1 auto; height: 100%; min-height: 0; aspect-ratio: auto; border: 0; border-radius: 0; }
.stage-state, .play-prompt, .playback-starting { z-index: 5; }
</style>

<style scoped>
.watch-details { min-width:0; padding:0 2px 24px; }
.watch-summary { display:flex; align-items:center; gap:12px; padding:4px 0 18px; border-bottom:1px solid var(--divider); }
.watch-summary>div { flex:1; min-width:0; }.watch-summary h2 { font-size:20px; font-weight:650; line-height:1.35; overflow-wrap:anywhere; }.watch-summary p { margin-top:6px; color:var(--text-tertiary); font-size:13px; }
.collect-series { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:40px; flex-shrink:0; padding:0 6px; border:0; color:var(--text-primary); background:transparent; font:inherit; font-size:13px; cursor:pointer; }.collect-series svg { width:20px; height:20px; }.collect-series:disabled { color:var(--text-tertiary); cursor:default; }
.collect-error { font-size:12px; color:var(--danger); margin:8px 0; }.episode-placeholder { padding:36px 12px; color:var(--text-tertiary); font-size:13px; text-align:center; }
.fullscreen-episode-panel { padding:4px 14px 16px; }.fullscreen-episode-panel>.collect-series { display:flex; margin-left:auto; }
@media(max-width:820px) { .watch-details { width:100%; flex:1; padding:18px 16px calc(24px + var(--safe-area-bottom)); } .watch-summary h2 { font-size:19px; } .video-stage { border-radius:0; } .video-column :deep(.player-controls) { border-radius:0; } .player-header .title-copy h1 { font-size:15px; } .player-header .title-copy p { display:none; } }
</style>

<style scoped>
:global(html[data-theme='dark']) .player-page { --liquid-accent:#8fb8f1; --liquid-accent-strong:#a9c9f5; --liquid-accent-subtle:rgb(143 184 241 / .14); --accent-ink:#122039; }
</style>
