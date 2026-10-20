// Finding the default browser and opening the Douban login page.
import { spawnSync } from 'node:child_process';
import { type BrowserName, type LoginOptions, normalizeBrowserSource } from './browser-cookies.js';
import { asObject } from './cookies.js';

const DOUBAN_ACCOUNT_URL = 'https://www.douban.com/mine/';
interface LoginLaunchCommand {
  command: string;
  args: string[];
}
const MAC_BROWSER_BUNDLE_IDS: Record<BrowserName, string> = {
  chrome: 'com.google.Chrome',
  arc: 'company.thebrowser.Browser',
  edge: 'com.microsoft.edgemac',
  firefox: 'org.mozilla.firefox',
  safari: 'com.apple.Safari'
};
export function browserFromSystemIdentifier(identifier: string): BrowserName | undefined {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes('company.thebrowser') || normalized.includes('arc')) return 'arc';
  if (normalized.includes('google.chrome') || normalized.includes('chromehtml')) return 'chrome';
  if (normalized.includes('microsoft.edge') || normalized.includes('msedge')) return 'edge';
  if (normalized.includes('mozilla.firefox') || normalized.includes('firefox')) return 'firefox';
  if (normalized.includes('apple.safari') || normalized.includes('safari')) return 'safari';
  return undefined;
}
function detectMacDefaultBrowser(): BrowserName {
  const exported = spawnSync(
    'defaults',
    ['export', 'com.apple.LaunchServices/com.apple.launchservices.secure', '-'],
    { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 }
  );
  if (exported.error || exported.status !== 0 || !exported.stdout) {
    throw new Error('无法读取 macOS 默认浏览器设置，请使用 --browser 明确指定');
  }

  const converted = spawnSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
    input: exported.stdout,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024
  });
  if (converted.error || converted.status !== 0 || !converted.stdout) {
    throw new Error('无法解析 macOS 默认浏览器设置，请使用 --browser 明确指定');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(converted.stdout) as unknown;
  } catch (error) {
    throw new Error('macOS 默认浏览器设置格式无效，请使用 --browser 明确指定', { cause: error });
  }

  const root = asObject(payload);
  const handlers = Array.isArray(root?.LSHandlers) ? root.LSHandlers : [];
  const httpsHandlers = handlers
    .map(asObject)
    .filter((handler): handler is Record<string, unknown> => handler?.LSHandlerURLScheme === 'https')
    .sort((left, right) => Number(right.LSHandlerModificationDate ?? 0) - Number(left.LSHandlerModificationDate ?? 0));
  const identifier = typeof httpsHandlers[0]?.LSHandlerRoleAll === 'string'
    ? httpsHandlers[0].LSHandlerRoleAll
    : '';
  const browser = browserFromSystemIdentifier(identifier);
  if (!browser) {
    throw new Error(`暂不支持默认浏览器 ${identifier || 'unknown'}，请使用 --browser 明确指定`);
  }
  return browser;
}
export function detectDefaultBrowser(): BrowserName {
  if (process.platform === 'darwin') return detectMacDefaultBrowser();

  if (process.platform === 'linux') {
    const result = spawnSync('xdg-settings', ['get', 'default-web-browser'], { encoding: 'utf8' });
    const browser = !result.error && result.status === 0
      ? browserFromSystemIdentifier(result.stdout)
      : undefined;
    if (browser) return browser;
  }

  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice").ProgId'
    ], { encoding: 'utf8' });
    const browser = !result.error && result.status === 0
      ? browserFromSystemIdentifier(result.stdout)
      : undefined;
    if (browser) return browser;
  }

  throw new Error('无法识别系统默认浏览器，请使用 --browser 明确指定');
}
export function resolveLoginLaunchCommand(
  platform: NodeJS.Platform,
  browser?: BrowserName
): LoginLaunchCommand {
  if (platform === 'darwin') {
    return {
      command: 'open',
      args: browser
        ? ['-b', MAC_BROWSER_BUNDLE_IDS[browser], DOUBAN_ACCOUNT_URL]
        : [DOUBAN_ACCOUNT_URL]
    };
  }

  if (platform === 'linux') {
    const commands: Partial<Record<BrowserName, string>> = {
      chrome: 'google-chrome',
      edge: 'microsoft-edge',
      firefox: 'firefox'
    };
    const command = browser ? commands[browser] : undefined;
    if (browser && !command) {
      throw new Error(`当前平台暂不支持自动打开 ${normalizeBrowserSource(browser)}`);
    }
    return command
      ? { command, args: [DOUBAN_ACCOUNT_URL] }
      : { command: 'xdg-open', args: [DOUBAN_ACCOUNT_URL] };
  }

  if (platform === 'win32') {
    const commands: Partial<Record<BrowserName, string>> = {
      chrome: 'chrome',
      edge: 'msedge',
      firefox: 'firefox'
    };
    const command = browser ? commands[browser] : undefined;
    if (browser && !command) {
      throw new Error(`当前平台暂不支持自动打开 ${normalizeBrowserSource(browser)}`);
    }
    return {
      command: 'cmd',
      args: command
        ? ['/c', 'start', '', command, DOUBAN_ACCOUNT_URL]
        : ['/c', 'start', '', DOUBAN_ACCOUNT_URL]
    };
  }

  throw new Error('当前平台暂不支持自动打开浏览器登录流程');
}
export function openLoginPage(options: LoginOptions): void {
  const { command, args } = resolveLoginLaunchCommand(process.platform, options.browser);

  const opened = spawnSync(command, args, { stdio: 'ignore' });
  if (opened.error || opened.status !== 0) {
    const message = opened.error?.message || `exit code ${opened.status ?? 'unknown'}`;
    throw new Error(`打开浏览器失败: ${message}`);
  }
}
