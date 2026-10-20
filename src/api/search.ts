import {
  cleanText,
  fetchJson,
  isRecord,
  normalizeTitle,
  ResponseSchemaError,
  withOptionalSession,
  type SessionReadOptions
} from './common.js';
import type { SubjectKind } from './subject.js';

export interface SearchItem {
  id: string;
  title: string;
  rating: string;
  year?: string;
  /** `tv` for series. */
  type?: 'movie' | 'tv';
  url: string;
  cover?: string;
  /** card_subtitle, e.g. 中国大陆 / 剧情 / 陈凯歌 / 张国荣. */
  meta?: string;
}

export interface SubjectSearchResult {
  id: string;
  title: string;
  /** movie, tv or book. */
  type: string;
  year?: string;
  rating: string;
  rating_count: number;
  /** card_subtitle, e.g. 中国大陆 / 剧情 / 陈凯歌 or 作者 / 2020 / 出版社. */
  subtitle: string;
  cover?: string;
  url: string;
}

const PAGE_SIZE = 20;

function parseSearchItem(kind: SubjectKind, item: unknown): SubjectSearchResult | null {
  if (!isRecord(item) || !isRecord(item.target)) return null;
  const type = typeof item.target_type === 'string' ? item.target_type : '';
  const accepted = kind === 'movie' ? type === 'movie' || type === 'tv' : type === 'book';
  const { target } = item;
  const id = String(target.id ?? '');
  const title = typeof target.title === 'string' ? normalizeTitle(target.title) : '';
  if (!accepted || !/^\d+$/.test(id) || !title) return null;
  const rating = isRecord(target.rating) ? target.rating : {};
  return {
    id,
    title,
    type,
    year: typeof target.year === 'string' && target.year ? target.year : undefined,
    // Douban reports unrated titles as 0.
    rating: typeof rating.value === 'number' && rating.value > 0 ? rating.value.toFixed(1) : '-',
    rating_count: typeof rating.count === 'number' ? rating.count : 0,
    subtitle: typeof target.card_subtitle === 'string' ? cleanText(target.card_subtitle) : '',
    cover: typeof target.cover_url === 'string' ? target.cover_url : undefined,
    url: `https://${kind}.douban.com/subject/${id}/`
  };
}

/**
 * Movie (including series) or book search through the mobile API. A failure
 * after the first page keeps what was read and adds a warning.
 */
export async function searchSubjects(
  kind: SubjectKind,
  keyword: string,
  start = 0,
  limit = 20,
  options: SessionReadOptions = {}
): Promise<SubjectSearchResult[]> {
  const query = keyword.trim();
  if (!query) return [];
  if (!Number.isInteger(start) || start < 0) throw new Error('start 必须是非负整数');
  if (!Number.isInteger(limit) || limit <= 0) return [];

  const results: SubjectSearchResult[] = [];
  const seen = new Set<string>();
  let cursor = start;
  while (results.length < limit) {
    const url = `https://m.douban.com/rexxar/api/v2/search/${kind}?q=${encodeURIComponent(query)}&start=${cursor}&count=${PAGE_SIZE}`;
    let data: unknown;
    try {
      data = await withOptionalSession(options, (session) => fetchJson<unknown>(url, {
        Referer: `https://m.douban.com/search/?query=${encodeURIComponent(query)}&type=${kind}`,
        ...session
      }));
      if (!isRecord(data) || !Array.isArray(data.items) || typeof data.total !== 'number') {
        throw new ResponseSchemaError('搜索接口返回格式异常', url);
      }
    } catch (error) {
      if (cursor === start) throw error;
      options.warnings?.push(`后续搜索结果读取失败，结果可能不完整：${error instanceof Error ? error.message : String(error)}`);
      break;
    }

    if (typeof data.banned === 'string' && data.banned.trim() && data.items.length === 0) {
      throw new Error(`豆瓣未返回这个关键词的搜索结果：${cleanText(data.banned)}`);
    }
    for (const item of data.items) {
      const parsed = parseSearchItem(kind, item);
      if (!parsed || seen.has(parsed.id)) continue;
      seen.add(parsed.id);
      results.push(parsed);
    }
    cursor += data.items.length;
    if (data.items.length === 0 || cursor >= data.total) break;
  }
  return results.slice(0, limit);
}

export async function searchMovies(
  keyword: string,
  start = 0,
  limit = 20,
  options: SessionReadOptions = {}
): Promise<SearchItem[]> {
  const results = await searchSubjects('movie', keyword, start, limit, options);
  return results.map((item) => ({
    id: item.id,
    title: item.title,
    rating: item.rating,
    year: item.year,
    type: item.type === 'tv' ? 'tv' : 'movie',
    url: item.url,
    cover: item.cover,
    meta: item.subtitle || undefined
  }));
}
