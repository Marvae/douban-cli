import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { ensureAuth } from '../auth.js';
import {
  editSubjectRecord,
  getSubjectRecord,
  removeSubjectRecord,
  type RecordChange,
  type RecordPatch,
  type SubjectRecord
} from '../api/record.js';
import type { SubjectActionKind, SubjectInterest } from '../api/mutations.js';
import { CliArgumentError, withErrorHandler } from '../utils/error.js';
import { isNumericId } from '../utils/parsing.js';
import { withSpinner } from '../utils/spinner.js';
import { parseDelaySeconds, sleep } from '../utils/timing.js';

type Status = Exclude<SubjectInterest, 'none'>;

interface KindProfile {
  kind: SubjectActionKind;
  prefix: string;
  noun: string;
  /** Measure word for the noun: 部 for films, 本 for books. */
  measure: string;
  example: string;
  statusLabels: Record<SubjectInterest, string>;
  statusFlags: Array<{ flag: string; key: string; status: Status }>;
}

const PROFILES: Record<SubjectActionKind, KindProfile> = {
  movie: {
    kind: 'movie',
    prefix: '',
    noun: '电影',
    measure: '部',
    example: '1292052',
    statusLabels: { wish: '想看', do: '在看', collect: '看过', none: '未标记' },
    statusFlags: [
      { flag: '--wish', key: 'wish', status: 'wish' },
      { flag: '--watched', key: 'watched', status: 'collect' },
      { flag: '--watching', key: 'watching', status: 'do' }
    ]
  },
  book: {
    kind: 'book',
    prefix: 'book ',
    noun: '图书',
    measure: '本',
    example: '2567698',
    statusLabels: { wish: '想读', do: '在读', collect: '读过', none: '未标记' },
    statusFlags: [
      { flag: '--wish', key: 'wish', status: 'wish' },
      { flag: '--read', key: 'read', status: 'collect' },
      { flag: '--reading', key: 'reading', status: 'do' }
    ]
  }
};

interface WriteItem {
  id: string;
  patch: RecordPatch;
}

interface WriteOptions {
  file?: string;
  delay?: string;
  json?: boolean;
  dryRun?: boolean;
  tags?: string;
  private?: boolean;
  public?: boolean;
}

function parseNumericId(value: string): string {
  const id = value.trim();
  if (!isNumericId(id)) throw new CliArgumentError(`无效条目 ID: ${value}`);
  return id;
}

function readBatchLines(filePath: string): string[] {
  const lines = readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (lines.length === 0) throw new CliArgumentError(`批量文件为空: ${filePath}`);
  return lines;
}

function splitIdLine(line: string, format: string): [string, string] {
  const index = line.search(/[,\t]/);
  if (index <= 0) throw new CliArgumentError(`批量文件格式错误: ${line}。应为 ${format}`);
  return [parseNumericId(line.slice(0, index)), line.slice(index + 1).trim()];
}

function parseScore(value: unknown): number {
  const score = Number(value);
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new CliArgumentError('评分必须是 1-5 的整数');
  return score;
}

/** Options shared by every edit: tags and visibility. */
function sharedPatch(opts: WriteOptions): RecordPatch {
  if (opts.private && opts.public) throw new CliArgumentError('--private 与 --public 不能同时使用');
  const patch: RecordPatch = {};
  if (opts.tags !== undefined) patch.tags = String(opts.tags).split(/[,，\s]+/).filter(Boolean);
  if (opts.private) patch.private = true;
  if (opts.public) patch.private = false;
  return patch;
}

function rejectMixedInput(opts: WriteOptions, hasInlineInput: boolean): void {
  if (opts.file && hasInlineInput) throw new CliArgumentError('--file 不能与单条模式参数同时使用');
}

function nextDelayMs(index: number, total: number, delaySeconds: number): number {
  if (index >= total - 1) return 0;
  if (Number.isFinite(delaySeconds)) return Math.round(delaySeconds * 1000);
  return Math.round((1 + Math.random()) * 1000);
}

function describeRecord(record: SubjectRecord, profile: KindProfile): string {
  const parts = [profile.statusLabels[record.status]];
  if (record.rating) parts.push('★'.repeat(record.rating));
  if (record.tags.length > 0) parts.push(`标签:${record.tags.join(' ')}`);
  if (record.private) parts.push('仅自己可见');
  if (record.comment) parts.push(`“${record.comment.length > 30 ? `${record.comment.slice(0, 30)}…` : record.comment}”`);
  return parts.join(' · ');
}

function describeChange(change: RecordChange, profile: KindProfile): string {
  const after = describeRecord(change.after, profile);
  if (!change.changed) return `无变化（${after}）`;
  const prefix = change.dryRun ? '[预览，未提交] ' : '';
  return `${prefix}${describeRecord(change.before, profile)} → ${after}`;
}

/**
 * Run writes sequentially with a pause between items. Failures do not stop
 * the batch and are never retried; the exit code is non-zero if any failed.
 */
async function runWrites(
  items: WriteItem[],
  opts: WriteOptions,
  profile: KindProfile,
  write: (item: WriteItem, cookies: string, ck?: string) => Promise<RecordChange>
): Promise<void> {
  const delaySeconds = parseDelaySeconds(opts.delay);
  const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
  const results: Array<{ id: string; ok: boolean; changed?: boolean; dryRun?: boolean; before?: SubjectRecord; after?: SubjectRecord; error?: string }> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      const change = await withSpinner(`正在处理 ${item.id}...`, () => write(item, auth.cookies, auth.ck), !opts.json);
      results.push({ id: item.id, ok: true, ...change });
      if (!opts.json) console.log(`✓ ${item.id} ${describeChange(change, profile)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ id: item.id, ok: false, error: message });
      if (!opts.json) console.error(`✗ ${item.id}: ${message}`);
    }
    const delayMs = nextDelayMs(index, items.length, delaySeconds);
    if (delayMs > 0) await sleep(delayMs);
  }

  const okCount = results.filter((result) => result.ok).length;
  if (opts.json) console.log(JSON.stringify(results, null, 2));
  else if (items.length > 1) console.log(`done: ${okCount}/${results.length}`);
  if (okCount !== results.length) process.exitCode = 1;
}

function addWriteOptions(command: Command, batchHelp: string): Command {
  return command
    .option('--tags <tags>', '设置标签（逗号或空格分隔，覆盖原有标签）')
    .option('--private', '设为仅自己可见')
    .option('--public', '设为公开')
    .option('--dry-run', '只预览修改，不提交')
    .option('--file <path>', batchHelp)
    .option('--delay <seconds>', '批量请求间隔（秒），默认随机 1-2 秒')
    .option('--json', '以 JSON 输出');
}

function registerKindCommands(parent: Command, profile: KindProfile): void {
  const { kind, prefix, noun, measure, example, statusLabels, statusFlags } = profile;
  const group = (command: Command) => command.helpGroup('写入操作:');
  const statusHelp = statusFlags.map(({ flag }) => flag).join(' / ');

  const mark = group(parent.command('mark [id]'))
    .description(`标记${noun}状态（${statusFlags.map(({ status }) => statusLabels[status]).join('/')}），保留原有评分、短评和标签 [需登录]`);
  for (const { flag, status } of statusFlags) mark.option(flag, `标记为“${statusLabels[status]}”`);
  addWriteOptions(mark, '批量模式：每行一个条目 ID').action(withErrorHandler({
    command: `${prefix}mark`,
    options: `状态：${statusHelp}（三选一）`,
    suggestion: `可尝试：douban ${prefix}mark ${example} --wish`
  }, async (id: string | undefined, opts) => {
    rejectMixedInput(opts, Boolean(id));
    const selected = statusFlags.filter(({ key }) => opts[key]);
    if (selected.length !== 1) throw new CliArgumentError(`必须且只能选择 ${statusHelp} 之一`);
    if (!id && !opts.file) throw new CliArgumentError(`请提供${noun} ID 或使用 --file`);
    const patch = { ...sharedPatch(opts), status: selected[0].status };
    const ids = opts.file ? readBatchLines(String(opts.file)).map((line) => parseNumericId(line.split(/[\s,]/)[0] || '')) : [parseNumericId(id || '')];
    await runWrites(ids.map((itemId) => ({ id: itemId, patch })), opts, profile, (item, cookies, ck) => (
      editSubjectRecord(kind, item.id, item.patch, cookies, { dryRun: opts.dryRun, ck })
    ));
  }));

  const rate = group(parent.command('rate [id]'))
    .description(`给${noun}评分（1-5），并标记为“${statusLabels.collect}” [需登录]`)
    .option('--score <score>', '单条模式评分（1-5）');
  addWriteOptions(rate, '批量模式：每行 <id>,<score>').action(withErrorHandler({
    command: `${prefix}rate`,
    options: '评分范围：1-5',
    suggestion: `可尝试：douban ${prefix}rate ${example} --score 5`
  }, async (id: string | undefined, opts) => {
    rejectMixedInput(opts, Boolean(id || opts.score));
    if (!id && !opts.file) throw new CliArgumentError(`请提供${noun} ID 或使用 --file`);
    const shared = sharedPatch(opts);
    const items: WriteItem[] = opts.file
      ? readBatchLines(String(opts.file)).map((line) => {
        const [itemId, score] = splitIdLine(line, '<id>,<score>');
        return { id: itemId, patch: { ...shared, status: 'collect', rating: parseScore(score) } };
      })
      : [{ id: parseNumericId(id || ''), patch: { ...shared, status: 'collect', rating: parseScore(opts.score) } }];
    await runWrites(items, opts, profile, (item, cookies, ck) => (
      editSubjectRecord(kind, item.id, item.patch, cookies, { dryRun: opts.dryRun, ck })
    ));
  }));

  const comment = group(parent.command('comment [id] [text]'))
    .description(`发布或修改${noun}短评，保留原状态（未标记时标为“${statusLabels.collect}”） [需登录]`);
  addWriteOptions(comment, '批量模式：每行 <id>,<comment> 或 <id>\\t<comment>').action(withErrorHandler({
    command: `${prefix}comment`,
    suggestion: `可尝试：douban ${prefix}comment ${example} "值得重看"`
  }, async (id: string | undefined, text: string | undefined, opts) => {
    rejectMixedInput(opts, Boolean(id || text));
    if (!id && !opts.file) throw new CliArgumentError(`请提供${noun} ID 或使用 --file`);
    const shared = sharedPatch(opts);
    const pairs: Array<[string, string]> = opts.file
      ? readBatchLines(String(opts.file)).map((line) => splitIdLine(line, '<id>,<comment>'))
      : [[parseNumericId(id || ''), String(text ?? '').trim()]];
    if (pairs.some(([, body]) => !body)) throw new CliArgumentError(`短评内容不能为空。单条模式：douban ${prefix}comment <id> "短评"`);
    await runWrites(pairs.map(([itemId, body]) => ({ id: itemId, patch: { ...shared, comment: body } })), opts, profile, (item, cookies, ck) => (
      editSubjectRecord(kind, item.id, (before) => (
        before.status === 'none' ? { ...item.patch, status: 'collect' } : item.patch
      ), cookies, { dryRun: opts.dryRun, ck })
    ));
  }));

  const unmark = group(parent.command('unmark [id]'))
    .description(`取消${noun}标记（同时删除评分、短评和标签） [需登录]`)
    .option('--dry-run', '只预览，不提交')
    .option('--file <path>', '批量模式：每行一个条目 ID')
    .option('--delay <seconds>', '批量请求间隔（秒），默认随机 1-2 秒')
    .option('--json', '以 JSON 输出');
  unmark.action(withErrorHandler({
    command: `${prefix}unmark`,
    suggestion: `可尝试：douban ${prefix}unmark ${example} --dry-run`
  }, async (id: string | undefined, opts) => {
    rejectMixedInput(opts, Boolean(id));
    if (!id && !opts.file) throw new CliArgumentError(`请提供${noun} ID 或使用 --file`);
    const ids = opts.file ? readBatchLines(String(opts.file)).map((line) => parseNumericId(line.split(/[\s,]/)[0] || '')) : [parseNumericId(id || '')];
    await runWrites(ids.map((itemId) => ({ id: itemId, patch: {} })), opts, profile, (item, cookies, ck) => (
      removeSubjectRecord(kind, item.id, cookies, { dryRun: opts.dryRun, ck })
    ));
  }));

  group(parent.command('record <id>'))
    .description(`查看自己对某${measure}${noun}的记录（状态、评分、短评、标签、可见性） [需登录]`)
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: `${prefix}record`,
      suggestion: `可尝试：douban ${prefix}record ${example}`
    }, async (id: string, opts) => {
      const subjectId = parseNumericId(id);
      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const record = await withSpinner('正在读取记录...', () => getSubjectRecord(kind, subjectId, auth.cookies), !opts.json);
      if (opts.json) {
        console.log(JSON.stringify(record, null, 2));
        return;
      }
      console.log(`\n${noun} ${record.id}: ${statusLabels[record.status]}`);
      console.log(`评分: ${record.rating ? '★'.repeat(record.rating) : '-'}`);
      console.log(`标签: ${record.tags.length > 0 ? record.tags.join(' ') : '-'}`);
      console.log(`可见性: ${record.private ? '仅自己可见' : '公开'}`);
      console.log(`短评: ${record.comment || '-'}`);
      console.log(`链接: ${record.url}`);
    }));
}

export function registerMarkCommands(program: Command, bookCommand: Command): void {
  registerKindCommands(program, PROFILES.movie);
  registerKindCommands(bookCommand, PROFILES.book);
}
