// Reading Douban cookies from local browsers' cookie stores.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { debug } from '../utils/debug.js';
import {
  type AuthSession,
  asObject,
  normalizeAuthCookieValue,
  createSession,
  stripControlCharacters
} from './cookies.js';

const DEFAULT_COOKIE_TIMEOUT_MS = 60_000;
const MAX_COOKIE_TIMEOUT_MS = 300_000;
export type BrowserName = 'chrome' | 'arc' | 'edge' | 'firefox' | 'safari';
type CookieBackendName = 'chrome' | 'edge' | 'firefox' | 'safari';
export interface BrowserCookieTarget {
  backend: Exclude<BrowserName, 'arc'>;
  chromiumBrowser?: 'chrome' | 'arc';
}
export interface LoginOptions {
  browser?: BrowserName;
  profile?: string;
  cookieTimeoutMs?: number;
  open?: boolean;
}
interface SweetCookieResult {
  cookies: Array<{
    name: string;
    value: string;
    source?: { browser?: CookieBackendName; profile?: string; storeId?: string };
  }>;
  warnings: string[];
}
interface SweetCookieOptions {
  url: string;
  names: string[];
  browsers: CookieBackendName[];
  mode: 'first';
  timeoutMs: number;
  chromiumBrowser?: 'chrome' | 'arc';
  chromeProfile?: string;
  edgeProfile?: string;
  firefoxProfile?: string;
}
export type BrowserCookieReader = (options: SweetCookieOptions) => Promise<SweetCookieResult>;
interface BrowserCookieBucket {
  source: string;
  profile?: string;
  storeId?: string;
  dbcl2?: string;
  ck?: string;
}
function asCookieBackendName(value: unknown): CookieBackendName | undefined {
  return value === 'chrome' || value === 'edge' || value === 'firefox' || value === 'safari'
    ? value
    : undefined;
}
function browserFromStoreId(value: string | undefined): BrowserName | undefined {
  return value === 'arc' ? 'arc' : undefined;
}
function parseSweetCookieResult(value: unknown): SweetCookieResult {
  const result = asObject(value);
  if (!result || !Array.isArray(result.cookies) || !Array.isArray(result.warnings)) {
    throw new Error('sweet-cookie 返回了无效结果');
  }

  const cookies: SweetCookieResult['cookies'] = result.cookies.map((value) => {
    const cookie = asObject(value);
    if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') {
      throw new Error('sweet-cookie 返回了无效 Cookie');
    }

    const rawSource = asObject(cookie.source);
    const browser = asCookieBackendName(rawSource?.browser);
    const source = browser
      ? {
          browser,
          profile: typeof rawSource?.profile === 'string' ? rawSource.profile : undefined,
          storeId: typeof rawSource?.storeId === 'string' ? rawSource.storeId : undefined
        }
      : undefined;
    return { name: cookie.name, value: cookie.value, source };
  });

  const warnings = result.warnings.map((warning) => {
    if (typeof warning !== 'string') throw new Error('sweet-cookie 返回了无效警告');
    return warning;
  });
  return { cookies, warnings };
}
function sanitizeCookieWarning(warning: string, cookies: SweetCookieResult['cookies']): string {
  let sanitized = stripControlCharacters(warning);
  const secrets = new Set<string>();

  for (const cookie of cookies) {
    if (cookie.name !== 'dbcl2' && cookie.name !== 'ck') continue;
    if (cookie.value) secrets.add(cookie.value);
    const unquoted = cookie.value.replace(/^"|"$/g, '');
    if (unquoted) secrets.add(unquoted);
  }
  for (const secret of secrets) {
    sanitized = sanitized.split(secret).join('[REDACTED]');
  }
  return sanitized;
}
/**
 * What a sweet-cookie warning means for the user, or undefined when the store
 * was still read. Its wording (English, local paths) is kept for DOUBAN_DEBUG.
 */
function describeCookieWarning(browser: BrowserName, warning: string): string | undefined {
  const name = normalizeBrowserSource(browser);
  // Cookies left out on purpose: the store itself was read.
  if (/partitioned|container-scoped/i.test(warning)) return undefined;
  // Before the permission check: a Keychain failure says "permission denied" too.
  if (/keychain/i.test(warning)) {
    return `没有拿到读取 ${name} Cookie 的钥匙串授权：请在弹窗中选择“允许”，授权较慢时可加 --cookie-timeout`;
  }
  if (/EPERM|EACCES|operation not permitted|permission denied/i.test(warning)) {
    return browser === 'safari'
      ? '没有权限读取 Safari 的 Cookie：请在“系统设置 → 隐私与安全性 → 完全磁盘访问权限”中允许当前终端，重新打开终端后再试'
      : `没有权限读取 ${name} 的 Cookie 文件`;
  }
  if (/not found/i.test(warning)) return `没有找到 ${name} 的 Cookie 文件：确认已安装并用过 ${name}`;
  return `读取 ${name} 的 Cookie 失败（加 DOUBAN_DEBUG=1 查看原因）`;
}
export function normalizeBrowserSource(source: string): string {
  const lower = source.trim().toLowerCase();
  if (!lower) return 'Browser';

  const mapping: Record<string, string> = {
    chrome: 'Chrome',
    arc: 'Arc',
    edge: 'Edge',
    firefox: 'Firefox',
    safari: 'Safari'
  };

  return mapping[lower] || source.charAt(0).toUpperCase() + source.slice(1);
}
export function sourceLabel(browser: BrowserName, profile?: string): string {
  const normalized = normalizeBrowserSource(browser);
  const safeProfile = profile ? stripControlCharacters(profile) : '';
  return safeProfile ? `${normalized} (${safeProfile})` : normalized;
}
export function validateLoginOptions(options: LoginOptions): void {
  if (options.profile && !options.browser) {
    throw new Error('--profile 必须与 --browser 一起使用');
  }
  if (options.profile && options.browser === 'safari') {
    throw new Error('Safari 不支持 --profile');
  }
  if (options.open && options.profile) {
    throw new Error('--open 无法保证打开指定浏览器 profile，不能与 --profile 一起使用；请先手动打开目标 profile，再不带 --open 重试');
  }
  if (options.cookieTimeoutMs !== undefined
    && (!Number.isInteger(options.cookieTimeoutMs)
      || options.cookieTimeoutMs < 1_000
      || options.cookieTimeoutMs > MAX_COOKIE_TIMEOUT_MS)) {
    throw new Error('Cookie 读取超时必须是 1-300 秒');
  }
}
function profileOptions(browser: BrowserName, profile?: string): Partial<SweetCookieOptions> {
  const selected = profile?.trim();
  if (!selected) return {};
  if (browser === 'chrome' || browser === 'arc') return { chromeProfile: selected };
  if (browser === 'edge') return { edgeProfile: selected };
  if (browser === 'firefox') return { firefoxProfile: selected };
  return {};
}
function sessionsFromCookies(
  result: SweetCookieResult,
  fallbackBrowser: BrowserName,
  fallbackProfile?: string
): AuthSession[] {
  const grouped = new Map<string, BrowserCookieBucket>();

  for (const cookie of result.cookies) {
    if (!cookie?.name || typeof cookie.value !== 'string') continue;
    if (cookie.name !== 'dbcl2' && cookie.name !== 'ck') continue;

    const browser = browserFromStoreId(cookie.source?.storeId)
      || (cookie.source?.browser === 'chrome' && fallbackBrowser === 'arc' ? 'arc' : cookie.source?.browser)
      || fallbackBrowser;
    const profile = cookie.source?.profile?.trim() || fallbackProfile?.trim() || undefined;
    const storeId = cookie.source?.storeId?.trim() || undefined;
    const key = `${browser}:${profile || ''}:${storeId || ''}`;
    const bucket = grouped.get(key) || {
      source: sourceLabel(browser, profile),
      profile,
      storeId
    };

    if (cookie.name === 'dbcl2' && !bucket.dbcl2) {
      bucket.dbcl2 = normalizeAuthCookieValue(cookie.value, true) ?? undefined;
    }
    if (cookie.name === 'ck' && !bucket.ck) {
      bucket.ck = normalizeAuthCookieValue(cookie.value) ?? undefined;
    }

    grouped.set(key, bucket);
  }

  return [...grouped.values()]
    .filter((bucket): bucket is BrowserCookieBucket & { dbcl2: string } => Boolean(bucket.dbcl2))
    .map((bucket) => createSession(bucket.dbcl2, bucket.ck, bucket.source));
}
async function loadBrowserCookieReader(): Promise<BrowserCookieReader> {
  try {
    const mod = await import('@steipete/sweet-cookie');
    if (typeof mod.getCookies !== 'function') {
      throw new Error('sweet-cookie 未导出 getCookies 函数');
    }
    return mod.getCookies as BrowserCookieReader;
  } catch (error) {
    throw new Error(`加载浏览器 Cookie 组件失败: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }
}
/** Douban sessions found in the browsers, and why a cookie store could not be read. */
export interface BrowserCookieScan {
  sessions: AuthSession[];
  /** For the user, without local paths. A store that could not be read says nothing about the login. */
  problems: string[];
}
export async function extractFromBrowsers(
  options: LoginOptions = {},
  reader?: BrowserCookieReader
): Promise<BrowserCookieScan> {
  validateLoginOptions(options);

  const browsers: BrowserName[] = options.browser
    ? [options.browser]
    : [
        'chrome',
        'edge',
        'firefox',
        ...(process.platform === 'darwin' ? ['safari' as const] : [])
      ];
  const targets = browsers.map((browser) => ({
    browser,
    ...resolveBrowserCookieTarget(browser, process.platform)
  }));
  const getCookies = reader || await loadBrowserCookieReader();
  const sessions: AuthSession[] = [];
  const problems = new Set<string>();

  for (const { browser, backend, chromiumBrowser } of targets) {
    try {
      const result = parseSweetCookieResult(await getCookies({
        url: 'https://www.douban.com',
        names: ['dbcl2', 'ck'],
        browsers: [backend],
        mode: 'first',
        timeoutMs: options.cookieTimeoutMs ?? DEFAULT_COOKIE_TIMEOUT_MS,
        ...(chromiumBrowser ? { chromiumBrowser } : {}),
        ...profileOptions(browser, options.profile)
      }));
      for (const warning of result.warnings) {
        debug('auth', `${normalizeBrowserSource(browser)} Cookie 提示: ${sanitizeCookieWarning(warning, result.cookies)}`);
        const problem = describeCookieWarning(browser, warning);
        if (problem) problems.add(problem);
      }
      sessions.push(...sessionsFromCookies(result, browser, options.profile));
    } catch (error) {
      debug('auth', `${normalizeBrowserSource(browser)} Cookie 读取失败: ${stripControlCharacters(error instanceof Error ? error.message : String(error))}`);
      problems.add(`读取 ${normalizeBrowserSource(browser)} 的 Cookie 失败（加 DOUBAN_DEBUG=1 查看原因）`);
    }
  }

  const deduped = new Map<string, AuthSession>();
  for (const session of sessions) {
    const key = `${session.source}:${session.dbcl2}`;
    if (!deduped.has(key)) deduped.set(key, session);
  }
  return { sessions: [...deduped.values()], problems: [...problems] };
}
export function resolveBrowserCookieTarget(
  browser: BrowserName,
  platform: NodeJS.Platform
): BrowserCookieTarget {
  if (browser === 'arc' || browser === 'safari') {
    if (platform !== 'darwin') {
      throw new Error(`${normalizeBrowserSource(browser)} Cookie 提取目前仅支持 macOS；请在 Windows 或 Linux 上使用 Chrome、Edge 或 Firefox`);
    }
    if (browser === 'arc') return { backend: 'chrome', chromiumBrowser: 'arc' };
  }

  return {
    backend: browser,
    ...(browser === 'chrome' ? { chromiumBrowser: 'chrome' as const } : {})
  };
}
const CHROMIUM_COOKIE_ROOTS: Partial<Record<BrowserName, string[]>> = {
  chrome: ['Google', 'Chrome'],
  edge: ['Microsoft Edge'],
  arc: ['Arc', 'User Data']
};
async function importNodeSqlite(): Promise<typeof import('node:sqlite')> {
  // Importing node:sqlite emits an ExperimentalWarning; silence only that one.
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (String(warning instanceof Error ? warning.message : warning).includes('SQLite is an experimental feature')) return;
    return (emitWarning as (...values: unknown[]) => void).call(process, warning, ...args);
  }) as typeof process.emitWarning;
  try {
    return await import('node:sqlite');
  } finally {
    process.emitWarning = emitWarning;
  }
}
/**
 * What a Chromium browser's default macOS profile has saved of the Douban
 * login: a stamp that changes when the login is saved again, null when none is
 * saved, undefined when unknown. Cookie names, hosts and dates are not
 * encrypted, so this reads no Keychain secret and cannot trigger a Safe
 * Storage prompt.
 */
export async function storedDoubanLoginStamp(
  browser: BrowserName,
  profile: string | undefined,
  platform: NodeJS.Platform = process.platform,
  home = os.homedir()
): Promise<string | null | undefined> {
  const root = CHROMIUM_COOKIE_ROOTS[browser];
  if (platform !== 'darwin' || !root || profile !== undefined) return undefined;
  const profileDir = path.join(home, 'Library', 'Application Support', ...root, 'Default');
  // The same database sweet-cookie reads: the legacy location first.
  const dbPath = [path.join(profileDir, 'Cookies'), path.join(profileDir, 'Network', 'Cookies')].find((file) => existsSync(file));
  if (!dbPath) return undefined;

  // Query a private copy: the browser may hold the database open.
  const directory = mkdtempSync(path.join(os.tmpdir(), 'douban-cli-cookies-'));
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, path.join(directory, `Cookies${suffix}`));
    }
    const { DatabaseSync } = await importNodeSqlite();
    const db = new DatabaseSync(path.join(directory, 'Cookies'));
    try {
      // Chromium times exceed Number.MAX_SAFE_INTEGER, so read them as text. A new
      // login gets a new expiry even when the browser keeps the creation time.
      const rows = db.prepare(
        "SELECT host_key || '|' || path || '|' || CAST(creation_utc AS TEXT) || '|' || CAST(expires_utc AS TEXT) AS stamp"
        + " FROM cookies WHERE name = 'dbcl2' AND (host_key = 'douban.com' OR host_key LIKE '%.douban.com')"
        + ' ORDER BY host_key, path'
      ).all();
      return rows.length > 0 ? rows.map((row) => String(row.stamp)).join(';') : null;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
