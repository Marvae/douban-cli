import { Command } from 'commander';
import { getDoulist, getHotLists } from '../api/list.js';
import { printWarnings, withErrorHandler } from '../utils/error.js';
import { parseNonNegativeInt, parsePositiveIntAtMost } from '../utils/parsing.js';
import { withSpinner } from '../ui/spinner.js';

const KIND_LABELS = { movie: '电影', book: '图书', music: '音乐', other: '其他' } as const;
const MAX_DOULIST_ITEMS = 1000;

export function registerListCommands(program: Command): void {
  program
    .command('list [doulist]')
    .helpGroup('用户与豆列:')
    .description('读取豆列内容（ID 或链接）；不带参数时显示热门豆列')
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
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title}  (ID: ${item.id})`);
          console.log(`    作者: ${item.author} | 关注: ${item.followers}`);
          console.log(`    最近更新: ${item.recent}`);
        });
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
        console.log(`    ${result.description.length > 80 ? `${result.description.slice(0, 80)}…` : result.description}`);
      }
      console.log('');
      for (const item of result.items) {
        const rating = item.rating !== '-' ? ` ⭐${item.rating}` : '';
        console.log(`${item.position.toString().padStart(3)}. ${item.title}${rating}  [${KIND_LABELS[item.kind]}${item.id ? ` ${item.id}` : ''}]`);
        if (item.abstract) console.log(`     ${item.abstract}`);
      }
      if (result.next_start !== null) {
        console.log(`\n还有更多，继续读取：douban list ${result.id} --start ${result.next_start}`);
      }
    }));
}
