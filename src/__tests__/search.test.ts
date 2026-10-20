import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseIsbn, resolveBookIdByIsbn, searchBooks } from '../api/book.ts';
import { HttpRequestError } from '../api/http/errors.ts';
import { searchMovies } from '../api/search.ts';
import { withErrorHandler } from '../utils/error.ts';

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Hit = { id: string; title: string; type: string; year?: string; rating?: number };

function searchResponse(hits: Hit[], total = hits.length, start = 0): Response {
  return Response.json({
    banned: '', start, count: 20, total,
    items: hits.map((hit) => ({
      target_type: hit.type,
      target: { id: hit.id, title: hit.title, year: hit.year, rating: { value: hit.rating ?? 0, count: 10 }, card_subtitle: '中国 / 剧情' }
    }))
  });
}

const hitsFrom = (start: number, count: number): Hit[] => Array.from({ length: count }, (_, index) => (
  { id: String(start + index + 1), title: `电影 ${start + index + 1}`, type: 'movie' }
));

describe('search', () => {
  it('keeps movies and series, drops other kinds and reads year and rating', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => searchResponse([
      { id: '1', title: '醉梦', type: 'tv', year: '2026', rating: 7.9 },
      { id: '2', title: '醉梦', type: 'book' },
      { id: '3', title: '醉梦人', type: 'movie' }
    ])));

    await expect(searchMovies('醉梦')).resolves.toEqual([
      expect.objectContaining({ id: '1', type: 'tv', year: '2026', rating: '7.9', meta: '中国 / 剧情' }),
      expect.objectContaining({ id: '3', type: 'movie', rating: '-' })
    ]);
  });

  it('pages through results and keeps them when a later page fails', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const start = Number(new URL(String(input)).searchParams.get('start'));
      return start === 0 ? searchResponse(hitsFrom(0, 20), 60) : new Response('busy', { status: 403 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const warnings: string[] = [];

    await expect(searchMovies('测试', 0, 30, { warnings })).resolves.toHaveLength(20);
    expect(warnings).toEqual([expect.stringContaining('结果可能不完整')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps book results to book list items', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => searchResponse([{ id: '34800934', title: '在森崎书店的日子', type: 'book', rating: 7.6 }])));
    await expect(searchBooks('森崎书店')).resolves.toEqual([
      expect.objectContaining({ id: '34800934', rating: '7.6', rating_count: 10, meta: '中国 / 剧情' })
    ]);
  });

  it('sends an explicitly supplied session and retries anonymously when it is rejected', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => (
      new Headers(init?.headers).get('Cookie')
        ? new Response('<title>登录豆瓣</title>', { headers: { 'Content-Type': 'text/html' } })
        : searchResponse(hitsFrom(0, 1))
    ));
    vi.stubGlobal('fetch', fetchMock);
    const warnings: string[] = [];

    await expect(searchMovies('沙丘', 0, 5, { cookies: 'dbcl2=STALE', warnings })).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('Cookie'))).toEqual(['dbcl2=STALE', null]);
    expect(warnings).toEqual([expect.stringContaining('本地登录已失效')]);
  });

  it('classifies HTTP 429 as RATE_LIMITED with a login hint', async () => {
    process.argv = ['node', 'douban', 'search', '沙丘', '--json'];
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await withErrorHandler({ command: 'search' }, async () => {
      throw new HttpRequestError('HTTP 429', { code: 'HTTP_STATUS', status: 429, url: 'https://m.douban.com/' });
    })();
    const error = JSON.parse(String(stderr.mock.calls[0]?.[0])).error;
    expect(error).toMatchObject({ code: 'RATE_LIMITED', suggestion: expect.stringContaining('douban login') });
  });
});

describe('ISBN', () => {
  it('normalizes ISBN-10 and ISBN-13 input and rejects subject IDs', () => {
    expect(parseIsbn('978-7-5366-9293-0')).toBe('9787536692930');
    expect(parseIsbn('753669293x')).toBe('753669293X');
    expect(parseIsbn('2567698')).toBeNull();
  });

  it('resolves the subject through the /isbn/ redirect', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const response = new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: 'https://book.douban.com/subject/36892731/' });
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveBookIdByIsbn('9787536692930')).resolves.toBe('36892731');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://book.douban.com/isbn/9787536692930/');
  });
});
