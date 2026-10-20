import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

let directory: string;
let originalCliHome: string | undefined;
const fixture = readFileSync(new URL('./fixtures/movie-collection-page.html', import.meta.url), 'utf8');

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'douban-pr3-review-'));
  originalCliHome = process.env.DOUBAN_CLI_HOME;
  process.env.DOUBAN_CLI_HOME = path.join(directory, 'storage');
  vi.spyOn(os, 'homedir').mockReturnValue(directory);
  vi.resetModules();
});

afterEach(() => {
  if (originalCliHome === undefined) delete process.env.DOUBAN_CLI_HOME;
  else process.env.DOUBAN_CLI_HOME = originalCliHome;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  rmSync(directory, { recursive: true, force: true });
});

it('public getUserCollectionPage stays anonymous even with a cached CLI session', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(
    '<a class="lnk-mine" href="https://www.douban.com/people/alice/">Alice</a>',
    { headers: { 'Content-Type': 'text/html' } }
  ));
  vi.stubGlobal('fetch', fetchMock);
  const auth = await import('../auth/index.ts');
  await auth.loginFromCookieStdin(Readable.from(['dbcl2=REVIEW_FAKE_ACCOUNT; ck=REVIEW_FAKE_CSRF']));
  fetchMock.mockClear();
  fetchMock.mockImplementation(async () => new Response(fixture, { headers: { 'Content-Type': 'text/html' } }));
  const api = await import('../api/collection.ts');
  const page = await api.getUserCollectionPage({ kind: 'movie', userId: 'someone-else', status: 'collect', start: 0, count: 2 });
  expect(page.items).toHaveLength(2);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Cookie')).toBeNull();
});

it('public getUserCollectionPage does not modify a malformed CLI auth cache', async () => {
  const storage = path.join(directory, 'storage');
  mkdirSync(storage, { mode: 0o700 });
  const cache = path.join(storage, 'auth.json');
  writeFileSync(cache, '{malformed-cache', { mode: 0o600 });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(fixture, {
    headers: { 'Content-Type': 'text/html' }
  })));
  const api = await import('../api/collection.ts');
  await api.getUserCollectionPage({ kind: 'movie', userId: 'someone-else', status: 'collect', start: 0, count: 2 });
  expect(existsSync(cache)).toBe(true);
});
