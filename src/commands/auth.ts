import { Command } from 'commander';
import { clearAuthCache, ensureAuth, getCachedAuthSession, loginWithBrowser } from '../auth.js';
import { getCurrentUserProfile } from '../api/index.js';
import { withErrorHandler } from '../utils/error.js';
import { withSpinner } from '../utils/spinner.js';

export function registerAuthCommands(program: Command): void {
  program
    .command('login')
    .description('打开浏览器登录豆瓣并保存 Cookie')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'login',
      suggestion: '可尝试：douban login'
    }, async (opts) => {
      const session = await withSpinner(
        '正在打开浏览器登录豆瓣...',
        () => loginWithBrowser(),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(session, null, 2));
        return;
      }

      console.log('\n✅ 登录成功，已保存登录态');
      console.log(`来源: ${session.source}`);
      console.log(`更新时间: ${session.updatedAt}`);
    }));

  program
    .command('whoami')
    .description('显示当前登录用户信息 [需登录]')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'whoami',
      suggestion: '可尝试：douban login 后再运行 douban whoami'
    }, async (opts) => {
      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const profile = await withSpinner('正在获取用户信息...', () => getCurrentUserProfile(auth.cookies), !opts.json);

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
    .description('清除本地保存的登录态 [需登录]')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'logout',
      suggestion: '可尝试：douban logout'
    }, async (opts) => {
      const cached = getCachedAuthSession();
      if (!cached) {
        if (opts.json) {
          console.log(JSON.stringify({ ok: true, message: '本地没有登录态缓存' }, null, 2));
        } else {
          console.log('本地没有登录态缓存。');
        }
        return;
      }

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
