import {
  BOOK_BASE,
  cleanText,
  extractField,
  extractWindowJsonObject,
  fetchHtml,
  isChallengePage,
  normalizeTitle
} from './common.js';

export interface BookItem {
  id: string;
  title: string;
  rating: string;
  votes: string;
  meta: string;
  url: string;
}

export interface BookSearchItem {
  id: string;
  title: string;
  rating: string;
  year?: string;
  url: string;
  cover?: string;
  abstract?: string;
}

export interface BookDetail {
  id: string;
  title: string;
  rating: string;
  author: string;
  publisher: string;
  pubdate: string;
  pages: string;
  price: string;
  isbn: string;
  summary: string;
  url: string;
}

function parseBookSearchFromHtml(html: string, limit: number): BookSearchItem[] {
  const rawData = extractWindowJsonObject(html, '__DATA__');
  if (!rawData) throw new Error('图书搜索页未找到完整的 __DATA__ JSON 数据');

  const data = JSON.parse(rawData) as {
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

  return (data.items || [])
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
}

/**
 * Get Douban Book Top250 list.
 */
export async function getBookHot(start = 0, limit = 20): Promise<BookItem[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const results: BookItem[] = [];
  const tableRegex = /<table width="100%">([\s\S]*?)<\/table>/g;
  const seen = new Set<string>();
  let pageStart = Math.max(0, start);

  while (results.length < limit) {
    const html = await fetchHtml(`${BOOK_BASE}/top250?start=${pageStart}`, { Referer: BOOK_BASE });
    if (isChallengePage(html)) throw new Error('图书 Top 页面触发了反爬挑战，暂时无法解析');

    let tableMatch;
    let addedThisPage = 0;
    while ((tableMatch = tableRegex.exec(html)) !== null && results.length < limit) {
      const block = tableMatch[1];
      const idMatch = block.match(/href="https:\/\/book\.douban\.com\/subject\/(\d+)\/"/);
      const titleMatch = block.match(/<a[^>]*title="([^"]+)"[^>]*>/);
      const ratingMatch = block.match(/<span class="rating_nums">([^<]+)<\/span>/);
      const votesMatch = block.match(/<span class="pl">\(([\s\S]*?)\)<\/span>/);
      const metaMatch = block.match(/<p class="pl">([\s\S]*?)<\/p>/);

      if (!idMatch || !titleMatch) continue;
      const id = idMatch[1];
      if (seen.has(id)) continue;
      seen.add(id);
      addedThisPage += 1;

      results.push({
        id,
        title: normalizeTitle(titleMatch[1]),
        rating: ratingMatch ? cleanText(ratingMatch[1]) : '-',
        votes: votesMatch ? cleanText(votesMatch[1]) : '-',
        meta: metaMatch ? cleanText(metaMatch[1]) : '-',
        url: `https://book.douban.com/subject/${id}/`
      });
    }

    tableRegex.lastIndex = 0;
    if (addedThisPage === 0) break;
    pageStart += 25;
  }

  return results;
}

/**
 * Search books by keyword.
 */
export async function searchBooks(keyword: string, start = 0, limit = 20): Promise<BookSearchItem[]> {
  const query = keyword.trim();
  if (!query) return [];
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const url = `https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(query)}&cat=1001&start=${start}`;
  const html = await fetchHtml(url, { Referer: 'https://www.douban.com/' });
  if (isChallengePage(html)) throw new Error('图书搜索页面触发了反爬挑战，暂时无法解析');

  return parseBookSearchFromHtml(html, limit);
}

/**
 * Get book detail from subject page.
 */
export async function getBookInfo(id: string): Promise<BookDetail> {
  const bookId = id.trim();
  if (!/^\d+$/.test(bookId)) throw new Error('书籍 ID 必须是纯数字');

  const url = `${BOOK_BASE}/subject/${bookId}/`;
  const html = await fetchHtml(url, { Referer: BOOK_BASE });
  if (isChallengePage(html)) throw new Error('书籍详情页面触发了反爬挑战，暂时无法解析');

  const titleMatch = html.match(/<span\s+property="v:itemreviewed"[^>]*>([\s\S]*?)<\/span>/);
  if (!titleMatch) throw new Error(`解析书籍详情失败，ID=${bookId}`);

  const ratingMatch = html.match(/<strong[^>]*property="v:average"[^>]*>([\s\S]*?)<\/strong>/)
    || html.match(/<strong[^>]*class="[^"]*rating_num[^"]*"[^>]*>([\s\S]*?)<\/strong>/);

  const infoMatch = html.match(/<div id="info"[^>]*>([\s\S]*?)<\/div>/);
  const infoHtml = infoMatch ? infoMatch[1] : '';

  const hiddenSummaryMatch = html.match(/<div class="indent" id="link-report">[\s\S]*?<span class="all hidden">([\s\S]*?)<\/span>/);
  const normalSummaryMatch = html.match(/<div class="indent" id="link-report">[\s\S]*?<div class="intro">([\s\S]*?)<\/div>/);
  const summary = hiddenSummaryMatch
    ? cleanText(hiddenSummaryMatch[1])
    : normalSummaryMatch
      ? cleanText(normalSummaryMatch[1])
      : '';

  return {
    id: bookId,
    title: normalizeTitle(titleMatch[1]),
    rating: ratingMatch ? cleanText(ratingMatch[1]) : '-',
    author: extractField(infoHtml, '作者') || '-',
    publisher: extractField(infoHtml, '出版社') || '-',
    pubdate: extractField(infoHtml, '出版年') || '-',
    pages: extractField(infoHtml, '页数') || '-',
    price: extractField(infoHtml, '定价') || '-',
    isbn: extractField(infoHtml, 'ISBN') || '-',
    summary: summary || '-',
    url
  };
}
