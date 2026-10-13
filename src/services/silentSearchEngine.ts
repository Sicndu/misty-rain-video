import type { ResourceItem, SearchResult } from '../types/search';
import { apiUrl } from './appUrl';
import { authFetch } from './authService';
import { parseLibraryInput } from './libraryFeedback';

const SEARCH_THROTTLE_MS = 300;
const REQUEST_TIMEOUT_MS = 12_000;
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_CACHE_ENTRIES = 40;

/**
 * =========================================================================
 * 夸克资源聚合检索引擎 (SilentSearchEngine)
 * =========================================================================
 */
export class SilentSearchEngine {
  private cache: Map<string, { createdAt: number; data: SearchResult }> = new Map();
  private inFlight: Map<string, Promise<SearchResult>> = new Map();
  private lastRequestTime: number = 0;

  async search(keyword: string, options: { force?: boolean } = {}): Promise<SearchResult> {
    const cleanKw = keyword
      .normalize('NFKC')
      .replace(/[《》()（）]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanKw) {
      return { success: false, total: 0, items: [], quarkItems: [], source: 'error' };
    }

    const cacheKey = cleanKw.toLocaleLowerCase('zh-CN');
    const cached = this.cache.get(cacheKey);
    if (!options.force && cached && Date.now() - cached.createdAt <= (cached.data.partial || cached.data.stale ? 5_000 : SEARCH_CACHE_TTL_MS)) {
      return { ...cached.data, fromCache: true };
    }

    const requestKey = cacheKey;
    if (this.inFlight.has(requestKey)) {
      return this.inFlight.get(requestKey)!.catch(error => this.getEmptyResult(error instanceof Error ? error.message : '资源检索失败'));
    }

    // Register the promise before the throttle waits, so concurrent requests
    // cannot pass the in-flight check and send duplicate upstream searches.
    const task = (async () => {
      const remaining = SEARCH_THROTTLE_MS - (Date.now() - this.lastRequestTime);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      this.lastRequestTime = Date.now();
      return this.executeBackendFetch(cleanKw, Boolean(options.force));
    })();
    this.inFlight.set(requestKey, task);

    try {
      const result = await task;
      if (result.success && result.items.length > 0) {
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, { createdAt: Date.now(), data: result });
        while (this.cache.size > MAX_SEARCH_CACHE_ENTRIES) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey === undefined) break;
          this.cache.delete(oldestKey);
        }
      }
      return result;
    } catch (error) {
      return this.getEmptyResult(error instanceof Error ? error.message : '资源检索失败，请稍后重试');
    } finally {
      this.inFlight.delete(requestKey);
    }
  }

  async readCached(keyword: string): Promise<SearchResult | null> {
    const params = new URLSearchParams({ kw: keyword, cached: '1' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await authFetch(`${apiUrl('/api/resource-search')}?${params}`, { cache: 'no-store', signal: controller.signal });
      const payload = await response.json();
      if (!response.ok || payload.code !== 0 || !payload.data) return null;
      const result = this.normalizeResponse(payload.data, 'direct');
      // Do not let an earlier partial client cache hide the completed server result.
      this.cache.delete(keyword.normalize('NFKC').replace(/[《》()（）]/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('zh-CN'));
      return result;
    } finally { clearTimeout(timer); }
  }

  private async executeBackendFetch(keyword: string, force: boolean): Promise<SearchResult> {
    const params = new URLSearchParams({ kw: keyword });
    if (force) params.set('refresh', '1');
    const targetUrl = `${apiUrl('/api/resource-search')}?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await authFetch(targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || json.code !== 0 || !json.data) {
        throw new Error(json.message || '资源检索服务暂时不可用');
      }
      return this.normalizeResponse(json.data, 'direct');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('资源检索超时，请稍后重试');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeResponse(data: any, sourceMode: 'direct' | 'cors_proxy'): SearchResult {
    const items: ResourceItem[] = [];
    const seen = new Set<string>();
    const list = Array.isArray(data?.merged_by_type?.quark) ? data.merged_by_type.quark : [];
    list.forEach((raw: any) => {
      const item = this.parseSingleItem(raw);
      if (!item || seen.has(item.url)) return;
      seen.add(item.url);
      items.push(item);
    });

    items.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

    return {
      success: true,
      total: items.length,
      items,
      quarkItems: items,
      source: sourceMode,
      stale: Boolean(data.stale),
      partial: Boolean(data.partial),
      refreshing: Boolean(data.refreshing),
      ...(data.message ? { message: String(data.message) } : {})
    };
  }

  private parseSingleItem(raw: any): ResourceItem | null {
    const note = String(raw.note || raw.title || '可用影视资源');
    const share = parseLibraryInput(`${String(raw.url || '')}\n${note}`);
    if (share.kind !== 'share') return null;
    const canonicalUrl = share.url;
    const is4k = /4k|2160p|uhd|杜比|hdr/i.test(note);
    const is1080p = /1080p|fhd|蓝光/i.test(note);
    const quality = is4k ? '4K 超高清' : (is1080p ? '1080P 超清' : '清晰度待解析');
    const rawDatetime = String(raw.datetime || '').trim();
    const parsedDatetime = Date.parse(rawDatetime);
    const year = Number.isFinite(parsedDatetime) ? new Date(parsedDatetime).getFullYear() : 0;
    const datetime = year >= 2001 ? rawDatetime.substring(0, 10) : '近期收录';

    return {
      id: `quark-${canonicalUrl.split('/').pop()}`,
      title: note,
      url: canonicalUrl,
      password: raw.password || share.passcode,
      driveType: 'quark',
      datetime,
      source: raw.source || 'PanSou 聚合分析',
      quality,
      is4k
    };
  }

  private getEmptyResult(message = ''): SearchResult {
    return {
      success: false,
      total: 0,
      items: [],
      quarkItems: [],
      source: 'error',
      ...(message ? { message } : {})
    };
  }
}
