import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDoulist, parseDoulistId } from '../api/list.ts';
import { getNowShowing } from '../api/movie.ts';
import { parseSubjectRecommendations, resolveRecommendations } from '../api/subject.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discovery', () => {
  it('reads a doulist across pages and reports where a failed read can resume', async () => {
    const entry = (n: number, type: string) => ({
      target_id: String(n), type, title: `条目 ${n}`, url: `https://www.douban.com/x/${n}/`,
      rating: { value: type === 'movie' ? 9.7 : 0 }, subtitle: '1994 / 美国'
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/240962')) return Response.json({ title: '高分榜', desc: '说明\n\n第二行' });
      const start = Number(url.searchParams.get('start'));
      if (start === 0) return Response.json({ total: 5, items: [entry(1, 'movie'), entry(2, 'tv'), entry(3, 'note')] });
      return new Response('busy', { status: 403 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const list = await getDoulist('https://www.douban.com/doulist/240962/', { limit: 5, delayMs: 0 });

    expect(list).toMatchObject({ id: '240962', title: '高分榜', description: '说明 第二行', next_start: 3, partial: true });
    expect(list.items).toEqual([
      expect.objectContaining({ position: 1, id: '1', kind: 'movie', rating: '9.7', meta: '1994 / 美国' }),
      expect.objectContaining({ position: 2, id: '2', kind: 'movie', rating: '-' }),
      expect.objectContaining({ position: 3, id: '', kind: 'other' })
    ]);
    expect(parseDoulistId('240962')).toBe('240962');
    expect(() => parseDoulistId('https://evil.example/doulist/1/')).toThrow('豆列必须是');
  });

  it('parses the recommendation block of movie and book pages only', () => {
    const block = (kind: string, id: string, title: string) =>
      `<dl><dt><a href="https://${kind}.douban.com/subject/${id}/?from=subject-page"><img/></a></dt>
       <dd><a href="https://${kind}.douban.com/subject/${id}/">${title}</a><span class="subject-rate">9.1</span></dd></dl>`;
    const movie = `<div class="recommendations-bd">${block('movie', '1292720', '阿甘正传')}</div>${block('movie', '1', '页面其他位置')}`;
    const book = `<div id="db-rec-section"><div class="content clearfix">${block('book', '5363767', '三体Ⅲ')}</div></div>`;

    expect(parseSubjectRecommendations(movie, 'movie')).toEqual([
      { id: '1292720', title: '阿甘正传', rating: '9.1', url: 'https://movie.douban.com/subject/1292720/' }
    ]);
    expect(parseSubjectRecommendations(book, 'book').map((item) => item.title)).toEqual(['三体Ⅲ']);
    expect(parseSubjectRecommendations('<html></html>', 'book')).toEqual([]);
  });

  it('asks the mobile API for recommendations only when the page has none', async () => {
    const fetchMock = vi.fn(async () => Response.json([
      { id: '1292720', title: '阿甘正传', rating: { value: 9.5 } },
      { id: 'bad', title: '无效条目' }
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const fromPage = [{ id: '1', title: '页面推荐', rating: '9.0', url: 'https://movie.douban.com/subject/1/' }];

    await expect(resolveRecommendations('movie', '1292052', fromPage)).resolves.toBe(fromPage);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(resolveRecommendations('movie', '1292052', [])).resolves.toEqual([
      { id: '1292720', title: '阿甘正传', rating: '9.5', url: 'https://movie.douban.com/subject/1292720/' }
    ]);
    fetchMock.mockResolvedValueOnce(Response.json({ msg: 'unexpected' }));
    await expect(resolveRecommendations('book', '2567698', undefined)).resolves.toEqual([]);
  });

  it('maps the mobile now-showing collection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      start: 0, count: 2, total: 2,
      subject_collection_items: [
        { id: '1', title: '上映中', rating: { value: 7.3 }, release_date: '10.05', card_subtitle: '2026 / 美国' },
        { id: '2', title: '暂无评分', rating: null, release_date: '10.16' }
      ]
    })));

    await expect(getNowShowing(5)).resolves.toEqual([
      expect.objectContaining({ id: '1', rating: '7.3', release_date: '10.05', meta: '2026 / 美国' }),
      expect.objectContaining({ id: '2', rating: '-', release_date: '10.16' })
    ]);
  });
});
