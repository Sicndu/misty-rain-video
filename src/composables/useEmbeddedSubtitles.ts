import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import { authFetch } from '../services/authService';
import { withAppBase } from '../services/appUrl';
import { managedSubtitleTracks, centerSubtitleCue } from '../services/subtitleTracks';

interface SubtitleWindow {
  from: number; to: number;
  tracks: Array<{ id: string; label: string; language: string; cues: Array<{ start: number; end: number; text: string }> }>;
}

/** Browser MP4 decoders do not consistently expose tx3g. Load text near the
 * playhead independently of video delivery, including native iOS fullscreen. */
export function useEmbeddedSubtitles(videoRef: Ref<HTMLVideoElement | null>, endpoint: () => string | undefined) {
  const loading = ref(false), error = ref('');
  let release = () => {}, retry = () => {};
  watch([videoRef, endpoint], ([video, url]) => {
    release(); loading.value = false; error.value = '';
    if (!video || !url || typeof video.addTextTrack !== 'function') return;
    const controller = new AbortController(), tracks = new Map<string, TextTrack>();
    const loaded = new Set<number>();
    let busy = false, stopped = false, found: boolean | undefined;
    const announce = () => video.dispatchEvent(new Event('subtitletracksupdated'));
    const read = async (force = false) => {
      if (stopped || busy || found === false || (!force && error.value)) return;
      const current = Math.max(0, video.currentTime || 0);
      const bucket = Math.floor(current / 90);
      const wanted = loaded.has(bucket) && current % 90 >= 75 ? bucket + 1 : bucket;
      if (loaded.has(wanted)) return;
      busy = true; loading.value = true;
      try {
        const response = await authFetch(`${withAppBase(url)}?time=${wanted * 90}`, { signal: controller.signal });
        if (!response.ok) throw new Error('字幕读取失败');
        const json = await response.json();
        if (stopped) return;
        if (json.code !== 0 || !Array.isArray(json.data?.tracks)) throw new Error('字幕读取失败');
        const data = json.data as SubtitleWindow;
        found = data.tracks.length > 0;
        for (const item of data.tracks) {
          let track = tracks.get(item.id);
          if (!track) {
            track = video.addTextTrack('subtitles', item.label, item.language);
            managedSubtitleTracks.set(track, { active: true, origin: 'embedded' });
            track.mode = 'hidden'; tracks.set(item.id, track);
          }
          // CueList is unavailable in disabled mode. Keep loading independent
          // of the user's on/off choice, then restore that choice before paint.
          const mode = track.mode; track.mode = 'hidden';
          for (const cue of Array.from(track.cues || [])) {
            if (cue.endTime < current - 180 || cue.startTime > current + 270) track.removeCue(cue);
          }
          const existing = new Set(Array.from(track.cues || []).map(cue => `${cue.startTime}:${cue.endTime}`));
          for (const itemCue of item.cues) {
            if (existing.has(`${itemCue.start}:${itemCue.end}`)) continue;
            const text = itemCue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const cue = new VTTCue(itemCue.start, itemCue.end, text);
            centerSubtitleCue(cue); track.addCue(cue);
          }
          track.mode = mode;
        }
        loaded.add(wanted);
        for (const key of loaded) if (key < bucket - 1 || key > bucket + 2) loaded.delete(key);
        error.value = ''; announce();
      } catch {
        if (!stopped) error.value = '内嵌字幕暂时读取失败';
      } finally {
        if (!stopped) {
          busy = false; loading.value = false;
          // A seek may finish while the previous range is loading.
          if (!error.value && Math.floor(video.currentTime / 90) !== bucket) void read();
        }
      }
    };
    const update = () => { void read(); };
    retry = () => { error.value = ''; void read(true); };
    ['loadedmetadata', 'seeked', 'timeupdate'].forEach(event => video.addEventListener(event, update));
    void read();
    release = () => {
      stopped = true; controller.abort();
      ['loadedmetadata', 'seeked', 'timeupdate'].forEach(event => video.removeEventListener(event, update));
      for (const track of tracks.values()) {
        managedSubtitleTracks.set(track, { active: false, origin: 'embedded' });
        track.mode = 'hidden';
        for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
        track.mode = 'disabled';
      }
    };
  }, { immediate: true, flush: 'post' });
  onBeforeUnmount(() => release());
  return { loading, error, retry: () => retry() };
}
