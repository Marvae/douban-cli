import { Command } from 'commander';
import { getDoulist, getHotLists } from '../api/list.js';
import { printWarnings, withErrorHandler } from '../utils/error.js';
import { parseNonNegativeInt, parsePositiveIntAtMost } from '../utils/parsing.js';
import { idColumn, renderTable } from '../ui/output.js';
import { withSpinner } from '../ui/spinner.js';
import { truncateDisplay } from '../ui/text.js';

const KIND_LABELS = { movie: '电影', book: '图书', music: '音乐', other: '其他' } as const;
const MAX_DOULIST_ITEMS = 1000;

export function registerListCommands(program: Command): void {
  program
    .command('list [doulist]')
    .helpGroup('用户与豆列:')
    .description('读取豆列（ID 或链接），不带参数看热门豆列')
    .option('-n, --limit <n>', `返回数量（豆列内容最多 ${MAX_DOULIST_ITEMS}）`, '20')
    .option('-s, --start <n>', '豆列内容起始偏移', '0')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'list',
      ...(args[0] ? { target: `豆列: ${String(args[0])}` } : {}),
      suggestion: '可尝试：douban list 240962 -n 50'
    }), async (doulist: string | undefined, opts) => {
      const limit = parsePositiveIntAtMost(opts.limit, '--limit', 20, MAX_DOULIST_ITEMS);

      if (!doulist) {
        const items = await withSpinner('正在获取热门豆列...', () => getHotLists(limit), !opts.json);
        if (opts.json) {
          console.log(JSON.stringify(items, null, 2));
          return;
        }
        console.log('\n🗂️  热门豆列\n');
        renderTable(items, [
          { header: '#', value: (_, index) => String(index + 1), minWidth: 2 },
          { header: '豆列', value: (item) => item.title, maxWidth: 24 },
          { header: '作者', value: (item) => item.author, maxWidth: 12 },
          { header: '关注', value: (item) => item.followers },
          { header: '最近更新', value: (item) => item.recent, maxWidth: 20 },
          idColumn()
        ]);
        return;
      }

      const start = parseNonNegativeInt(opts.start, '--start', 0);
      const result = await withSpinner('正在读取豆列...', () => getDoulist(doulist, { start, limit }), !opts.json);
      printWarnings(result.warnings);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`\n🗂️  ${result.title}`);
      if (result.description) {
        console.log(`    ${truncateDisplay(result.description, 80)}`);
      }
      console.log('');
      for (const item of result.items) {
        const rating = item.rating !== '-' ? ` ⭐${item.rating}` : '';
        console.log(`${item.position.toString().padStart(3)}. ${item.title}${rating}  [${KIND_LABELS[item.kind]}${item.id ? ` ${item.id}` : ''}]`);
        if (item.meta) console.log(`     ${item.meta}`);
      }
      if (result.next_start !== null) {
        console.log(`\n还有更多，继续读取：douban list ${result.id} --start ${result.next_start}`);
      }
    }));
}
