// Login through a browser or from pasted cookies.
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stdin as input } from 'node:process';
import { HttpRequestError } from '../api/http/errors.js';
import { CliArgumentError } from '../utils/error.js';
import { ask } from '../ui/prompt.js';
import { withSpinner } from '../ui/spinner.js';
import {
  type BrowserName,
  type LoginOptions,
  type BrowserCookieReader,
  normalizeBrowserSource,
  sourceLabel,
  validateLoginOptions,
  extractFromBrowsers,
  storedDoubanLoginStamp
} from './browser-cookies.js';
import { detectDefaultBrowser, openLoginPage } from './browser-open.js';
import { saveAuthCache } from './cache.js';
import {
  type VerifiedAuthSession,
  type ParsedAuthCookies,
  MAX_COOKIE_FILE_BYTES,
  MAX_COOKIE_STDIN_BYTES,
  parseCookieHeader,
  parseNetscapeCookies,
  createSession
} from './cookies.js';
import { selectVerifiedSession } from './session.js';

export type CookieInputStream = AsyncIterable<Buffer | string> & {
  isTTY?: boolean;
};
function decodeCookieInput(contents: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(contents);
  } catch (error) {
    throw new CliArgumentError('Cookie 输入必须是 UTF-8 文本', { cause: error });
  }
}
async function readCookieStdin(stream: CookieInputStream): Promise<Buffer> {
  if (stream.isTTY === true) {
    throw new CliArgumentError('--cookie-stdin 只接受管道或重定向输入；请勿把 Cookie 放在命令行参数或环境变量中');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, 'utf8');
      totalBytes += buffer.length;
      if (totalBytes > MAX_COOKIE_STDIN_BYTES) {
        buffer.fill(0);
        throw new CliArgumentError(`Cookie 标准输入不能超过 ${MAX_COOKIE_STDIN_BYTES / 1024} KiB`);
      }
      chunks.push(buffer);
    }

    if (totalBytes === 0) throw new CliArgumentError('Cookie 标准输入为空');
    return Buffer.concat(chunks, totalBytes);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}
function readCookieFile(filePath: string): Buffer {
  const selectedPath = filePath.trim();
  if (!selectedPath) throw new CliArgumentError('Cookie 文件路径不能为空');

  const resolvedPath = path.resolve(selectedPath);
  let stat;
  try {
    stat = lstatSync(resolvedPath);
  } catch (error) {
    throw new CliArgumentError('无法读取 Cookie 文件', { cause: error });
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new CliArgumentError('Cookie 文件必须是普通文件，不能是符号链接');
  }
  if (stat.size === 0) throw new CliArgumentError('Cookie 文件为空');
  if (stat.size > MAX_COOKIE_FILE_BYTES) {
    throw new CliArgumentError(`Cookie 文件不能超过 ${MAX_COOKIE_FILE_BYTES / 1024} KiB`);
  }

  try {
    return readFileSync(resolvedPath);
  } catch (error) {
    throw new CliArgumentError('无法读取 Cookie 文件', { cause: error });
  }
}
async function verifyAndSaveManualCookies(
  parsed: ParsedAuthCookies,
  source: 'Manual stdin' | 'Manual file'
): Promise<VerifiedAuthSession> {
  const selected = await selectVerifiedSession([
    createSession(parsed.dbcl2, parsed.ck, source)
  ]);
  saveAuthCache(selected);
  return selected;
}
export async function loginFromCookieStdin(
  stream: CookieInputStream = input as CookieInputStream
): Promise<VerifiedAuthSession> {
  const contents = await readCookieStdin(stream);
  try {
    const parsed = parseCookieHeader(decodeCookieInput(contents));
    if (!parsed) {
      throw new CliArgumentError('Cookie 标准输入无效或缺少 dbcl2；请传入单行 Cookie 请求头');
    }
    return await verifyAndSaveManualCookies(parsed, 'Manual stdin');
  } finally {
    contents.fill(0);
  }
}
export async function loginFromCookieFile(filePath: string): Promise<VerifiedAuthSession> {
  const contents = readCookieFile(filePath);
  try {
    const parsed = parseNetscapeCookies(decodeCookieInput(contents));
    if (!parsed) {
      throw new CliArgumentError('Cookie 文件无效或缺少有效的豆瓣 dbcl2；仅支持 Netscape cookies.txt');
    }
    return await verifyAndSaveManualCookies(parsed, 'Manual file');
  } finally {
    contents.fill(0);
  }
}
export function assertInteractiveLogin(isTTY: boolean | undefined): void {
  if (isTTY !== true) {
    throw new Error('douban login 需要交互式终端；请在终端中直接运行，不要通过管道、CI 或后台输入启动');
  }
}
type BrowserTarget = LoginOptions & { browser: BrowserName };
/** The browser's verified login, or why there is none and what the browser had saved. */
type LoginRead =
  | { session: VerifiedAuthSession }
  | { session?: undefined; signedOut: boolean; failure: Error; saved: string | null | undefined };

/** Chromium saves new cookies to disk in batches, up to about 30 seconds after a login. */
const SAVE_WAIT_MS = 35_000;
const SAVE_POLL_MS = 1_000;

/** Ask before opening the login page; declining ends the login. */
async function offerLoginPage(options: BrowserTarget, signedOut: boolean): Promise<void> {
  const source = sourceLabel(options.browser, options.profile);
  const problem = signedOut ? `${source} 里的豆瓣登录已失效` : `${source} 里还没有登录豆瓣`;
  const answer = await ask(`${problem}。要在 ${source} 中打开豆瓣登录页吗？[Y/n] `);
  if (/^n/i.test(answer)) {
    throw new Error(signedOut
      ? `${problem}：请先在浏览器重新登录豆瓣，或用 --browser 选择其他浏览器`
      : `未在 ${source} 中找到豆瓣登录：请先在浏览器登录豆瓣，或用 --browser 选择其他浏览器`);
  }
  openLoginPage(options);
}
async function waitForEnter(browser: BrowserName, profile: string | undefined, opened: boolean): Promise<void> {
  assertInteractiveLogin(input.isTTY);
  const source = sourceLabel(browser, profile);
  const preparation = opened
    ? `已在 ${source} 中打开豆瓣登录页；该窗口仅用于完成登录，已登录则无需重新登录。CLI 将从 ${source} 读取 Cookie，并以验证到的豆瓣账号为准。`
    : `将从 ${source} 读取 Cookie 并验证豆瓣账号。`;
  // Only Chromium browsers keep their cookie key in the macOS Keychain.
  const keychain = process.platform === 'darwin' && browser !== 'safari' && browser !== 'firefox'
    ? `；若 macOS 随后请求访问 ${normalizeBrowserSource(browser)} Safe Storage，请选择允许`
    : '';
  await ask(`${preparation}确认已登录后按回车${keychain}...`);
}
export async function loginFromBrowserCookies(
  options: LoginOptions = {},
  reader?: BrowserCookieReader
): Promise<VerifiedAuthSession> {
  const { sessions, problems } = await extractFromBrowsers(options, reader);
  if (sessions.length === 0 && problems.length > 0) throw new Error(problems.join('；'));
  const selected = await selectVerifiedSession(sessions);
  saveAuthCache(selected);
  return selected;
}
/** Read and verify the browser's login; anything but a missing or signed-out login throws. */
async function readLogin(target: BrowserTarget): Promise<LoginRead> {
  const source = sourceLabel(target.browser, target.profile);
  const saved = await storedDoubanLoginStamp(target.browser, target.profile);
  const missing = { saved, signedOut: false, failure: new Error(`未在 ${source} 中找到豆瓣登录`) };
  // Nothing saved: reading would only ask for the Keychain to decrypt nothing.
  if (saved === null) return missing;

  const { sessions, problems } = await extractFromBrowsers(target);
  if (sessions.length === 0) {
    // A store that could not be read says nothing about the login, and a login page would not help.
    if (problems.length > 0) throw new Error(problems.join('；'));
    return missing;
  }
  try {
    return { session: await selectVerifiedSession(sessions) };
  } catch (error) {
    // Douban sent the saved session to its login page.
    if (!(error instanceof HttpRequestError && error.code === 'AUTH_REQUIRED')) throw error;
    return { saved, signedOut: true, failure: new Error(`${source} 里的豆瓣登录已失效`, { cause: error }) };
  }
}
/**
 * Wait until the browser has saved a login other than `before`, without the
 * Keychain. A cookie store that cannot be watched leaves it to the user.
 */
async function waitForSave(target: BrowserTarget, before: string | null | undefined): Promise<boolean> {
  const source = sourceLabel(target.browser, target.profile);
  if (before === undefined) {
    await ask(`还没有从 ${source} 读到有效的豆瓣登录，浏览器可能还没保存。稍等几秒后按回车再试一次...`);
    return true;
  }
  const deadline = Date.now() + SAVE_WAIT_MS;
  return withSpinner(`正在等待 ${source} 保存登录（最多 ${SAVE_WAIT_MS / 1000} 秒）...`, async () => {
    for (;;) {
      const saved = await storedDoubanLoginStamp(target.browser, target.profile);
      if (saved && saved !== before) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, SAVE_POLL_MS));
    }
  });
}
export async function loginWithBrowser(options: LoginOptions = {}): Promise<VerifiedAuthSession> {
  validateLoginOptions(options);
  assertInteractiveLogin(input.isTTY);

  const browser = options.browser ?? detectDefaultBrowser();
  const target = { ...options, browser };
  let opened = Boolean(options.open);
  if (opened) {
    openLoginPage(target);
  } else if (await storedDoubanLoginStamp(browser, options.profile) === null) {
    // Known to be logged out: ask before anything else.
    await offerLoginPage(target, false);
    opened = true;
  }
  await waitForEnter(browser, options.profile, opened);

  let read = await readLogin(target);
  // The pre-check cannot see every browser, nor a signed-out session; offer the login page here too.
  if (!read.session && !opened && options.profile === undefined) {
    await offerLoginPage(target, read.signedOut);
    opened = true;
    await waitForEnter(browser, options.profile, true);
    read = await readLogin(target);
  }
  // Right after a login in the opened page, the browser may not have saved it yet.
  if (!read.session && opened && await waitForSave(target, read.saved)) read = await readLogin(target);
  if (!read.session) throw read.failure;
  saveAuthCache(read.session);
  return read.session;
}
