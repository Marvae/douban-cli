import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const apiMocks = vi.hoisted(() => ({
  getUserCollectionPage: vi.fn()
}));
const authMocks = vi.hoisted(() => ({
  ensureAuth: vi.fn(),
  getOptionalSessionCookies: vi.fn()
}));

vi.mock('../api/collection.js', () => ({
  getUserCollectionPageWithSession: apiMocks.getUserCollectionPage
}));
vi.mock('../auth/index.js', () => authMocks);
vi.mock('../ui/spinner.js', () => ({
  withSpinner: vi.fn(async (_message: string, task: () => Promise<unknown>) => task())
}));

import { registerCollectionCommands } from '../commands/collection.ts';
import { registerConfigCommand } from '../commands/config.ts';

const originalArgv = process.argv;
const originalHome = process.env.HOME;
const originalCliHome = process.env.DOUBAN_CLI_HOME;
const tempDirectories: string[] = [];

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = undefined;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalCliHome === undefined) delete process.env.DOUBAN_CLI_HOME;
  else process.env.DOUBAN_CLI_HOME = originalCliHome;
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function useTempStorage(): { tempHome: string; storageDirectory: string } {
  const tempHome = mkdtempSync(path.join(os.tmpdir(), 'douban-config-'));
  tempDirectories.push(tempHome);
  const storageDirectory = path.join(tempHome, 'storage');
  process.env.HOME = tempHome;
  process.env.DOUBAN_CLI_HOME = storageDirectory;
  return { tempHome, storageDirectory };
}

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerCollectionCommands(program, program.command('book'));
  registerConfigCommand(program);
  return program;
}

describe('collection and config commands', () => {
  it.each([
    [['user', 'alice', '--page', '3', '--limit', '10', '--json'], 'movie', 'collect'],
    [['book', 'user', 'alice', '--reading', '--page', '3', '--limit', '10'], 'book', 'do']
  ] as const)('reads only the requested page for %j with the local session', async (args, kind, status) => {
    apiMocks.getUserCollectionPage.mockResolvedValue({
      items: [{ kind, id: '42', title: 'Example', url: '', rating: 0, date: '', comment: '', cover: '' }],
      total: 100,
      nextStart: 30,
      partial: false,
      warnings: []
    });
    authMocks.getOptionalSessionCookies.mockResolvedValue('dbcl2=alice');
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await createProgram().parseAsync(['node', 'douban', ...args]);

    expect(apiMocks.getUserCollectionPage).toHaveBeenCalledOnce();
    expect(apiMocks.getUserCollectionPage).toHaveBeenCalledWith({ kind, userId: 'alice', status, start: 20, count: 10 }, 'dbcl2=alice');
    expect(stdout.mock.calls.flat().join('\n')).toContain('42');
  });

  it('rejects conflicting collection status flags before fetching', async () => {
    process.argv = ['node', 'douban', 'user', 'alice', '--wish', '--doing', '--json'];
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await createProgram().parseAsync(process.argv);

    expect(apiMocks.getUserCollectionPage).not.toHaveBeenCalled();
    const payload = JSON.parse(String(stderr.mock.calls[0]?.[0]));
    expect(payload.error.code).toBe('INVALID_ARGUMENT');
    expect(process.exitCode).toBe(1);
  });

  it('uses the verified session identity for me without another profile lookup', async () => {
    useTempStorage();
    authMocks.ensureAuth.mockResolvedValue({
      dbcl2: 'secret',
      cookies: 'dbcl2=secret',
      source: 'Chrome',
      accountId: 'alice',
      accountName: 'Alice',
      updatedAt: '2026-08-10T00:00:00.000Z'
    });
    authMocks.getOptionalSessionCookies.mockResolvedValue('dbcl2=secret');
    apiMocks.getUserCollectionPage.mockResolvedValue({
      items: [], total: 0, nextStart: null, partial: false, warnings: []
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await createProgram().parseAsync(['node', 'douban', 'me', '--json']);

    expect(authMocks.ensureAuth).toHaveBeenCalledOnce();
    expect(apiMocks.getUserCollectionPage).toHaveBeenCalledWith({
      kind: 'movie', userId: 'alice', status: 'collect', start: 0, count: 15
    }, 'dbcl2=secret');
  });

  it.each([undefined, 'dbcl2=cached-account'])('reads the configured user with the optional session %s', async (cookies) => {
    useTempStorage();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await createProgram().parseAsync(['node', 'douban', 'config', '--user', 'alice', '--json']);
    authMocks.getOptionalSessionCookies.mockResolvedValue(cookies);
    apiMocks.getUserCollectionPage.mockResolvedValue({
      items: [], total: 0, nextStart: null, partial: false, warnings: []
    });

    await createProgram().parseAsync(['node', 'douban', 'me', '--json']);

    expect(authMocks.ensureAuth).not.toHaveBeenCalled();
    expect(apiMocks.getUserCollectionPage).toHaveBeenCalledWith({
      kind: 'movie', userId: 'alice', status: 'collect', start: 0, count: 15
    }, cookies);
  });

  it('stores config in a private DOUBAN_CLI_HOME directory', async () => {
    const { storageDirectory } = useTempStorage();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await createProgram().parseAsync([
      'node',
      'douban',
      'config',
      '--user',
      'alice',
      '--json'
    ]);

    const configPath = path.join(storageDirectory, 'config.json');
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ user: 'alice' });
    expect(lstatSync(storageDirectory).mode & 0o777).toBe(0o700);
    expect(lstatSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('drops a damaged remembered login and keeps a valid one across user changes', async () => {
    const { storageDirectory } = useTempStorage();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const configPath = path.join(storageDirectory, 'config.json');

    await createProgram().parseAsync(['node', 'douban', 'config', '--user', 'alice', '--json']);
    writeFileSync(configPath, JSON.stringify({ user: 'alice', login: 'broken' }), { mode: 0o600 });
    await createProgram().parseAsync(['node', 'douban', 'config', '--json']);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toEqual({ user: 'alice' });

    writeFileSync(configPath, JSON.stringify({ user: 'alice', login: { browser: 'arc', profile: 'Profile 2' } }), { mode: 0o600 });
    await createProgram().parseAsync(['node', 'douban', 'config', '--user', 'bob', '--json']);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ user: 'bob', login: { browser: 'arc', profile: 'Profile 2' } });
  });

  it('migrates the legacy config after validating the new copy', async () => {
    const { tempHome, storageDirectory } = useTempStorage();
    const legacyPath = path.join(tempHome, '.douban-cli.json');
    const configPath = path.join(storageDirectory, 'config.json');
    writeFileSync(legacyPath, '{"user":"legacy-user"}\n');
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await createProgram().parseAsync(['node', 'douban', 'config', '--json']);

    expect(existsSync(legacyPath)).toBe(false);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ user: 'legacy-user' });
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({ user: 'legacy-user' });
  });

});
