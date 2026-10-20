import { cleanText, extractNumericId, fetchHtml, fetchJson, isRecord, ResponseSchemaError } from './common.js';
import { sleep } from '../utils/timing.js';

export interface DoulistItem {
  id: string;
  title: string;
  author: string;
  followers: string;
  recent: string;
  url: string;
}

/**
 * Get hot doulist recommendations from https://www.douban.com/doulist/
 */
export async function getHotLists(limit = 20): Promise<DoulistItem[]> {
  if (!Number.isInteger(limit) || limit <= 0) return [];

  const html = await fetchHtml('https://www.douban.com/doulist/', {
    Referer: 'https://www.douban.com/'
  });

  const results: DoulistItem[] = [];
  const itemRegex = /<li[^>]*class=["'][^"']*\bdoulist-item\b[^"']*["'][^>]*>[\s\S]*?<\/li>/gi;

  let match;
  while ((match = itemRegex.exec(html)) !== null && results.length < limit) {
    const block = match[0];

    const linkMatch = block.match(/<div[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>\s*<a[^>]*href=["'](https:\/\/www\.douban\.com\/doulist\/(\d+)\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>\s*<\/div>/i);
    if (!linkMatch) continue;

    const metaMatch = block.match(/<p class="meta">([\s\S]*?)<\/p>/);
    const recentMatch = block.match(/<div class="bd doulist-note">[\s\S]*?<div class="title">\s*<a[^>]*>([\s\S]*?)<\/a>/);

    const metaText = metaMatch ? cleanText(metaMatch[1]) : '';
    const authorMatch = metaText.match(/^(.*?)创建/);
    const followersMatch = metaText.match(/(\d+)\s*关注/);

    results.push({
      id: linkMatch[2] || extractNumericId(linkMatch[1], 'doulist'),
      title: cleanText(linkMatch[3]),
      author: authorMatch ? cleanText(authorMatch[1]) : '-',
      followers: followersMatch ? followersMatch[1] : '-',
      recent: recentMatch ? cleanText(recentMatch[1]) : '-',
      url: linkMatch[1]
    });
  }

  if (results.length === 0) {
    throw new ResponseSchemaError('热门豆列页面未解析出预期条目', 'https://www.douban.com/doulist/');
  }

  return results;
}

export interface DoulistEntry {
  position: number;
  /** Subject ID when the entry links to a movie, book or music subject. */
  id: string;
  kind: 'movie' | 'book' | 'music' | 'other';
  title: string;
  rating: string;
  /** Year, region, genre and people, or author and publisher. */
  meta: string;
  url: string;
}

export interface Doulist {
  id: string;
  title: string;
  description: string;
  items: DoulistEntry[];
  url: string;
  next_start: number | null;
  partial: boolean;
  warnings: string[];
}

/** Accept a numeric doulist ID or a https://www.douban.com/doulist/<id>/ URL. */
export function parseDoulistId(input: string): string {
  const value = input.trim();
  if (/^\d+$/.test(value)) return value;
  try {
    const url = new URL(value);
    const id = url.pathname.match(/^\/doulist\/(\d+)\/?$/)?.[1];
    if (url.protocol === 'https:' && url.hostname === 'www.douban.com' && id) return id;
  } catch {
    // Reported below with the accepted formats.
  }
  throw new Error('豆列必须是数字 ID 或 https://www.douban.com/doulist/<id>/ 地址');
}

const DOULIST_API = 'https://m.douban.com/rexxar/api/v2/doulist';

function parseDoulistEntry(item: unknown, position: number): DoulistEntry | null {
  if (!isRecord(item)) return null;
  const title = typeof item.title === 'string' ? cleanText(item.title) : '';
  const url = typeof item.url === 'string' ? item.url : '';
  if (!title || !url) return null;
  // Series count as movies so `movie <id>` follows up on them.
  const kind = item.type === 'movie' || item.type === 'tv' ? 'movie'
    : item.type === 'book' || item.type === 'music' ? item.type
      : 'other';
  const rating = isRecord(item.rating) ? item.rating.value : undefined;
  return {
    position,
    id: kind === 'other' ? '' : String(item.target_id ?? ''),
    kind,
    title,
    rating: typeof rating === 'number' && rating > 0 ? rating.toFixed(1) : '-',
    meta: typeof item.subtitle === 'string' ? cleanText(item.subtitle) : '',
    url
  };
}

/**
 * Read a doulist through the mobile API, up to 50 entries per request. A
 * failure after the first page keeps what was read and reports it as partial.
 */
export async function getDoulist(
  input: string,
  options: { start?: number; limit?: number; delayMs?: number } = {}
): Promise<Doulist> {
  const id = parseDoulistId(input);
  const limit = options.limit ?? 25;
  const start = options.start ?? 0;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit 必须是正整数');
  if (!Number.isInteger(start) || start < 0) throw new Error('start 必须是非负整数');

  const headers = { Referer: `https://m.douban.com/doulist/${id}/` };
  const info = await fetchJson<unknown>(`${DOULIST_API}/${id}`, headers);
  if (!isRecord(info) || typeof info.title !== 'string') {
    throw new ResponseSchemaError('豆列接口返回格式异常', `${DOULIST_API}/${id}`);
  }

  const items: DoulistEntry[] = [];
  const warnings: string[] = [];
  let cursor = start;
  let total = Number.POSITIVE_INFINITY;
  while (items.length < limit && cursor < total) {
    if (cursor > start) await sleep(options.delayMs ?? 1000);
    const url = `${DOULIST_API}/${id}/items?start=${cursor}&count=${Math.min(50, limit - items.length)}`;
    let entries: unknown[];
    try {
      const data = await fetchJson<unknown>(url, headers);
      if (!isRecord(data) || !Array.isArray(data.items) || typeof data.total !== 'number') {
        throw new ResponseSchemaError('豆列条目接口返回格式异常', url);
      }
      entries = data.items.slice(0, limit - items.length);
      total = data.total;
    } catch (error) {
      if (cursor === start) throw error;
      warnings.push(`start=${cursor} 读取失败：${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    if (entries.length === 0) break;
    entries.forEach((item, index) => {
      const entry = parseDoulistEntry(item, cursor + index + 1);
      if (entry) items.push(entry);
    });
    cursor += entries.length;
  }

  return {
    id,
    url: `https://www.douban.com/doulist/${id}/`,
    title: cleanText(info.title),
    description: typeof info.desc === 'string' ? cleanText(info.desc) : '',
    items,
    next_start: cursor < total ? cursor : null,
    partial: warnings.length > 0,
    warnings
  };
}
