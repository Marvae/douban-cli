import { cleanText, fetchJson, isRecord, normalizeTitle, ResponseSchemaError } from './common.js';

/** The three tabs of Douban's 实时热门 page: 书影音 (all), 电影榜 and 电视榜. */
export type TrendingChart = 'all' | 'movie' | 'tv';

const COLLECTIONS: Record<TrendingChart, string> = {
  all: 'subject_real_time_hotest',
  movie: 'movie_real_time_hotest',
  tv: 'tv_real_time_hotest'
};

/** The chart's own size; Douban returns no more than this. */
export const TRENDING_LIMIT = 20;

const SUBJECT_HOSTS: Record<string, string> = {
  movie: 'movie.douban.com',
  tv: 'movie.douban.com',
  book: 'book.douban.com',
  music: 'music.douban.com'
};

export interface TrendingItem {
  rank: number;
  id: string;
  title: string;
  /** movie, tv, book or music. */
  type: string;
  /** Douban's label: 电影, 电视剧, 综艺… */
  type_name: string;
  year: string;
  /** '-' when unrated. */
  rating: string;
  /** Why there is no rating, such as 暂无评分; empty when rated. */
  rating_note: string;
  /** Douban's heat score; higher is hotter. */
  heat: number;
  /** `up 1`, `down 2`, `stay` or `new`. */
  trend: string;
  /** card_subtitle: year / region / genres / director / cast. */
  meta: string;
  url: string;
  cover: string;
}

export interface TrendingResult {
  chart: TrendingChart;
  name: string;
  /**
   * The chart's `updated_at` as Douban reports it (Beijing time). For the
   * 书影音 chart it can lag the items by hours, so treat it as a hint.
   */
  updated_at: string;
  items: TrendingItem[];
}

function trendOf(item: Record<string, unknown>): string {
  if (item.is_new === true) return 'new';
  const changed = typeof item.rank_value_changed === 'number' && Number.isFinite(item.rank_value_changed)
    ? Math.abs(Math.trunc(item.rank_value_changed))
    : 0;
  if (item.trend_up === true && changed > 0) return `up ${changed}`;
  if (item.trend_down === true && changed > 0) return `down ${changed}`;
  return 'stay';
}

function subjectUrl(type: string, id: string, fallback: unknown): string {
  const host = SUBJECT_HOSTS[type];
  if (host) return `https://${host}/subject/${id}/`;
  return typeof fallback === 'string' && /^https:\/\/([\w-]+\.)*douban\.com\//.test(fallback) ? fallback : '';
}

function parseTrendingItem(item: unknown, index: number): TrendingItem | null {
  if (!isRecord(item)) return null;
  const id = String(item.id ?? '');
  const title = typeof item.title === 'string' ? normalizeTitle(item.title) : '';
  if (!/^\d+$/.test(id) || !title) return null;
  const type = typeof item.type === 'string' ? item.type : '';
  const rating = isRecord(item.rating) ? item.rating : {};
  const rated = typeof rating.value === 'number' && Number.isFinite(rating.value) && rating.value > 0;
  const rank = typeof item.rank_value === 'number' && item.rank_value > 0
    ? Math.trunc(item.rank_value)
    : typeof item.rank === 'number' && item.rank > 0 ? Math.trunc(item.rank) : index + 1;
  const cover = isRecord(item.cover) && typeof item.cover.url === 'string'
    ? item.cover.url
    : isRecord(item.pic) && typeof item.pic.normal === 'string' ? item.pic.normal : '';
  return {
    rank,
    id,
    title,
    type,
    type_name: typeof item.type_name === 'string' ? cleanText(item.type_name) : '',
    year: typeof item.year === 'string' || typeof item.year === 'number' ? String(item.year) : '',
    rating: rated ? (rating.value as number).toFixed(1) : '-',
    rating_note: !rated && typeof item.null_rating_reason === 'string' ? cleanText(item.null_rating_reason) : '',
    heat: typeof item.score === 'number' && Number.isFinite(item.score) && item.score > 0 ? Math.trunc(item.score) : 0,
    trend: trendOf(item),
    meta: typeof item.card_subtitle === 'string' ? cleanText(item.card_subtitle) : '',
    url: subjectUrl(type, id, item.url),
    cover
  };
}

/** Douban's real-time hot chart (实时热门), refreshed hourly. */
export async function getTrending(chart: TrendingChart = 'all', limit = TRENDING_LIMIT): Promise<TrendingResult> {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit 必须是正整数');
  const collection = COLLECTIONS[chart];
  const url = `https://m.douban.com/rexxar/api/v2/subject_collection/${collection}/items?start=0&count=${Math.min(limit, TRENDING_LIMIT)}`;
  const data = await fetchJson<unknown>(url, { Referer: `https://m.douban.com/subject_collection/${collection}` });
  if (!isRecord(data) || !Array.isArray(data.subject_collection_items)) {
    throw new ResponseSchemaError('实时热门接口返回格式异常', url);
  }
  const items = data.subject_collection_items.map(parseTrendingItem);
  if (items.some((item) => item === null)) throw new ResponseSchemaError('实时热门包含无效条目', url);
  if (items.length === 0) throw new ResponseSchemaError('实时热门没有返回条目', url);
  const meta = isRecord(data.subject_collection) ? data.subject_collection : {};
  return {
    chart,
    name: typeof meta.name === 'string' && meta.name ? cleanText(meta.name) : '实时热门',
    updated_at: typeof meta.updated_at === 'string' ? meta.updated_at : '',
    items: (items as TrendingItem[]).slice(0, limit)
  };
}
