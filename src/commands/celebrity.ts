import { Command } from 'commander';
import { getCelebrityDetail } from '../api/index.js';

export function registerCelebrityCommands(program: Command): void {
  program
    .command('celebrity <id>')
    .description('Get celebrity detail by id')
    .option('--json', 'Output as JSON')
    .action(async (id, opts) => {
      const detail = await getCelebrityDetail(id);

      if (opts.json) {
        console.log(JSON.stringify(detail, null, 2));
      } else {
        console.log(`\n🎭 ${detail.name}${detail.name_en !== '-' ? ` / ${detail.name_en}` : ''}`);
        console.log(`ID: ${detail.id}`);
        console.log(`性别: ${detail.gender}`);
        console.log(`星座: ${detail.horoscope}`);
        console.log(`生日: ${detail.birthday}`);
        console.log(`出生地: ${detail.birthplace}`);
        console.log(`职业: ${detail.profession}`);
        console.log(`来源: ${detail.source}`);
        console.log(`\n简介:\n${detail.summary}`);
        console.log(`\n链接: ${detail.url}`);
      }
    });
}
