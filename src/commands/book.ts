import { Command } from 'commander';
import {
  BOOK_CHART_CATEGORIES,
  BOOK_LATEST_CATEGORIES,
  getBookChart,
  getBookComments,
  getBookInfo,
  getBookNotes,
  getBookRatingStats,
  getBookReviews,
  getBookTop250,
  getLatestBooks,
  searchBooks,
  type BookItem
} from '../api/book.js';
import { getOptionalSessionCookies } from '../auth/index.js';
import { printWarnings, withErrorHandler } from '../utils/error.js';
import {
  getPageRange,
  pageToOffset,
  parseNonNegativeInt,
  parsePositiveInt,
  parsePositiveIntAtMost
} from '../utils/parsing.js';
import { withPagination } from '../ui/pagination.js';
import { withSpinner } from '../ui/spinner.js';
import {
  compactNumber,
  formatTrend,
  idColumn,
  printListHeading,
  printPosts,
  printRatingBars,
  renderTable,
  subjectLabel,
  type TableColumn
} from '../ui/output.js';
import { resolveSubject } from './resolve.js';

function renderBookList(items: BookItem[], heading: string, offset = 0): void {
  console.log(`\n${heading}\n`);
  if (items.length === 0) {
    console.log('暂无结果');
    return;
  }
  const trendColumn: TableColumn<BookItem>[] = items.some((item) => item.trend)
    ? [{ header: '变化', value: (item) => formatTrend(item.trend) || '—' }]
    : [];
  renderTable(items, [
    { header: '#', value: (item, index) => String(item.rank || offset + index + 1), minWidth: 2 },
    { header: '书名', value: (item) => item.title, maxWidth: 24 },
    { header: '评分', value: (item) => item.rating },
    { header: '评价', value: (item) => (item.rating_count > 0 ? compactNumber(item.rating_count) : '-') },
    ...trendColumn,
    { header: '作者 / 出版', value: (item) => item.meta, maxWidth: 30 },
    idColumn()
  ]);
}

function registerTop250Command(book: Command, name: 'hot' | 'top250'): void {
  const legacy = name === 'hot';
  book
    .command(name, { hidden: legacy })
    .description(legacy ? '获取热门书籍（兼容旧版，等同 Top250）' : '豆瓣图书 Top250')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '每页数量', '25')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: `book ${name}`,
      suggestion: '可尝试：douban book top250 -n 10 --page 2'
    }, async (opts) => {
      const total = 250;
      const limit = parsePositiveIntAtMost(opts.limit, '--limit', 25, total);
      const page = parsePositiveIntAtMost(opts.page, '--page', 1, Math.ceil(total / limit));
      const load = (currentPage: number, spinner: boolean) => withSpinner(
        '正在获取图书 Top250...',
        () => getBookTop250(pageToOffset(currentPage, limit), limit),
        spinner
      );

      if (opts.json) {
        console.log(JSON.stringify(await load(page, false), null, 2));
        return;
      }
      await withPagination({
        startPage: page,
        pageSize: limit,
        fetchPage: async (currentPage) => {
          const items = await load(currentPage, true);
          return { items, total, hasMore: pageToOffset(currentPage, limit) + items.length < total };
        },
        renderPage: (items, currentPage) => {
          const { from, to } = getPageRange(currentPage, limit, items.length);
          renderBookList(items, `📚 豆瓣图书 Top250 · 第 ${from}-${to} 本`, pageToOffset(currentPage, limit));
        }
      });
    }));
}

export function registerBookCommands(program: Command): Command {
  const book = program
    .command('book')
    .helpGroup('图书:')
    .commandsGroup('图书:')
    .description('豆瓣图书：榜单、搜索、详情、评分、短评、书评、笔记、书单与写入')
    .helpCommand(false);

  registerTop250Command(book, 'hot');
  registerTop250Command(book, 'top250');
  book
    .command('chart [category]')
    .description('热门图书榜')
    .option('-n, --limit <n>', '返回数量（最多 20）', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book chart',
      target: `分类: ${String(args[0] || '全部')}`,
      options: `分类：${Object.keys(BOOK_CHART_CATEGORIES).join('、')}`,
      suggestion: '可尝试：douban book chart 小说'
    }), async (category = '全部', opts) => {
      const limit = parsePositiveIntAtMost(opts.limit, '--limit', 20, 20);
      const items = await withSpinner(
        `正在获取${category}热门图书...`,
        () => getBookChart(category, limit),
        !opts.json
      );

      if (opts.json) console.log(JSON.stringify(items, null, 2));
      else renderBookList(items, `🔥 热门图书榜 · ${category}`);
    }));

  book
    .command('new [category]')
    .alias('latest')
    .description('新书速递')
    .option('-n, --limit <n>', '返回数量（最多 20）', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book new',
      target: `分类: ${String(args[0] || '全部')}`,
      options: `分类：${BOOK_LATEST_CATEGORIES.join('、')}`,
      suggestion: '可尝试：douban book new 科学新知'
    }), async (category = '全部', opts) => {
      const limit = parsePositiveIntAtMost(opts.limit, '--limit', 20, 20);
      const items = await withSpinner(
        `正在获取${category}新书...`,
        () => getLatestBooks(category, limit),
        !opts.json
      );

      if (opts.json) console.log(JSON.stringify(items, null, 2));
      else renderBookList(items, `🆕 新书速递 · ${category}`);
    }));

  book
    .command('search <keyword>')
    .description('搜索图书（书名、作者或 ISBN）')
    .option('-s, --start <n>', '起始偏移', '0')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book search',
      target: `关键词: ${String(args[0])}`,
      suggestion: '可尝试：douban book search 三体 -n 20'
    }), async (keyword, opts) => {
      const start = parseNonNegativeInt(opts.start, '--start', 0);
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const warnings: string[] = [];
      const cookies = await getOptionalSessionCookies();
      const items = await withSpinner(
        `正在搜索书籍“${keyword}”...`,
        () => searchBooks(keyword, start, limit, { cookies, warnings }),
        !opts.json
      );
      printWarnings(warnings);

      if (opts.json) console.log(JSON.stringify(items, null, 2));
      else renderBookList(items, `🔍 搜索书籍 · ${keyword}`, start);
    }));

  book
    .command('info <query>')
    .description('图书详情和相似推荐（ID、ISBN 或书名）')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book info',
      target: `书籍: ${String(args[0])}`,
      suggestion: '可尝试：douban book info 三体'
    }), async (query, opts) => {
      const { id } = await resolveSubject('book', query, Boolean(opts.json));
      const detail = await withSpinner(
        '正在获取书籍详情...',
        () => getBookInfo(id),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(detail, null, 2));
        return;
      }

      console.log(`\n📘 ${detail.title}${detail.subtitle !== '-' ? `：${detail.subtitle}` : ''}`);
      console.log(`ID: ${detail.id}`);
      console.log(`评分: ${detail.rating} (${compactNumber(detail.rating_count)}人评价)`);
      console.log(`作者: ${detail.author}`);
      console.log(`译者: ${detail.translator.length > 0 ? detail.translator.join(' / ') : '-'}`);
      console.log(`出版社: ${detail.publisher}`);
      console.log(`出品方: ${detail.producer.length > 0 ? detail.producer.join(' / ') : '-'}`);
      console.log(`出版年: ${detail.pubdate}`);
      console.log(`页数: ${detail.pages}`);
      console.log(`装帧: ${detail.binding}`);
      console.log(`定价: ${detail.price}`);
      console.log(`ISBN: ${detail.isbn}`);
      console.log(`丛书: ${detail.series?.title || '-'}`);
      console.log(`短评: ${compactNumber(detail.comment_count)}`);
      console.log(`书评: ${compactNumber(detail.review_count)}`);
      console.log(`读书笔记: ${compactNumber(detail.annotation_count)}`);
      console.log(`标签: ${detail.tags.length > 0 ? detail.tags.join(' / ') : '-'}`);
      console.log(`电子书: ${detail.has_ebook ? '有' : '无/未知'}`);
      console.log(`\n简介:\n${detail.summary}`);
      if (detail.author_intro !== '-') console.log(`\n作者简介:\n${detail.author_intro}`);
      if (detail.catalog !== '-') console.log(`\n目录:\n${detail.catalog}`);
      if (detail.recommendations.length > 0) {
        console.log(`\n相似推荐: ${detail.recommendations.map((item) => `${item.title}(${item.rating})`).join(' / ')}`);
      }
      console.log(`\n链接: ${detail.url}`);
    }));

  book
    .command('rating <query>')
    .description('评分分布（ID、ISBN 或书名）')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book rating',
      target: `书籍: ${String(args[0])}`,
      suggestion: '可尝试：douban book rating 三体'
    }), async (query, opts) => {
      const { id } = await resolveSubject('book', query, Boolean(opts.json));
      const stats = await withSpinner(
        '正在获取书籍评分分布...',
        () => getBookRatingStats(id),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      console.log(`\n⭐ 评分分布 (${stats.value}分，${compactNumber(stats.count)}人评价)\n`);
      printRatingBars(stats.stars);
      console.log(`\n想读: ${compactNumber(stats.wish_count)}`);
      console.log(`在读: ${compactNumber(stats.doing_count)}`);
      console.log(`读过: ${compactNumber(stats.done_count)}`);
    }));

  book
    .command('comments <query>')
    .description('热门短评（ID、ISBN 或书名）')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '每页数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book comments',
      target: `书籍: ${String(args[0])}`,
      suggestion: '可尝试：douban book comments 三体'
    }), async (query, opts) => {
      const { id, title } = await resolveSubject('book', query, Boolean(opts.json));
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const page = parsePositiveInt(opts.page, '--page', 1);

      if (opts.json) {
        const result = await getBookComments(id, 'hot', pageToOffset(page, limit), limit);
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      await withPagination({
        startPage: page,
        pageSize: limit,
        fetchPage: async (currentPage) => {
          const start = pageToOffset(currentPage, limit);
          const result = await withSpinner(
            '正在获取热门短评...',
            () => getBookComments(id, 'hot', start, limit),
            true
          );
          return { ...result, hasMore: start + result.items.length < result.total };
        },
        renderPage: (items, currentPage, total) => {
          const start = pageToOffset(currentPage, limit);
          const { from, to } = getPageRange(currentPage, limit, items.length);
          printListHeading(`💬 热门短评 · ${subjectLabel(id, title)}`, total, from, to);
          printPosts(items, start);
        }
      });
    }));

  book
    .command('reviews <query>')
    .description('热门书评（ID、ISBN 或书名）')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '每页数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book reviews',
      target: `书籍: ${String(args[0])}`,
      suggestion: '可尝试：douban book reviews 三体 -n 5'
    }), async (query, opts) => {
      const { id, title } = await resolveSubject('book', query, Boolean(opts.json));
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const page = parsePositiveInt(opts.page, '--page', 1);

      if (opts.json) {
        const result = await getBookReviews(id, pageToOffset(page, limit), limit);
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      await withPagination({
        startPage: page,
        pageSize: limit,
        fetchPage: async (currentPage) => {
          const start = pageToOffset(currentPage, limit);
          const result = await withSpinner('正在获取热门书评...', () => getBookReviews(id, start, limit), true);
          return { ...result, hasMore: start + result.items.length < result.total };
        },
        renderPage: (items, currentPage, total) => {
          const start = pageToOffset(currentPage, limit);
          const { from, to } = getPageRange(currentPage, limit, items.length);
          printListHeading(`📝 热门书评 · ${subjectLabel(id, title)}`, total, from, to);
          printPosts(items, start);
        }
      });
    }));

  book
    .command('notes <query>')
    .description('读书笔记（ID、ISBN 或书名）')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '每页数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book notes',
      target: `书籍: ${String(args[0])}`,
      suggestion: '可尝试：douban book notes 三体 -n 5'
    }), async (query, opts) => {
      const { id, title } = await resolveSubject('book', query, Boolean(opts.json));
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const page = parsePositiveInt(opts.page, '--page', 1);

      if (opts.json) {
        const result = await getBookNotes(id, pageToOffset(page, limit), limit);
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      await withPagination({
        startPage: page,
        pageSize: limit,
        fetchPage: async (currentPage) => {
          const start = pageToOffset(currentPage, limit);
          const result = await withSpinner('正在获取读书笔记...', () => getBookNotes(id, start, limit), true);
          return { ...result, hasMore: start + result.items.length < result.total };
        },
        renderPage: (items, currentPage, total) => {
          const start = pageToOffset(currentPage, limit);
          const { from, to } = getPageRange(currentPage, limit, items.length);
          printListHeading(`📒 读书笔记 · ${subjectLabel(id, title)}`, total, from, to);
          if (items.length === 0) console.log('暂无内容');
          items.forEach((item, index) => {
            console.log(`${(start + index + 1).toString().padStart(2)}. ${item.user} · ${item.chapter}`);
            console.log(`    ${item.content}`);
            console.log(`    ${item.time}\n`);
          });
        }
      });
    }));

  return book;
}
