import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SUBJECT_ACTIONS,
  createReview,
  decodeExplicitMutation,
  followUser,
  removeSubjectInterest,
  submitSubjectInterestForm
} from '../api/mutations.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function requestHeaders(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): Headers {
  const init = fetchMock.mock.calls[callIndex][1] as RequestInit;
  return new Headers(init.headers);
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0): URLSearchParams {
  const init = fetchMock.mock.calls[callIndex][1] as RequestInit;
  return new URLSearchParams(String(init.body));
}

describe('mutation contracts', () => {
  it('rejects ambiguous and conflicting success objects', () => {
    expect(() => decodeExplicitMutation({})).toThrow('缺少明确的成功状态');
    expect(() => decodeExplicitMutation({ r: false })).toThrow();
    expect(() => decodeExplicitMutation({ r: 0, ok: false })).toThrow();
    expect(() => decodeExplicitMutation({ r: 0, error: 'denied' })).toThrow('denied');
    expect(() => decodeExplicitMutation({ r: 0, error: { code: 'denied' } })).toThrow();
    expect(() => decodeExplicitMutation({ ok: true, status: 'error' })).toThrow();
    expect(decodeExplicitMutation({ r: 0 })).toMatchObject({ r: 0 });
  });

  it('posts the complete form to the subject origin with a ck token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ r: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await submitSubjectInterestForm(
      SUBJECT_ACTIONS.book,
      '2567698',
      { interest: 'collect', rating: '5', comment: '', private: undefined },
      'dbcl2=book-interest',
      'book-ck'
    );

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://book.douban.com/j/subject/2567698/interest');
    expect(requestHeaders(fetchMock).get('Origin')).toBe('https://book.douban.com');
    expect(Object.fromEntries(requestBody(fetchMock))).toEqual({ interest: 'collect', rating: '5', comment: '', ck: 'book-ck' });
  });

  it('removes a record through the subject page form and rejects a login redirect', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://book.douban.com/subject/2567698/' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://accounts.douban.com/passport/login' } }));
    vi.stubGlobal('fetch', fetchMock);

    await removeSubjectInterest(SUBJECT_ACTIONS.book, '2567698', 'dbcl2=remove', 'remove-ck');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://book.douban.com/subject/2567698/remove');
    expect(Object.fromEntries(requestBody(fetchMock))).toEqual({ ck: 'remove-ck' });
    await expect(removeSubjectInterest(SUBJECT_ACTIONS.book, '2567698', 'dbcl2=remove', 'remove-ck')).rejects.toThrow('登录');
  });

  it('rejects an untrusted subject action host before sending cookies', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitSubjectInterestForm(
      { kind: 'movie', baseUrl: 'https://movie.douban.com.evil.example' },
      '1292052',
      { interest: 'wish' },
      'dbcl2=must-not-leak',
      'movie-ck'
    )).rejects.toThrow('非受信任地址');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires review creation to return an id and uses the movie origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ r: 0, id: '98765' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createReview('1292052', 'Title', 'Body', 'dbcl2=review-ok', 'review-ck'))
      .resolves.toEqual({ id: '98765', url: 'https://movie.douban.com/review/98765/' });
    expect(requestHeaders(fetchMock).get('Origin')).toBe('https://movie.douban.com');
  });

  it('fails closed when review creation has no id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ r: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createReview('1292052', 'Title', 'Body', 'dbcl2=review-no-id', 'review-ck'))
      .rejects.toThrow('未返回有效的长评 ID');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('uses a fallback only for an explicitly unsupported endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(Response.json({ r: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await followUser('alice', 'dbcl2=follow-fallback', 'follow-ck');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/j/contact/follow/alice');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/j/contact/add');
    expect(requestHeaders(fetchMock, 0).get('Origin')).toBe('https://www.douban.com');
  });

  it('refreshes an expired ck before considering an unsupported-endpoint fallback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('ck expired', { status: 404 }))
      .mockResolvedValueOnce(new Response('<input name="ck" value="fresh-ck">', { status: 200 }))
      .mockResolvedValueOnce(Response.json({ r: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await followUser('alice', 'dbcl2=follow-refresh', 'stale-ck');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/j/contact/follow/alice');
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://www.douban.com/');
    expect(String(fetchMock.mock.calls[2][0])).toContain('/j/contact/follow/alice');
    expect(requestBody(fetchMock, 2).get('ck')).toBe('fresh-ck');
  });

  it('does not fallback after server, transport, or decoder failures', async () => {
    for (const response of [
      new Response('server error', { status: 500 }),
      Response.json({}),
      Response.json({ r: 1, msg: 'denied' })
    ]) {
      const fetchMock = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetchMock);

      await expect(followUser('alice', `dbcl2=no-fallback-${response.status}-${Math.random()}`, 'follow-ck'))
        .rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    }
  });
});
