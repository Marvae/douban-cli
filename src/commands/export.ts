import path from 'node:path';
import { Command } from 'commander';
import {
  getUserCollectionPageWithSession,
  type CollectionStatus,
  type UserCollectionItem
} from '../api/collection.js';
import type { SubjectKind } from '../api/subject.js';
import { getOptionalSessionCookies } from '../auth/index.js';
import { secureAtomicWriteFile } from '../storage/secure-file.js';
import { formatStars, STATUS_LABELS } from '../ui/output.js';
import { withSpinner } from '../ui/spinner.js';
import { csvRow } from '../utils/csv.js';
import { CliArgumentError, printWarnings, withErrorHandler } from '../utils/error.js';
import { parsePositiveInt, parsePositiveIntAtMost } from '../utils/parsing.js';
import { parseDelaySeconds, sleep } from '../utils/timing.js';
import { pickStatuses, resolveCurrentUser } from './collection.js';

type ExportFormat = 'json' | 'csv' | 'markdown';

/** One status of a user's collection, read in full or up to the limit. */
interface CollectionSection {
  status: CollectionStatus;
  items: UserCollectionItem[];
  /** More entries exist beyond the limit. */
  more: boolean;
  partial: boolean;
  warnings: string[];
}

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 3000;
const NOUNS = { movie: { list: '片单', unit: '部', stats: '观影' }, book: { list: '书单', unit: '本', stats: '读书' } } as const;

/**
 * Read statuses one after another with the same pacing as pages. A status that
 * fails after another was read ends the run and keeps what was read.
 */
async function readCollection(options: {
  kind: SubjectKind;
  userId: string;
  statuses: CollectionStatus[];
  limit: number;
  delayMs: number;
  spinner: boolean;
}): Promise<CollectionSection[]> {
  const { kind, userId, limit, delayMs } = options;
  const cookies = await getOptionalSessionCookies();
  const sections: CollectionSection[] = [];
  for (const status of options.statuses) {
    const label = STATUS_LABELS[kind][status];
    if (sections.length > 0 && delayMs > 0) await sleep(delayMs);
    let fetched = 0;
    try {
      const page = await withSpinner(
        () => `正在读取${label}... 已读取 ${fetched} 条`,
        () => getUserCollectionPageWithSession({
          kind, userId, status, start: 0, count: limit, pageDelayMs: delayMs, onProgress: (count) => { fetched = count; }
        }, cookies),
        options.spinner
      );
      sections.push({
        status,
        items: page.items,
        more: page.nextStart !== null && !page.partial,
        partial: page.partial,
        warnings: page.warnings.map((warning) => `${label}：${warning}`)
      });
    } catch (error) {
      if (sections.length === 0) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      sections.push({ status, items: [], more: false, partial: true, warnings: [`${label}：读取失败，已停止：${reason}`] });
      break;
    }
  }
  return sections;
}

function resolveFormat(raw: string | undefined, outputPath: string): ExportFormat {
  if (raw) {
    const format = raw.trim().toLowerCase();
    if (format === 'json' || format === 'csv' || format === 'markdown') return format;
    if (format === 'md') return 'markdown';
    throw new CliArgumentError('--format 仅支持 json、csv、markdown');
  }
  const extension = path.extname(outputPath).toLowerCase();
  if (extension === '.csv') return 'csv';
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  return 'json';
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}[\]()#+.\-!|>])/g, '\\$1')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

export function serializeCollection(
  format: ExportFormat,
  kind: SubjectKind,
  userId: string,
  sections: CollectionSection[]
): string {
  const entries = sections.flatMap((section) => section.items.map((item) => ({ ...item, status: section.status })));
  if (format === 'json') {
    return `${JSON.stringify({
      metadata: {
        kind,
        userId,
        exported_at: new Date().toISOString(),
        count: entries.length,
        partial: sections.some((section) => section.partial),
        warnings: sections.flatMap((section) => section.warnings)
      },
      items: entries
    }, null, 2)}\n`;
  }
  if (format === 'csv') {
    const rows = entries.map((item) => [item.id, item.title, item.status, item.rating || '', item.date, item.comment, item.url]);
    return `${[['id', 'title', 'status', 'rating', 'date', 'comment', 'url'], ...rows].map(csvRow).join('\n')}\n`;
  }
  const lines = [`# 豆瓣${NOUNS[kind].list}`, '', `用户 ${userId}，导出于 ${new Date().toISOString().slice(0, 10)}`];
  for (const section of sections) {
    lines.push('', `## ${STATUS_LABELS[kind][section.status]}（${section.items.length}）`, '');
    section.items.forEach((item, index) => {
      lines.push(`${index + 1}. **${escapeMarkdown(item.title) || '未命名'}** · ${formatStars(item.rating)} · ${item.date || '-'}`);
      if (item.comment) lines.push(`   > ${escapeMarkdown(item.comment)}`);
    });
  }
  return `${lines.join('\n')}\n`;
}

async function runExport(
  kind: SubjectKind,
  userIdArg: string | undefined,
  opts: { output?: string; format?: string; limit?: string; delay?: string; wish?: boolean; doing?: boolean; reading?: boolean }
): Promise<void> {
  const statuses = pickStatuses(kind, opts);
  const limit = parsePositiveIntAtMost(opts.limit, '--limit', DEFAULT_LIMIT, MAX_LIMIT);
  const delayMs = Math.round(parseDelaySeconds(opts.delay, 1) * 1000);
  const rawOutput = String(opts.output ?? '').trim();
  if (!rawOutput) throw new CliArgumentError('输出文件路径不能为空');
  const outputPath = path.resolve(rawOutput);
  const format = resolveFormat(opts.format, outputPath);
  const userId = userIdArg?.trim() || await resolveCurrentUser(true);

  const sections = await readCollection({ kind, userId, statuses, limit, delayMs, spinner: true });
  for (const section of sections) {
    if (section.more) {
      section.partial = true;
      section.warnings.push(`${STATUS_LABELS[kind][section.status]}：只导出了前 ${limit} 条，可调大 --limit`);
    }
  }
  printWarnings(sections.flatMap((section) => section.warnings));
  secureAtomicWriteFile(outputPath, serializeCollection(format, kind, userId, sections));

  const count = sections.reduce((sum, section) => sum + section.items.length, 0);
  const breakdown = sections.map((section) => `${STATUS_LABELS[kind][section.status]} ${section.items.length}`).join(' · ');
  console.log(sections.some((section) => section.partial)
    ? `⚠️ 已写入 ${count} 条（${breakdown}）到 ${outputPath}；结果不完整，请查看上方提示`
    : `✅ 已导出 ${count} 条（${breakdown}）到 ${outputPath}`);
}

function calcStats(items: UserCollectionItem[], year: number): { year: number; total: number; byMonth: number[]; avgScore: string } {
  const inYear = items.filter((item) => item.date.startsWith(`${year}-`));
  const byMonth = new Array<number>(12).fill(0);
  for (const item of inYear) {
    const month = Number(item.date.slice(5, 7));
    if (month >= 1 && month <= 12) byMonth[month - 1] += 1;
  }
  const rated = inYear.filter((item) => item.rating > 0);
  const avgScore = rated.length > 0 ? (rated.reduce((sum, item) => sum + item.rating, 0) / rated.length).toFixed(2) : '-';
  return { year, total: inYear.length, byMonth, avgScore };
}

async function runStats(kind: SubjectKind, opts: { year?: string; limit?: string; delay?: string; json?: boolean }): Promise<void> {
  const year = parsePositiveInt(opts.year, '--year', new Date().getFullYear());
  if (year < 1900 || year > 3000) throw new CliArgumentError('年份格式不正确');
  const limit = parsePositiveIntAtMost(opts.limit, '--limit', DEFAULT_LIMIT, MAX_LIMIT);
  const delayMs = Math.round(parseDelaySeconds(opts.delay, 1) * 1000);
  const userId = await resolveCurrentUser(!opts.json);

  const [section] = await readCollection({ kind, userId, statuses: ['collect'], limit, delayMs, spinner: !opts.json });
  const stat = calcStats(section.items, year);
  const label = STATUS_LABELS[kind].collect;
  // Entries come newest first; stopping at the limit inside the year means older ones were missed.
  const oldestYear = Number(section.items.at(-1)?.date.slice(0, 4));
  const warnings = [...section.warnings];
  if (section.more && !(oldestYear < year)) {
    warnings.push(`只读取了最近 ${limit} 条${label}记录，${year} 年更早的没有统计到，可调大 --limit`);
  }
  const metadata = { partial: section.partial || warnings.length > section.warnings.length, warnings };
  printWarnings(warnings);

  if (opts.json) {
    console.log(JSON.stringify({ user: { id: userId }, ...stat, metadata }, null, 2));
    return;
  }
  const { unit, stats } = NOUNS[kind];
  console.log(`\n📊 ${year} 年${stats}统计${metadata.partial ? '（结果可能不完整）' : ''}`);
  console.log(`${label}: ${stat.total} ${unit}`);
  console.log(`平均分: ${stat.avgScore}`);
  console.log('\n按月分布:');
  stat.byMonth.forEach((count, index) => {
    console.log(`${String(index + 1).padStart(2, '0')}月: ${count}`);
  });
}

function registerKind(parent: Command, kind: SubjectKind): void {
  const prefix = kind === 'movie' ? '' : 'book ';
  const group = kind === 'movie' ? '账号:' : '图书:';
  const { list, stats } = NOUNS[kind];
  const labels = STATUS_LABELS[kind];
  const inProgressFlag = kind === 'movie' ? '--doing' : '--reading';

  parent
    .command('stats')
    .helpGroup(group)
    .description(`我某一年的${stats}统计`)
    .option('-y, --year <year>', '统计年份，默认今年')
    .option('-n, --limit <n>', `最多读取的${labels.collect}记录数（上限 ${MAX_LIMIT}）`, String(DEFAULT_LIMIT))
    .option('--delay <seconds>', '分页请求间隔（秒）', '1')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: `${prefix}stats`,
      suggestion: `可尝试：douban ${prefix}stats --year 2026 --limit 30 --delay 2`
    }, (opts) => runStats(kind, opts)));

  parent
    .command('export [userId]')
    .helpGroup(group)
    .description(`导出${list}（默认导出自己的${labels.collect}/${labels.wish}/${labels.do}）`)
    .requiredOption('-o, --output <path>', '输出文件路径（.json、.csv 或 .md）')
    .option('-f, --format <format>', '格式：json、csv、markdown（默认按扩展名推断）')
    .option('--wish', `只导出“${labels.wish}”`)
    .option(`${inProgressFlag}`, `只导出“${labels.do}”`)
    .option('-n, --limit <n>', `每种状态最多导出数量（上限 ${MAX_LIMIT}）`, String(DEFAULT_LIMIT))
    .option('--delay <seconds>', '分页请求间隔（秒）', '1')
    .action(withErrorHandler((args) => ({
      command: `${prefix}export`,
      ...(args[0] ? { target: `用户ID: ${String(args[0])}` } : {}),
      suggestion: `可尝试：douban ${prefix}export -o my-${kind === 'movie' ? 'movies' : 'books'}.md`
    }), (userId, opts) => runExport(kind, userId, opts)));
}

/** `stats` and `export` for movies at the root and for books under `book`. */
export function registerExportCommands(program: Command, book: Command): void {
  registerKind(program, 'movie');
  registerKind(book, 'book');
}
