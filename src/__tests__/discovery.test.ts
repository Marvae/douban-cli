import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDoulist, parseDoulistId } from '../api/list.ts';
import { getNowShowing } from '../api/movie.ts';
import { parseSubjectRecommendations, resolveRecommendations } from '../api/subject.ts';
import { getTrending } from '../api/trending.ts';

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

  it('maps the real-time hot chart: heat, trend, unrated reason and per-type links', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      start: 0, count: 4, total: 20,
      subject_collection: { name: '实时热门书影音', updated_at: '2026-10-30 07:20:52' },
      subject_collection_items: [
        { id: '37100984', type: 'tv', type_name: '综艺', title: '后会友期', year: '2026', rank_value: 1, rank_value_changed: 0,
          trend_equal: true, score: 62163720, rating: { value: 0, count: 0 }, null_rating_reason: '暂无评分' },
        { id: '37322586', type: 'movie', type_name: '电影', title: '生日快乐', year: '2025', rank_value: 2, rank_value_changed: 1,
          trend_up: true, score: 640720, rating: { value: 8.9, count: 20956 }, null_rating_reason: '' },
        { id: '2567698', type: 'book', type_name: '图书', title: '三体', rank_value: 3, rank_value_changed: -2,
          trend_down: true, score: 1200, rating: { value: 8.9 } },
        { id: '1', type: 'tv', type_name: '电视剧', title: '新剧', rank_value: 4, is_new: true, score: 900 }
      ]
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getTrending('all', 20);

    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/subject_collection/subject_real_time_hotest/items?start=0&count=20');
    expect(result).toMatchObject({ chart: 'all', name: '实时热门书影音', updated_at: '2026-10-30 07:20:52' });
    expect(result.items).toEqual([
      expect.objectContaining({ rank: 1, title: '后会友期', type_name: '综艺', rating: '-', rating_note: '暂无评分', heat: 62163720, trend: 'stay',
        url: 'https://movie.douban.com/subject/37100984/' }),
      expect.objectContaining({ rank: 2, rating: '8.9', rating_note: '', trend: 'up 1', url: 'https://movie.douban.com/subject/37322586/' }),
      expect.objectContaining({ rank: 3, type: 'book', trend: 'down 2', url: 'https://book.douban.com/subject/2567698/' }),
      expect.objectContaining({ rank: 4, trend: 'new' })
    ]);
  });

  it('reads the movie and TV tabs from their own charts and rejects a malformed chart', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      subject_collection_items: [{ id: '1', type: 'movie', title: '电影', rank_value: 1, score: 10 }]
    }));
    vi.stubGlobal('fetch', fetchMock);

    await getTrending('movie', 10);
    await getTrending('tv', 5);
    expect(fetchMock.mock.calls.map((call) => new URL(String((call as unknown[])[0])).pathname)).toEqual([
      '/rexxar/api/v2/subject_collection/movie_real_time_hotest/items',
      '/rexxar/api/v2/subject_collection/tv_real_time_hotest/items'
    ]);

    fetchMock.mockResolvedValueOnce(Response.json({ subject_collection_items: [{ title: '没有 ID' }] }));
    await expect(getTrending('all')).rejects.toThrow('实时热门包含无效条目');
    fetchMock.mockResolvedValueOnce(Response.json({ subject_collection_items: [] }));
    await expect(getTrending('all')).rejects.toThrow('实时热门没有返回条目');
  });
});
