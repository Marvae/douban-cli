import { BASE, cleanText, fetchHtml, fetchJson, isRecord, normalizeTitle, ResponseSchemaError } from './common.js';
import {
  getSubjectComments,
  getSubjectRatingStats,
  getSubjectReviews,
  listSubjectCollection,
  resolveRecommendations,
  type SubjectCommentItem,
  type SubjectRecommendation,
  type SubjectPaginatedResult,
  type SubjectRatingStats,
  type SubjectReviewItem
} from './subject.js';
import { debug } from '../utils/debug.js';

interface Subject {
  id: string;
  title: string;
  rating: string;
  url: string;
  cover: string;
}

interface RankItem {
  id: string;
  title: string;
  rating: string;
  rating_count: number;
  types: string[];
  regions: string[];
  release_date: string;
  actors: string[];
  url: string;
  cover: string;
}

/** A platform that streams the title, as Douban lists it. */
export interface MovieVendor {
  name: string;
  /** Such as 免费, VIP免费观看 or 单片付费; empty when Douban does not say. */
  payment: string;
}

export interface MovieDetail {
  id: string;
  title: string;
  year: string;
  original_title: string;
  rating: string;
  /** Why there is no rating, such as 暂无评分 or 尚未上映; empty when rated. */
  rating_note: string;
  directors: string[];
  actors: string[];
  genres: string[];
  countries: string[];
  durations: string[];
  languages: string[];
  aka: string[];
  pubdate: string[];
  comment_count: number;
  review_count: number;
  summary: string;
  url: string;
  /** "喜欢这部电影的人也喜欢"; empty when no source provides it. */
  recommendations: SubjectRecommendation[];
  /** Where to watch; empty when Douban lists none, which does not mean nowhere. */
  vendors: MovieVendor[];
  /** Douban's note on the platforms, such as 独播. */
  vendor_note?: string;
  type?: 'movie' | 'tv';
  episodes_count?: number;
  episodes_info?: string;
}

export interface NowShowingItem {
  id: string;
  title: string;
  rating: string;
  release_date: string;
  meta: string;
  url: string;
  cover: string;
}

interface MobileMovieResponse {
  type?: string;
  title?: string;
  year?: string | number;
  original_title?: string;
  intro?: string;
  rating?: { value?: number };
  null_rating_reason?: unknown;
  vendors?: unknown;
  linewatches?: unknown;
  vendor_desc?: unknown;
  directors?: Array<{ name?: string }>;
  actors?: Array<{ name?: string }>;
  genres?: string[];
  countries?: string[];
  durations?: string[];
  languages?: string[];
  aka?: string[];
  pubdate?: string[];
  comment_count?: number;
  review_count?: number;
  episodes_count?: number;
  episodes_info?: string;
  url?: string;
}

export interface ComingItem {
  id: string;
  title: string;
  release_date: string;
  types: string[];
  regions: string[];
  wish_count: number;
  url: string;
}

export type ReviewItem = SubjectReviewItem;
export type CommentItem = SubjectCommentItem;
export type PaginatedResult<T> = SubjectPaginatedResult<T>;

function sanitizeList(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const text = cleanText(String(value || ''));
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });

  return result;
}

function splitSlashList(raw: string): string[] {
  return sanitizeList(raw.split('/').map((item) => item.trim()).filter(Boolean));
}

/** A Douban score as shown, or '-' for unrated titles (reported as 0 or empty). */
function doubanScore(value: unknown): string {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return text && Number(text) > 0 ? text : '-';
}

function normalizeArrayField(value: unknown): string[] {
  if (Array.isArray(value)) {
    return sanitizeList(value);
  }
  if (typeof value === 'string') {
    return splitSlashList(value);
  }
  return [];
}

const MOBILE_API = 'https://m.douban.com/rexxar/api/v2';

function personNames(people: MobileMovieResponse['directors']): string[] {
  return Array.isArray(people) ? sanitizeList(people.map((person) => person?.name)) : [];
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

/** Platforms from `vendors`, or from `linewatches` when that is all there is. Ads are skipped. */
export function parseMovieVendors(vendors: unknown, linewatches: unknown): MovieVendor[] {
  const result: MovieVendor[] = [];
  const add = (name: unknown, payment: string) => {
    const text = typeof name === 'string' ? cleanText(name) : '';
    if (text && !result.some((vendor) => vendor.name === text)) result.push({ name: text, payment });
  };
  if (Array.isArray(vendors)) {
    for (const vendor of vendors) {
      if (!isRecord(vendor) || vendor.is_ad === true) continue;
      const described = typeof vendor.payment_desc === 'string' ? cleanText(vendor.payment_desc) : '';
      add(vendor.title, described || (vendor.is_paid === false ? '免费' : ''));
    }
  }
  if (result.length === 0 && Array.isArray(linewatches)) {
    for (const watch of linewatches) {
      if (isRecord(watch) && isRecord(watch.source)) add(watch.source.name, watch.free === true ? '免费' : '');
    }
  }
  return result;
}

/** Movie or series detail from the mobile API; series take their episode count from the TV endpoint. */
export async function getMovieDetail(id: string): Promise<MovieDetail> {
  const movieId = id.trim();
  if (!/^\d+$/.test(movieId)) throw new Error('电影 ID 必须是纯数字');

  const url = `${MOBILE_API}/movie/${movieId}`;
  const headers = { Referer: `https://m.douban.com/movie/subject/${movieId}/` };
  const [data, recommendations] = await Promise.all([
    fetchJson<MobileMovieResponse>(url, headers),
    resolveRecommendations('movie', movieId, [])
  ]);
  const title = normalizeTitle(data?.title ?? '');
  if (!title) throw new ResponseSchemaError('电影详情接口未返回标题', url);

  const rating = data.rating?.value;
  const detail: MovieDetail = {
    id: movieId,
    title,
    type: data.type === 'tv' ? 'tv' : 'movie',
    year: cleanText(String(data.year ?? '')),
    original_title: normalizeTitle(data.original_title ?? ''),
    // Douban reports unrated titles as 0.
    rating: typeof rating === 'number' && rating > 0 ? rating.toFixed(1) : '-',
    rating_note: !(typeof rating === 'number' && rating > 0) && typeof data.null_rating_reason === 'string'
      ? cleanText(data.null_rating_reason)
      : '',
    directors: personNames(data.directors),
    actors: personNames(data.actors),
    genres: normalizeArrayField(data.genres),
    countries: normalizeArrayField(data.countries),
    durations: normalizeArrayField(data.durations),
    languages: normalizeArrayField(data.languages),
    aka: normalizeArrayField(data.aka),
    pubdate: normalizeArrayField(data.pubdate),
    comment_count: positiveInt(data.comment_count) ?? 0,
    review_count: positiveInt(data.review_count) ?? 0,
    summary: cleanText(data.intro ?? ''),
    url: `${BASE}/subject/${movieId}/`,
    recommendations,
    vendors: parseMovieVendors(data.vendors, data.linewatches),
    ...(typeof data.vendor_desc === 'string' && cleanText(data.vendor_desc) ? { vendor_note: cleanText(data.vendor_desc) } : {}),
    episodes_count: positiveInt(data.episodes_count),
    episodes_info: cleanText(data.episodes_info ?? '') || undefined
  };

  if (detail.type === 'tv' && !detail.episodes_count) {
    try {
      const tv = await fetchJson<MobileMovieResponse>(`${MOBILE_API}/tv/${movieId}`, headers);
      detail.episodes_count = positiveInt(tv.episodes_count);
      detail.episodes_info = cleanText(tv.episodes_info ?? '') || detail.episodes_info;
    } catch (error) {
      debug('movie', `剧集接口失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return detail;
}

/**
 * Get hot/trending by tag
 * @param type - 'movie' or 'tv'
 * @param tag - A Douban category such as trending, US TV, Japanese TV, or latest.
 * @param limit - number of results
 */
export async function getHot(type: 'movie' | 'tv', tag: string, limit = 20): Promise<Subject[]> {
  if (!Number.isInteger(limit) || limit <= 0) return [];
  const url = `${BASE}/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&page_limit=${limit}&page_start=0`;
  const data = await fetchJson<unknown>(url);
  if (!isRecord(data) || !Array.isArray(data.subjects)) {
    throw new ResponseSchemaError('热门影视接口返回格式异常', url);
  }
  const subjects = data.subjects
    .filter(isRecord)
    .map((item): Subject | null => {
      const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id).trim() : '';
      const title = typeof item.title === 'string' ? normalizeTitle(item.title) : '';
      if (!id || !title) return null;
      return {
        id,
        title,
        rating: doubanScore(item.rate),
        url: typeof item.url === 'string' ? item.url : `${BASE}/subject/${id}/`,
        cover: typeof item.cover === 'string' ? item.cover : ''
      };
    })
    .filter((item): item is Subject => item !== null);
  if (data.subjects.length > 0 && subjects.length === 0) {
    throw new ResponseSchemaError('热门影视接口未解析出有效条目', url);
  }
  return subjects;
}

/**
 * Get ranked list by genre type
 * @param typeId - Douban genre ID (for example: 17=science fiction, 5=action, 13=romance).
 * @param limit - number of results
 */
export async function getRank(typeId: number, limit = 20): Promise<RankItem[]> {
  if (!Number.isInteger(limit) || limit <= 0) return [];
  const url = `${BASE}/j/chart/top_list?type=${typeId}&interval_id=100:90&start=0&limit=${limit}`;
  const data = await fetchJson<unknown>(url);
  const rawItems = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.data)
      ? data.data
      : null;
  if (!rawItems) throw new ResponseSchemaError('分类榜单接口返回格式异常', url);

  const items = rawItems
    .filter(isRecord)
    .map((item): RankItem | null => {
      const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id).trim() : '';
      const title = typeof item.title === 'string' ? normalizeTitle(item.title) : '';
      if (!id || !title) return null;
      return {
        id,
        title,
        rating: doubanScore(item.score),
        rating_count: typeof item.vote_count === 'number' && Number.isFinite(item.vote_count)
          ? Math.max(0, Math.trunc(item.vote_count))
          : 0,
        types: normalizeArrayField(item.types),
        regions: normalizeArrayField(item.regions),
        release_date: typeof item.release_date === 'string' ? cleanText(item.release_date) : '',
        actors: normalizeArrayField(item.actors),
        url: typeof item.url === 'string' ? item.url : `${BASE}/subject/${id}/`,
        cover: typeof item.cover_url === 'string' ? item.cover_url : ''
      };
    })
    .filter((item): item is RankItem => item !== null);
  if (rawItems.length > 0 && items.length === 0) {
    throw new ResponseSchemaError('分类榜单接口未解析出有效条目', url);
  }
  return items;
}

/** Genre type mapping */
export const GENRES: Record<string, number> = {
  '剧情': 11, '喜剧': 24, '动作': 5, '爱情': 13, '科幻': 17,
  '动画': 25, '悬疑': 10, '惊悚': 19, '恐怖': 20, '纪录片': 1,
  '短片': 23, '情色': 6, '同性': 26, '音乐': 14, '歌舞': 7,
  '家庭': 28, '儿童': 8, '传记': 2, '历史': 4, '战争': 22,
  '犯罪': 3, '西部': 27, '奇幻': 16, '冒险': 12, '灾难': 21,
  '武侠': 29, '古装': 30, '运动': 18, '黑色电影': 31
};

/**
 * Get Top250
 */
export interface Top250Item {
  id: string;
  rank: number;
  title: string;
  year: string;
  rating: string;
  director: string;
  /** One-line tagline; the mobile list has it for only some titles. */
  quote: string;
  url: string;
}

export async function getTop250(start = 0, limit = 25): Promise<Top250Item[]> {
  if (!Number.isInteger(start) || start < 0) throw new Error('start 必须是非负整数');
  if (!Number.isInteger(limit) || limit <= 0) return [];
  const items = await listSubjectCollection('movie', 'movie_top250', start, Math.min(limit, 250 - start));
  return items.map((item) => {
    // card_subtitle: 1994 / 美国 / 剧情 犯罪 / 弗兰克·德拉邦特 / 蒂姆·罗宾斯 摩根·弗里曼
    const parts = item.meta.split('/').map((part) => part.trim());
    return {
      id: item.id,
      rank: item.rank,
      title: item.title,
      year: parts[0]?.match(/\d{4}/)?.[0] || '-',
      rating: item.rating,
      director: parts.length >= 5 ? parts[3] || '-' : '-',
      quote: item.description,
      url: item.url
    };
  });
}

/**
 * Get coming soon movies from https://movie.douban.com/coming
 */
export async function getComing(limit = 20): Promise<ComingItem[]> {
  if (!Number.isInteger(limit) || limit <= 0) return [];
  const html = await fetchHtml(`${BASE}/coming`, { Referer: BASE });

  const results: ComingItem[] = [];
  const rowRegex = /<tr>\s*<td>\s*([\s\S]*?)<\/td>\s*<td>\s*<a[^>]*href="https:\/\/movie\.douban\.com\/subject\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>\s*<\/td>\s*<td>\s*([\s\S]*?)<\/td>\s*<td>\s*([\s\S]*?)<\/td>\s*<td>\s*([\s\S]*?)<\/td>\s*<\/tr>/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null && results.length < limit) {
    const wishCount = Number(cleanText(match[6]).replace(/\D/g, '')) || 0;
    results.push({
      id: match[2],
      title: normalizeTitle(match[3]),
      release_date: cleanText(match[1]),
      types: cleanText(match[4]).split('/').map((v) => v.trim()).filter(Boolean),
      regions: cleanText(match[5]).split('/').map((v) => v.trim()).filter(Boolean),
      wish_count: wishCount,
      url: `https://movie.douban.com/subject/${match[2]}/`
    });
  }

  if (results.length === 0) {
    throw new ResponseSchemaError('即将上映页面未解析出预期条目', `${BASE}/coming`);
  }

  return results;
}

/**
 * Movies now showing nationwide, from the public mobile collection. The
 * city-specific cinema pages require verification for anonymous clients.
 */
export async function getNowShowing(limit = 20): Promise<NowShowingItem[]> {
  if (!Number.isInteger(limit) || limit <= 0) return [];
  const items = await listSubjectCollection('movie', 'movie_showing', 0, limit);
  return items.map(({ id, title, rating, release_date, meta, url, cover }) => (
    { id, title, rating, release_date: release_date ?? '-', meta, url, cover }
  ));
}

/**
 * Get movie reviews (long-form) from mobile API.
 */
export async function getReviews(movieId: string, start = 0, limit = 20): Promise<PaginatedResult<ReviewItem>> {
  return getSubjectReviews('movie', movieId, start, limit);
}

/**
 * Get movie comments (short reviews) from mobile API.
 * The order parameter remains for compatibility and only accepts hot sorting.
 */
export async function getComments(movieId: string, orderBy: 'hot' = 'hot', start = 0, count = 20): Promise<PaginatedResult<CommentItem>> {
  return getSubjectComments('movie', movieId, orderBy, start, count);
}

export type RatingStats = SubjectRatingStats;

/**
 * Get movie rating statistics including distribution.
 */
export async function getRatingStats(movieId: string): Promise<RatingStats> {
  return getSubjectRatingStats('movie', movieId);
}
