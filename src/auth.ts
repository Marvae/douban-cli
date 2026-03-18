import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export interface AuthSession {
  dbcl2: string;
  ck?: string;
  cookies: string;
  source: string;
  updatedAt: string;
}

interface EncryptedAuthCache {
  version: 1;
  source: string;
  updatedAt: string;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

const AUTH_CACHE_PATH = path.join(os.homedir(), '.douban-cli-auth.json');
const DOUBAN_LOGIN_URL = 'https://accounts.douban.com/passport/login';

type PuppeteerCookie = { name?: string; value?: string };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseEncryptedAuthCache(raw: unknown): EncryptedAuthCache | null {
  const obj = asObject(raw);
  if (!obj) return null;

  if (obj.version !== 1) return null;

  const source = typeof obj.source === 'string' ? obj.source : '';
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : '';
  const salt = typeof obj.salt === 'string' ? obj.salt : '';
  const iv = typeof obj.iv === 'string' ? obj.iv : '';
  const tag = typeof obj.tag === 'string' ? obj.tag : '';
  const data = typeof obj.data === 'string' ? obj.data : '';

  if (!source || !updatedAt || !salt || !iv || !tag || !data) return null;

  return {
    version: 1,
    source,
    updatedAt,
    salt,
    iv,
    tag,
    data
  };
}

function parseAuthSession(raw: unknown): AuthSession | null {
  const obj = asObject(raw);
  if (!obj) return null;

  const dbcl2 = typeof obj.dbcl2 === 'string' ? obj.dbcl2.trim() : '';
  if (!dbcl2) return null;

  const ck = typeof obj.ck === 'string' && obj.ck.trim() ? obj.ck.trim() : undefined;
  const source = typeof obj.source === 'string' && obj.source.trim() ? obj.source.trim() : 'Browser';
  const updatedAt = typeof obj.updatedAt === 'string' && obj.updatedAt.trim() ? obj.updatedAt.trim() : new Date().toISOString();
  const cookies = buildCookieHeader(dbcl2, ck);

  return {
    dbcl2,
    ck,
    cookies,
    source,
    updatedAt
  };
}

function machineSecret(): Buffer {
  const payload = `${os.userInfo().username}|${os.hostname()}|${os.homedir()}|douban-cli`;
  return createHash('sha256').update(payload).digest();
}

function encryptCache(auth: AuthSession): EncryptedAuthCache {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(machineSecret(), salt, 120000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(auth), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    source: auth.source,
    updatedAt: auth.updatedAt,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64')
  };
}

function decryptCache(payload: EncryptedAuthCache): AuthSession | null {
  try {
    const salt = Buffer.from(payload.salt, 'base64');
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const data = Buffer.from(payload.data, 'base64');
    const key = pbkdf2Sync(machineSecret(), salt, 120000, 32, 'sha256');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    const decoded = JSON.parse(plaintext.toString('utf8')) as unknown;
    return parseAuthSession(decoded);
  } catch (error) {
    reportRecoverableError('解密登录缓存失败', error);
    return null;
  }
}

function readAuthCache(): AuthSession | null {
  if (!existsSync(AUTH_CACHE_PATH)) return null;

  try {
    const stat = statSync(AUTH_CACHE_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 30 * 24 * 60 * 60 * 1000) return null;

    const raw = JSON.parse(readFileSync(AUTH_CACHE_PATH, 'utf8')) as unknown;
    const parsed = parseEncryptedAuthCache(raw);
    if (!parsed) return null;
    return decryptCache(parsed);
  } catch (error) {
    reportRecoverableError('读取登录缓存失败', error);
    return null;
  }
}

function saveAuthCache(auth: AuthSession): void {
  const encrypted = encryptCache(auth);
  writeFileSync(AUTH_CACHE_PATH, `${JSON.stringify(encrypted, null, 2)}\n`, { mode: 0o600 });
}

export function clearAuthCache(): void {
  if (!existsSync(AUTH_CACHE_PATH)) return;
  unlinkSync(AUTH_CACHE_PATH);
}

export function getCachedAuthSession(clear = false): AuthSession | null {
  const cached = readAuthCache();
  if (clear) clearAuthCache();
  return cached;
}

function buildCookieHeader(dbcl2: string, ck?: string): string {
  const parts = [`dbcl2=${dbcl2}`];
  if (ck) parts.push(`ck=${ck}`);
  return parts.join('; ');
}

function createSession(dbcl2: string, ck: string | undefined, source: string): AuthSession {
  return {
    dbcl2,
    ck,
    cookies: buildCookieHeader(dbcl2, ck),
    source,
    updatedAt: new Date().toISOString()
  };
}

interface SweetCookieResult {
  cookies: Array<{ name: string; value: string; source?: { browser?: string } }>;
  warnings: string[];
}

interface PuppeteerPage {
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  waitForFunction(pageFunction: string | (() => unknown), options?: { timeout?: number }): Promise<unknown>;
  cookies(): Promise<PuppeteerCookie[]>;
}

interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}

interface PuppeteerLaunchOptions {
  headless?: boolean;
  defaultViewport?: null | { width: number; height: number };
}

type PuppeteerLaunch = (options?: PuppeteerLaunchOptions) => Promise<PuppeteerBrowser>;

type BrowserName = 'chrome' | 'edge' | 'firefox' | 'safari';

function reportRecoverableError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[auth] ${context}: ${message}`);
}

function normalizeBrowserSource(source: string): string {
  const lower = source.trim().toLowerCase();
  if (!lower) return 'Browser';

  const mapping: Record<string, string> = {
    chrome: 'Chrome',
    edge: 'Edge',
    firefox: 'Firefox',
    safari: 'Safari'
  };

  return mapping[lower] || source.charAt(0).toUpperCase() + source.slice(1);
}

async function extractFromBrowsers(): Promise<AuthSession | null> {
  // 使用 sweet-cookie 库提取浏览器 cookie（支持 Chrome/Edge/Firefox/Safari）
  let getCookies: (options: { url: string; browsers?: BrowserName[] }) => Promise<SweetCookieResult>;
  
  try {
    const mod = await import('@steipete/sweet-cookie');
    getCookies = mod.getCookies;
  } catch (error) {
    reportRecoverableError('加载 sweet-cookie 失败', error);
    return null;
  }

  try {
    const result = await getCookies({
      url: 'https://www.douban.com',
      browsers: ['chrome', 'edge', 'firefox', 'safari']
    });

    let dbcl2 = '';
    let ck = '';
    let source = 'Browser';

    for (const cookie of result.cookies) {
      if (cookie.name === 'dbcl2' && !dbcl2) {
        dbcl2 = cookie.value.replace(/^"|"$/g, '');
        source = cookie.source?.browser || 'Browser';
      }
      if (cookie.name === 'ck' && !ck) {
        ck = cookie.value;
      }
      if (dbcl2 && ck) break;
    }

    if (!dbcl2) return null;
    return createSession(dbcl2, ck || undefined, normalizeBrowserSource(source));
  } catch (error) {
    reportRecoverableError('从浏览器提取 Cookie 失败', error);
    return null;
  }
}

function openLoginPage(): void {
  let command: string;
  let args: string[];

  if (process.platform === 'darwin') {
    command = 'open';
    args = [DOUBAN_LOGIN_URL];
  } else if (process.platform === 'linux') {
    command = 'xdg-open';
    args = [DOUBAN_LOGIN_URL];
  } else if (process.platform === 'win32') {
    command = 'cmd';
    args = ['/c', 'start', '', DOUBAN_LOGIN_URL];
  } else {
    throw new Error('当前平台暂不支持自动打开浏览器登录流程');
  }

  const opened = spawnSync(command, args, { stdio: 'ignore' });
  if (opened.error || opened.status !== 0) {
    const message = opened.error?.message || `exit code ${opened.status ?? 'unknown'}`;
    throw new Error(`打开浏览器失败: ${message}`);
  }
}

async function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question('完成豆瓣登录后，按回车继续提取 Cookie...');
  } finally {
    rl.close();
  }
}

function toSessionFromPuppeteerCookies(cookies: PuppeteerCookie[]): AuthSession | null {
  let dbcl2 = '';
  let ck = '';

  for (const cookie of cookies) {
    if (!cookie?.name || typeof cookie.value !== 'string') continue;
    if (cookie.name === 'dbcl2' && !dbcl2) dbcl2 = cookie.value.replace(/^"|"$/g, '');
    if (cookie.name === 'ck' && !ck) ck = cookie.value;
  }

  if (!dbcl2) return null;
  return createSession(dbcl2, ck || undefined, 'Puppeteer');
}

async function extractFromPuppeteerBrowserLogin(): Promise<AuthSession | null> {
  let puppeteerModule: unknown;
  try {
    const moduleName = 'puppeteer';
    puppeteerModule = await import(moduleName);
  } catch (error) {
    reportRecoverableError('加载 puppeteer 失败', error);
    return null;
  }

  const launch = (puppeteerModule as { default?: { launch?: PuppeteerLaunch }; launch?: PuppeteerLaunch }).default?.launch
    || (puppeteerModule as { launch?: PuppeteerLaunch }).launch;
  if (typeof launch !== 'function') return null;

  let browser: PuppeteerBrowser | null = null;

  try {
    browser = await launch({
      headless: false,
      defaultViewport: null
    });

    const page = await browser.newPage();
    await page.goto(DOUBAN_LOGIN_URL, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(
      () => document.cookie.includes('dbcl2='),
      { timeout: 180000 }
    );

    const cookies = await page.cookies();
    return toSessionFromPuppeteerCookies(cookies as PuppeteerCookie[]);
  } catch (error) {
    reportRecoverableError('通过 puppeteer 登录提取 Cookie 失败', error);
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        reportRecoverableError('关闭 puppeteer 浏览器失败', error);
      }
    }
  }
}

export async function loginWithBrowser(): Promise<AuthSession> {
  const fromPuppeteer = await extractFromPuppeteerBrowserLogin();
  if (fromPuppeteer) {
    saveAuthCache(fromPuppeteer);
    return fromPuppeteer;
  }

  openLoginPage();
  await waitForEnter();

  const extracted = await extractFromBrowsers();
  if (!extracted) {
    throw new Error('登录后仍未提取到 dbcl2 Cookie，请确认已在浏览器完成登录。');
  }

  saveAuthCache(extracted);
  return extracted;
}

export async function detectAuthSession(): Promise<AuthSession | null> {
  const cached = readAuthCache();
  if (cached) return cached;

  const extracted = await extractFromBrowsers();
  if (!extracted) return null;

  saveAuthCache(extracted);
  return extracted;
}

export async function ensureAuth(): Promise<AuthSession> {
  const detected = await detectAuthSession();
  if (detected) return detected;

  console.log('未检测到可用豆瓣登录态，正在打开浏览器登录页面...');
  return loginWithBrowser();
}
