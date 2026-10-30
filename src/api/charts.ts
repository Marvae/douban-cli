import { cleanText, fetchJson, isRecord, normalizeTitle, ResponseSchemaError } from './common.js';

// Douban's ranked charts from the public mobile API: the hourly 实时热门
// and the weekly 口碑榜 for films, series and variety shows. They share one
// item shape with a rank, a trend against the last edition and a rating.

/** The three tabs of Douban's 实时热门 page: 书影音 (all), 电影榜 and 电视榜. */
export type TrendingChart = 'all' | 'movie' | 'tv';

/** Weekly 口碑榜: films, or series and variety shows (华语/国内 or 全球/国外). */
export type WeeklyChart = 'movie' | 'tv' | 'tv-global' | 'show' | 'show-global';

const TRENDING_COLLECTIONS: Record<TrendingChart, string> = {
  all: 'subject_real_time_hotest',
  movie: 'movie_real_time_hotest',
  tv: 'tv_real_time_hotest'
};

const WEEKLY_COLLECTIONS: Record<WeeklyChart, string> = {
  movie: 'movie_weekly_best',
  tv: 'tv_chinese_best_weekly',
  'tv-global': 'tv_global_best_weekly',
  show: 'show_chinese_best_weekly',
  'show-global': 'show_global_best_weekly'
};

/** The charts' own sizes; Douban returns no more than these. */
export const TRENDING_LIMIT = 20;
export const WEEKLY_LIMIT = 10;

const SUBJECT_HOSTS: Record<string, string> = {
  movie: 'movie.douban.com',
  tv: 'movie.douban.com',
  book: 'book.douban.com',
  music: 'music.douban.com'
};

export interface ChartItem {
  rank: number;
  id: string;
  title: string;
  /** movie, tv, book or music. */
  type: string;
  /** Douban's label such as 电影, 电视剧 or 综艺; empty on the weekly charts. */
  type_name: string;
  year: string;
  /** '-' when unrated. */
  rating: string;
  /** Why there is no rating, such as 暂无评分; empty when rated. */
  rating_note: string;
  /** Heat score on 实时热门; higher is hotter. Absent on the weekly charts. */
  heat?: number;
  /** Against the previous edition: `up 1`, `down 2`, `stay` or `new`. */
  trend: string;
  /** card_subtitle: year / region / genres / director / cast. */
  meta: string;
  url: string;
  cover: string;
}

export interface ChartResult {
  chart: string;
  name: string;
  /** How often Douban refreshes it, from its own description, such as 每周五更新. */
  schedule: string;
  /**
   * The chart's `updated_at` as Douban reports it (Beijing time). For the
   * 书影音 chart it can lag the items by hours, so treat it as a hint.
   */
  updated_at: string;
  items: ChartItem[];
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

function parseChartItem(item: unknown, index: number): ChartItem | null {
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
  const heat = typeof item.score === 'number' && Number.isFinite(item.score) && item.score > 0
    ? Math.trunc(item.score)
    : undefined;
  return {
    rank,
    id,
    title,
    type,
    type_name: typeof item.type_name === 'string' ? cleanText(item.type_name) : '',
    year: typeof item.year === 'string' || typeof item.year === 'number' ? String(item.year) : '',
    rating: rated ? (rating.value as number).toFixed(1) : '-',
    rating_note: !rated && typeof item.null_rating_reason === 'string' ? cleanText(item.null_rating_reason) : '',
    ...(heat !== undefined ? { heat } : {}),
    trend: trendOf(item),
    meta: typeof item.card_subtitle === 'string' ? cleanText(item.card_subtitle) : '',
    url: subjectUrl(type, id, item.url),
    cover
  };
}

/** "每周五更新；关注榜单…" → "每周五更新". */
function scheduleOf(description: unknown): string {
  const first = typeof description === 'string' ? cleanText(description).split(/[；;。，,]/)[0] ?? '' : '';
  return /^每.{1,6}更新$/.test(first) ? first : '';
}

async function getRankedChart(chart: string, collection: string, limit: number, maximum: number): Promise<ChartResult> {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit 必须是正整数');
  const url = `https://m.douban.com/rexxar/api/v2/subject_collection/${collection}/items?start=0&count=${Math.min(limit, maximum)}`;
  const data = await fetchJson<unknown>(url, { Referer: `https://m.douban.com/subject_collection/${collection}` });
  if (!isRecord(data) || !Array.isArray(data.subject_collection_items)) {
    throw new ResponseSchemaError('榜单接口返回格式异常', url);
  }
  const items = data.subject_collection_items.map(parseChartItem);
  if (items.some((item) => item === null)) throw new ResponseSchemaError('榜单包含无效条目', url);
  if (items.length === 0) throw new ResponseSchemaError('榜单没有返回条目', url);
  const meta = isRecord(data.subject_collection) ? data.subject_collection : {};
  return {
    chart,
    name: typeof meta.name === 'string' && meta.name ? cleanText(meta.name) : '豆瓣榜单',
    schedule: scheduleOf(meta.description),
    updated_at: typeof meta.updated_at === 'string' ? meta.updated_at : '',
    items: (items as ChartItem[]).slice(0, limit)
  };
}

/** Douban's real-time hot chart (实时热门), refreshed hourly. */
export async function getTrending(chart: TrendingChart = 'all', limit = TRENDING_LIMIT): Promise<ChartResult> {
  const result = await getRankedChart(chart, TRENDING_COLLECTIONS[chart], limit, TRENDING_LIMIT);
  return { ...result, schedule: '每小时更新' };
}

/** A weekly 口碑榜: films, or Chinese or global series and variety shows. */
export async function getWeeklyChart(chart: WeeklyChart = 'movie', limit = WEEKLY_LIMIT): Promise<ChartResult> {
  return getRankedChart(chart, WEEKLY_COLLECTIONS[chart], limit, WEEKLY_LIMIT);
}
