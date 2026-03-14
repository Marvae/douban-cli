import { Command } from 'commander';
import { getBookHot, getBookInfo, searchBooks } from '../api/index.js';

export function registerBookCommands(program: Command): void {
  const book = program
    .command('book')
    .description('Douban book commands');

  book
    .command('hot')
    .description('Get hot books from Top250')
    .option('-s, --start <n>', 'Start offset', '0')
    .option('-n, --limit <n>', 'Number of results', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const items = await getBookHot(parseInt(opts.start), parseInt(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log('\n📚 热门书籍 (Top250)\n');
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title} ⭐${item.rating}`);
          console.log(`    ${item.meta}`);
        });
      }
    });

  book
    .command('search <keyword>')
    .description('Search books by keyword')
    .option('-s, --start <n>', 'Start offset', '0')
    .option('-n, --limit <n>', 'Number of results', '20')
    .option('--json', 'Output as JSON')
    .action(async (keyword, opts) => {
      const items = await searchBooks(keyword, parseInt(opts.start), parseInt(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n📖 搜索书籍: ${keyword}\n`);
        if (items.length === 0) {
          console.log('No results found.');
          return;
        }
        items.forEach((item, i) => {
          const year = item.year ? ` (${item.year})` : '';
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title}${year} ⭐${item.rating}`);
          console.log(`    ID: ${item.id}`);
        });
      }
    });

  book
    .command('info <id>')
    .description('Get book detail by subject id')
    .option('--json', 'Output as JSON')
    .action(async (id, opts) => {
      const detail = await getBookInfo(id);

      if (opts.json) {
        console.log(JSON.stringify(detail, null, 2));
      } else {
        console.log(`\n📘 ${detail.title}`);
        console.log(`ID: ${detail.id}`);
        console.log(`评分: ${detail.rating}`);
        console.log(`作者: ${detail.author}`);
        console.log(`出版社: ${detail.publisher}`);
        console.log(`出版年: ${detail.pubdate}`);
        console.log(`页数: ${detail.pages}`);
        console.log(`定价: ${detail.price}`);
        console.log(`ISBN: ${detail.isbn}`);
        console.log(`\n简介:\n${detail.summary}`);
        console.log(`\n链接: ${detail.url}`);
      }
    });
}
