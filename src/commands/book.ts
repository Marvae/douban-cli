import { Command } from 'commander';
import { getBookHot, getBookInfo, searchBooks } from '../api/index.js';
import { withErrorHandler } from '../utils/error.js';
import { parseNonNegativeInt, parsePositiveInt } from '../utils/parsing.js';
import { withSpinner } from '../utils/spinner.js';

export function registerBookCommands(program: Command): void {
  const book = program
    .command('book')
    .description('豆瓣书籍相关命令');

  book
    .command('hot')
    .description('获取热门书籍（Top250）')
    .option('-s, --start <n>', '起始偏移', '0')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'book hot',
      suggestion: '可尝试：douban book hot -n 30'
    }, async (opts) => {
      const start = parseNonNegativeInt(opts.start, '--start', 0);
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const items = await withSpinner(
        '正在获取热门书籍...',
        () => getBookHot(start, limit),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log('\n📚 热门书籍 (Top250)\n');
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title} ⭐${item.rating}`);
          console.log(`    ${item.meta}`);
        });
      }
    }));

  book
    .command('search <keyword>')
    .description('按关键词搜索书籍')
    .option('-s, --start <n>', '起始偏移', '0')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book search',
      target: `关键词: ${String(args[0])}`,
      suggestion: '可尝试：douban book search 三体'
    }), async (keyword, opts) => {
      const start = parseNonNegativeInt(opts.start, '--start', 0);
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const items = await withSpinner(
        `正在搜索书籍“${keyword}”...`,
        () => searchBooks(keyword, start, limit),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n📖 搜索书籍: ${keyword}\n`);
        if (items.length === 0) {
          console.log('未找到相关结果。');
          return;
        }
        items.forEach((item, i) => {
          const year = item.year ? ` (${item.year})` : '';
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title}${year} ⭐${item.rating}`);
          console.log(`    ID: ${item.id}`);
        });
      }
    }));

  book
    .command('info <id>')
    .description('按书籍 ID 获取详情')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'book info',
      target: `ID: ${String(args[0])}`,
      suggestion: '确认 ID 是否正确，可先运行 douban book search <关键词>'
    }), async (id, opts) => {
      const detail = await withSpinner(
        '正在获取书籍详情...',
        () => getBookInfo(id),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(detail, null, 2));
      } else {
        console.log(`\n📘 ${detail.title}`);
        console.log(`ID: ${detail.id}`);
        console.log(`评分: ${detail.rating}`);
        console.log(`作者: ${detail.author}`);
        console.log(`译者: ${detail.translator.length > 0 ? detail.translator.join(' / ') : '-'}`);
        console.log(`副标题: ${detail.subtitle}`);
        console.log(`出版社: ${detail.publisher}`);
        console.log(`出版年: ${detail.pubdate}`);
        console.log(`页数: ${detail.pages}`);
        console.log(`定价: ${detail.price}`);
        console.log(`ISBN: ${detail.isbn}`);
        console.log(`短评: ${detail.comment_count.toLocaleString()}`);
        console.log(`书评: ${detail.review_count.toLocaleString()}`);
        console.log(`标签: ${detail.tags.length > 0 ? detail.tags.join(' / ') : '-'}`);
        console.log(`\n简介:\n${detail.summary}`);
        console.log(`\n链接: ${detail.url}`);
      }
    }));
}
