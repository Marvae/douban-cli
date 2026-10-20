import { HttpClient, type HtmlPage } from './http/client.js';
import { HttpRequestError, ResponseSchemaError } from './http/errors.js';

export { HttpClient, type HtmlPage } from './http/client.js';
export { HttpRequestError, ResponseSchemaError } from './http/errors.js';

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const BASE = 'https://movie.douban.com';
export const BOOK_BASE = 'https://book.douban.com';
export const FETCH_TIMEOUT_MS = 30000;

const httpClient = new HttpClient({
  defaultHeaders: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' },
  timeoutMs: FETCH_TIMEOUT_MS
});

/** Options for reads that work anonymously but are throttled far less with a session. */
export interface SessionReadOptions {
  /** Cookie header of an explicitly supplied local session. */
  cookies?: string;
  /** Receives human-readable notes about degraded or partial results. */
  warnings?: string[];
}

export function sessionHeaders(cookies: string | undefined): Record<string, string> {
  const header = cookies?.trim();
  return header ? { Cookie: header } : {};
}

export const STALE_SESSION_WARNING = '本地登录已失效，已改用匿名请求；运行 douban login 重新登录';

/**
 * Run a read with the optional session. If Douban rejects the session, drop it
 * for the rest of the call and retry anonymously once.
 */
export async function withOptionalSession<T>(
  options: SessionReadOptions,
  read: (headers: Record<string, string>) => Promise<T>
): Promise<T> {
  if (!options.cookies?.trim()) return read({});
  try {
    return await read(sessionHeaders(options.cookies));
  } catch (error) {
    if (!(error instanceof HttpRequestError && error.code === 'AUTH_REQUIRED')) throw error;
    options.cookies = undefined;
    if (!options.warnings?.includes(STALE_SESSION_WARNING)) options.warnings?.push(STALE_SESSION_WARNING);
    return read({});
  }
}

/** Search pages report throttling in `__DATA__.error_info` alongside an otherwise valid empty result. */
export function assertSearchAvailable(data: Record<string, unknown>, url: string): void {
  const info = typeof data.error_info === 'string' ? data.error_info.trim() : '';
  if (!info) return;
  if (/频繁|太快|稍后|限制/.test(info)) {
    throw new HttpRequestError(`豆瓣暂时限制了搜索：${info}`, { code: 'RATE_LIMITED', url, retryable: true });
  }
  throw new ResponseSchemaError(`豆瓣搜索返回错误：${info}`, url);
}

export async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return httpClient.getJson<T>(url, headers);
}

export async function fetchHtml(url: string, headers: Record<string, string> = {}): Promise<string> {
  return httpClient.getHtml(url, headers);
}

export async function fetchHtmlPage(url: string, headers: Record<string, string> = {}): Promise<HtmlPage> {
  return httpClient.getHtmlPage(url, headers);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeHtml(text: string): string {
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
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

export function cleanText(text: string): string {
  // Douban titles sometimes carry invisible direction marks that break table alignment.
  return decodeHtml(stripTags(text)).replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(title: string): string {
  return cleanText(title).replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractNumericId(url: string, kind: 'subject' | 'celebrity' | 'doulist' | 'personage'): string {
  const regex = new RegExp(`/${kind}/(\\d+)/`);
  const match = url.match(regex);
  return match ? match[1] : '';
}

export function extractField(infoHtml: string, label: string): string {
  const pattern = new RegExp(
    `<span[^>]*class="pl"[^>]*>\\s*${escapeRegExp(label)}\\s*[:：]?\\s*<\\/span>\\s*:?\\s*([\\s\\S]*?)(?:<br\\/?\\s*>|<\\/span>\\s*<br\\/?\\s*>)`,
    'i'
  );
  const match = infoHtml.match(pattern);
  return match ? cleanText(match[1]).replace(/^:/, '').trim() : '';
}

export function extractWindowJsonObject(html: string, variable = '__DATA__'): string | null {
  const marker = `window.${variable}`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;

  const equalIndex = html.indexOf('=', markerIndex + marker.length);
  if (equalIndex < 0) return null;

  let start = equalIndex + 1;
  while (start < html.length && /\s/.test(html[start] || '')) {
    start += 1;
  }
  if (html[start] !== '{') return null;

  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (typeof ch !== 'string') break;

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, i + 1);
      }
    }
  }

  return null;
}
