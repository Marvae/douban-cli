import { Command } from 'commander';
import { getHotLists } from '../api/index.js';

export function registerListCommands(program: Command): void {
  program
    .command('list')
    .description('Get hot doulist recommendations')
    .option('-n, --limit <n>', 'Number of results', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const items = await getHotLists(parseInt(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log('\n🗂️  热门片单\n');
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title}`);
          console.log(`    作者: ${item.author} | 关注: ${item.followers}`);
          console.log(`    最近更新: ${item.recent}`);
        });
      }
    });
}
