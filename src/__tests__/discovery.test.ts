import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDoulistId, parseDoulistPage } from '../api/list.ts';
import { getNowShowing } from '../api/movie.ts';
import { parseSubjectRecommendations } from '../api/subject.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('discovery', () => {
  it('parses doulist entries, kinds and the next page cursor', () => {
    const item = (pos: number, url: string, title: string, rating = '') => `
      <div id="${pos}" class="doulist-item"><span class="pos">${pos}</span>
        <div class="title"><a href="${url}">${title}</a></div>
        ${rating ? `<span class="rating_nums">${rating}</span>` : ''}
        <div class="abstract">导演: 某人 <br /> 年份: 1994</div></div>`;
    const html = `<h1><span>高分榜</span></h1><div class="doulist-about">说明<br/>第二行</div>
      ${item(1, 'https://movie.douban.com/subject/1292052/', '肖申克的救赎', '9.7')}
      ${item(2, 'https://book.douban.com/subject/2567698/', '三体')}
      <span class="next"><a href="https://www.douban.com/doulist/240962/?start=25&amp;sort=seq">后页</a></span>`;

    const page = parseDoulistPage(html, 'https://www.douban.com/doulist/240962/');

    expect(page).toMatchObject({ title: '高分榜', description: '说明 第二行', nextStart: 25 });
    expect(page.items).toEqual([
      expect.objectContaining({ position: 1, id: '1292052', kind: 'movie', rating: '9.7', abstract: '导演: 某人 / 年份: 1994' }),
      expect.objectContaining({ position: 2, id: '2567698', kind: 'book', rating: '-' })
    ]);
    expect(parseDoulistId('https://www.douban.com/doulist/240962/')).toBe('240962');
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
