import { describe, expect, it } from 'vitest';
import { resolveCliStoragePaths } from '../storage/paths.ts';

describe('CLI storage paths', () => {
  it.each([
    ['DOUBAN_CLI_HOME on any platform', 'linux', '/home/alice', { DOUBAN_CLI_HOME: '/var/lib/douban' }, '/var/lib/douban/auth.json', '/var/lib/douban/config.json'],
    ['Application Support on macOS', 'darwin', '/Users/alice', {}, '/Users/alice/Library/Application Support/douban-cli/auth.json', '/Users/alice/Library/Application Support/douban-cli/config.json'],
    ['absolute XDG directories on Linux', 'linux', '/home/alice', { XDG_STATE_HOME: '/data/state', XDG_CONFIG_HOME: '/data/config' }, '/data/state/douban-cli/auth.json', '/data/config/douban-cli/config.json'],
    ['standard Linux fallbacks for relative XDG values', 'linux', '/home/alice', { XDG_STATE_HOME: 'state', XDG_CONFIG_HOME: 'config' }, '/home/alice/.local/state/douban-cli/auth.json', '/home/alice/.config/douban-cli/config.json'],
    ['local state and roaming config on Windows', 'win32', 'C:\\Users\\alice', { LOCALAPPDATA: 'D:\\Local', APPDATA: 'D:\\Roaming' }, 'D:\\Local\\douban-cli\\auth.json', 'D:\\Roaming\\douban-cli\\config.json']
  ] as const)('uses %s', (_name, platform, homedir, env, authCachePath, configPath) => {
    expect(resolveCliStoragePaths({ platform, homedir, env })).toMatchObject({ authCachePath, configPath });
  });

  it.each([
    [{ DOUBAN_CLI_HOME: './douban-data' }, '/home/alice', 'DOUBAN_CLI_HOME 必须是绝对路径'],
    [{ DOUBAN_CLI_HOME: '/' }, '/home/alice', '不能指向文件系统根目录'],
    [{}, 'home/alice', '用户主目录必须是绝对路径']
  ])('rejects unsafe locations: %j %s', (env, homedir, message) => {
    expect(() => resolveCliStoragePaths({ platform: 'linux', homedir, env })).toThrow(message);
  });
});
