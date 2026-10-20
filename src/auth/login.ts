// Login through a browser or from pasted cookies.
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stdin as input, stderr as promptOutput } from 'node:process';
import readline from 'node:readline/promises';
import { CliArgumentError } from '../utils/error.js';
import {
  type BrowserName,
  type LoginOptions,
  type BrowserCookieReader,
  sourceLabel,
  validateLoginOptions,
  extractFromBrowsers,
  hasStoredDoubanLogin
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
/** Ask before opening the login page; declining ends the login. */
async function offerLoginPage(options: LoginOptions & { browser: BrowserName }): Promise<void> {
  const rl = readline.createInterface({ input, output: promptOutput });
  const source = sourceLabel(options.browser, options.profile);
  let answer: string;
  try {
    answer = await rl.question(`${source} 里还没有登录豆瓣。要在 ${source} 中打开豆瓣登录页吗？[Y/n] `);
  } finally {
    rl.close();
  }
  if (/^n/i.test(answer.trim())) {
    throw new Error(`未在 ${source} 中找到豆瓣登录：请先在浏览器登录豆瓣，或用 --browser 选择其他浏览器`);
  }
  openLoginPage(options);
}
async function waitForEnter(browser: BrowserName, profile: string | undefined, opened: boolean): Promise<void> {
  assertInteractiveLogin(input.isTTY);
  const rl = readline.createInterface({ input, output: promptOutput });
  const source = sourceLabel(browser, profile);
  const preparation = opened
    ? `已打开 ${source} 的豆瓣当前账号页；该窗口仅用于完成登录。CLI 将从 ${source} 读取 Cookie，并以验证到的豆瓣账号为准。`
    : `将从 ${source} 读取 Cookie 并验证豆瓣账号。`;
  try {
    await rl.question(`${preparation}确认已登录后按回车；若 macOS 随后请求访问浏览器 Safe Storage，请选择允许...`);
  } finally {
    rl.close();
  }
}
export async function loginFromBrowserCookies(
  options: LoginOptions = {},
  reader?: BrowserCookieReader
): Promise<VerifiedAuthSession> {
  const candidates = await extractFromBrowsers(options, reader);
  const selected = await selectVerifiedSession(candidates);
  saveAuthCache(selected);
  return selected;
}
export async function loginWithBrowser(options: LoginOptions = {}): Promise<VerifiedAuthSession> {
  validateLoginOptions(options);
  assertInteractiveLogin(input.isTTY);

  const browser = options.browser ?? detectDefaultBrowser();
  const target = { ...options, browser };
  let opened = Boolean(options.open);
  if (opened) {
    openLoginPage(target);
  } else if (await hasStoredDoubanLogin(browser, options.profile) === false) {
    // Known to be logged out: ask before reading, so no Safe Storage prompt is wasted.
    await offerLoginPage(target);
    opened = true;
  }
  await waitForEnter(browser, options.profile, opened);

  let candidates = await extractFromBrowsers(target);
  // The pre-check cannot see every browser; offer the login page once here too.
  if (candidates.length === 0 && !opened && options.profile === undefined) {
    await offerLoginPage(target);
    await waitForEnter(browser, options.profile, true);
    candidates = await extractFromBrowsers(target);
  }
  const selected = await selectVerifiedSession(candidates);
  saveAuthCache(selected);
  return selected;
}
