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

function searchPage(items: Array<{ id: string; title: string }>, errorInfo = ''): Response {
  const data = {
    total: items.length, start: 0, count: 15, error_info: errorInfo,
    items: items.map(({ id, title }) => ({ tpl_name: 'search_subject', id, title, url: `https://movie.douban.com/subject/${id}/` }))
  };
  return new Response(`<script>window.__DATA__ = ${JSON.stringify(data)};</script>`, {
    headers: { 'Content-Type': 'text/html' }
  });
}

type FetchInput = string | URL | Request;

describe('search', () => {
  it('reports throttling instead of an empty result', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: FetchInput) => (
      String(input).includes('subject_suggest') ? Response.json([]) : searchPage([], '搜索访问太频繁。')
    )));
    await expect(searchMovies('沙丘')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('sends an explicitly supplied session on every request', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => (
      String(input).includes('subject_suggest') ? Response.json([]) : searchPage([{ id: '3001114', title: '沙丘' }])
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchMovies('沙丘', 0, 5, { cookies: 'dbcl2=FAKE' })).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('Cookie')))
      .toEqual(['dbcl2=FAKE', 'dbcl2=FAKE']);
  });

  it('retries anonymously when Douban rejects the saved session', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).includes('subject_suggest')) return Response.json([]);
      return new Headers(init?.headers).get('Cookie')
        ? new Response('<title>登录豆瓣</title>', { headers: { 'Content-Type': 'text/html' } })
        : searchPage([{ id: '3001114', title: '沙丘' }]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const warnings: string[] = [];

    await expect(searchMovies('沙丘', 0, 5, { cookies: 'dbcl2=STALE', warnings })).resolves.toHaveLength(1);
    expect(warnings).toEqual([expect.stringContaining('本地登录已失效')]);
  });

  it('warns when a throttled search falls back to suggestions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: FetchInput) => (
      String(input).includes('subject_suggest')
        ? Response.json([{ id: '2567698', title: '三体', type: 'b' }])
        : searchPage([], '搜索访问太频繁。')
    )));
    const warnings: string[] = [];
    await expect(searchBooks('三体', 0, 5, { warnings })).resolves.toHaveLength(1);
    expect(warnings).toEqual([expect.stringContaining('联想结果')]);
  });

  it('classifies throttling and HTTP 429 as RATE_LIMITED with a login hint', async () => {
    process.argv = ['node', 'douban', 'search', '沙丘', '--json'];
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const error of [
      new HttpRequestError('throttled', { code: 'RATE_LIMITED', url: 'https://search.douban.com/' }),
      new HttpRequestError('HTTP 429', { code: 'HTTP_STATUS', status: 429, url: 'https://movie.douban.com/' })
    ]) {
      await withErrorHandler({ command: 'search' }, async () => { throw error; })();
    }
    const errors = stderr.mock.calls.map(([line]) => JSON.parse(String(line)).error);
    expect(errors.map((error) => error.code)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);
    expect(errors[0].suggestion).toContain('douban login');
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
