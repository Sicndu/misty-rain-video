import type Hls from 'hls.js';
export interface SubtitleTrackOption { id: string; label: string; language: string; origin: string; }
const caption = (track: TextTrack) => track.kind === 'subtitles' || track.kind === 'captions';
export const managedSubtitleTracks = new WeakMap<TextTrack, { active: boolean; origin: string; ready?: boolean }>();
export const subtitleLanguageKey = (language: string) => /^(zh|chi|zho)/i.test(language) ? 'zh' : /^en(g)?$/i.test(language) ? 'en' : language.toLowerCase();
export const centerSubtitleCue = (cue: VTTCue) => {
  if (cue.align !== 'center') cue.align = 'center';
  if (cue.position !== 50) cue.position = 50;
  if (cue.size !== 90) cue.size = 90;
  if (!cue.snapToLines) cue.snapToLines = true;
  if (cue.line !== 'auto') cue.line = 'auto';
  if ('positionAlign' in cue && cue.positionAlign !== 'center') cue.positionAlign = 'center';
};
export const subtitleTrackOptions = (video: HTMLVideoElement, hls?: Hls | null): SubtitleTrackOption[] => {
  const options: SubtitleTrackOption[] = (hls?.subtitleTracks || []).map((track, index) => ({
    id: `hls:${index}`, label: `${track.name || track.lang || `字幕 ${index + 1}`} · 流媒体`, language: track.lang || '', origin: 'hls'
  }));
  Array.from(video.textTracks).forEach((track, index) => {
    if (!caption(track)) return;
    const managed = managedSubtitleTracks.get(track);
    if (managed?.active === false || managed?.ready === false) return;
    const element = Array.from(video.querySelectorAll('track')).find(item => item.track === track);
    // Prefer normalized text over the container's native tx3g positioning. The
    // same available languages remain selectable, without duplicate entries.
    if (!element && !managed && Array.from(video.textTracks).some(other => managedSubtitleTracks.get(other)?.active && managedSubtitleTracks.get(other)?.ready !== false && subtitleLanguageKey(other.language) === subtitleLanguageKey(track.language))) return;
    if (!element?.dataset.subtitleOrigin && hls?.subtitleTracks.some(item => item.name === track.label && (item.lang || '') === track.language)) return;
    options.push({ id: `native:${index}`, label: track.label || track.language || `字幕 ${index + 1}`, language: track.language || '', origin: managed?.origin || element?.dataset.subtitleOrigin || 'embedded' });
  });
  return options;
};
export const activeSubtitleTrack = (video: HTMLVideoElement, hls?: Hls | null): string => {
  if (hls?.subtitleDisplay && hls.subtitleTrack >= 0) return `hls:${hls.subtitleTrack}`;
  const options = subtitleTrackOptions(video, hls);
  const showing = Array.from(video.textTracks).map((track,index) => ({ track, id: `native:${index}` })).filter(item => caption(item.track) && item.track.mode === 'showing');
  const selectable = showing.find(item => options.some(option => option.id === item.id));
  if (selectable) return selectable.id;
  return showing[0]?.id || 'off';
};
export const setSubtitleDefaults = (video: HTMLVideoElement, id: string) => {
  Array.from(video.querySelectorAll('track')).forEach(element => {
    const selected = id.startsWith('native:') && element.track === video.textTracks[Number(id.slice(7))];
    if (element.default !== selected) element.default = selected;
  });
};
export const selectSubtitleTrack = (video: HTMLVideoElement, hls: Hls | null | undefined, id: string) => {
  if (id !== 'off' && !subtitleTrackOptions(video, hls).some(track => track.id === id)) return false;
  if (hls) { hls.subtitleDisplay = false; hls.subtitleTrack = -1; }
  Array.from(video.textTracks).filter(caption).forEach(track => { if (managedSubtitleTracks.get(track)?.ready !== false && track.mode !== 'disabled') track.mode = 'disabled'; });
  setSubtitleDefaults(video, id);
  if (id.startsWith('hls:') && hls) { hls.subtitleTrack = Number(id.slice(4)); hls.subtitleDisplay = true; }
  else if (id.startsWith('native:')) video.textTracks[Number(id.slice(7))].mode = 'showing';
  return true;
};

export const subtitlePreferenceKey = (username = 'guest') => `misty_rain_subtitles:${encodeURIComponent(username || 'guest')}`;
export const subtitlePreference = (option?: SubtitleTrackOption) => !option ? 'off' : `${option.origin}:${option.language && option.language !== 'und' ? `language:${option.language}` : `label:${option.label}`}`;
export const subtitleEvents = (hls: Hls) => {
  const events = (hls.constructor as typeof Hls).Events;
  return [events.SUBTITLE_TRACKS_UPDATED, events.SUBTITLE_TRACK_SWITCH, events.SUBTITLE_TRACKS_CLEARED];
};
