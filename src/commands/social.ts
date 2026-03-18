import { readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { ensureAuth } from '../auth.js';
import {
  createReview,
  followUser,
  getCollectionRecords,
  getCurrentUserProfile,
  getFeed,
  unfollowUser
} from '../api/index.js';
import { withErrorHandler } from '../utils/error.js';
import { isNumericId, parsePositiveInt } from '../utils/parsing.js';
import { withSpinner } from '../utils/spinner.js';

type ExportFormat = 'json' | 'csv';

interface StatResult {
  year: number;
  total: number;
  byMonth: number[];
  avgScore: string;
}

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

function monthIndex(dateText: string): number | null {
  const match = dateText.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return month - 1;
}

function calcStats(records: Array<{ date?: string; rating?: number }>, year: number): StatResult {
  const byMonth = new Array<number>(12).fill(0);
  let total = 0;
  let scoreSum = 0;
  let scoreCount = 0;

  for (const item of records) {
    if (!item.date || !item.date.startsWith(`${year}-`)) continue;
    total += 1;

    const idx = monthIndex(item.date);
    if (idx !== null) byMonth[idx] += 1;

    if (typeof item.rating === 'number' && item.rating > 0) {
      scoreSum += item.rating;
      scoreCount += 1;
    }
  }

  return {
    year,
    total,
    byMonth,
    avgScore: scoreCount > 0 ? (scoreSum / scoreCount).toFixed(2) : '-'
  };
}

function toCsv(records: Array<{
  id: string;
  title: string;
  status: string;
  date?: string;
  rating?: number;
  comment?: string;
  url: string;
}>): string {
  const header = 'id,title,status,date,rating,comment,url';
  const rows = records.map((row) => {
    const cells = [
      row.id,
      row.title,
      row.status,
      row.date || '',
      typeof row.rating === 'number' ? String(row.rating) : '',
      row.comment || '',
      row.url
    ];

    return cells
      .map((cell) => {
        const safe = String(cell).replace(/"/g, '""');
        return `"${safe}"`;
      })
      .join(',');
  });

  return `${header}\n${rows.join('\n')}\n`;
}

function parseExportFormat(value: string | undefined): ExportFormat {
  const format = (value || 'json').toLowerCase();
  if (format === 'json' || format === 'csv') return format;
  throw new Error('--format 仅支持 json 或 csv');
}

function parseDelaySeconds(value: string | undefined, fallback: number): number {
  if (typeof value === 'undefined') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('--delay 必须是非负数字');
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function registerSocialCommands(program: Command): void {
  program
    .command('review [movieId] [title] [content]')
    .description('写长评 [需登录]')
    .option('--file <path>', '从文件读取长评内容')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'review',
      target: `电影ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban review 1292052 "标题" "正文"'
    }), async (movieId, title, content, opts) => {
      if (!movieId || !title) {
        console.log('\n📝 写长评 - 请指定电影 ID 和标题\n');
        console.log('用法: douban review <电影ID> <标题> [正文]\n');
        console.log('选项:');
        console.log('  --file <path>  从文件读取长评内容\n');
        console.log('示例: douban review 1292052 "神作" "这部电影改变了我..."');
        return;
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
    .command('feed')
    .description('查看关注动态/时间线 [需登录]')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'feed',
      suggestion: '可尝试：douban feed -n 10'
    }, async (opts) => {
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const items = await withSpinner(
        '正在获取时间线...',
        () => getFeed(auth.cookies, limit),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }

      if (items.length === 0) {
        console.log('暂无动态。');
        return;
      }

      console.log('\n📰 关注动态\n');
      items.forEach((item, index) => {
        console.log(`${String(index + 1).padStart(2)}. ${item.user} ${item.action}`);
        if (item.target && item.target !== '-') console.log(`    ${item.target}`);
        if (item.content) console.log(`    ${item.content}`);
        if (item.time) console.log(`    ${item.time}`);
      });
    }));

  program
    .command('stats')
    .description('我的统计（今年看了多少片） [需登录]')
    .option('-y, --year <year>', '统计年份，默认今年')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'stats',
      suggestion: '可尝试：douban stats --year 2026'
    }, async (opts) => {
      const year = opts.year ? Number(opts.year) : new Date().getFullYear();
      if (!Number.isInteger(year) || year < 1900 || year > 3000) {
        throw new Error('年份格式不正确');
      }

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const me = await withSpinner('正在识别当前用户...', () => getCurrentUserProfile(auth.cookies), !opts.json);
      const records = await withSpinner(
        `正在读取 ${me.id} 的看过记录...`,
        () => getCollectionRecords(me.id, 'collect', 1000, auth.cookies),
        !opts.json
      );

      const stat = calcStats(records, year);

      if (opts.json) {
        console.log(JSON.stringify({ user: me, ...stat }, null, 2));
        return;
      }

      console.log(`\n📊 ${me.name} 在 ${year} 年观影统计`);
      console.log(`总计: ${stat.total} 部`);
      console.log(`平均分: ${stat.avgScore}`);
      console.log('\n按月分布:');
      stat.byMonth.forEach((count, idx) => {
        console.log(`${String(idx + 1).padStart(2, '0')}月: ${count}`);
      });
    }));

  program
    .command('export')
    .description('导出我的观影记录 [需登录]')
    .option('-o, --output <path>', '输出文件路径', 'douban-export.json')
    .option('-f, --format <format>', '导出格式：json/csv', 'json')
    .option('-n, --limit <n>', '导出数量上限', '1000')
    .option('--delay <seconds>', '批量请求间隔（秒）', '1')
    .action(withErrorHandler({
      command: 'export',
      suggestion: '可尝试：douban export --format csv -o records.csv'
    }, async (opts) => {
      const format = parseExportFormat(opts.format);
      const limit = parsePositiveInt(opts.limit, '--limit', 1000);
      const delaySeconds = parseDelaySeconds(opts.delay, 1);
      const delayMs = Math.round(delaySeconds * 1000);

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), true);
      const me = await withSpinner('正在识别当前用户...', () => getCurrentUserProfile(auth.cookies), true);

      const tasks: Array<{ status: 'collect' | 'wish' | 'do'; text: string }> = [
        { status: 'collect', text: '正在获取看过记录...' },
        { status: 'wish', text: '正在获取想看记录...' },
        { status: 'do', text: '正在获取在看记录...' }
      ];

      const bucket = new Map<'collect' | 'wish' | 'do', Awaited<ReturnType<typeof getCollectionRecords>>>();
      for (let i = 0; i < tasks.length; i += 1) {
        const task = tasks[i];
        const items = await withSpinner(
          task.text,
          () => getCollectionRecords(me.id, task.status, limit, auth.cookies),
          true
        );
        bucket.set(task.status, items);

        if (delayMs > 0 && i < tasks.length - 1) {
          await sleep(delayMs);
        }
      }

      const collect = bucket.get('collect') || [];
      const wish = bucket.get('wish') || [];
      const doing = bucket.get('do') || [];

      const merged = [...collect, ...wish, ...doing];

      if (format === 'json') {
        writeFileSync(opts.output, `${JSON.stringify({ user: me, records: merged }, null, 2)}\n`, 'utf8');
      } else {
        writeFileSync(opts.output, toCsv(merged), 'utf8');
      }

      console.log(`✅ 已导出 ${merged.length} 条记录到 ${opts.output}`);
    }));

  program
    .command('follow [userId]')
    .description('关注用户 [需登录]')
    .option('--delay <seconds>', '请求前延迟（秒）', '0')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'follow',
      target: `用户ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban follow USER_ID'
    }), async (userId, opts) => {
      if (!userId) {
        console.log('\n👥 关注用户 - 请指定用户 ID\n');
        console.log('用法: douban follow <用户ID>\n');
        console.log('获取 ID: 打开用户主页 URL，/people/xxx/ 中的 xxx 就是 ID\n');
        console.log('示例: douban follow USER_ID');
        return;
      }
      const delaySeconds = parseDelaySeconds(opts.delay, 0);
      const delayMs = Math.round(delaySeconds * 1000);

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      if (delayMs > 0) {
        await withSpinner(`等待 ${delaySeconds} 秒后提交...`, () => sleep(delayMs), !opts.json);
      }
      await withSpinner('正在关注用户...', () => followUser(String(userId), auth.cookies, auth.ck), !opts.json);

      if (opts.json) {
        console.log(JSON.stringify({ ok: true, userId }, null, 2));
      } else {
        console.log(`✅ 已关注 ${userId}`);
      }
    }));

  program
    .command('unfollow [userId]')
    .description('取消关注用户 [需登录]')
    .option('--delay <seconds>', '请求前延迟（秒）', '0')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'unfollow',
      target: `用户ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban unfollow USER_ID'
    }), async (userId, opts) => {
      if (!userId) {
        console.log('\n👥 取消关注 - 请指定用户 ID\n');
        console.log('用法: douban unfollow <用户ID>\n');
        console.log('示例: douban unfollow USER_ID');
        return;
      }
      const delaySeconds = parseDelaySeconds(opts.delay, 0);
      const delayMs = Math.round(delaySeconds * 1000);

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      if (delayMs > 0) {
        await withSpinner(`等待 ${delaySeconds} 秒后提交...`, () => sleep(delayMs), !opts.json);
      }
      await withSpinner('正在取消关注...', () => unfollowUser(String(userId), auth.cookies, auth.ck), !opts.json);

      if (opts.json) {
        console.log(JSON.stringify({ ok: true, userId }, null, 2));
      } else {
        console.log(`✅ 已取消关注 ${userId}`);
      }
    }));
}
