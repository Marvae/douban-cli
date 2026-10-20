import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  ensureAuth: vi.fn(),
  getOptionalSessionCookies: vi.fn(),
  getPage: vi.fn(),
  readConfig: vi.fn(),
  secureAtomicWriteFile: vi.fn(),
  sleep: vi.fn()
}));

vi.mock('../auth/index.js', () => ({
  ensureAuth: mocks.ensureAuth,
  getOptionalSessionCookies: mocks.getOptionalSessionCookies
}));
vi.mock('../api/collection.js', () => ({
  getUserCollectionPageWithSession: mocks.getPage
}));
vi.mock('../storage/config.js', () => ({ readConfig: mocks.readConfig }));
vi.mock('../storage/secure-file.js', () => ({ secureAtomicWriteFile: mocks.secureAtomicWriteFile }));
vi.mock('../ui/spinner.js', () => ({
  withSpinner: vi.fn(async (_message: unknown, task: () => Promise<unknown>) => task())
}));
vi.mock('../utils/timing.js', () => ({
  parseDelaySeconds: vi.fn((value: string | undefined, fallback: number) => (value === undefined ? fallback : Number(value))),
  sleep: mocks.sleep
}));

import { registerExportCommands } from '../commands/export.ts';

function entry(id: string, date = '2026-08-10', overrides: Record<string, unknown> = {}) {
  return { kind: 'movie', id, title: `Title ${id}`, url: `https://movie.douban.com/subject/${id}/`, rating: 4, date, comment: '', cover: '', ...overrides };
}

function page(items: unknown[], nextStart: number | null = null, extra: Record<string, unknown> = {}) {
  return { items, total: items.length, nextStart, partial: false, warnings: [], ...extra };
}

async function run(...args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerExportCommands(program, program.command('book'));
  await program.parseAsync(['node', 'douban', ...args]);
}

const written = () => String(mocks.secureAtomicWriteFile.mock.calls[0]?.[1] ?? '');

beforeEach(() => {
  mocks.readConfig.mockReturnValue({});
  mocks.ensureAuth.mockResolvedValue({ accountId: 'alice', accountName: 'Alice', cookies: 'dbcl2=secret' });
  mocks.getOptionalSessionCookies.mockResolvedValue('dbcl2=secret');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  process.exitCode = undefined;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('export', () => {
  it('backs up all three statuses of the signed-in account with the session and paced requests', async () => {
    mocks.getPage
      .mockResolvedValueOnce(page([entry('1')]))
      .mockResolvedValueOnce(page([entry('2')]))
      .mockResolvedValueOnce(page([]));

    await run('export', '-o', 'movies.md', '--delay', '2');

    expect(mocks.getPage.mock.calls.map(([options, cookies]) => [options.userId, options.status, options.pageDelayMs, cookies]))
      .toEqual([['alice', 'collect', 2000, 'dbcl2=secret'], ['alice', 'wish', 2000, 'dbcl2=secret'], ['alice', 'do', 2000, 'dbcl2=secret']]);
    expect(mocks.sleep).toHaveBeenCalledTimes(2);
    expect(written()).toContain('## 看过（1）');
    expect(written()).toContain('## 在看（0）');
    expect(written()).toContain('1. **Title 1** · ★★★★ · 2026-08-10');
  });

  it('exports one book status of another user and neutralizes spreadsheet formulas', async () => {
    mocks.getPage.mockResolvedValueOnce(page([entry('7', '2026-01-02', { kind: 'book', title: '=HYPERLINK("x")' })]));

    await run('book', 'export', 'bob', '--reading', '-o', 'reading.csv');

    expect(mocks.ensureAuth).not.toHaveBeenCalled();
    expect(mocks.getPage).toHaveBeenCalledOnce();
    expect(mocks.getPage.mock.calls[0]?.[0]).toMatchObject({ kind: 'book', userId: 'bob', status: 'do' });
    expect(written().split('\n')[0]).toBe('"id","title","status","rating","date","comment","url"');
    expect(written()).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('keeps earlier statuses when a later one fails or is cut short by the limit', async () => {
    mocks.getPage
      .mockResolvedValueOnce(page([entry('1'), entry('2')], 2))
      .mockRejectedValueOnce(new Error('HTTP 403'));

    await run('export', '-o', 'movies.json', '-n', '2');

    const exported = JSON.parse(written());
    expect(exported.items.map((item: { id: string; status: string }) => [item.id, item.status])).toEqual([['1', 'collect'], ['2', 'collect']]);
    expect(exported.metadata.partial).toBe(true);
    expect(exported.metadata.warnings).toEqual([
      expect.stringContaining('只导出了前 2 条'),
      expect.stringContaining('想看：读取失败，已停止：HTTP 403')
    ]);
    expect(mocks.getPage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('结果不完整');
  });

  it.each([
    [['export', '-o', 'x.txt', '--format', 'xml'], '--format 仅支持'],
    [['book', 'export', '--wish', '--reading', '-o', 'x.json'], '不能同时使用']
  ])('rejects %j before reading or writing', async (args, message) => {
    await run(...args);
    expect(mocks.getPage).not.toHaveBeenCalled();
    expect(mocks.secureAtomicWriteFile).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain(message);
  });
});

describe('stats', () => {
  it('counts the year and its average rating', async () => {
    mocks.getPage.mockResolvedValueOnce(page([
      entry('1', '2026-10-21', { rating: 3 }),
      entry('2', '2026-03-01', { rating: 0 }),
      entry('3', '2025-12-31', { rating: 5 })
    ]));

    await run('stats', '--year', '2026', '--json');

    const result = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(result).toMatchObject({ user: { id: 'alice' }, year: 2026, total: 2, avgScore: '3.00', metadata: { partial: false } });
    expect(result.byMonth[9]).toBe(1);
    expect(mocks.getPage.mock.calls[0]?.[0]).toMatchObject({ kind: 'movie', status: 'collect', count: 1000 });
  });

  it('warns when the limit stops inside the year', async () => {
    mocks.getPage.mockResolvedValueOnce(page([entry('1', '2026-10-21'), entry('2', '2026-05-01')], 2));

    await run('book', 'stats', '--year', '2026', '-n', '2', '--json');

    const result = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]));
    expect(result.metadata).toMatchObject({ partial: true, warnings: [expect.stringContaining('只读取了最近 2 条读过记录')] });
  });
});
