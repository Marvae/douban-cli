import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchBooks: vi.fn(),
  searchMovies: vi.fn(),
  resolveBookIdByIsbn: vi.fn(),
  getOptionalSessionCookies: vi.fn(),
  canPrompt: vi.fn(),
  ask: vi.fn()
}));

vi.mock('../api/book.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/book.ts')>()),
  searchBooks: mocks.searchBooks,
  resolveBookIdByIsbn: mocks.resolveBookIdByIsbn
}));
vi.mock('../api/search.js', () => ({ searchMovies: mocks.searchMovies }));
vi.mock('../auth/index.js', () => ({
  getOptionalSessionCookies: mocks.getOptionalSessionCookies
}));
vi.mock('../ui/prompt.js', () => ({
  canPrompt: mocks.canPrompt,
  ask: mocks.ask
}));

import { formatResolvedLabel, resolveSubject } from '../commands/resolve.ts';
import { CliArgumentError } from '../utils/error.ts';

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function book(partial: { id: string; title: string; rating?: string; rating_count?: number; meta?: string }): {
  id: string;
  title: string;
  rating: string;
  rating_count: number;
  meta: string;
  url: string;
} {
  return {
    rating: '8.8',
    rating_count: 100,
    meta: '刘慈欣 / 重庆出版社 / 2008',
    url: `https://book.douban.com/subject/${partial.id}/`,
    ...partial
  };
}

const threeBody = [
  book({ id: '1', title: '三体Ⅱ', meta: '刘慈欣 / 重庆出版社 / 2008' }),
  book({ id: '2567698', title: '三体', rating: '8.8', rating_count: 500000, meta: '刘慈欣 / 重庆出版社 / 2008' }),
  book({ id: '6414884', title: '三体', rating: '9.1', rating_count: 1000, meta: '刘慈欣 / 重庆出版社 / 2016' })
];

function movie(partial: {
  id: string;
  title: string;
  type?: 'movie' | 'tv';
  year?: string;
  rating?: string;
  rating_count?: number;
  meta?: string;
}): {
  id: string;
  title: string;
  type: 'movie' | 'tv';
  year?: string;
  rating: string;
  rating_count: number;
  meta: string;
  url: string;
} {
  return {
    type: 'movie',
    rating: '8.0',
    rating_count: 100,
    meta: '美国 / 科幻',
    url: `https://movie.douban.com/subject/${partial.id}/`,
    ...partial
  };
}

describe('resolveSubject', () => {
  it('resolves a book ISBN without searching', async () => {
    mocks.resolveBookIdByIsbn.mockResolvedValue('2567698');
    await expect(resolveSubject('book', '978-7-5366-9293-0', true)).resolves.toEqual({
      id: '2567698',
      searched: false
    });
    expect(mocks.searchBooks).not.toHaveBeenCalled();
  });

  it('lists same-title editions and uses the first when it cannot prompt', async () => {
    mocks.getOptionalSessionCookies.mockResolvedValue(undefined);
    mocks.searchBooks.mockResolvedValue(threeBody);
    mocks.canPrompt.mockReturnValue(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(resolveSubject('book', '三体', false)).resolves.toEqual({
      id: '2567698',
      title: '三体',
      searched: true,
      rating: '8.8',
      meta: '刘慈欣 / 重庆出版社 / 2008'
    });
    const output = log.mock.calls.map(([line]) => String(line)).join('\n');
    expect(output).toContain('有 2 个版本，使用 2567698');
    expect(output).toContain('2567698');
    expect(output).toContain('6414884');
    expect(output).toContain('刘慈欣 / 重庆出版社 / 2016');
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it('lets a terminal pick a later edition instead of the first hit', async () => {
    mocks.getOptionalSessionCookies.mockResolvedValue(undefined);
    mocks.searchBooks.mockResolvedValue(threeBody);
    mocks.canPrompt.mockReturnValue(true);
    mocks.ask.mockResolvedValue('2');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(resolveSubject('book', '三体', false)).resolves.toEqual({
      id: '6414884',
      title: '三体',
      searched: true,
      rating: '9.1',
      meta: '刘慈欣 / 重庆出版社 / 2016',
      picked: true
    });
    expect(String(error.mock.calls.flat().join('\n'))).toContain('有 2 个版本');
    expect(mocks.ask).toHaveBeenCalledWith('编号，回车用 1，q 取消：');
    expect(String(log.mock.calls[0]?.[0])).toContain('《三体》(6414884) 9.1 · 刘慈欣 / 重庆出版社 / 2016');
  });

  it('cancels when the user declines the edition list', async () => {
    mocks.getOptionalSessionCookies.mockResolvedValue(undefined);
    mocks.searchBooks.mockResolvedValue(threeBody);
    mocks.canPrompt.mockReturnValue(true);
    mocks.ask.mockResolvedValue('q');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(resolveSubject('book', '三体', false)).rejects.toBeInstanceOf(CliArgumentError);
    await expect(resolveSubject('book', '三体', false)).rejects.toThrow('已取消');
  });

  it('puts every edition on stderr for JSON instead of prompting', async () => {
    mocks.getOptionalSessionCookies.mockResolvedValue(undefined);
    mocks.searchBooks.mockResolvedValue(threeBody);
    mocks.canPrompt.mockReturnValue(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(resolveSubject('book', '三体', true)).resolves.toMatchObject({ id: '2567698', searched: true });
    const warning = String(error.mock.calls.flat().join('\n'));
    expect(warning).toContain('有 2 个版本，当前 2567698');
    expect(warning).toContain('6414884 9.1 刘慈欣 / 重庆出版社 / 2016');
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it('lists search hits when the title does not match exactly', async () => {
    mocks.getOptionalSessionCookies.mockResolvedValue(undefined);
    mocks.searchBooks.mockResolvedValue([book({ id: '1', title: '三体Ⅱ' })]);
    mocks.canPrompt.mockReturnValue(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(resolveSubject('book', '三体全集', false)).resolves.toMatchObject({
      id: '1',
      title: '三体Ⅱ',
      searched: true
    });
    expect(String(log.mock.calls[0]?.[0])).toContain('未找到与“三体全集”完全同名的图书');
  });

  it('picks an exact movie title even when a sequel ranked first', async () => {
    mocks.getOptionalSessionCookies.mockResolvedValue(undefined);
    mocks.searchMovies.mockResolvedValue([
      movie({ id: '35593344', title: '沙丘2', year: '2024' }),
      movie({ id: '3001114', title: '沙丘', year: '2021', rating: '7.9' })
    ]);
    mocks.canPrompt.mockReturnValue(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(resolveSubject('movie', '沙丘', false)).resolves.toMatchObject({
      id: '3001114',
      title: '沙丘',
      searched: true
    });
    expect(mocks.searchMovies).toHaveBeenCalledWith('沙丘', 0, 10, expect.anything());
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(String(log.mock.calls[0]?.[0])).toContain('《沙丘》(3001114)');
  });

  it('lists same-title movies and series instead of taking the first hit', async () => {
    mocks.getOptionalSessionCookies.mockResolvedValue(undefined);
    mocks.searchMovies.mockResolvedValue([
      movie({ id: '1', title: '醉梦', type: 'tv', year: '2026', rating: '7.9', meta: '陈凯歌' }),
      movie({ id: '2', title: '醉梦', type: 'movie', year: '2024', rating: '6.1', meta: '剧情' }),
      movie({ id: '3', title: '醉梦人', year: '2020' })
    ]);
    mocks.canPrompt.mockReturnValue(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(resolveSubject('movie', '醉梦', false)).resolves.toMatchObject({ id: '1', title: '醉梦' });
    const output = log.mock.calls.map(([line]) => String(line)).join('\n');
    expect(output).toContain('有 2 部同名作品，使用 1');
    expect(output).toContain('剧集');
    expect(output).toContain('电影');
    expect(output).not.toContain('醉梦人');
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it('does not list editions when a single title matches', async () => {
    mocks.getOptionalSessionCookies.mockResolvedValue(undefined);
    mocks.searchBooks.mockResolvedValue([
      book({ id: '34800934', title: '在森崎书店的日子', rating: '7.6', meta: '酒井顺子' })
    ]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(resolveSubject('book', '在森崎书店的日子', true)).resolves.toEqual({
      id: '34800934',
      title: '在森崎书店的日子',
      searched: true,
      rating: '7.6',
      meta: '酒井顺子'
    });
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

describe('formatResolvedLabel', () => {
  it('joins rating and edition after the title', () => {
    expect(formatResolvedLabel({
      id: '2567698',
      title: '三体',
      rating: '8.8',
      meta: '刘慈欣 / 重庆出版社 / 2008'
    })).toBe('《三体》(2567698) 8.8 · 刘慈欣 / 重庆出版社 / 2008');
    expect(formatResolvedLabel({ id: '1', title: '醉梦' })).toBe('《醉梦》(1)');
  });
});
