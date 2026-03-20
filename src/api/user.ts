import { BASE, cleanText, fetchHtml, isChallengePage } from './common.js';

export interface UserCollectionItem {
  title: string;
  url: string;
  id: string;
  rating: number;
  date: string;
  comment: string;
  cover: string;
}

function normalizeRatingClass(block: string): number {
  const match = block.match(/rating(\d)-t/);
  if (!match) return 0;
  const score = Number(match[1]);
  return Number.isFinite(score) ? score : 0;
}

function parseDate(text: string): string {
  return text.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '';
}

function parseCollectionBlocks(html: string): UserCollectionItem[] {
  const items: UserCollectionItem[] = [];
  const itemRegex = /<li[^>]*class="item"[^>]*>[\s\S]*?<\/li>/g;

  let match;
  while ((match = itemRegex.exec(html)) !== null) {
    const block = match[0];

    const subjectMatch = block.match(/href="https:\/\/movie\.douban\.com\/subject\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/i);
    if (!subjectMatch?.[1]) continue;

    const coverMatch = block.match(/<img[^>]*src="([^"]+)"[^>]*>/i);
    const dateMatch = block.match(/<div class="date">([\s\S]*?)<\/div>/i);
    const commentMatch = block.match(/<span class="comment">([\s\S]*?)<\/span>/i);

    items.push({
      id: subjectMatch[1],
      title: cleanText(subjectMatch[2]),
      url: `https://movie.douban.com/subject/${subjectMatch[1]}/`,
      rating: normalizeRatingClass(block),
      date: parseDate(dateMatch?.[1] || ''),
      comment: cleanText(commentMatch?.[1] || ''),
      cover: cleanText(coverMatch?.[1] || '')
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
  } catch {
    return null;
  }

  const nextStart = Number(url.searchParams.get('start'));
  if (!Number.isInteger(nextStart) || nextStart < 0) return null;
  return nextStart;
}

/**
 * Get user's movie collection
 */
export async function getUserCollection(
  userId: string,
  status: 'collect' | 'wish' | 'do' = 'collect',
  limit = 50
): Promise<UserCollectionItem[]> {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) {
    throw new Error('用户 ID 不能为空');
  }
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const results: UserCollectionItem[] = [];
  const seen = new Set<string>();
  const visitedStarts = new Set<number>();
  const encodedUserId = encodeURIComponent(trimmedUserId);
  let start = 0;

  while (results.length < limit) {
    if (visitedStarts.has(start)) break;
    visitedStarts.add(start);

    const html = await fetchHtml(`${BASE}/people/${encodedUserId}/${status}/?start=${start}&sort=time&rating=all&filter=all&mode=list`, {
      Referer: `${BASE}/people/${encodedUserId}/${status}/`
    });

    if (isChallengePage(html)) {
      throw new Error('触发豆瓣反爬挑战页面，无法继续获取用户片单，请稍后重试');
    }

    const pageItems = parseCollectionBlocks(html);
    if (pageItems.length === 0) break;

    for (const item of pageItems) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      results.push(item);
      if (results.length >= limit) break;
    }

    const nextStart = parseCollectionNextStart(html);
    if (nextStart === null || nextStart <= start) break;
    start = nextStart;
  }

  return results;
}
