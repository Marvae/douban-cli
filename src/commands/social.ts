import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { createReview, followUser, unfollowUser } from '../api/mutations.js';
import { ensureAuth } from '../auth/index.js';
import { withSpinner } from '../ui/spinner.js';
import { withErrorHandler } from '../utils/error.js';
import { isNumericId } from '../utils/parsing.js';
import { parseDelaySeconds, sleep } from '../utils/timing.js';

function parseMovieId(value: string): string {
  const id = value.trim();
  if (!isNumericId(id)) throw new Error('电影 ID 必须是纯数字');
  return id;
}

function readReviewContent(content: string | undefined, filePath: string | undefined): string {
  if (filePath) {
    return readFileSync(filePath, 'utf8').trim();
  }
  return String(content || '').trim();
}

export function registerSocialCommands(program: Command): void {
  program
    .command('review <movieId> <title> [content]')
    .helpGroup('写入操作:')
    .description('发布电影长评 [需登录]')
    .option('--file <path>', '从文件读取长评内容')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'review',
      target: `电影ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban review 1292052 "标题" "正文"'
    }), async (movieId, title, content, opts) => {
      if (opts.file && content) {
        throw new Error('--file 不能与 [content] 同时使用');
      }
      const body = readReviewContent(content, opts.file);
      if (!body) throw new Error('长评内容不能为空，请传 [content] 或 --file');

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const result = await withSpinner(
        '正在发布长评...',
        () => createReview(parseMovieId(movieId), String(title), body, auth.cookies, auth.ck),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log('\n✅ 长评发布成功');
      console.log(`reviewId: ${result.id || '-'}`);
      console.log(`链接: ${result.url}`);
    }));

  program
    .command('follow <userId>')
    .helpGroup('写入操作:')
    .description('关注用户 [需登录]')
    .option('--delay <seconds>', '请求前延迟（秒）', '0')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'follow',
      target: `用户ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban follow USER_ID'
    }), async (userId, opts) => {
      const id = String(userId).trim();
      if (!id) throw new Error('用户 ID 不能为空');
      const delaySeconds = parseDelaySeconds(opts.delay, 0);
      const delayMs = Math.round(delaySeconds * 1000);

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      if (delayMs > 0) {
        await withSpinner(`等待 ${delaySeconds} 秒后提交...`, () => sleep(delayMs), !opts.json);
      }
      await withSpinner('正在关注用户...', () => followUser(id, auth.cookies, auth.ck), !opts.json);

      if (opts.json) {
        console.log(JSON.stringify({ ok: true, userId: id }, null, 2));
      } else {
        console.log(`✅ 已关注 ${id}`);
      }
    }));

  program
    .command('unfollow <userId>')
    .helpGroup('写入操作:')
    .description('取消关注用户 [需登录]')
    .option('--delay <seconds>', '请求前延迟（秒）', '0')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'unfollow',
      target: `用户ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban unfollow USER_ID'
    }), async (userId, opts) => {
      const id = String(userId).trim();
      if (!id) throw new Error('用户 ID 不能为空');
      const delaySeconds = parseDelaySeconds(opts.delay, 0);
      const delayMs = Math.round(delaySeconds * 1000);

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      if (delayMs > 0) {
        await withSpinner(`等待 ${delaySeconds} 秒后提交...`, () => sleep(delayMs), !opts.json);
      }
      await withSpinner('正在取消关注...', () => unfollowUser(id, auth.cookies, auth.ck), !opts.json);

      if (opts.json) {
        console.log(JSON.stringify({ ok: true, userId: id }, null, 2));
      } else {
        console.log(`✅ 已取消关注 ${id}`);
      }
    }));
}
