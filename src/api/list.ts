import { cleanText, extractNumericId, fetchHtml, ResponseSchemaError } from './common.js';
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
  abstract: string;
  url: string;
}

export interface DoulistPage {
  title: string;
  description: string;
  items: DoulistEntry[];
  nextStart: number | null;
}

export interface Doulist extends Omit<DoulistPage, 'nextStart'> {
  id: string;
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

function entryKind(hostname: string): DoulistEntry['kind'] {
  if (hostname === 'movie.douban.com') return 'movie';
  if (hostname === 'book.douban.com') return 'book';
  if (hostname === 'music.douban.com') return 'music';
  return 'other';
}

export function parseDoulistPage(html: string, url: string): DoulistPage {
  const title = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  if (!title) throw new ResponseSchemaError('豆列页面缺少标题', url);
  const description = cleanText((html.match(/<div class="doulist-about">([\s\S]*?)<\/div>/i)?.[1] ?? '').replace(/<br\s*\/?>/gi, ' '));

  const blocks = html.split(/<div[^>]*class=["']doulist-item["'][^>]*>/i).slice(1);
  const items: DoulistEntry[] = [];
  for (const block of blocks) {
    const link = block.match(/<div class="title">\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let target: URL;
    try {
      target = new URL(link[1], url);
    } catch {
      continue;
    }
    items.push({
      position: Number(block.match(/<span class="pos">\s*(\d+)\s*<\/span>/)?.[1] ?? items.length + 1),
      id: target.pathname.match(/\/subject\/(\d+)/)?.[1] ?? '',
      kind: entryKind(target.hostname),
      title: cleanText(link[2]),
      rating: cleanText(block.match(/<span class="rating_nums">([\s\S]*?)<\/span>/)?.[1] ?? '') || '-',
      abstract: cleanText((block.match(/<div class="abstract">([\s\S]*?)<\/div>/)?.[1] ?? '').replace(/<br\s*\/?>/gi, ' / ')),
      url: target.href
    });
  }
  if (blocks.length > 0 && items.length === 0) {
    throw new ResponseSchemaError('豆列页面未解析出任何条目', url);
  }

  const next = html.match(/<span class="next">[\s\S]*?<a[^>]*href=["'][^"']*[?&](?:amp;)?start=(\d+)/i)?.[1];
  return { title, description, items, nextStart: next === undefined ? null : Number(next) };
}

/**
 * Read a doulist across pages (25 entries each). A failure after the first
 * page keeps what was read and reports it as partial.
 */
export async function getDoulist(
  input: string,
  options: { start?: number; limit?: number; delayMs?: number } = {}
): Promise<Doulist> {
  const id = parseDoulistId(input);
  const url = `https://www.douban.com/doulist/${id}/`;
  const limit = options.limit ?? 25;
  let cursor = options.start ?? 0;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit 必须是正整数');
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error('start 必须是非负整数');

  let first: DoulistPage | undefined;
  let nextStart: number | null = cursor;
  const items: DoulistEntry[] = [];
  const warnings: string[] = [];
  while (nextStart !== null && items.length < limit) {
    if (first) await sleep(options.delayMs ?? 1000);
    let page: DoulistPage;
    try {
      page = parseDoulistPage(await fetchHtml(`${url}?start=${cursor}`, { Referer: url }), url);
    } catch (error) {
      if (!first) throw error;
      warnings.push(`start=${cursor} 读取失败：${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    first ??= page;
    const room = limit - items.length;
    items.push(...page.items.slice(0, room));
    nextStart = page.items.length > room ? cursor + room : page.nextStart;
    if (nextStart !== null && nextStart <= cursor) {
      warnings.push('豆列分页游标没有前进，已停止');
      break;
    }
    if (nextStart !== null) cursor = nextStart;
  }

  return {
    id,
    url,
    title: first?.title ?? '',
    description: first?.description ?? '',
    items,
    next_start: warnings.length > 0 ? cursor : nextStart,
    partial: warnings.length > 0,
    warnings
  };
}
