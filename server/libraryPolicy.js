// Pure identity rules shared by storage and background source maintenance.
const chineseNumbers = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
export const seasonNumber = value => {
  const text = String(value || '').normalize('NFKC');
  const number = text.match(/(?:^|[^a-z])s(\d{1,2})(?=e\d|[^a-z0-9]|$)/i)?.[1]
    || text.match(/第\s*(\d{1,2}|[一二三四五六七八九十])\s*季/)?.[1];
  return Number(number) || chineseNumbers[number] || 0;
};

export const episodeKey = (episode, defaultSeason = 1) => episode.episodeNumber > 0
  ? `episode:${episode.seasonNumber || defaultSeason}:${episode.episodeNumber}:${episode.episodePart || ''}`
  : `file:${String(episode.fileName || '').normalize('NFKC').toLowerCase()}:${Number(episode.size) || 0}`;

export const missingLibraryEpisodes = (local, source, card) => {
  // A saved movie is kept as-is; an alternative encode is not a new episode.
  if (card.category === 'movie' && local.length) return [];
  const season = seasonNumber(card.title) || 1;
  const saved = new Set(local.map(item => episodeKey(item, season)));
  return source.filter(item => !saved.has(episodeKey(item, season)));
};

export const libraryVideoName = (episode, category) => {
  const extension = String(episode.fileName || '').match(/\.[a-z0-9]{2,5}$/i)?.[0] || '';
  // Unnumbered specials/movies retain their names so identity survives a restart.
  if (category === 'movie' || !episode.episodeNumber || !extension) return episode.fileName;
  const season = episode.seasonNumber ? `第${String(episode.seasonNumber).padStart(2, '0')}季 ` : '';
  const part = episode.episodePart ? `（${episode.episodePart}）` : '';
  return `${season}第${String(episode.episodeNumber).padStart(2, '0')}集${part}${extension}`;
};

export const isAncillaryVideoPath = value => String(value || '').split('/').some(part =>
  /(?:^|[\s._\-【\[(（])(?:预告片?|花絮|幕后花絮|宣传片|广告|推广|片头|片尾|资源说明)(?=[\s._\-】\])）\d]|$)/.test(part));

const cleanTitle = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[\s·:：_.,，。《》【】\[\]()（）-]/g, '');
const titleMatches = (title, value) => {
  const expected = cleanTitle(title);
  const actual = cleanTitle(value);
  if (expected.length < 2 || !actual.startsWith(expected)) return false;
  // Only known release descriptors may follow an exact title. A sequel, other
  // season, or mixed collection must not pass a substring match.
  return /^(?:(?:19|20)\d{2}|4k|1080p|2160p|720p|高清|超清|蓝光|原盘|中字|国语|粤语|双语|简繁|无水印|全集|完结|更新至?\d+集?|全\d+集|\d+集|h26[45]|hevc|webdl|web|aac|mkv|mp4)*$/i
    .test(actual.slice(expected.length));
};

export const validateSourceCandidate = ({ card, shareTitle, episodes, localEpisodes }) => {
  if (!episodes.length || !localEpisodes.length) return false;
  const evidence = [shareTitle, ...episodes.map(item => item.sourcePath?.split('/')[0]).filter(Boolean)];
  if (!evidence.some(value => titleMatches(card.title, value))) return false;
  const targetYear = String(card.year || card.title.match(/(?:19|20)\d{2}/)?.[0] || '');
  const years = String(shareTitle || '').match(/(?:19|20)\d{2}/g) || [];
  if (targetYear && years.some(year => year !== targetYear)) return false;
  const season = seasonNumber(card.title) || 1;
  if (episodes.some(item => item.seasonNumber && item.seasonNumber !== season)) return false;
  if (seasonNumber(shareTitle) && seasonNumber(shareTitle) !== season) return false;
  for (const episode of episodes) {
    const name = String(episode.fileName || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    const prefix = name.split(/s\d{1,2}e\d|(?:ep?|episode)[\s._-]*\d|第\s*\d+\s*[集话期]|^\d+/i)[0];
    if (cleanTitle(prefix) && !titleMatches(card.title, prefix)) return false;
    // Each directory must identify this work or a release/season descriptor.
    // A correct root title does not make unrelated nested works safe.
    for (const part of String(episode.sourcePath || '').split('/').filter(Boolean)) {
      if (!titleMatches(card.title, part)
        && !/^(?:s\d{1,2}|第[\d一二三四五六七八九十]+季|4k|1080p|2160p|720p|高清|超清|正片|国语|粤语|全集|完结)+$/i.test(cleanTitle(part))) return false;
    }
  }
  // Without episode identity, automatic association is too ambiguous.
  if (card.category === 'movie' || episodes.some(item => !item.episodeNumber)
    || localEpisodes.some(item => !item.episodeNumber)) return false;
  const available = new Set(episodes.map(item => episodeKey(item, season)));
  return localEpisodes.every(item => available.has(episodeKey(item, season)));
};
