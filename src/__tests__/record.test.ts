import { afterEach, describe, expect, it, vi } from 'vitest';
import { editSubjectRecord, parseRecordForm } from '../api/record.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Shape captured from movie.douban.com/j/subject/<id>/interest for a private, rated record.
function formPayload(record: { status?: string; rating?: string; comment?: string; tags?: string[]; private?: boolean } = {}) {
  const status = record.status ?? 'collect';
  return {
    interest_status: status,
    tags: record.tags ?? ['科幻'],
    my_tags: ['科幻', '经典'],
    html: `<form action="https://movie.douban.com/j/subject/1292052/interest" method="post">
      <input type="radio" value="wish" name="interest" ${status === 'wish' ? 'checked' : ''}/>
      <input type="radio" value="collect" name="interest" ${status === 'collect' ? 'checked' : ''}/>
      <input id="n_rating" type="hidden" value="${record.rating ?? '4'}" name="rating" />
      <input id="foldcollect" name="foldcollect" value="F" type="hidden"/>
      <input name="tags" type="text" class="inp-tags">
      <textarea name="comment" class="comment" maxlength="350">${record.comment ?? '好看 &amp; 值得'}</textarea>
      <input id="inp-private" name="private" type="checkbox" ${record.private === false ? '' : 'checked=&#34;checked&#34;'} />
      <input id="share-shuo" name="share-shuo" value="douban" type="checkbox" />
      <input name="save" type="submit" value="保存">
    </form>`
  };
}

describe('record form', () => {
  it('reads status, rating, comment, tags and privacy from the edit form', () => {
    const { record, passthrough } = parseRecordForm(formPayload(), 'movie', '1292052');
    expect(record).toMatchObject({ status: 'collect', rating: 4, comment: '好看 & 值得', tags: ['科幻'], private: true });
    expect(passthrough).toEqual({ foldcollect: 'F' });
  });

  it('changes only the patched field and keeps privacy, tags and the comment', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(formPayload()))
      .mockResolvedValueOnce(Response.json({ r: 0 }))
      .mockResolvedValueOnce(Response.json(formPayload({ rating: '5' })));
    vi.stubGlobal('fetch', fetchMock);

    const change = await editSubjectRecord('movie', '1292052', { status: 'collect', rating: 5 }, 'dbcl2=FAKE; ck=FAKECK');

    const body = new URLSearchParams(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(Object.fromEntries(body)).toEqual({
      foldcollect: 'F', interest: 'collect', rating: '5', tags: '科幻', comment: '好看 & 值得', private: 'on', ck: 'FAKECK'
    });
    expect(body.has('share-shuo')).toBe(false);
    expect(change).toMatchObject({ changed: true, before: { rating: 4 }, after: { rating: 5, private: true } });
  });

  it('drops the rating when moving to 想看, which Douban cannot rate', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Response.json(formPayload())));
    const change = await editSubjectRecord('movie', '1292052', { status: 'wish' }, 'dbcl2=FAKE', { dryRun: true });
    expect(change.after).toMatchObject({ status: 'wish', rating: null, private: true });
    await expect(editSubjectRecord('movie', '1292052', { status: 'wish', rating: 3 }, 'dbcl2=FAKE', { dryRun: true }))
      .rejects.toThrow('不能评分');
  });

  it('previews without writing', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(formPayload()));
    vi.stubGlobal('fetch', fetchMock);

    const change = await editSubjectRecord('movie', '1292052', { private: false }, 'dbcl2=FAKE; ck=FAKECK', { dryRun: true });

    expect(change).toMatchObject({ dryRun: true, changed: true, after: { private: false } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('fails when the record read back differs from what was submitted', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(formPayload()))
      .mockResolvedValueOnce(Response.json({ r: 0 }))
      .mockResolvedValueOnce(Response.json(formPayload())));

    await expect(editSubjectRecord('movie', '1292052', { rating: 5 }, 'dbcl2=FAKE; ck=FAKECK'))
      .rejects.toThrow('读回的记录与预期不一致');
  });
});
