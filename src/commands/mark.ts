import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { ensureAuth } from '../auth.js';
import { BASE, UA, fetchHtml } from '../api/common.js';

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

const INTEREST_PATH = (id: string) => `${BASE}/j/subject/${id}/interest`;

function isNumericId(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function parseNumericId(value: string): string {
  const id = value.trim();
  if (!isNumericId(id)) throw new Error(`Invalid subject id: ${value}`);
  return id;
}

function parseDelaySeconds(value: string | undefined): number {
  if (!value) return NaN;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('--delay must be a non-negative number');
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextDelayMs(index: number, total: number, delaySeconds: number): number {
  if (index >= total - 1) return 0;
  if (Number.isFinite(delaySeconds)) return Math.round(delaySeconds * 1000);
  if (total <= 1) return 0;
  return Math.round((1 + Math.random()) * 1000);
}

function readBatchLines(filePath: string): string[] {
  const raw = readFileSync(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function parseIdFile(filePath: string): BatchItem[] {
  return readBatchLines(filePath).map((line) => ({ id: parseNumericId(line.split(/[\s,]/)[0] || '') }));
}

function parseRateFile(filePath: string): BatchItem[] {
  return readBatchLines(filePath).map((line) => {
    const match = line.match(/^(\d+)\s*[,\t\s]\s*([1-5])\s*$/);
    if (!match) throw new Error(`Invalid rate line: ${line}. Expected: <id>,<score>`);
    return { id: parseNumericId(match[1]), score: Number(match[2]) };
  });
}

function parseCommentFile(filePath: string): BatchItem[] {
  return readBatchLines(filePath).map((line) => {
    const commaIndex = line.indexOf(',');
    const tabIndex = line.indexOf('\t');
    const splitIndex = commaIndex >= 0 && tabIndex >= 0 ? Math.min(commaIndex, tabIndex) : Math.max(commaIndex, tabIndex);

    if (splitIndex <= 0) {
      throw new Error(`Invalid comment line: ${line}. Expected: <id>,<comment> or <id>\t<comment>`);
    }

    const id = parseNumericId(line.slice(0, splitIndex).trim());
    const text = line.slice(splitIndex + 1).trim();
    if (!text) throw new Error(`Comment text is empty for id=${id}`);
    return { id, text };
  });
}

function formEncode(data: Record<string, string>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    if (value === '') continue;
    body.set(key, value);
  }
  return body.toString();
}

async function resolveCk(existing: string | undefined, id: string, cookieHeader: string): Promise<string> {
  if (existing) return existing;

  const subjectUrl = `${BASE}/subject/${id}/`;
  const html = await fetchHtml(subjectUrl, {
    Referer: BASE,
    Cookie: cookieHeader
  });

  const inputMatch = html.match(/name=["']ck["']\s+value=["']([^"']+)["']/i);
  if (inputMatch?.[1]) return inputMatch[1];

  const jsMatch = html.match(/[?&]ck=([A-Za-z0-9]+)/);
  if (jsMatch?.[1]) return jsMatch[1];

  throw new Error('Failed to resolve ck token from subject page');
}

async function submitInterest(
  id: string,
  payload: InterestPayload,
  cookieHeader: string,
  existingCk?: string
): Promise<InterestResponse> {
  const ck = await resolveCk(existingCk, id, cookieHeader);
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
    body: form
  });

  const text = await res.text();
  let parsed: InterestResponse | null = null;
  try {
    parsed = JSON.parse(text) as InterestResponse;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const message = parsed?.msg || `HTTP ${res.status}: ${text.slice(0, 120)}`;
    throw new Error(message);
  }

  if (!parsed || typeof parsed.r !== 'number') {
    throw new Error(`Unexpected response: ${text.slice(0, 120)}`);
  }

  if (parsed.r !== 0) {
    throw new Error(parsed.msg || `Douban API error code=${parsed.code ?? 'unknown'}`);
  }

  return parsed;
}

function selectInterestFromOptions(opts: { wish?: boolean; watched?: boolean; watching?: boolean }): Interest {
  const selected = [opts.wish, opts.watched, opts.watching].filter(Boolean).length;
  if (selected !== 1) {
    throw new Error('Choose exactly one of --wish, --watched, --watching');
  }
  if (opts.wish) return 'wish';
  if (opts.watching) return 'do';
  return 'collect';
}

export function registerMarkCommands(program: Command): void {
  program
    .command('mark [id]')
    .description('Mark movie status (wish/watched/watching), requires login')
    .option('--wish', 'Mark as wish list')
    .option('--watched', 'Mark as watched')
    .option('--watching', 'Mark as currently watching')
    .option('--file <path>', 'Batch mode: one subject id per line')
    .option('--delay <seconds>', 'Delay between batch requests; default random 1-2 seconds')
    .option('--json', 'Output as JSON')
    .action(async (id: string | undefined, opts) => {
      const interest = selectInterestFromOptions(opts);
      const delaySeconds = parseDelaySeconds(opts.delay);
      const items = opts.file ? parseIdFile(String(opts.file)) : [{ id: parseNumericId(id || '') }];

      const auth = await ensureAuth();
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        try {
          await submitInterest(item.id, { interest }, auth.cookies, auth.ck);
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
        return;
      }

      const okCount = results.filter((r) => r.ok).length;
      console.log(`done: ${okCount}/${results.length}`);
      if (okCount !== results.length) process.exitCode = 1;
    });

  program
    .command('rate [id]')
    .description('Rate movie (1-5), requires login')
    .option('--score <score>', 'Score 1-5 for single mode')
    .option('--file <path>', 'Batch mode: <id>,<score> per line')
    .option('--delay <seconds>', 'Delay between batch requests; default random 1-2 seconds')
    .option('--json', 'Output as JSON')
    .action(async (id: string | undefined, opts) => {
      const delaySeconds = parseDelaySeconds(opts.delay);
      const singleScore = Number(opts.score);

      if (!opts.file && (!isNumericId(id || '') || !Number.isInteger(singleScore) || singleScore < 1 || singleScore > 5)) {
        throw new Error('Single mode: rate <id> --score <1-5>');
      }

      const items = opts.file
        ? parseRateFile(String(opts.file))
        : [{ id: parseNumericId(id || ''), score: singleScore }];

      const auth = await ensureAuth();
      const results: Array<{ id: string; score: number; ok: boolean; error?: string }> = [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const score = item.score as number;

        try {
          await submitInterest(item.id, { interest: 'collect', rating: score }, auth.cookies, auth.ck);
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
        return;
      }

      const okCount = results.filter((r) => r.ok).length;
      console.log(`done: ${okCount}/${results.length}`);
      if (okCount !== results.length) process.exitCode = 1;
    });

  program
    .command('comment [id] [text]')
    .description('Post short comment, requires login')
    .option('--file <path>', 'Batch mode: <id>,<comment> per line')
    .option('--delay <seconds>', 'Delay between batch requests; default random 1-2 seconds')
    .option('--json', 'Output as JSON')
    .action(async (id: string | undefined, text: string | undefined, opts) => {
      const delaySeconds = parseDelaySeconds(opts.delay);

      if (!opts.file && (!isNumericId(id || '') || !text || !text.trim())) {
        throw new Error('Single mode: comment <id> "short comment"');
      }

      const items = opts.file
        ? parseCommentFile(String(opts.file))
        : [{ id: parseNumericId(id || ''), text: String(text).trim() }];

      const auth = await ensureAuth();
      const results: Array<{ id: string; ok: boolean; error?: string }> = [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];

        try {
          await submitInterest(item.id, { interest: 'collect', comment: item.text }, auth.cookies, auth.ck);
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
        return;
      }

      const okCount = results.filter((r) => r.ok).length;
      console.log(`done: ${okCount}/${results.length}`);
      if (okCount !== results.length) process.exitCode = 1;
    });
}
