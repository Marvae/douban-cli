/**
 * Douban API client - no login required
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const BASE = 'https://movie.douban.com';

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

export interface SearchItem {
  id: string;
  title: string;
  rating: string;
  year?: string;
  url: string;
  cover?: string;
  abstract?: string;
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

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchHtml(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, ' ');
}

function cleanText(text: string): string {
  return decodeHtml(stripTags(text)).replace(/\s+/g, ' ').trim();
}

function normalizeTitle(title: string): string {
  return cleanText(title).replace(/\s*\u200e?\([^)]*\)\s*$/, '').trim();
}

function parseSearchFromHtml(html: string, limit: number): SearchItem[] {
  const dataMatch = html.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\});/);
  if (!dataMatch) throw new Error('Search data not found in HTML');

  const data = JSON.parse(dataMatch[1]) as {
    items?: Array<{
      tpl_name?: string;
      id?: string | number;
      title?: string;
      url?: string;
      cover_url?: string;
      abstract?: string;
      rating?: { value?: number };
    }>;
  };

  const items = (data.items || [])
    .filter((item) => item.tpl_name === 'search_subject' && !!item.url)
    .map((item) => {
      const ratingValue = typeof item.rating?.value === 'number' ? item.rating.value.toFixed(1) : '-';
      const yearMatch = (item.abstract || '').match(/(19|20)\d{2}/);
      return {
        id: String(item.id || ''),
        title: normalizeTitle(item.title || ''),
        rating: ratingValue,
        year: yearMatch?.[0],
        url: item.url || '',
        cover: item.cover_url,
        abstract: cleanText(item.abstract || '')
      };
    })
    .filter((item) => item.id && item.title)
    .slice(0, limit);

  return items;
}

/**
 * Search movies by keyword.
 * Try Douban JSON API first, then fallback to HTML parsing.
 */
export async function searchMovies(keyword: string, start = 0, limit = 20): Promise<SearchItem[]> {
  const query = keyword.trim();
  if (!query) return [];

  try {
    const apiUrl = `https://www.douban.com/j/search?q=${encodeURIComponent(query)}&start=${start}&cat=1002`;
    const data = await fetchJson<{ items?: Array<Record<string, unknown>> }>(apiUrl, {
      Referer: 'https://www.douban.com/search'
    });

    if (!Array.isArray(data.items)) throw new Error('Invalid search API response');

    const items = data.items
      .map((item) => {
        const rawId = String(item.id || '');
        const ratingValue = typeof item.rating === 'number'
          ? item.rating.toFixed(1)
          : typeof item.rating === 'string'
            ? item.rating
            : '-';
        return {
          id: rawId,
          title: normalizeTitle(String(item.title || '')),
          rating: ratingValue,
          year: item.year ? String(item.year) : undefined,
          url: String(item.url || `https://movie.douban.com/subject/${rawId}/`),
          cover: item.img ? String(item.img) : undefined,
          abstract: item.abstract ? cleanText(String(item.abstract)) : undefined
        };
      })
      .filter((item) => item.id && item.title)
      .slice(0, limit);

    if (items.length > 0) return items;
  } catch {
    // Fallback to HTML parser below.
  }

  const pageUrl = `https://search.douban.com/movie/subject_search?search_text=${encodeURIComponent(query)}&cat=1002&start=${start}`;
  const html = await fetchHtml(pageUrl, { Referer: 'https://www.douban.com/' });
  return parseSearchFromHtml(html, limit);
}

function parseMovieDetailFromHtml(id: string, html: string): MovieDetail | null {
  if (html.includes('<form name="sec" id="sec"') || html.includes('载入中')) return null;

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
  if (!/^\d+$/.test(movieId)) throw new Error('Movie ID must be numeric');

  const subjectUrl = `${BASE}/subject/${movieId}/`;

  try {
    const html = await fetchHtml(subjectUrl, { Referer: BASE });
    const parsed = parseMovieDetailFromHtml(movieId, html);
    if (parsed) return parsed;
  } catch {
    // Continue with fallback endpoints.
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
  } catch {
    // Ignore and continue with mobile API fallback.
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
  } catch {
    // No more fallback source.
  }

  if (!detail.title) throw new Error(`Failed to fetch movie detail for id=${movieId}`);
  return detail;
}

/**
 * Get hot/trending by tag
 * @param type - 'movie' or 'tv'
 * @param tag - '热门', '美剧', '日剧', '韩剧', '国产剧', '综艺', '最新' etc.
 * @param limit - number of results
 */
export async function getHot(type: 'movie' | 'tv', tag: string, limit = 20): Promise<Subject[]> {
  const url = `${BASE}/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&page_limit=${limit}&page_start=0`;
  const data = await fetchJson<{ subjects: Subject[] }>(url);
  return data.subjects;
}

/**
 * Get ranked list by genre type
 * @param typeId - genre type ID (17=科幻, 5=动作, 13=爱情, 25=动画, 10=悬疑, etc.)
 * @param limit - number of results
 */
export async function getRank(typeId: number, limit = 20): Promise<RankItem[]> {
  const url = `${BASE}/j/chart/top_list?type=${typeId}&interval_id=100:90&start=0&limit=${limit}`;
  return fetchJson<RankItem[]>(url);
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
  const html = await fetchHtml(`${BASE}/top250?start=${start}`);
  const results: { title: string; rating: string; url: string }[] = [];
  
  // Parse HTML
  const itemRegex = /<div class="item">[\s\S]*?<span class="title">([^<]+)<\/span>[\s\S]*?<span class="rating_num"[^>]*>([^<]+)<\/span>[\s\S]*?href="([^"]+)"/g;
  let match;
  while ((match = itemRegex.exec(html)) !== null && results.length < limit) {
    results.push({
      title: match[1],
      rating: match[2],
      url: match[3]
    });
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
 * Get user's movie collection
 */
export async function getUserCollection(userId: string, status: 'collect' | 'wish' | 'do' = 'collect', limit = 50): Promise<{ title: string; url: string; id: string }[]> {
  const results: { title: string; url: string; id: string }[] = [];
  const seen = new Set<string>();
  let start = 0;
  
  while (results.length < limit) {
    const html = await fetchHtml(`${BASE}/people/${userId}/${status}?start=${start}&sort=time&mode=list`);
    
    // Match <div class="title"><a href="...subject/ID/">TITLE</a>
    const regex = /<div class="title">\s*<a href="https:\/\/movie\.douban\.com\/subject\/(\d+)\/">\s*([^<]+?)\s*<\/a>/g;
    let match;
    let found = false;
    
    while ((match = regex.exec(html)) !== null && results.length < limit) {
      const id = match[1];
      const title = match[2].trim();
      if (title && !seen.has(id)) {
        found = true;
        seen.add(id);
        results.push({
          title,
          url: `https://movie.douban.com/subject/${id}/`,
          id
        });
      }
    }
    
    if (!found) break;
    start += 15;
  }
  
  return results;
}

// City code mapping
export const CITIES: Record<string, string> = {
  '北京': 'beijing', '上海': 'shanghai', '广州': 'guangzhou', '深圳': 'shenzhen',
  '苏州': 'suzhou', '杭州': 'hangzhou', '南京': 'nanjing', '成都': 'chengdu',
  '武汉': 'wuhan', '西安': 'xian', '重庆': 'chongqing', '天津': 'tianjin'
};
