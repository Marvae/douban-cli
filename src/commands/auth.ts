import { Command } from 'commander';
import {
  clearAuthCache,
  detectDefaultBrowser,
  ensureAuth,
  loginFromCookieFile,
  loginFromCookieStdin,
  loginWithBrowser,
  type AuthSession,
  type BrowserName
} from '../auth/index.js';
import { readConfig, writeConfig, type CliConfig } from '../storage/config.js';
import { debug } from '../utils/debug.js';
import { CliArgumentError, withErrorHandler } from '../utils/error.js';
import { parsePositiveIntAtMost } from '../utils/parsing.js';
import { withSpinner } from '../ui/spinner.js';

function toSafeSessionJson(session: AuthSession): Record<string, string | undefined> {
  return {
    source: session.source,
    accountId: session.accountId,
    accountName: session.accountName,
    updatedAt: session.updatedAt
  };
}

function parseBrowserName(value: string | undefined): BrowserName | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'chrome' || normalized === 'arc' || normalized === 'edge' || normalized === 'firefox' || normalized === 'safari') {
    return normalized;
  }
  throw new Error('--browser 仅支持 chrome、arc、edge、firefox 或 safari');
}

/** The browser of the last browser login; a missing or damaged entry counts as none. */
function rememberedLogin(): { browser: BrowserName; profile?: string } | undefined {
  try {
    const login = readConfig().login;
    const browser = parseBrowserName(login?.browser);
    return browser ? { browser, profile: login?.profile } : undefined;
  } catch {
    return undefined;
  }
}

function rememberLogin(login: NonNullable<CliConfig['login']>): void {
  try {
    writeConfig({ ...readConfig(), login });
  } catch (error) {
    debug('login', `未能记住登录浏览器: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .helpGroup('账号:')
    .description('登录：读取浏览器里已登录的豆瓣，或导入 Cookie')
    .option('--browser <browser>', '明确从指定浏览器读取登录态（Arc 仅 macOS）')
    .option('--profile <profile>', '指定浏览器配置目录（需配合 --browser）')
    .option('--cookie-timeout <seconds>', '浏览器 Cookie/钥匙串读取超时（1-300 秒）')
    .option('--open', '打开浏览器的豆瓣当前账号页（不能与 --profile 同用）')
    .option('--cookie-stdin', '从非交互式标准输入读取单行 Cookie 请求头')
    .option('--cookie-file <path>', '从 Netscape cookies.txt 文件读取 Cookie')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'login',
      suggestion: '可尝试：douban login，或显式使用 --cookie-stdin / --cookie-file'
    }, async (opts) => {
      const cookieStdin = Boolean(opts.cookieStdin);
      const cookieFileProvided = typeof opts.cookieFile === 'string';
      const cookieFile = cookieFileProvided ? opts.cookieFile.trim() : undefined;
      if (cookieFileProvided && !cookieFile) throw new CliArgumentError('Cookie 文件路径不能为空');
      if (cookieStdin && cookieFileProvided) {
        throw new CliArgumentError('--cookie-stdin 与 --cookie-file 不能同时使用');
      }

      const manualCookieInput = cookieStdin || cookieFileProvided;
      if (manualCookieInput && (
        opts.browser !== undefined
        || opts.profile !== undefined
        || opts.open
        || opts.cookieTimeout !== undefined
      )) {
        throw new CliArgumentError('手动 Cookie 导入不能与 --browser、--profile、--open 或 --cookie-timeout 同时使用');
      }

      let session: AuthSession;
      if (cookieStdin) {
        session = await loginFromCookieStdin();
      } else if (cookieFile) {
        session = await loginFromCookieFile(cookieFile);
      } else {
        const explicit = parseBrowserName(opts.browser);
        const explicitProfile = typeof opts.profile === 'string' ? opts.profile.trim() : undefined;
        const cookieTimeoutSeconds = parsePositiveIntAtMost(
          opts.cookieTimeout ?? '60',
          '--cookie-timeout',
          60,
          300
        );
        if (explicitProfile && !explicit) throw new Error('--profile 必须与 --browser 一起使用');
        if (explicitProfile && explicit === 'safari') throw new Error('Safari 不支持 --profile');

        // Without --browser, use the browser of the last browser login, then the system default.
        const remembered = explicit ? undefined : rememberedLogin();
        const browser = explicit ?? remembered?.browser ?? detectDefaultBrowser();
        const profile = explicitProfile ?? (opts.open ? undefined : remembered?.profile);
        if (remembered && !opts.json) {
          console.log(`沿用上次登录的浏览器（--browser ${browser}${profile ? ` --profile ${profile}` : ''}）；换浏览器请指定 --browser`);
        }
        session = await loginWithBrowser({
          browser,
          profile,
          cookieTimeoutMs: cookieTimeoutSeconds * 1000,
          open: Boolean(opts.open)
        });
        rememberLogin({ browser, ...(profile ? { profile } : {}) });
      }

      if (opts.json) {
        console.log(JSON.stringify(toSafeSessionJson(session), null, 2));
        return;
      }

      console.log('\n✅ 登录成功，已保存登录态');
      console.log(`来源: ${session.source}`);
      console.log(`账号: ${session.accountName} (${session.accountId})`);
      console.log(`更新时间: ${session.updatedAt}`);
    }));

  program
    .command('whoami')
    .helpGroup('账号:')
    .description('当前登录的账号 [需登录]')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'whoami',
      suggestion: '可尝试：douban login 后再运行 douban whoami'
    }, async (opts) => {
      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const profile = {
        id: auth.accountId,
        name: auth.accountName,
        url: `https://www.douban.com/people/${auth.accountId}/`
      };

      if (opts.json) {
        console.log(JSON.stringify({
          ...profile,
          source: auth.source,
          updatedAt: auth.updatedAt
        }, null, 2));
        return;
      }

      console.log('\n👤 当前登录用户');
      console.log(`ID: ${profile.id}`);
      console.log(`昵称: ${profile.name}`);
      console.log(`主页: ${profile.url}`);
      console.log(`登录态来源: ${auth.source}`);
    }));

  program
    .command('logout')
    .helpGroup('账号:')
    .description('清除本地保存的登录态')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'logout',
      suggestion: '可尝试：douban logout'
    }, async (opts) => {
      await withSpinner('正在清理本地登录态...', async () => {
        clearAuthCache();
      }, !opts.json);

      if (opts.json) {
        console.log(JSON.stringify({ ok: true }, null, 2));
      } else {
        console.log('✅ 本地登录态已清除。');
      }
    }));
}
