import { seasonNumber } from './libraryPolicy.js';
const subtitleExtensions = /\.(?:srt|vtt|ass|ssa|sub|idx)$/i;
export const isSubtitleFile = item => item?.file_type !== 0 && !item?.dir && subtitleExtensions.test(item?.file_name || item?.name || '');
export const isTextSubtitleFile = item => item?.file_type !== 0 && !item?.dir && /\.(?:srt|vtt|ass|ssa)$/i.test(item?.file_name || item?.name || '');
export const subtitleLanguage = name => {
  const text = String(name || '').toLowerCase();
  if (/(?:zh[-_.]?hans|chs|简体|简中)/.test(text)) return 'zh-Hans';
  if (/(?:zh[-_.]?hant|cht|繁体|繁中)/.test(text)) return 'zh-Hant';
  if (/(?:^|[._ -])(?:en|eng|english)(?:[._ -]|$)/.test(text)) return 'en';
  if (/(?:^|[._ -])(?:zh|chi|chinese)(?:[._ -]|$)|中文/.test(text)) return 'zh';
  return 'und';
};
const stem = name => String(name || '').normalize('NFKC').toLowerCase().replace(/\.[^.]+$/, '');
const episodeKey = name => {
  const match = String(name).match(/s(\d{1,2})[._ -]*e(\d{1,4})/i);
  if (match) return `s${Number(match[1])}e${Number(match[2])}`;
  const episode = String(name).match(/(?:第\s*(\d+)\s*集|(?:ep?|episode)[._ -]*(\d+))/i);
  return episode ? `s${seasonNumber(name) || 1}e${Number(episode[1] || episode[2])}` : '';
};
export const subtitleMatches = (videoName, subtitleName) => {
  const video = stem(videoName); const subtitle = stem(subtitleName);
  if (subtitle === video || (subtitle.startsWith(video) && /^[._ -]/.test(subtitle.slice(video.length)))) return true;
  const videoEpisode = episodeKey(videoName); const subtitleEpisode = episodeKey(subtitleName);
  return Boolean(videoEpisode && videoEpisode === subtitleEpisode);
};

export const subtitleMatchesVideo = (videoName, subtitleName, onlyVideo = false) => {
  if (subtitleMatches(videoName, subtitleName)) return true;
  if (episodeKey(videoName) && episodeKey(subtitleName)) return false;
  return onlyVideo;
};

/** Include companions without replacing the user's selected directory scope. */
export const includeSubtitleCompanions = (entries, selected) => {
  const ids = new Set(selected.map(item => item.fid));
  const byId = new Map(entries.map(item => [item.fid, item]));
  const videoFile = item => item.file_type !== 0 && !item.dir && /\.(?:mp4|mkv|m4v|mov|webm|avi|ts|flv|wmv|mpeg|mpg)$/i.test(item.file_name || '');
  const videos = selected.filter(videoFile);
  for (const video of videos) {
    const parent = video.parentFid || video.pdir_fid || '0';
    const siblings = entries.filter(item => (item.parentFid || item.pdir_fid || '0') === parent);
    const onlyVideo = siblings.filter(videoFile).length === 1;
    for (const item of entries.filter(isSubtitleFile)) {
      const sameFolder = (item.parentFid || item.pdir_fid || '0') === parent;
      const ancestors = item.ancestorFids || [];
      const parentIndex = parent === '0' ? -1 : ancestors.indexOf(parent);
      const relative = ancestors.slice(parentIndex + 1);
      const subtitleFolder = (parent === '0' || parentIndex >= 0) && relative.length > 0 && relative.length <= 2
        && /^(?:subs?|subtitles?|.*字幕.*)$/i.test(byId.get(relative[0])?.file_name || '');
      if ((sameFolder || subtitleFolder) && subtitleMatchesVideo(video.file_name, item.file_name, onlyVideo)) ids.add(item.fid);
    }
  }
  return entries.filter(item => ids.has(item.fid) && !(item.ancestorFids || []).some(fid => ids.has(fid)));
};

export const decodeSubtitle = bytes => {
  const buffer = Buffer.from(bytes);
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { return new TextDecoder('gb18030').decode(buffer); }
};
const timestamp = value => {
  const match = String(value).trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) return null;
  return ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000
    + Number(match[4].padEnd(3, '0'));
};
const clock = ms => {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
};
const plainText = value => value.replace(/\{\\[^}]*\}/g, '').replace(/<[^>]*>/g, '')
  .replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const subtitleToVtt = (input, filename = '') => {
  const text = String(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  const add = (start, end, content) => {
    const from = timestamp(start); const to = timestamp(end);
    if (from !== null && to !== null && to > from && content.trim()) cues.push(`${clock(from)} --> ${clock(to)}\n${plainText(content).trim()}`);
  };
  if (/\.(?:ass|ssa)$/i.test(filename) || /^\s*\[Script Info\]/i.test(text)) {
    let format = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    let inEvents = false;
    for (const line of text.split('\n')) {
      if (/^\s*\[/.test(line)) inEvents = /^\s*\[Events\]/i.test(line);
      if (!inEvents) continue;
      if (/^Format:/i.test(line)) format = line.slice(7).split(',').map(value => value.trim().toLowerCase());
      if (/^Dialogue:/i.test(line)) {
        const fields = line.slice(9).split(',');
        const contentIndex = format.indexOf('text');
        if (contentIndex >= 0) add(fields[format.indexOf('start')], fields[format.indexOf('end')], fields.slice(contentIndex).join(','));
      }
    }
  } else {
    for (const block of text.split(/\n[ \t]*\n/)) {
      const lines = block.trim().split('\n');
      const index = lines.findIndex(line => line.includes('-->'));
      if (index < 0 || /^NOTE(?:\s|$)/.test(lines[0])) continue;
      const [start, end] = lines[index].split('-->').map(part => part.trim().split(/\s/)[0]);
      add(start, end, lines.slice(index + 1).join('\n'));
    }
  }
  if (!cues.length) throw Object.assign(new Error('字幕文件中没有可识别的时间轴，支持VTT、SRT、ASS和SSA文本字幕'), {
    code: 'SUBTITLE_FORMAT_UNSUPPORTED', statusCode: 422
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
};
