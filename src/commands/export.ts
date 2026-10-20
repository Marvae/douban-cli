import path from 'node:path';
import { Command } from 'commander';
import {
  getCollectionRecords,
  getUserCollectionPageWithSession,
  type CollectionStatus,
  type UserCollectionItem,
  type UserCollectionPage
} from '../api/collection.js';
import { ensureAuth, getOptionalSessionCookies, type VerifiedAuthSession } from '../auth/index.js';
import { secureAtomicWriteFile } from '../storage/secure-file.js';
import { formatStars } from '../ui/output.js';
import { withSpinner } from '../ui/spinner.js';
import { csvRow } from '../utils/csv.js';
import { printWarnings, withErrorHandler } from '../utils/error.js';
import { parsePositiveInt } from '../utils/parsing.js';
import { parseDelaySeconds, sleep } from '../utils/timing.js';
import { resolveBookStatus } from './collection.js';

interface StatResult {
  year: number;
  total: number;
  byMonth: number[];
  avgScore: string;
}

function currentUserProfile(session: VerifiedAuthSession) {
  return {
    id: session.accountId,
    name: session.accountName,
    url: `https://www.douban.com/people/${session.accountId}/`
  };
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

function serializeExportCsv(records: Array<{
  id: string;
  title: string;
  status: string;
  date?: string;
  rating?: number;
  comment?: string;
  url: string;
}>): string {
  const header = 'id,title,status,date,rating,comment,url';
  const rows = records.map((row) => csvRow([
    row.id, row.title, row.status, row.date, row.rating, row.comment, row.url
  ]));

  return `${header}\n${rows.join('\n')}\n`;
}

function parseExportFormat(value: string | undefined): 'json' | 'csv' {
  const format = (value || 'json').toLowerCase();
  if (format === 'json' || format === 'csv') return format;
  throw new Error('--format 仅支持 json 或 csv');
}

type BookExportFormat = 'json' | 'csv' | 'markdown';

type ExportResult = {
  items: UserCollectionItem[];
  total?: number;
  partial: boolean;
  warnings: string[];
};

const DEFAULT_EXPORT_LIMIT = 1000;
const MAX_EXPORT_ITEMS = 5000;
const EXPORT_BATCH_SIZE = 30;
const MAX_EXPORT_REQUESTS = 200;


function parseExportLimit(rawValue: string | undefined): number {
  const limit = parsePositiveInt(rawValue, '--limit', DEFAULT_EXPORT_LIMIT);
  if (limit > MAX_EXPORT_ITEMS) {
    throw new Error(`--limit 不能超过 ${MAX_EXPORT_ITEMS}`);
  }
  return limit;
}

function resolveExportFormat(rawFormat: string | undefined, outputPath: string): BookExportFormat {
  if (rawFormat) {
    const format = rawFormat.trim().toLowerCase();
    if (format === 'json' || format === 'csv' || format === 'markdown') return format;
    throw new Error('--format 仅支持 json、csv、markdown');
  }

  const extension = path.extname(outputPath).toLowerCase();
  if (extension === '.json') return 'json';
  if (extension === '.csv') return 'csv';
  return 'markdown';
}

function serializeBookCollectionCsv(
  items: UserCollectionItem[],
  statusLabel: string
): string {
  const rows = [
    ['序号', '书名', '状态', '星级', '日期', '短评', '豆瓣ID', '链接'],
    ...items.map((item, index) => [
      index + 1,
      item.title,
      statusLabel,
      item.rating > 0 ? item.rating : '',
      item.date,
      item.comment,
      item.id,
      item.url
    ])
  ];
  return `${rows.map(csvRow).join('\n')}\n`;
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}[\]()#+.\-!|>])/g, '\\$1')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function serializeBookCollectionMarkdown(
  items: UserCollectionItem[],
  statusLabel: string
): string {
  const lines = [
    '# 豆瓣读书清单',
    '',
    `- 状态：${statusLabel}`,
    `- 数量：${items.length}`,
    ''
  ];

  items.forEach((item, index) => {
    const title = escapeMarkdown(item.title) || '未命名书籍';
    const comment = escapeMarkdown(item.comment) || '-';
    const stars = formatStars(item.rating);
    lines.push(`${index + 1}. **${title}**`);
    lines.push(`   - 星级：${stars}`);
    lines.push(`   - 日期：${item.date || '-'}`);
    lines.push(`   - 短评：${comment}`);
    lines.push('');
  });

  return `${lines.join('\n').trimEnd()}\n`;
}

async function fetchBookCollectionExport(
  userId: string,
  status: CollectionStatus,
  limit: number,
  pageDelayMs: number,
  cookies?: string,
  onProgress?: (fetched: number) => void
): Promise<ExportResult> {
  const items: UserCollectionItem[] = [];
  const seenItems = new Set<string>();
  const seenStarts = new Set<number>();
  const warnings: string[] = [];
  let total: number | undefined;
  let partial = false;
  let nextStart: number | null = 0;
  let requestCount = 0;

  while (nextStart !== null && items.length < limit && requestCount < MAX_EXPORT_REQUESTS) {
    if (seenStarts.has(nextStart)) {
      partial = true;
      warnings.push(`导出在 start=${nextStart} 遇到重复游标，已停止继续请求`);
      break;
    }
    seenStarts.add(nextStart);
    requestCount += 1;

    if (requestCount > 1 && pageDelayMs > 0) {
      await sleep(pageDelayMs);
    }

    let result: UserCollectionPage;
    try {
      result = await getUserCollectionPageWithSession(
        {
          kind: 'book',
          userId,
          status,
          start: nextStart,
          count: Math.min(EXPORT_BATCH_SIZE, limit - items.length),
          pageDelayMs,
          onProgress: (count) => onProgress?.(items.length + count)
        },
        cookies
      );
    } catch (error) {
      if (items.length === 0) throw error;
      partial = true;
      warnings.push(`导出在 start=${nextStart} 中断: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
    if (result.total !== undefined) total = result.total;
    partial = partial || result.partial;
    warnings.push(...result.warnings);

    result.items.forEach((item) => {
      const key = `${item.kind}:${item.id}`;
      if (items.length < limit && !seenItems.has(key)) {
        seenItems.add(key);
        items.push(item);
      }
    });

    nextStart = result.nextStart;
  }

  if (nextStart !== null && items.length < limit && requestCount >= MAX_EXPORT_REQUESTS) {
    partial = true;
    warnings.push(`导出达到 ${MAX_EXPORT_REQUESTS} 次请求上限，已停止继续请求`);
  }

  return { items, total, partial, warnings };
}

function serializeBookCollectionJson(
  result: ExportResult,
  userId: string,
  status: CollectionStatus,
  statusLabel: string
): string {
  return `${JSON.stringify({
    metadata: {
      userId,
      status,
      statusLabel,
      count: result.items.length,
      ...(result.total !== undefined ? { total: result.total } : {}),
      partial: result.partial,
      warnings: result.warnings
    },
    items: result.items
  }, null, 2)}\n`;
}

/** `stats` and `export` for the signed-in account's movies, `book export` for any user's books. */
export function registerExportCommands(program: Command, book: Command): void {
  program
    .command('stats')
    .helpGroup('账号:')
    .description('我的统计（今年看了多少片） [需登录]')
    .option('-y, --year <year>', '统计年份，默认今年')
    .option('-n, --limit <n>', '最多读取的看过记录数', '1000')
    .option('--delay <seconds>', '分页请求间隔（秒）', '1')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'stats',
      suggestion: '可尝试：douban stats --year 2026 --limit 30 --delay 2'
    }, async (opts) => {
      const year = typeof opts.year === 'string'
        ? parsePositiveInt(opts.year, '--year', new Date().getFullYear())
        : new Date().getFullYear();
      if (!Number.isInteger(year) || year < 1900 || year > 3000) {
        throw new Error('年份格式不正确');
      }
      const limit = parsePositiveInt(opts.limit, '--limit', 1000);
      const delaySeconds = parseDelaySeconds(opts.delay, 1);
      const pageDelayMs = Math.round(delaySeconds * 1000);

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const me = currentUserProfile(auth);
      let fetched = 0;
      const result = await withSpinner(
        () => `正在读取看过记录... 已读取 ${fetched} 条`,
        () => getCollectionRecords(me.id, 'collect', limit, auth.cookies, { pageDelayMs, onProgress: (count) => { fetched = count; } }),
        !opts.json
      );

      const stat = calcStats(result.records, year);
      const warnings = [...result.warnings];
      // Records come newest first; stopping at the limit inside the year means older ones were missed.
      const oldestYear = Number(result.records.at(-1)?.date?.slice(0, 4));
      if (result.records.length >= limit && !(oldestYear < year)) {
        warnings.push(`只读取了最近 ${limit} 条看过记录，${year} 年更早的没有统计到，可调大 --limit`);
      }
      const metadata = { partial: result.partial || warnings.length > result.warnings.length, warnings };
      printWarnings(warnings);

      if (opts.json) {
        console.log(JSON.stringify({ user: me, ...stat, metadata }, null, 2));
        return;
      }

      console.log(`\n📊 ${me.name} 在 ${year} 年观影统计${metadata.partial ? '（结果可能不完整）' : ''}`);
      console.log(`总计: ${stat.total} 部`);
      console.log(`平均分: ${stat.avgScore}`);
      console.log('\n按月分布:');
      stat.byMonth.forEach((count, idx) => {
        console.log(`${String(idx + 1).padStart(2, '0')}月: ${count}`);
      });
    }));

  program
    .command('export')
    .helpGroup('账号:')
    .description('导出我的观影记录 [需登录]')
    .requiredOption('-o, --output <path>', '输出文件路径（包含个人数据，必须明确指定）')
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

      const rawOutputPath = String(opts.output || '').trim();
      if (!rawOutputPath) {
        throw new Error('输出文件路径不能为空');
      }
      const outputPath = path.resolve(rawOutputPath);

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), true);
      const me = currentUserProfile(auth);

      const tasks: Array<{ status: 'collect' | 'wish' | 'do'; label: string; text: string }> = [
        { status: 'collect', label: '看过', text: '正在获取看过记录...' },
        { status: 'wish', label: '想看', text: '正在获取想看记录...' },
        { status: 'do', label: '在看', text: '正在获取在看记录...' }
      ];

      const bucket = new Map<'collect' | 'wish' | 'do', Awaited<ReturnType<typeof getCollectionRecords>>>();
      const warnings: string[] = [];
      for (let i = 0; i < tasks.length; i += 1) {
        const task = tasks[i];
        let fetched = 0;
        const result = await withSpinner(
          () => `${task.text} 已读取 ${fetched} 条`,
          () => getCollectionRecords(me.id, task.status, limit, auth.cookies, { pageDelayMs: delayMs, onProgress: (count) => { fetched = count; } }),
          true
        );
        bucket.set(task.status, result);
        const scopedWarnings = result.warnings.map((warning) => `${task.label}：${warning}`);
        warnings.push(...scopedWarnings);
        printWarnings(scopedWarnings);

        if (delayMs > 0 && i < tasks.length - 1) {
          await sleep(delayMs);
        }
      }

      const collect = bucket.get('collect')?.records || [];
      const wish = bucket.get('wish')?.records || [];
      const doing = bucket.get('do')?.records || [];

      const merged = [...collect, ...wish, ...doing];
      const metadata = {
        count: merged.length,
        partial: [...bucket.values()].some((result) => result.partial),
        warnings
      };

      if (format === 'json') {
        secureAtomicWriteFile(outputPath, `${JSON.stringify({ user: me, records: merged, metadata }, null, 2)}\n`);
      } else {
        secureAtomicWriteFile(outputPath, serializeExportCsv(merged));
      }

      if (metadata.partial) {
        console.log(`⚠️ 已写入 ${merged.length} 条记录到 ${outputPath}；结果可能不完整，请查看上方警告。`);
      } else {
        console.log(`✅ 已导出 ${merged.length} 条记录到 ${outputPath}`);
      }
    }));

  book
    .command('export <userId>')
    .description('导出指定用户的图书收藏')
    .option('--wish', '导出“想读”列表（默认读过）')
    .option('--reading', '导出“在读”列表')
    .option('-n, --limit <n>', `最多导出数量（上限 ${MAX_EXPORT_ITEMS}）`, String(DEFAULT_EXPORT_LIMIT))
    .requiredOption('-o, --output <path>', '输出文件路径')
    .option('-f, --format <format>', '格式：json、csv、markdown（默认按扩展名推断）')
    .option('--delay <seconds>', '分页请求间隔（秒）', '1')
    .action(withErrorHandler((args) => ({
      command: 'book export',
      target: `用户ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban book export <userId> -o books.md'
    }), async (userId, opts) => {
      const { status, statusLabel } = resolveBookStatus(opts);
      const limit = parseExportLimit(opts.limit);
      const delaySeconds = parseDelaySeconds(opts.delay, 1);
      const pageDelayMs = Math.round(delaySeconds * 1000);
      const outputPath = path.resolve(String(opts.output));
      const format = resolveExportFormat(opts.format, outputPath);
      // Reuse the same session across all export pages.
      const cookies = await getOptionalSessionCookies();
      let fetched = 0;
      const result = await withSpinner(
        () => `正在导出用户 ${userId} 的${statusLabel}书单... 已读取 ${fetched} 条`,
        () => fetchBookCollectionExport(userId, status, limit, pageDelayMs, cookies, (count) => { fetched = count; }),
        true
      );
      printWarnings(result.warnings);

      let contents: string;
      if (format === 'json') {
        contents = serializeBookCollectionJson(result, userId, status, statusLabel);
      } else if (format === 'csv') {
        contents = serializeBookCollectionCsv(result.items, statusLabel);
      } else {
        contents = serializeBookCollectionMarkdown(result.items, statusLabel);
      }

      secureAtomicWriteFile(outputPath, contents);
      if (result.partial) {
        console.log(`⚠️ 已写入 ${result.items.length} 本书到 ${outputPath}；结果可能不完整，请查看上方警告。`);
      } else {
        console.log(`✅ 已导出 ${result.items.length} 本书到 ${outputPath}`);
      }
    }));
}
