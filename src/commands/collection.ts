import { Command } from 'commander';
import { getUserCollectionPageWithSession, type CollectionStatus } from '../api/collection.js';
import type { SubjectKind } from '../api/subject.js';
import { ensureAuth, getOptionalSessionCookies } from '../auth/index.js';
import { readConfig } from '../storage/config.js';
import { printCollectionItems } from '../ui/output.js';
import { withPagination } from '../ui/pagination.js';
import { withSpinner } from '../ui/spinner.js';
import { CliArgumentError, printWarnings, withErrorHandler } from '../utils/error.js';
import { pageToOffset, parsePositiveInt } from '../utils/parsing.js';

const COLLECTION_PAGE_SIZE = 15;

/**
 * One user's movies or books in one status, paged in the terminal. The local
 * session is reused so entries visible only when signed in are included.
 */
async function showCollection(options: {
  kind: SubjectKind;
  userId: string;
  mine: boolean;
  status: CollectionStatus;
  statusLabel: string;
  page?: string;
  limit?: string;
  json?: boolean;
}): Promise<void> {
  const { kind, userId, status, statusLabel } = options;
  const page = parsePositiveInt(options.page, '--page', 1);
  const limit = parsePositiveInt(options.limit, '--limit', COLLECTION_PAGE_SIZE);
  const noun = kind === 'movie' ? '片单' : '书单';
  const owner = options.mine ? '我' : `用户 ${userId} `;
  const cookies = await getOptionalSessionCookies();
  const load = async (currentPage: number, spinner: boolean) => {
    const result = await withSpinner(
      `正在获取${owner}的${statusLabel}${noun}...`,
      () => getUserCollectionPageWithSession({ kind, userId, status, start: pageToOffset(currentPage, limit), count: limit }, cookies),
      spinner
    );
    printWarnings(result.warnings);
    return result;
  };

  if (options.json) {
    console.log(JSON.stringify((await load(page, false)).items, null, 2));
    return;
  }
  await withPagination({
    startPage: page,
    pageSize: limit,
    fetchPage: async (currentPage) => {
      const result = await load(currentPage, true);
      return { items: result.items, total: result.total, hasMore: result.nextStart !== null };
    },
    renderPage: (items, currentPage) => {
      console.log(`\n${options.mine ? '🙋' : '👤'} ${owner}的${noun} · ${statusLabel}（第 ${currentPage} 页）\n`);
      printCollectionItems(items, pageToOffset(currentPage, limit));
    }
  });
}

/**
 * The user for `me` and `book me`: the configured `config --user`, otherwise
 * the signed-in account.
 */
async function resolveCurrentUser(showSpinner: boolean): Promise<string> {
  const configured = readConfig().user?.trim();
  if (configured) return configured;
  try {
    const auth = await withSpinner('正在识别当前登录用户...', () => ensureAuth(), showSpinner);
    return auth.accountId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}；也可以用 douban config --user <id> 指定默认用户`, { cause: error });
  }
}

function resolveMovieStatus(opts: { wish?: boolean; doing?: boolean }): {
  status: CollectionStatus;
  statusLabel: string;
} {
  if (opts.wish && opts.doing) throw new CliArgumentError('--wish 和 --doing 不能同时使用');
  if (opts.wish) return { status: 'wish', statusLabel: '想看' };
  if (opts.doing) return { status: 'do', statusLabel: '在看' };
  return { status: 'collect', statusLabel: '看过' };
}

export function resolveBookStatus(opts: { wish?: boolean; reading?: boolean }): {
  status: CollectionStatus;
  statusLabel: string;
} {
  if (opts.wish && opts.reading) throw new CliArgumentError('--wish 和 --reading 不能同时使用');
  if (opts.wish) return { status: 'wish', statusLabel: '想读' };
  if (opts.reading) return { status: 'do', statusLabel: '在读' };
  return { status: 'collect', statusLabel: '读过' };
}

/** `user` and `me` for movies, `book user` and `book me` for books. */
export function registerCollectionCommands(program: Command, book: Command): void {
  program
    .command('user <userId>')
    .helpGroup('用户与豆列:')
    .description('指定用户的电影片单（默认看过）')
    .option('--wish', '查看“想看”列表')
    .option('--doing', '查看“在看”列表')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '每页数量', String(COLLECTION_PAGE_SIZE))
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'user',
      target: `用户ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban user <userId> --wish'
    }), (userId, opts) => showCollection({
      kind: 'movie', userId, mine: false, ...resolveMovieStatus(opts), page: opts.page, limit: opts.limit, json: opts.json
    })));

  program
    .command('me')
    .helpGroup('用户与豆列:')
    .description('我的电影片单（默认看过）')
    .option('--wish', '查看“想看”列表')
    .option('--doing', '查看“在看”列表')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '每页数量', String(COLLECTION_PAGE_SIZE))
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'me',
      suggestion: '可先运行 douban login 或 douban config --user <id>'
    }, async (opts) => {
      const userId = await resolveCurrentUser(!opts.json);
      await showCollection({
        kind: 'movie', userId, mine: true, ...resolveMovieStatus(opts), page: opts.page, limit: opts.limit, json: opts.json
      });
    }));

  book
    .command('user <userId>')
    .description('指定用户的书单（默认读过）')
    .option('--wish', '查看“想读”列表')
    .option('--reading', '查看“在读”列表')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '每页数量', String(COLLECTION_PAGE_SIZE))
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book user',
      target: `用户ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban book user <userId> --wish'
    }), (userId, opts) => showCollection({
      kind: 'book', userId, mine: false, ...resolveBookStatus(opts), page: opts.page, limit: opts.limit, json: opts.json
    })));

  book
    .command('me')
    .description('我的书单（默认读过）')
    .option('--wish', '查看“想读”列表')
    .option('--reading', '查看“在读”列表')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '每页数量', String(COLLECTION_PAGE_SIZE))
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'book me',
      suggestion: '可先运行 douban login 或 douban config --user <id>'
    }, async (opts) => {
      const userId = await resolveCurrentUser(!opts.json);
      await showCollection({
        kind: 'book', userId, mine: true, ...resolveBookStatus(opts), page: opts.page, limit: opts.limit, json: opts.json
      });
    }));
}
