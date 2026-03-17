import { Command } from 'commander';
import { getCelebrityDetail } from '../api/index.js';
import { withErrorHandler } from '../utils/error.js';
import { withSpinner } from '../utils/spinner.js';

export function registerCelebrityCommands(program: Command): void {
  program
    .command('celebrity [id]')
    .description('按影人 ID 获取详情')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'celebrity',
      target: `ID: ${String(args[0] || '未指定')}`,
      suggestion: '确认 ID 是否正确，可在豆瓣网页地址中查看影人 ID'
    }), async (id, opts) => {
      if (!id) {
        console.log('\n🎭 影人详情 - 请指定 ID\n');
        console.log('用法: douban celebrity <ID>\n');
        console.log('获取 ID: 在豆瓣网页地址中查看，如 movie.douban.com/celebrity/1054521/\n');
        console.log('示例: douban celebrity 1054521');
        return;
      }
      const detail = await withSpinner(
        '正在获取影人详情...',
        () => getCelebrityDetail(id),
        !opts.json
      );

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
    }));
}
