import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { ensureAuth } from '../auth/index.js';
import {
  editSubjectRecord,
  getSubjectRecord,
  removeSubjectRecord,
  type RecordChange,
  type RecordPatch,
  type SubjectRecord
} from '../api/record.js';
import type { SubjectActionKind, SubjectInterest } from '../api/mutations.js';
import { resolveBookIdByIsbn } from '../api/book.js';
import { getSubjectTitle } from '../api/subject.js';
import { ask, canPrompt } from '../ui/prompt.js';
import { withSpinner } from '../ui/spinner.js';
import { CliArgumentError, withErrorHandler } from '../utils/error.js';
import { parseSubjectRef, resolveSubject } from './resolve.js';
import { parseDelaySeconds, sleep } from '../utils/timing.js';
import { formatStars, STATUS_LABELS, subjectLabel } from '../ui/output.js';

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
    statusLabels: STATUS_LABELS.movie,
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
    statusLabels: STATUS_LABELS.book,
    statusFlags: [
      { flag: '--wish', key: 'wish', status: 'wish' },
      { flag: '--read', key: 'read', status: 'collect' },
      { flag: '--reading', key: 'reading', status: 'do' }
    ]
  }
};

interface WriteTarget {
  ref: { id?: string; isbn?: string };
  title?: string;
}

interface WriteItem extends WriteTarget {
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

/**
 * The subject of a single write: an ID, an ISBN for books or a title. A title
 * found by search is written only after the user confirms it in a terminal; a
 * dry run just previews it. Returns null when the user declines.
 */
async function singleTarget(kind: SubjectActionKind, input: string | undefined, opts: WriteOptions): Promise<WriteTarget | null> {
  const target = await resolveSubject(kind, input ?? '', true);
  if (!target.searched || opts.dryRun) return { ref: { id: target.id }, title: target.title };
  const label = subjectLabel(target.id, target.title);
  if (!canPrompt()) throw new CliArgumentError(`按名称修改需要在终端里确认；请改用 ID：${label}`);
  if (!/^y/i.test(await ask(`将修改 ${label}，确认吗？[y/N] `))) {
    console.log('已取消');
    return null;
  }
  return { ref: { id: target.id }, title: target.title };
}

function readBatchLines(filePath: string): string[] {
  const lines = readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (lines.length === 0) throw new CliArgumentError(`批量文件为空: ${filePath}`);
  return lines;
}

/** Batch lines name subjects by ID (or ISBN for books) and never by title. */
function batchTargets(kind: SubjectActionKind, filePath: string): WriteTarget[] {
  return readBatchLines(filePath).map((line) => ({ ref: parseSubjectRef(kind, line.split(/[\s,]/)[0] || '') }));
}

/** The batch lines, or the single target; empty when the user declines a title match. */
async function writeTargets(kind: SubjectActionKind, id: string | undefined, opts: WriteOptions): Promise<WriteTarget[]> {
  if (opts.file) return batchTargets(kind, String(opts.file));
  const target = await singleTarget(kind, id, opts);
  return target ? [target] : [];
}

function splitBatchLine(kind: SubjectActionKind, line: string, format: string): [WriteTarget, string] {
  const index = line.search(/[,\t]/);
  if (index <= 0) throw new CliArgumentError(`批量文件格式错误: ${line}。应为 ${format}`);
  return [{ ref: parseSubjectRef(kind, line.slice(0, index)) }, line.slice(index + 1).trim()];
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
  if (record.rating) parts.push(formatStars(record.rating));
  if (record.tags.length > 0) parts.push(`标签:${record.tags.join(' ')}`);
  if (record.private) parts.push('仅自己可见');
  if (record.comment) parts.push(`“${record.comment.length > 30 ? `${record.comment.slice(0, 30)}…` : record.comment}”`);
  return parts.join(' · ');
}

/** Best-effort title lookup run alongside a write; a failure just omits the title. */
function lookupTitle(kind: SubjectActionKind, id: string): Promise<string | undefined> {
  return getSubjectTitle(kind, id).catch(() => undefined);
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
  write: (id: string, patch: RecordPatch, cookies: string, ck?: string) => Promise<RecordChange>
): Promise<void> {
  const delaySeconds = parseDelaySeconds(opts.delay);
  const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
  const results: Array<{ id?: string; isbn?: string; title?: string; ok: boolean; changed?: boolean; dryRun?: boolean; before?: SubjectRecord; after?: SubjectRecord; error?: string }> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const { isbn } = item.ref;
    const name = item.ref.id ?? `ISBN ${isbn}`;
    try {
      const [change, title] = await withSpinner(`正在处理 ${name}...`, async () => {
        const id = item.ref.id ?? await resolveBookIdByIsbn(isbn ?? '');
        return Promise.all([
          write(id, item.patch, auth.cookies, auth.ck),
          item.title ? Promise.resolve(item.title) : lookupTitle(profile.kind, id)
        ]);
      }, !opts.json);
      results.push({ id: change.after.id, ...(isbn ? { isbn } : {}), ...(title ? { title } : {}), ok: true, ...change });
      if (!opts.json) console.log(`✓ ${subjectLabel(change.after.id, title)} ${describeChange(change, profile)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ ...item.ref, ok: false, error: message });
      if (!opts.json) console.error(`✗ ${name}: ${message}`);
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
  // Writes take what the matching reads take: an ID or title, and an ISBN for books.
  const subjectArg = kind === 'book' ? 'query' : 'id-or-title';
  const missing = `请提供${noun}（ID${kind === 'book' ? '、ISBN' : ''}或名称）或使用 --file`;
  const group = (command: Command) => command.helpGroup('写入操作:');
  const statusHelp = statusFlags.map(({ flag }) => flag).join(' / ');

  const mark = group(parent.command(`mark [${subjectArg}]`))
    .description(`标记${noun}状态（${statusFlags.map(({ status }) => statusLabels[status]).join('/')}），保留原有评分、短评和标签 [需登录]`);
  for (const { flag, status } of statusFlags) mark.option(flag, `标记为“${statusLabels[status]}”`);
  addWriteOptions(mark, `批量模式：每行一个${kind === 'book' ? ' ID 或 ISBN' : '条目 ID'}`).action(withErrorHandler({
    command: `${prefix}mark`,
    options: `状态：${statusHelp}（三选一）`,
    suggestion: `可尝试：douban ${prefix}mark ${example} --wish`
  }, async (id: string | undefined, opts) => {
    rejectMixedInput(opts, Boolean(id));
    const selected = statusFlags.filter(({ key }) => opts[key]);
    if (selected.length !== 1) throw new CliArgumentError(`必须且只能选择 ${statusHelp} 之一`);
    if (!id && !opts.file) throw new CliArgumentError(missing);
    const patch = { ...sharedPatch(opts), status: selected[0].status };
    const targets = await writeTargets(kind, id, opts);
    if (targets.length === 0) return;
    await runWrites(targets.map((target) => ({ ...target, patch })), opts, profile, (subjectId, itemPatch, cookies, ck) => (
      editSubjectRecord(kind, subjectId, itemPatch, cookies, { dryRun: opts.dryRun, ck })
    ));
  }));

  const rate = group(parent.command(`rate [${subjectArg}]`))
    .description(`给${noun}评分（1-5），并标记为“${statusLabels.collect}” [需登录]`)
    .option('--score <score>', '单条模式评分（1-5）');
  addWriteOptions(rate, '批量模式：每行 <id>,<score>').action(withErrorHandler({
    command: `${prefix}rate`,
    options: '评分范围：1-5',
    suggestion: `可尝试：douban ${prefix}rate ${example} --score 5`
  }, async (id: string | undefined, opts) => {
    rejectMixedInput(opts, Boolean(id || opts.score));
    if (!id && !opts.file) throw new CliArgumentError(missing);
    const shared = sharedPatch(opts);
    let items: WriteItem[];
    if (opts.file) {
      items = readBatchLines(String(opts.file)).map((line) => {
        const [target, score] = splitBatchLine(kind, line, '<id>,<score>');
        return { ...target, patch: { ...shared, status: 'collect', rating: parseScore(score) } };
      });
    } else {
      const rating = parseScore(opts.score);
      const target = await singleTarget(kind, id, opts);
      if (!target) return;
      items = [{ ...target, patch: { ...shared, status: 'collect', rating } }];
    }
    await runWrites(items, opts, profile, (subjectId, itemPatch, cookies, ck) => (
      editSubjectRecord(kind, subjectId, itemPatch, cookies, { dryRun: opts.dryRun, ck })
    ));
  }));

  const comment = group(parent.command(`comment [${subjectArg}] [text]`))
    .description(`发布或修改${noun}短评，保留原状态（未标记时标为“${statusLabels.collect}”） [需登录]`);
  addWriteOptions(comment, '批量模式：每行 <id>,<comment> 或 <id>\\t<comment>').action(withErrorHandler({
    command: `${prefix}comment`,
    suggestion: `可尝试：douban ${prefix}comment ${example} "值得重看"`
  }, async (id: string | undefined, text: string | undefined, opts) => {
    rejectMixedInput(opts, Boolean(id || text));
    if (!id && !opts.file) throw new CliArgumentError(missing);
    const shared = sharedPatch(opts);
    const emptyComment = new CliArgumentError(`短评内容不能为空。单条模式：douban ${prefix}comment <id> "短评"`);
    let items: WriteItem[];
    if (opts.file) {
      items = readBatchLines(String(opts.file)).map((line) => {
        const [target, body] = splitBatchLine(kind, line, '<id>,<comment>');
        if (!body) throw emptyComment;
        return { ...target, patch: { ...shared, comment: body } };
      });
    } else {
      const body = String(text ?? '').trim();
      if (!body) throw emptyComment;
      const target = await singleTarget(kind, id, opts);
      if (!target) return;
      items = [{ ...target, patch: { ...shared, comment: body } }];
    }
    await runWrites(items, opts, profile, (subjectId, itemPatch, cookies, ck) => (
      editSubjectRecord(kind, subjectId, (before) => (
        before.status === 'none' ? { ...itemPatch, status: 'collect' } : itemPatch
      ), cookies, { dryRun: opts.dryRun, ck })
    ));
  }));

  const unmark = group(parent.command(`unmark [${subjectArg}]`))
    .description(`取消${noun}标记（同时删除评分、短评和标签） [需登录]`)
    .option('--dry-run', '只预览修改，不提交')
    .option('--file <path>', `批量模式：每行一个${kind === 'book' ? ' ID 或 ISBN' : '条目 ID'}`)
    .option('--delay <seconds>', '批量请求间隔（秒），默认随机 1-2 秒')
    .option('--json', '以 JSON 输出');
  unmark.action(withErrorHandler({
    command: `${prefix}unmark`,
    suggestion: `可尝试：douban ${prefix}unmark ${example} --dry-run`
  }, async (id: string | undefined, opts) => {
    rejectMixedInput(opts, Boolean(id));
    if (!id && !opts.file) throw new CliArgumentError(missing);
    const targets = await writeTargets(kind, id, opts);
    if (targets.length === 0) return;
    await runWrites(targets.map((target) => ({ ...target, patch: {} })), opts, profile, (subjectId, _patch, cookies, ck) => (
      removeSubjectRecord(kind, subjectId, cookies, { dryRun: opts.dryRun, ck })
    ));
  }));

  // Reading your own record is not a write: it sits with the account or book reads.
  parent.command(`record <${subjectArg}>`)
    .helpGroup(kind === 'book' ? '图书:' : '账号:')
    .description(`我对某${measure}${noun}的记录（状态、评分、短评、标签、可见性） [需登录]`)
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: `${prefix}record`,
      suggestion: `可尝试：douban ${prefix}record ${example}`
    }, async (query: string, opts) => {
      const target = await resolveSubject(kind, query, Boolean(opts.json));
      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const [record, title] = await withSpinner('正在读取记录...', () => Promise.all([
        getSubjectRecord(kind, target.id, auth.cookies),
        target.title ? Promise.resolve(target.title) : lookupTitle(kind, target.id)
      ]), !opts.json);
      if (opts.json) {
        console.log(JSON.stringify({ ...(title ? { title } : {}), ...record }, null, 2));
        return;
      }
      console.log(`\n${subjectLabel(record.id, title)}: ${statusLabels[record.status]}`);
      console.log(`评分: ${formatStars(record.rating)}`);
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
