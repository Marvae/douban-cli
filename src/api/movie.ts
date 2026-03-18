import { BASE, cleanText, fetchHtml, fetchJson, isChallengePage, normalizeTitle } from './common.js';

interface Subject {
  id: string;
  title: string;
  rate: string;
  url: string;
  cover: string;
}

interface RankItem {
  id: string;
  title: string;
  score: string;
  vote_count: number;
  types: string[];
  regions: string[];
  release_date: string;
  actors: string[];
  url: string;
  cover_url: string;
}

export interface MovieDetail {
  id: string;
  title: string;
  rating: string;
  directors: string[];
  actors: string[];
  summary: string;
  url: string;
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

export interface WeeklyItem {
  rank: number;
  id: string;
  title: string;
  trend: string;
  url: string;
}

export interface ReviewItem {
  id: string;
  user: string;
  rating: string;
  votes: number;
  time: string;
  content: string;
  url: string;
}

export interface CommentItem {
  id: string;
  user: string;
  avatar: string;
  rating: number;
  votes: number;
  time: string;
  content: string;
  url: string;
}

function parseMovieDetailFromHtml(id: string, html: string): MovieDetail | null {
  if (isChallengePage(html)) return null;

  const titleMatch = html.match(/<span\s+property="v:itemreviewed"[^>]*>([\s\S]*?)<\/span>/);
  const ratingMatch = html.match(/<strong[^>]*property="v:average"[^>]*>([\s\S]*?)<\/strong>/);

  const directors: string[] = [];
  const directorRegex = /<a[^>]*rel="v:directedBy"[^>]*>([\s\S]*?)<\/a>/g;
  let directorMatch;
  while ((directorMatch = directorRegex.exec(html)) !== null) {
    directors.push(cleanText(directorMatch[1]));
  }

  const actors: string[] = [];
  const actorRegex = /<a[^>]*rel="v:starring"[^>]*>([\s\S]*?)<\/a>/g;
  let actorMatch;
  while ((actorMatch = actorRegex.exec(html)) !== null) {
    actors.push(cleanText(actorMatch[1]));
  }

  let summary = '';
  const summaryMatch = html.match(/<span[^>]*property="v:summary"[^>]*>([\s\S]*?)<\/span>/);
  if (summaryMatch) {
    summary = cleanText(summaryMatch[1]);
  }

  const title = titleMatch ? normalizeTitle(titleMatch[1]) : '';
  if (!title) return null;

  return {
    id,
    title,
    rating: ratingMatch ? cleanText(ratingMatch[1]) : '-',
    directors,
    actors,
    summary,
    url: `${BASE}/subject/${id}/`
  };
}

/**
 * Get movie detail by subject id.
 * Parse subject page first; if blocked, fallback to public JSON endpoints.
 */
export async function getMovieDetail(id: string): Promise<MovieDetail> {
  const movieId = id.trim();
  if (!/^\d+$/.test(movieId)) throw new Error('电影 ID 必须是纯数字');

  const subjectUrl = `${BASE}/subject/${movieId}/`;

  try {
    const html = await fetchHtml(subjectUrl, { Referer: BASE });
    const parsed = parseMovieDetailFromHtml(movieId, html);
    if (parsed) return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[movie] 主页面解析失败，进入回退逻辑: ${message}`);
  }

  const detail: MovieDetail = {
    id: movieId,
    title: '',
    rating: '-',
    directors: [],
    actors: [],
    summary: '',
    url: subjectUrl
  };

  try {
    const abstract = await fetchJson<{
      r?: number;
      subject?: {
        title?: string;
        rate?: string;
        directors?: string[];
        actors?: string[];
        url?: string;
      };
    }>(`${BASE}/j/subject_abstract?subject_id=${movieId}`, { Referer: BASE });

    const subject = abstract.subject;
    if (subject) {
      if (subject.title) detail.title = normalizeTitle(subject.title);
      if (subject.rate) detail.rating = subject.rate;
      if (Array.isArray(subject.directors)) detail.directors = subject.directors.map((name) => cleanText(name));
      if (Array.isArray(subject.actors)) detail.actors = subject.actors.map((name) => cleanText(name));
      if (subject.url) detail.url = subject.url;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[movie] subject_abstract 回退失败: ${message}`);
  }

  try {
    const mobile = await fetchJson<{
      title?: string;
      intro?: string;
      rating?: { value?: number };
      directors?: Array<{ name?: string }>;
      actors?: Array<{ name?: string }>;
      url?: string;
    }>(`https://m.douban.com/rexxar/api/v2/movie/${movieId}`, {
      Referer: `https://m.douban.com/movie/subject/${movieId}/`
    });

    if (mobile.title) detail.title = normalizeTitle(mobile.title);
    if (typeof mobile.rating?.value === 'number') detail.rating = mobile.rating.value.toFixed(1);
    if (Array.isArray(mobile.directors) && mobile.directors.length > 0) {
      detail.directors = mobile.directors
        .map((person) => cleanText(person.name || ''))
        .filter(Boolean);
    }
    if (Array.isArray(mobile.actors) && mobile.actors.length > 0) {
      detail.actors = mobile.actors
        .map((person) => cleanText(person.name || ''))
        .filter(Boolean);
    }
    if (mobile.intro) detail.summary = cleanText(mobile.intro);
    if (mobile.url) detail.url = mobile.url;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[movie] mobile API 回退失败: ${message}`);
  }

  if (!detail.title) throw new Error(`获取电影详情失败，ID=${movieId}`);
  return detail;
}

/**
 * Get hot/trending by tag
 * @param type - 'movie' or 'tv'
 * @param tag - '热门', '美剧', '日剧', '韩剧', '国产剧', '综艺', '最新' etc.
 * @param limit - number of results
 */
export async function getHot(type: 'movie' | 'tv', tag: string, limit = 20): Promise<Subject[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const url = `${BASE}/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&page_limit=${limit}&page_start=0`;
  const data = await fetchJson<{ subjects: Subject[] }>(url);
  return Array.isArray(data.subjects) ? data.subjects : [];
}

/**
 * Get ranked list by genre type
 * @param typeId - genre type ID (17=科幻, 5=动作, 13=爱情, 25=动画, 10=悬疑, etc.)
 * @param limit - number of results
 */
export async function getRank(typeId: number, limit = 20): Promise<RankItem[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const url = `${BASE}/j/chart/top_list?type=${typeId}&interval_id=100:90&start=0&limit=${limit}`;
  const data = await fetchJson<RankItem[] | { data?: RankItem[] }>(url);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  return [];
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
export async function getTop250(start = 0, limit = 25): Promise<{ title: string; rating: string; url: string }[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const results: { title: string; rating: string; url: string }[] = [];
  const itemRegex = /<div class="item">[\s\S]*?href="([^"]+)"[\s\S]*?<span class="title">([^<]+)<\/span>[\s\S]*?<span class="rating_num"[^>]*>([^<]+)<\/span>/g;

  const seen = new Set<string>();
  let pageStart = Math.max(0, start);

  while (results.length < limit) {
    const html = await fetchHtml(`${BASE}/top250?start=${pageStart}`);

    let addedThisPage = 0;
    let match;
    while ((match = itemRegex.exec(html)) !== null && results.length < limit) {
      const itemUrl = match[1];
      if (seen.has(itemUrl)) continue;
      seen.add(itemUrl);
      addedThisPage += 1;

      results.push({
        title: match[2],
        rating: match[3],
        url: itemUrl
      });
    }

    itemRegex.lastIndex = 0;
    if (addedThisPage === 0) break;
    pageStart += 25;
  }

  return results;
}

/**
 * Get now playing movies
 */
export async function getNowPlaying(city = 'beijing'): Promise<{ title: string; score: string; id: string }[]> {
  const html = await fetchHtml(`${BASE}/cinema/nowplaying/${city}/`);
  const results: { title: string; score: string; id: string }[] = [];

  const regex = /data-title="([^"]+)"[^>]*data-score="([^"]*)"[^>]*data-subject="(\d+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    results.push({
      title: match[1],
      score: match[2] || '-',
      id: match[3]
    });
  }
  return results;
}

/**
 * Get coming soon movies from https://movie.douban.com/coming
 */
export async function getComing(limit = 20): Promise<ComingItem[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const html = await fetchHtml(`${BASE}/coming`, { Referer: BASE });
  if (isChallengePage(html)) throw new Error('即将上映页面触发了反爬挑战，暂时无法解析');

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

  return results;
}

/**
 * Get weekly reputation chart from https://movie.douban.com/chart
 */
export async function getWeekly(limit = 10): Promise<WeeklyItem[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const html = await fetchHtml(`${BASE}/chart`, { Referer: BASE });
  if (isChallengePage(html)) throw new Error('一周口碑榜页面触发了反爬挑战，暂时无法解析');

  const sectionMatch = html.match(/<h2>一周口碑榜[\s\S]*?<ul class="content" id="listCont2">([\s\S]*?)<\/ul>/);
  if (!sectionMatch) throw new Error('未找到一周口碑榜数据区域');

  const results: WeeklyItem[] = [];
  const itemRegex = /<li class="clearfix">[\s\S]*?<div class="no">(\d+)<\/div>[\s\S]*?<a[^>]*href="https:\/\/movie\.douban\.com\/subject\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div class="(stay|up|down)">(\d+)<\/div>[\s\S]*?<\/li>/g;

  let match;
  while ((match = itemRegex.exec(sectionMatch[1])) !== null && results.length < limit) {
    const type = match[4];
    const delta = Number(match[5]);
    const trend = type === 'stay' ? 'stay' : `${type} ${delta}`;

    results.push({
      rank: Number(match[1]),
      id: match[2],
      title: normalizeTitle(match[3]),
      trend,
      url: `https://movie.douban.com/subject/${match[2]}/`
    });
  }

  return results;
}

/**
 * Get movie reviews (long-form) from mobile API.
 */
export async function getReviews(movieId: string, start = 0, limit = 20): Promise<ReviewItem[]> {
  const id = movieId.trim();
  if (!/^\d+$/.test(id)) throw new Error('电影 ID 必须是纯数字');
  if (!Number.isFinite(start) || start < 0) throw new Error('start 必须是非负整数');
  if (!Number.isFinite(limit) || limit <= 0) return [];

  interface ReviewResponse {
    reviews?: Array<{
      id?: string;
      title?: string;
      abstract?: string;
      rating?: { value?: number };
      useful_count?: number;
      create_time?: string;
      user?: { name?: string };
      url?: string;
    }>;
  }

  const url = `https://m.douban.com/rexxar/api/v2/movie/${id}/reviews?count=${limit}&start=${start}`;
  const data = await fetchJson<ReviewResponse>(url, {
    Referer: `https://m.douban.com/movie/subject/${id}/`
  });

  if (!Array.isArray(data.reviews)) return [];

  return data.reviews.map((item) => ({
    id: item.id || '',
    user: item.user?.name || '匿名',
    rating: item.rating?.value ? String(item.rating.value) : '-',
    votes: item.useful_count || 0,
    time: item.create_time || '',
    content: `【${item.title || '无标题'}】${item.abstract || ''}`,
    url: item.url || `https://movie.douban.com/review/${item.id}/`
  }));
}

// City code mapping
export const CITIES: Record<string, string> = {
  '北京': 'beijing', '上海': 'shanghai', '广州': 'guangzhou', '深圳': 'shenzhen',
  '苏州': 'suzhou', '杭州': 'hangzhou', '南京': 'nanjing', '成都': 'chengdu',
  '武汉': 'wuhan', '西安': 'xian', '重庆': 'chongqing', '天津': 'tianjin'
};

/**
 * Get movie comments (short reviews) from mobile API.
 * order_by: 'hot' (default) or 'latest'
 */
export async function getComments(movieId: string, orderBy: 'hot' | 'latest' = 'hot', start = 0, count = 20): Promise<CommentItem[]> {
  const id = movieId.trim();
  if (!/^\d+$/.test(id)) throw new Error('电影 ID 必须是纯数字');
  if (!Number.isFinite(start) || start < 0) throw new Error('start 必须是非负整数');
  if (!Number.isFinite(count) || count <= 0) return [];

  interface Interest {
    id: string;
    comment?: string;
    rating?: { value?: number };
    vote_count?: number;
    create_time?: string;
    user?: {
      name?: string;
      avatar?: string;
    };
  }

  const url = `https://m.douban.com/rexxar/api/v2/movie/${id}/interests?count=${count}&start=${start}&order_by=${orderBy}`;
  const data = await fetchJson<{ interests?: Interest[] }>(url, {
    Referer: `https://m.douban.com/movie/subject/${id}/`
  });

  if (!Array.isArray(data.interests)) return [];

  return data.interests
    .filter((item) => item.comment)
    .map((item) => ({
      id: item.id || '',
      user: item.user?.name || '匿名',
      avatar: item.user?.avatar || '',
      rating: item.rating?.value || 0,
      votes: item.vote_count || 0,
      time: item.create_time || '',
      content: item.comment || '',
      url: `https://www.douban.com/doubanapp/dispatch?uri=/movie/${id}/interest/${item.id}`
    }));
}

export interface RatingStats {
  value: number;
  count: number;
  stars: number[];
  wish_count: number;
  done_count: number;
  type_ranks: Array<{ type: string; rank: number }>;
}

/**
 * Get movie rating statistics including distribution.
 */
export async function getRatingStats(movieId: string): Promise<RatingStats> {
  const id = movieId.trim();
  if (!/^\d+$/.test(id)) throw new Error('电影 ID 必须是纯数字');

  interface RatingResponse {
    stats?: number[];
    wish_count?: number;
    done_count?: number;
    type_ranks?: Array<{ type: string; rank: number }>;
  }

  interface MovieResponse {
    rating?: { value?: number; count?: number };
  }

  const [ratingData, movieData] = await Promise.all([
    fetchJson<RatingResponse>(`https://m.douban.com/rexxar/api/v2/movie/${id}/rating?for_mobile=1`, {
      Referer: `https://m.douban.com/movie/subject/${id}/`
    }),
    fetchJson<MovieResponse>(`https://m.douban.com/rexxar/api/v2/movie/${id}?for_mobile=1`, {
      Referer: `https://m.douban.com/movie/subject/${id}/`
    })
  ]);

  const rawStats = Array.isArray(ratingData.stats) ? ratingData.stats : [];
  const stats = new Array<number>(5).fill(0).map((_, index) => {
    const value = rawStats[index];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  });

  return {
    value: movieData.rating?.value || 0,
    count: movieData.rating?.count || 0,
    stars: stats.map((s) => Math.round(s * 1000) / 10),
    wish_count: ratingData.wish_count || 0,
    done_count: ratingData.done_count || 0,
    type_ranks: ratingData.type_ranks || []
  };
}
