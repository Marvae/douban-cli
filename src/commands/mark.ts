import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { ensureAuth } from '../auth.js';
import { BASE, FETCH_TIMEOUT_MS, UA } from '../api/common.js';
import { resolveCk, unmarkSubject } from '../api/index.js';
import { withErrorHandler } from '../utils/error.js';
import { formEncode, isNumericId } from '../utils/parsing.js';
import { withSpinner } from '../utils/spinner.js';
import { parseDelaySeconds, sleep } from '../utils/timing.js';

type Interest = 'wish' | 'collect' | 'do';

interface InterestPayload {
  interest: Interest;
  rating?: number;
  comment?: string;
}

interface InterestResponse {
  r: number;
  msg?: string;
  code?: number;
  [key: string]: unknown;
}

interface BatchItem {
  id: string;
  score?: number;
  text?: string;
}

interface BatchResult {
  ok: boolean;
}

const INTEREST_PATH = (id: string) => `${BASE}/j/subject/${id}/interest`;
const CK_ERROR_PATTERNS: RegExp[] = [
  /\bck\b/i,
  /invalid\s*token/i,
  /token\s*invalid/i,
  /token\s*expired/i,
  /ck\s*expired/i,
  /ck[^\n]{0,20}(?:无效|过期)/i,
  /(?:无效|过期)[^\n]{0,20}ck/i,
  /请先登录/i,
  /更新[^\n]{0,20}登录状态/i
];

function parseNumericId(value: string): string {
  const id = value.trim();
  if (!isNumericId(id)) throw new Error(`无效条目 ID: ${value}`);
  return id;
}

function nextDelayMs(index: number, total: number, delaySeconds: number): number {
  if (index >= total - 1) return 0;
  if (Number.isFinite(delaySeconds)) return Math.round(delaySeconds * 1000);
  if (total <= 1) return 0;
  return Math.round((1 + Math.random()) * 1000);
}

function readBatchLines(filePath: string): string[] {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) {
    throw new Error(`批量文件为空: ${filePath}`);
  }

  return lines;
}

function parseIdFile(filePath: string): BatchItem[] {
  return readBatchLines(filePath).map((line) => {
    const firstCell = line.split(/[\s,]/)[0] || '';
    return { id: parseNumericId(firstCell) };
  });
}

function parseRateFile(filePath: string): BatchItem[] {
  return readBatchLines(filePath).map((line) => {
    const match = line.match(/^(\d+)\s*[,\t\s]\s*([1-5])\s*$/);
    if (!match) throw new Error(`评分文件格式错误: ${line}。应为 <id>,<score>`);
    return { id: parseNumericId(match[1]), score: Number(match[2]) };
  });
}

function parseCommentFile(filePath: string): BatchItem[] {
  return readBatchLines(filePath).map((line) => {
    const commaIndex = line.indexOf(',');
    const tabIndex = line.indexOf('\t');
    const splitIndex = commaIndex >= 0 && tabIndex >= 0 ? Math.min(commaIndex, tabIndex) : Math.max(commaIndex, tabIndex);

    if (splitIndex <= 0) {
      throw new Error(`评论文件格式错误: ${line}。应为 <id>,<comment> 或 <id>\t<comment>`);
    }

    const id = parseNumericId(line.slice(0, splitIndex).trim());
    const text = line.slice(splitIndex + 1).trim();
    if (!text) throw new Error(`ID=${id} 的评论为空`);
    return { id, text };
  });
}

async function submitInterest(
  id: string,
  payload: InterestPayload,
  cookieHeader: string,
  existingCk?: string
): Promise<InterestResponse> {
  const send = async (ck: string): Promise<InterestResponse> => {
    const form = formEncode({
      interest: payload.interest,
      rating: payload.rating ? String(payload.rating) : '',
      comment: payload.comment ? payload.comment : '',
      ck
    });

    const res = await fetch(INTEREST_PATH(id), {
      method: 'POST',
      headers: {
        'User-Agent': UA,
        Cookie: cookieHeader,
        Referer: `${BASE}/subject/${id}/`,
        Origin: BASE,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: form,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });

    const text = await res.text();
    let parsed: InterestResponse | null = null;
    try {
      parsed = JSON.parse(text) as InterestResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[mark] 解析兴趣接口 JSON 失败: ${message}`);
      parsed = null;
    }

    if (!res.ok) {
      const message = parsed?.msg || `HTTP ${res.status}: ${text.slice(0, 120)}`;
      throw new Error(message);
    }

    if (!parsed || typeof parsed.r !== 'number') {
      throw new Error(`返回结果异常: ${text.slice(0, 120)}`);
    }

    if (parsed.r !== 0) {
      throw new Error(parsed.msg || `豆瓣接口错误 code=${parsed.code ?? 'unknown'}`);
    }

    return parsed;
  };

  const initialCk = await resolveCk(cookieHeader, existingCk, id);
  try {
    return await send(initialCk);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!CK_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
      throw error;
    }

    const refreshedCk = await resolveCk(cookieHeader, undefined, id, { forceRefresh: true });
    return send(refreshedCk);
  }
}

function selectInterestFromOptions(opts: { wish?: boolean; watched?: boolean; watching?: boolean }): Interest {
  const selected = [opts.wish, opts.watched, opts.watching].filter(Boolean).length;
  if (selected !== 1) {
    throw new Error('必须且只能选择 --wish、--watched、--watching 之一');
  }
  if (opts.wish) return 'wish';
  if (opts.watching) return 'do';
  return 'collect';
}

function isValidScore(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function finalizeBatch(results: BatchResult[], outputJson: boolean): void {
  const okCount = results.filter((r) => r.ok).length;
  if (!outputJson) {
    console.log(`done: ${okCount}/${results.length}`);
  }
  if (okCount !== results.length) {
    process.exitCode = 1;
  }
}

export function registerMarkCommands(program: Command): void {
  program
    .command('mark [id]')
    .description('标记电影状态（想看/看过/在看），需要登录 [需登录]')
    .option('--wish', '标记为“想看”')
    .option('--watched', '标记为“看过”')
    .option('--watching', '标记为“在看”')
    .option('--file <path>', '批量模式：每行一个条目 ID')
    .option('--delay <seconds>', '批量请求间隔（秒），默认随机 1-2 秒')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'mark',
      options: '状态：--wish / --watched / --watching（三选一）',
      suggestion: '可尝试：douban mark 1292052 --wish'
    }, async (id: string | undefined, opts) => {
      const interest = selectInterestFromOptions(opts);
      const delaySeconds = parseDelaySeconds(opts.delay);
      const items = opts.file ? parseIdFile(String(opts.file)) : [{ id: parseNumericId(id || '') }];

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        try {
          await withSpinner(
            `正在标记 ${item.id}...`,
            () => submitInterest(item.id, { interest }, auth.cookies, auth.ck),
            !opts.json
          );
          results.push({ id: item.id, ok: true });
          if (!opts.json) console.log(`✓ ${item.id} -> ${interest}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ id: item.id, ok: false, error: message });
          if (!opts.json) console.error(`✗ ${item.id}: ${message}`);
        }

        const delayMs = nextDelayMs(i, items.length, delaySeconds);
        if (delayMs > 0) await sleep(delayMs);
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        finalizeBatch(results, true);
        return;
      }

      finalizeBatch(results, false);
    }));

  program
    .command('rate [id]')
    .description('给电影评分（1-5），需要登录 [需登录]')
    .option('--score <score>', '单条模式评分（1-5）')
    .option('--file <path>', '批量模式：每行 <id>,<score>')
    .option('--delay <seconds>', '批量请求间隔（秒），默认随机 1-2 秒')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'rate',
      options: '评分范围：1-5',
      suggestion: '可尝试：douban rate 1292052 --score 5'
    }, async (id: string | undefined, opts) => {
      const delaySeconds = parseDelaySeconds(opts.delay);
      const singleScore = Number(opts.score);

      if (!opts.file && (!isNumericId(id || '') || !Number.isInteger(singleScore) || singleScore < 1 || singleScore > 5)) {
        throw new Error('单条模式请使用：rate <id> --score <1-5>');
      }

      const items = opts.file
        ? parseRateFile(String(opts.file))
        : [{ id: parseNumericId(id || ''), score: singleScore }];

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const results: Array<{ id: string; score: number; ok: boolean; error?: string }> = [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const rawScore = item.score;

        if (!isValidScore(rawScore)) {
          const message = `ID=${item.id} 的评分无效，应为 1-5 的整数`;
          results.push({ id: item.id, score: Number.NaN, ok: false, error: message });
          if (!opts.json) console.error(`✗ ${item.id}: ${message}`);
          const delayMs = nextDelayMs(i, items.length, delaySeconds);
          if (delayMs > 0) await sleep(delayMs);
          continue;
        }

        const score = rawScore;

        try {
          await withSpinner(
            `正在提交评分 ${item.id}...`,
            () => submitInterest(item.id, { interest: 'collect', rating: score }, auth.cookies, auth.ck),
            !opts.json
          );
          results.push({ id: item.id, score, ok: true });
          if (!opts.json) console.log(`✓ ${item.id} -> score ${score}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ id: item.id, score, ok: false, error: message });
          if (!opts.json) console.error(`✗ ${item.id}: ${message}`);
        }

        const delayMs = nextDelayMs(i, items.length, delaySeconds);
        if (delayMs > 0) await sleep(delayMs);
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        finalizeBatch(results, true);
        return;
      }

      finalizeBatch(results, false);
    }));

  program
    .command('comment [id] [text]')
    .description('发布短评，需要登录 [需登录]')
    .option('--file <path>', '批量模式：每行 <id>,<comment>')
    .option('--delay <seconds>', '批量请求间隔（秒），默认随机 1-2 秒')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'comment',
      suggestion: '可尝试：douban comment 1292052 "值得重看"'
    }, async (id: string | undefined, text: string | undefined, opts) => {
      const delaySeconds = parseDelaySeconds(opts.delay);

      if (!opts.file && (!isNumericId(id || '') || !text || !text.trim())) {
        throw new Error('单条模式请使用：comment <id> "短评内容"');
      }

      const items = opts.file
        ? parseCommentFile(String(opts.file))
        : [{ id: parseNumericId(id || ''), text: String(text).trim() }];

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const comment = item.text?.trim() || '';

        if (!comment) {
          const message = `ID=${item.id} 的短评内容为空`;
          results.push({ id: item.id, ok: false, error: message });
          if (!opts.json) console.error(`✗ ${item.id}: ${message}`);
          const delayMs = nextDelayMs(i, items.length, delaySeconds);
          if (delayMs > 0) await sleep(delayMs);
          continue;
        }

        try {
          await withSpinner(
            `正在发布短评 ${item.id}...`,
            () => submitInterest(item.id, { interest: 'collect', comment }, auth.cookies, auth.ck),
            !opts.json
          );
          results.push({ id: item.id, ok: true });
          if (!opts.json) console.log(`✓ ${item.id} -> commented`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ id: item.id, ok: false, error: message });
          if (!opts.json) console.error(`✗ ${item.id}: ${message}`);
        }

        const delayMs = nextDelayMs(i, items.length, delaySeconds);
        if (delayMs > 0) await sleep(delayMs);
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        finalizeBatch(results, true);
        return;
      }

      finalizeBatch(results, false);
    }));

  program
    .command('unmark [id]')
    .description('取消标记（想看/看过/在看），需要登录 [需登录]')
    .option('--file <path>', '批量模式：每行一个条目 ID')
    .option('--delay <seconds>', '批量请求间隔（秒），默认随机 1-2 秒')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'unmark',
      suggestion: '可尝试：douban unmark 1292052'
    }, async (id: string | undefined, opts) => {
      if (!id && !opts.file) {
        console.log('\n🗑️  取消标记 - 请指定电影 ID\n');
        console.log('用法: douban unmark <电影ID>\n');
        console.log('批量: douban unmark --file ids.txt\n');
        console.log('示例: douban unmark 1292052');
        return;
      }
      const delaySeconds = parseDelaySeconds(opts.delay);
      const items = opts.file ? parseIdFile(String(opts.file)) : [{ id: parseNumericId(id || '') }];

      const auth = await withSpinner('正在检查登录状态...', () => ensureAuth(), !opts.json);
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        try {
          await withSpinner(
            `正在取消标记 ${item.id}...`,
            () => unmarkSubject(item.id, auth.cookies, auth.ck),
            !opts.json
          );
          results.push({ id: item.id, ok: true });
          if (!opts.json) console.log(`✓ ${item.id} -> unmarked`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ id: item.id, ok: false, error: message });
          if (!opts.json) console.error(`✗ ${item.id}: ${message}`);
        }

        const delayMs = nextDelayMs(i, items.length, delaySeconds);
        if (delayMs > 0) await sleep(delayMs);
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        finalizeBatch(results, true);
        return;
      }

      finalizeBatch(results, false);
    }));
}
