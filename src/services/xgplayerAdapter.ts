import Player from 'xgplayer/es/player';
import Plugin from 'xgplayer/es/plugin/plugin';
import OptionsIcon from 'xgplayer/es/plugins/common/optionsIcon';
import Play from 'xgplayer/es/plugins/play';
import Progress from 'xgplayer/es/plugins/progress';
import Time from 'xgplayer/es/plugins/time';
import Volume from 'xgplayer/es/plugins/volume';
import Fullscreen from 'xgplayer/es/plugins/fullscreen';
import PlaybackRate from 'xgplayer/es/plugins/playbackRate';
import Pip from 'xgplayer/es/plugins/pip';
import Mobile from 'xgplayer/es/plugins/mobile';
import PC from 'xgplayer/es/plugins/pc';
import Keyboard from 'xgplayer/es/plugins/keyboard';
import I18N from 'xgplayer/es/lang/i18n';
import zh from 'xgplayer/es/lang/zh-cn';
import type { PlaybackSource } from './quarkStreamService';

I18N.use(zh);
const escapeText = (text: string) => text.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]!);

type QualityOption = { id: string; text: string; selected: boolean; showText?: string };

/** Reuse xgplayer's option UI, while the business owner handles signed URLs and resume. */
class SourceQuality extends OptionsIcon {
  static get pluginName() { return 'sourcequality'; }
  static get defaultConfig() { return { ...OptionsIcon.defaultConfig, position: Plugin.POSITIONS.CONTROLS_RIGHT, index: 3, className: 'xgplayer-definition', isShowIcon: true, hidePortrait: false, toggleMode: 'click', isItemClickHide: true, list: [] }; }
  renderItemList(items: QualityOption[] = this.config.list, index = Math.max(0, items.findIndex(item => item.selected))) {
    super.renderItemList(items.map(item => ({ ...item, showText: item.text })), index);
    const list = this.optionsList?.root as HTMLElement | undefined;
    list?.setAttribute('role', 'listbox'); list?.setAttribute('aria-label', '清晰度选择');
    list?.querySelectorAll('li').forEach((element, i) => {
      element.setAttribute('role', 'option'); element.setAttribute('aria-selected', String(items[i]?.selected)); element.tabIndex = 0;
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); this.onItemClick(event, { to: items[i]! }); }
      });
    });
  }
  onItemClick(event: Event, data: { to: { id: string } }) {
    event.stopPropagation();
    this.toggle(false);
    this.player.emit('sourcequalityrequest', data.to.id);
  }
}
class BusinessTools extends Plugin {
  static get pluginName() { return 'businesstools'; }
  static get defaultConfig() { return { position: Plugin.POSITIONS.CONTROLS_RIGHT, index: 2 }; }
  render() { return '<div class="misty-player-tools"></div>'; }
}

export function createDirectPlayer(root: HTMLElement, video: HTMLVideoElement, options: {
  fullscreen: () => void;
  quality: (id: string) => void;
  feedback: (message: string) => void;
}) {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const player = new Player({
    el: root, mediaEl: video, width: '100%', height: 'auto', lang: 'zh-cn',
    videoInit: false, autoplay: false, seekedStatus: 'auto', volume: video.volume, defaultPlaybackRate: video.playbackRate,
    remainMediaAfterDestroy: true, fullscreenTarget: root.parentElement!, cssFullscreen: false, closeVideoDblclick: true,
    controls: { mode: 'normal', autoHide: true, initShow: true },
    fullscreen: { useCssFullscreen: false, rotateFullscreen: false, switchCallback: options.fullscreen },
    playbackRate: { list: [.5, .75, 1, 1.25, 1.5, 2], hidePortrait: false, toggleMode: 'click', isItemClickHide: true },
    pip: { showIcon: true, preferDocument: false },
    commonStyle: { playedColor: '#8fb8f1', cachedColor: '#ffffff55', sliderBtnStyle: { background: '#fff' } },
    mobile: { gestureY: false, darkness: false, disablePress: true },
    // Install only UI plugins. No MSE engine, network speed test, relay or second subtitle renderer.
    plugins: [Play, Progress, Time, Volume, Fullscreen, PlaybackRate, Pip, SourceQuality, BusinessTools, ...(mobile ? [Mobile] : [PC, Keyboard])],
  });
  // Vue owns the media element and the sole direct-URL attachment pipeline.
  player.handleSource = false;
  void Promise.resolve(player.start()).catch(() => options.feedback('播放器加载失败，请重新打开影片'));
  player.on('sourcequalityrequest', options.quality);
  const mobilePlugin = player.plugins.mobile as Mobile | undefined;
  mobilePlugin?.useHooks('videoDbClick', (_plugin, data: { e: TouchEvent | MouseEvent }) => {
    const point = 'changedTouches' in data.e ? data.e.changedTouches[0] : data.e;
    const rect = root.getBoundingClientRect();
    const position = rect.width && point ? (point.clientX - rect.left) / rect.width : .5;
    if (position >= .4 && position <= .6) return true;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      const delta = position < .4 ? -10 : 10;
      video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta));
      options.feedback(delta < 0 ? '后退 10 秒' : '快进 10 秒');
    }
    player.focus();
    return false;
  });
  // Core icons are custom elements; expose the same controls to keyboard/AT users.
  const iconLabels: Record<string, string> = { play: '播放或暂停', fullscreen: '全屏播放', playbackrate: '播放速度', pip: '画中画', sourcequality: '选择画质', volume: '音量' };
  for (const [name, label] of Object.entries(iconLabels)) {
    const icon = player.plugins[name]?.root as HTMLElement | undefined;
    if (!icon) continue;
    icon.setAttribute('role', 'button'); icon.setAttribute('aria-label', label); icon.tabIndex = 0;
    icon.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation();
      if (name === 'sourcequality' || name === 'playbackrate') {
        const plugin = player.plugins[name] as OptionsIcon;
        plugin.toggle(!plugin.isActive);
      } else icon.click();
    });
  }
  const qualities = player.plugins.sourcequality as SourceQuality;
  return {
    player,
    tools: player.plugins.businesstools.root as HTMLElement,
    canPip: Boolean((player.plugins.pip as Pip).isPIPAvailable()),
    togglePip() { (player.plugins.pip as Pip).switchPIP(new Event('click')); },
    setFullscreen(active: boolean) {
      (player.plugins.fullscreen as Fullscreen).animate(active);
      player.plugins.fullscreen.root?.setAttribute('aria-label', active ? '退出全屏' : '全屏播放');
    },
    setQualities(sources: PlaybackSource[], id: string) {
      const list = sources.filter(source => source.delivery === 'direct').map(source => ({
        id: source.id, text: escapeText(source.resolution === 'original' ? '原画' : source.label), selected: source.id === id,
      }));
      qualities.config.list = list;
      qualities.renderItemList(list);
      list.length > 1 ? qualities.show() : qualities.hide();
    },
    destroy() { player.destroy(); },
  };
}
