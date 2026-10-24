import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  ensureAuth: vi.fn(),
  editSubjectRecord: vi.fn(),
  getSubjectRecord: vi.fn(),
  removeSubjectRecord: vi.fn(),
  resolveBookIdByIsbn: vi.fn(),
  searchBooks: vi.fn(),
  searchMovies: vi.fn(),
  getSubjectTitle: vi.fn(),
  canPrompt: vi.fn(),
  ask: vi.fn()
}));

vi.mock('../auth/index.js', () => ({
  ensureAuth: mocks.ensureAuth,
  getOptionalSessionCookies: vi.fn(async () => undefined)
}));
vi.mock('../api/book.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/book.ts')>()),
  resolveBookIdByIsbn: mocks.resolveBookIdByIsbn,
  searchBooks: mocks.searchBooks
}));
vi.mock('../api/search.js', () => ({ searchMovies: mocks.searchMovies }));
vi.mock('../api/subject.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/subject.ts')>()),
  getSubjectTitle: mocks.getSubjectTitle
}));
vi.mock('../ui/prompt.js', () => ({ canPrompt: mocks.canPrompt, ask: mocks.ask }));
vi.mock('../api/record.js', () => ({
  editSubjectRecord: mocks.editSubjectRecord,
  getSubjectRecord: mocks.getSubjectRecord,
  removeSubjectRecord: mocks.removeSubjectRecord
}));
vi.mock('../ui/spinner.js', () => ({
  withSpinner: vi.fn(async (_message: string, task: () => Promise<unknown>) => task())
}));

import { registerMarkCommands } from '../commands/mark.ts';

const originalArgv = process.argv;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerMarkCommands(program, program.command('book'));
  return program;
}

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = undefined;
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('mark commands', () => {
  it.each([
    ['mark', '1292052', '--wish', '--file', 'items.txt'],
    ['rate', '1292052', '--score', '5', '--file', 'ratings.txt'],
    ['rate', '1292052', '值得重看', '--score', '5', '--file', 'ratings.txt'],
    ['comment', '1292052', 'good', '--file', 'comments.txt'],
    ['unmark', '1292052', '--file', 'items.txt'],
    ['book', 'mark', '2567698', '--read', '--file', 'items.txt']
  ])('rejects mixed inline and batch input for %s', async (...args) => {
    process.argv = ['node', 'douban', ...args, '--json'];
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await createProgram().parseAsync(process.argv);

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0])).error.message)
      .toContain('--file 不能与单条模式参数同时使用');
    expect(mocks.ensureAuth).not.toHaveBeenCalled();
  });

  describe('choosing the subject', () => {
    const record = (id: string, status: string) => ({ kind: 'movie', id, url: '', status, rating: 0, tags: [], private: false, comment: '' });
    const directories: string[] = [];
    const batchFile = (contents: string) => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'douban-mark-'));
      directories.push(directory);
      const file = path.join(directory, 'items.txt');
      writeFileSync(file, contents);
      return file;
    };
    const run = async (args: string[], json = true) => {
      process.argv = ['node', 'douban', ...args, ...(json ? ['--json'] : [])];
      await createProgram().parseAsync(process.argv);
    };

    afterEach(() => {
      for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
    });

    function setUp(): void {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mocks.ensureAuth.mockResolvedValue({ cookies: 'dbcl2=x', ck: 'ck' });
      mocks.getSubjectTitle.mockResolvedValue('某个条目');
      mocks.editSubjectRecord.mockImplementation(async (_kind: string, id: string) => (
        { before: record(id, 'none'), after: record(id, 'collect'), changed: true, dryRun: true }
      ));
    }

    it('resolves book ISBNs exactly, inline and in batch files', async () => {
      setUp();
      mocks.resolveBookIdByIsbn.mockResolvedValue('34800934');

      await run(['book', 'mark', '978-7-5442-6950-6', '--read', '--dry-run']);
      await run(['book', 'mark', '--file', batchFile('9787544269506\n2567698\n'), '--read', '--dry-run', '--delay', '0']);

      expect(mocks.resolveBookIdByIsbn.mock.calls.map(([isbn]) => isbn)).toEqual(['9787544269506', '9787544269506']);
      expect(mocks.editSubjectRecord.mock.calls.map(([kind, id]) => [kind, id]))
        .toEqual([['book', '34800934'], ['book', '34800934'], ['book', '2567698']]);
    });

    it('writes a searched title only after confirmation in a terminal; a dry run just previews it', async () => {
      setUp();
      mocks.searchMovies.mockResolvedValue([{ id: '3001114', title: '沙丘' }]);

      mocks.canPrompt.mockReturnValue(false);
      await run(['mark', '沙丘', '--wish']);
      expect(process.exitCode).toBe(1);
      expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain('请改用 ID');
      expect(mocks.editSubjectRecord).not.toHaveBeenCalled();

      process.exitCode = undefined;
      await run(['mark', '沙丘', '--wish', '--dry-run']);
      expect(mocks.editSubjectRecord).toHaveBeenCalledWith('movie', '3001114', expect.anything(), 'dbcl2=x', expect.objectContaining({ dryRun: true }));

      mocks.editSubjectRecord.mockClear();
      mocks.canPrompt.mockReturnValue(true);
      mocks.ask.mockResolvedValue('n');
      await run(['mark', '沙丘', '--wish']);
      expect(mocks.ask).toHaveBeenCalledWith(expect.stringContaining('《沙丘》(3001114)'));
      expect(mocks.editSubjectRecord).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });

    it('returns AMBIGUOUS with every edition instead of writing the first hit', async () => {
      setUp();
      mocks.searchBooks.mockResolvedValue([
        {
          id: '2567698',
          title: '三体',
          rating: '8.8',
          rating_count: 500000,
          meta: '刘慈欣 / 重庆出版社 / 2008',
          url: 'https://book.douban.com/subject/2567698/'
        },
        {
          id: '6414884',
          title: '三体',
          rating: '9.1',
          rating_count: 1000,
          meta: '刘慈欣 / 重庆出版社 / 2016',
          url: 'https://book.douban.com/subject/6414884/'
        }
      ]);
      mocks.canPrompt.mockReturnValue(false);

      await run(['book', 'mark', '三体', '--read']);

      expect(process.exitCode).toBe(1);
      const payload = JSON.parse(String(vi.mocked(console.error).mock.calls[0]?.[0]));
      expect(payload.error).toMatchObject({
        code: 'AMBIGUOUS',
        message: expect.stringContaining('有 2 个版本')
      });
      expect(payload.error.matches.map((match: { id: string }) => match.id)).toEqual(['2567698', '6414884']);
      expect(mocks.ask).not.toHaveBeenCalled();
      expect(mocks.editSubjectRecord).not.toHaveBeenCalled();
    });

    it('writes the picked book edition without a second confirmation', async () => {
      setUp();
      mocks.searchBooks.mockResolvedValue([
        {
          id: '2567698',
          title: '三体',
          rating: '8.8',
          rating_count: 500000,
          meta: '刘慈欣 / 重庆出版社 / 2008',
          url: 'https://book.douban.com/subject/2567698/'
        },
        {
          id: '6414884',
          title: '三体',
          rating: '9.1',
          rating_count: 1000,
          meta: '刘慈欣 / 重庆出版社 / 2016',
          url: 'https://book.douban.com/subject/6414884/'
        }
      ]);
      mocks.canPrompt.mockReturnValue(true);
      mocks.ask.mockResolvedValue('2');
      mocks.editSubjectRecord.mockImplementation(async (_kind: string, id: string) => (
        { before: record(id, 'none'), after: record(id, 'collect'), changed: true, dryRun: false }
      ));

      await run(['book', 'mark', '三体', '--read'], false);

      expect(mocks.ask).toHaveBeenCalledTimes(1);
      expect(mocks.ask).toHaveBeenCalledWith('编号，回车用 1，q 取消：');
      expect(mocks.editSubjectRecord.mock.calls.map(([, id]) => id)).toEqual(['6414884']);
    });

    it('rejects titles in batch files before any request', async () => {
      setUp();
      await run(['mark', '--file', batchFile('1292052\n沙丘\n'), '--wish']);

      expect(process.exitCode).toBe(1);
      expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toContain('无效电影 ID: 沙丘');
      expect(mocks.ensureAuth).not.toHaveBeenCalled();
      expect(mocks.searchMovies).not.toHaveBeenCalled();
    });

    it('rates with an optional comment in one write, and keeps the comment off the patch when omitted', async () => {
      setUp();

      await run(['rate', '1292052', '值得重看', '--score', '5', '--dry-run']);
      expect(mocks.editSubjectRecord.mock.calls[0]?.[2]).toEqual({
        status: 'collect', rating: 5, comment: '值得重看'
      });

      mocks.editSubjectRecord.mockClear();
      await run(['rate', '1292052', '--score', '5', '--dry-run']);
      expect(mocks.editSubjectRecord.mock.calls[0]?.[2]).toEqual({ status: 'collect', rating: 5 });
    });

    it('reads an optional comment from a rate batch file', async () => {
      setUp();

      await run(['rate', '--file', batchFile('1292052,5,值得重看\n3001114,4\n'), '--dry-run', '--delay', '0']);

      expect(mocks.editSubjectRecord.mock.calls.map(([, id, patch]) => [id, patch])).toEqual([
        ['1292052', { status: 'collect', rating: 5, comment: '值得重看' }],
        ['3001114', { status: 'collect', rating: 4 }]
      ]);
    });
  });
});
