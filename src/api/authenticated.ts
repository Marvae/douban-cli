import { BASE, UA, cleanText, fetchHtml } from './common.js';
import { formEncode } from '../utils/parsing.js';

type InterestStatus = 'collect' | 'wish' | 'do';

interface DoubanJsonResponse {
  r?: number;
  msg?: string;
  [key: string]: unknown;
}

interface ProfileMatch {
  id: string;
  name?: string;
}

export interface CurrentUserProfile {
  id: string;
  name: string;
  url: string;
}

export interface FeedItem {
  user: string;
  action: string;
  target: string;
  content: string;
  time: string;
  url: string;
}

export interface CollectionRecord {
  id: string;
  title: string;
  url: string;
  status: InterestStatus;
  date?: string;
  rating?: number;
  comment?: string;
}

export interface ReviewCreateResult {
  id: string;
  url: string;
}

const FETCH_TIMEOUT_MS = 30000;

function parseJsonResponse(text: string): DoubanJsonResponse {
  try {
    return JSON.parse(text) as DoubanJsonResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[authenticated] JSON 解析失败: ${message}`);
    return {};
  }
}

function parseApiError(res: Response, text: string): string {
  const parsed = parseJsonResponse(text);
  if (typeof parsed.msg === 'string' && parsed.msg.trim()) {
    return parsed.msg.trim();
  }
  return `HTTP ${res.status}: ${text.slice(0, 120)}`;
}

function parseJsonApiResult(text: string): DoubanJsonResponse {
  const parsed = parseJsonResponse(text);
  if (typeof parsed.r === 'number') {
    if (parsed.r !== 0) {
      throw new Error(parsed.msg || `豆瓣接口错误 code=${String(parsed.code || 'unknown')}`);
    }
    return parsed;
  }

  const trimmed = text.trim();
  if (!trimmed) return parsed;
  throw new Error(`豆瓣接口返回异常: ${trimmed.slice(0, 120)}`);
}

async function postForm(url: string, data: Record<string, string>, cookies: string, referer: string): Promise<DoubanJsonResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Cookie: cookies,
      Referer: referer,
      Origin: 'https://www.douban.com',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: formEncode(data),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(parseApiError(res, text));
  }
  return parseJsonApiResult(text);
}

function extractCkFromHtml(html: string): string {
  const input = html.match(/name=["']ck["']\s+value=["']([^"']+)["']/i);
  if (input?.[1]) return input[1];

  const dataAttr = html.match(/data-ck=["']([^"']+)["']/i);
  if (dataAttr?.[1]) return dataAttr[1];

  const inScript = html.match(/[?&]ck=([A-Za-z0-9]+)/);
  if (inScript?.[1]) return inScript[1];

  throw new Error('无法解析 ck token，请重新登录后重试');
}

async function resolveCk(cookies: string, existingCk?: string, subjectId?: string): Promise<string> {
  if (existingCk) return existingCk;

  if (subjectId) {
    const subjectHtml = await fetchHtml(`${BASE}/subject/${subjectId}/`, {
      Referer: BASE,
      Cookie: cookies
    });
    return extractCkFromHtml(subjectHtml);
  }

  const homeHtml = await fetchHtml('https://www.douban.com/', {
    Referer: 'https://www.douban.com/',
    Cookie: cookies
  });
  return extractCkFromHtml(homeHtml);
}

function parseMineAnchor(html: string): ProfileMatch | null {
  const byClassThenHref = html.match(/<a[^>]*class=["'][^"']*\blnk-mine\b[^"']*["'][^>]*href=["']https:\/\/www\.douban\.com\/people\/([^/"']+)\/["'][^>]*>([\s\S]*?)<\/a>/i);
  if (byClassThenHref?.[1]) {
    return { id: byClassThenHref[1], name: cleanText(byClassThenHref[2] || '') };
  }

  const byHrefThenClass = html.match(/<a[^>]*href=["']https:\/\/www\.douban\.com\/people\/([^/"']+)\/["'][^>]*class=["'][^"']*\blnk-mine\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  if (byHrefThenClass?.[1]) {
    return { id: byHrefThenClass[1], name: cleanText(byHrefThenClass[2] || '') };
  }

  return null;
}

function parseProfileFromHtml(html: string): CurrentUserProfile {
  const mine = parseMineAnchor(html);
  if (mine?.id) {
    return {
      id: mine.id,
      name: mine.name || mine.id,
      url: `https://www.douban.com/people/${mine.id}/`
    };
  }

  const idMatch = html.match(/https:\/\/www\.douban\.com\/people\/([^/"']+)\//);
  if (!idMatch?.[1]) {
    throw new Error('当前登录态未识别到用户信息，请先运行 douban login');
  }

  const id = idMatch[1];
  return {
    id,
    name: id,
    url: `https://www.douban.com/people/${id}/`
  };
}

export async function getCurrentUserProfile(cookies: string): Promise<CurrentUserProfile> {
  const html = await fetchHtml('https://www.douban.com/', {
    Referer: 'https://www.douban.com/',
    Cookie: cookies
  });

  return parseProfileFromHtml(html);
}

export async function createReview(
  movieId: string,
  title: string,
  content: string,
  cookies: string,
  existingCk?: string
): Promise<ReviewCreateResult> {
  const id = movieId.trim();
  if (!/^\d+$/.test(id)) throw new Error('Movie ID must be numeric');
  if (!title.trim()) throw new Error('长评标题不能为空');
  if (!content.trim()) throw new Error('长评内容不能为空');

  const ck = await resolveCk(cookies, existingCk, id);

  const result = await postForm(
    `${BASE}/j/review/create`,
    {
      ck,
      subject_id: id,
      title: title.trim(),
      review: content.trim()
    },
    cookies,
    `${BASE}/subject/${id}/`
  );

  const reviewId = String(result.id || '').trim();
  return {
    id: reviewId,
    url: reviewId ? `${BASE}/review/${reviewId}/` : `${BASE}/subject/${id}/`
  };
}

export async function unmarkSubject(movieId: string, cookies: string, existingCk?: string): Promise<void> {
  const id = movieId.trim();
  if (!/^\d+$/.test(id)) throw new Error('Movie ID must be numeric');

  const ck = await resolveCk(cookies, existingCk, id);

  try {
    await postForm(
      `${BASE}/j/subject/${id}/removeinterest`,
      { ck },
      cookies,
      `${BASE}/subject/${id}/`
    );
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[authenticated] removeinterest 失败，回退 interest=none: ${message}`);
    await postForm(
      `${BASE}/j/subject/${id}/interest`,
      { ck, interest: 'none' },
      cookies,
      `${BASE}/subject/${id}/`
    );
  }
}

export async function followUser(userId: string, cookies: string, existingCk?: string): Promise<void> {
  const id = userId.trim();
  if (!id) throw new Error('用户 ID 不能为空');
  const ck = await resolveCk(cookies, existingCk);

  try {
    await postForm(
      `https://www.douban.com/j/contact/follow/${encodeURIComponent(id)}`,
      { ck },
      cookies,
      'https://www.douban.com/'
    );
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[authenticated] follow 接口失败，回退 add: ${message}`);
    await postForm(
      'https://www.douban.com/j/contact/add',
      { ck, people_id: id },
      cookies,
      'https://www.douban.com/'
    );
  }
}

export async function unfollowUser(userId: string, cookies: string, existingCk?: string): Promise<void> {
  const id = userId.trim();
  if (!id) throw new Error('用户 ID 不能为空');
  const ck = await resolveCk(cookies, existingCk);

  try {
    await postForm(
      `https://www.douban.com/j/contact/unfollow/${encodeURIComponent(id)}`,
      { ck },
      cookies,
      'https://www.douban.com/'
    );
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[authenticated] unfollow 接口失败，回退 remove: ${message}`);
    await postForm(
      'https://www.douban.com/j/contact/remove',
      { ck, people_id: id },
      cookies,
      'https://www.douban.com/'
    );
  }
}

export async function getFeed(cookies: string, limit = 20): Promise<FeedItem[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const html = await fetchHtml('https://www.douban.com/', {
    Referer: 'https://www.douban.com/',
    Cookie: cookies
  });

  const results: FeedItem[] = [];
  const blockRegex = /<div class="status-item[\s\S]*?<\/div>\s*<\/div>/g;

  let match;
  while ((match = blockRegex.exec(html)) !== null && results.length < limit) {
    const block = match[0];

    const userMatch = block.match(/class="name"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const actionMatch = block.match(/class="action"[^>]*>([\s\S]*?)<\/span>/i);
    const targetMatch = block.match(/class="title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const contentMatch = block.match(/class="status-saying"[^>]*>([\s\S]*?)<\/blockquote>/i)
      || block.match(/class="status-content"[^>]*>([\s\S]*?)<\/div>/i);
    const timeMatch = block.match(/class="created_at"[^>]*>([\s\S]*?)<\/span>/i);
    const urlMatch = block.match(/href="(https:\/\/www\.douban\.com\/people\/[^"#]+\/status\/\d+)"/i);

    results.push({
      user: cleanText(userMatch?.[1] || '未知用户'),
      action: cleanText(actionMatch?.[1] || '更新了动态'),
      target: cleanText(targetMatch?.[1] || '-'),
      content: cleanText(contentMatch?.[1] || ''),
      time: cleanText(timeMatch?.[1] || ''),
      url: urlMatch?.[1] || ''
    });
  }

  return results;
}

function normalizeRatingClass(block: string): number | undefined {
  const match = block.match(/rating(\d)-t/);
  if (!match) return undefined;
  const score = Number(match[1]);
  return Number.isFinite(score) ? score : undefined;
}

function parseCollectionBlocks(html: string, status: InterestStatus): CollectionRecord[] {
  const items: CollectionRecord[] = [];
  const itemRegex = /<li[^>]*class="item"[^>]*>[\s\S]*?<\/li>/g;

  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const block = match[0];
    const subjectMatch = block.match(/href="https:\/\/movie\.douban\.com\/subject\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/i);
    if (!subjectMatch?.[1]) continue;

    const dateMatch = block.match(/<div class="date">([\s\S]*?)<\/div>/i);
    const commentMatch = block.match(/<span class="comment">([\s\S]*?)<\/span>/i);

    // 从 date div 中提取日期（格式：2026-03-18）
    const dateText = dateMatch?.[1] || '';
    const dateOnly = dateText.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';

    items.push({
      id: subjectMatch[1],
      title: cleanText(subjectMatch[2]),
      url: `https://movie.douban.com/subject/${subjectMatch[1]}/`,
      status,
      date: dateOnly,
      rating: normalizeRatingClass(block),
      comment: cleanText(commentMatch?.[1] || '') || undefined
    });
  }

  return items;
}

function parseCollectionNextStart(html: string): number | null {
  const nextMatch = html.match(/<span[^>]*class=["'][^"']*next[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["']/i);
  if (!nextMatch?.[1]) return null;

  const href = nextMatch[1].replace(/&amp;/g, '&').trim();
  let url: URL;

  try {
    url = new URL(href, BASE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[authenticated] 解析下一页 start 失败: ${message}`);
    return null;
  }

  const nextStart = Number(url.searchParams.get('start'));
  if (!Number.isInteger(nextStart) || nextStart < 0) return null;
  return nextStart;
}

export async function getCollectionRecords(
  userId: string,
  status: InterestStatus,
  limit = 200,
  cookies?: string
): Promise<CollectionRecord[]> {
  const id = userId.trim();
  if (!id) throw new Error('用户 ID 不能为空');
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const results: CollectionRecord[] = [];
  const seenIds = new Set<string>();
  const visitedStarts = new Set<number>();
  const encodedId = encodeURIComponent(id);
  let start = 0;

  while (results.length < limit) {
    if (visitedStarts.has(start)) break;
    visitedStarts.add(start);

    const html = await fetchHtml(`${BASE}/people/${encodedId}/${status}/?start=${start}&sort=time&rating=all&filter=all&mode=list`, {
      Referer: `${BASE}/people/${encodedId}/${status}/`,
      ...(cookies ? { Cookie: cookies } : {})
    });

    const pageItems = parseCollectionBlocks(html, status);
    if (pageItems.length === 0) break;

    for (const item of pageItems) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      results.push(item);
      if (results.length >= limit) break;
    }

    const nextStart = parseCollectionNextStart(html);
    if (nextStart === null || nextStart <= start) break;
    start = nextStart;
  }

  return results;
}
