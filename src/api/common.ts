export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
export const BASE = 'https://movie.douban.com';
export const BOOK_BASE = 'https://book.douban.com';
const FETCH_TIMEOUT_MS = 30000;

export async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchHtml(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
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

export function stripTags(text: string): string {
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

export function cleanText(text: string): string {
  return decodeHtml(stripTags(text)).replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(title: string): string {
  return cleanText(title).replace(/\s*\u200e?\([^)]*\)\s*$/, '').trim();
}

export function isChallengePage(html: string): boolean {
  return html.includes('<form name="sec" id="sec"') && html.includes('载入中');
}

export function escapeRegExp(text: string): string {
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
