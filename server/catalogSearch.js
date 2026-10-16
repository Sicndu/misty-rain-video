import { isDiscoveryImageUrl, ratingCount } from './discoverySources.js';

const text = (value, max = 180) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const failure = () => Object.assign(new Error('影片信息暂时无法加载，可以直接搜索资源'), { code: 'CATALOG_UNAVAILABLE', statusCode: 503 });

export function normalizeCatalogSearch(payload) {
  if (!Array.isArray(payload?.subjects?.items) || payload.banned) throw failure();
  const items = new Map();
  for (const row of payload.subjects.items) {
    const item = row?.target, type = row?.target_type;
    if (!['movie', 'tv'].includes(type) || !/^[1-9]\d{0,12}$/.test(String(item?.id || ''))) continue;
    const title = text(item.title, 120); if (!title) continue;
    const description = text(item.card_subtitle);
    const category = /动画|动漫/.test(description) ? 'anime'
      : type === 'tv' && /真人秀|脱口秀|综艺/.test(description) ? 'variety' : type;
    const imageUrl = text(item.cover_url, 2048).replace(/^http:/, 'https:');
    const score = Number(item.rating?.value);
    const entry = { id: `douban-${item.id}`, provider: 'douban', title, category,
      ratingCount: ratingCount(item.rating?.count),
      year: /^(19|20)\d{2}$/.test(String(item.year)) ? String(item.year) : '',
      rating: score > 0 && score <= 10 && item.rating?.count !== 0 ? Math.round(score * 10) / 10 : null,
      subtitle: item.null_rating_reason === '尚未播出' ? '尚未播出' : '', description,
      imageUrl: isDiscoveryImageUrl(imageUrl, 'douban') ? imageUrl : '',
      sourceUrl: `https://movie.douban.com/subject/${item.id}/` };
    items.set(entry.id, entry);
  }
  return [...items.values()].slice(0, 30);
}

export class CatalogSearch {
  constructor({ discovery, fetcher = fetch, now = Date.now }) {
    this.discovery = discovery; this.fetcher = fetcher; this.now = now;
    this.cache = new Map(); this.pending = new Map();
  }
  async search(query) {
    const keyword = typeof query === 'string' ? query.trim().replace(/\s+/g, ' ') : '';
    if (!keyword || keyword.length > 100 || /https?:\/\//i.test(keyword)) throw Object.assign(new Error('请输入100字以内的片名'), { statusCode: 400 });
    const key = keyword.normalize('NFKC').toLowerCase(), cached = this.cache.get(key);
    if (cached && cached.until > this.now()) { this.discovery.registerCatalogItems(cached.items); return { items: this.publicItems(cached.items) }; }
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size >= 4) throw failure();
    const task = this.load(keyword).then(results => {
      // The public search can lag a current season already in Douban's charts.
      const merged = new Map();
      for (const item of [...results, ...(this.discovery.matchingCatalogItems?.(keyword) || [])]) {
        const previous = merged.get(item.id);
        merged.set(item.id, { ...previous, ...item, ratingCount: item.ratingCount ?? previous?.ratingCount ?? null });
      }
      const items = [...merged.values()].slice(0, 30);
      this.cache.delete(key); this.cache.set(key, { items, until: this.now() + 10 * 60_000 });
      if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
      this.discovery.registerCatalogItems(items);
      return { items: this.publicItems(items) };
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  publicItems(items) { return items.map(({ imageUrl, ...item }) => ({ ...item, poster: imageUrl ? `/api/discovery/posters/${item.id}` : '' })); }
  async load(keyword) {
    try {
      const response = await this.fetcher(`https://m.douban.com/rexxar/api/v2/search?type=movie&q=${encodeURIComponent(keyword)}`, {
        signal: AbortSignal.timeout(8000), redirect: 'error',
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.douban.com/search/' }
      });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw failure(); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) throw failure(); chunks.push(chunk); }
      return normalizeCatalogSearch(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch { throw failure(); }
  }
}
