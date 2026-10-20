import { Command } from 'commander';
import { readConfig, writeConfig } from '../storage/config.js';
import { resolveCliStoragePaths } from '../storage/paths.js';
import { withErrorHandler } from '../utils/error.js';

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .helpGroup('用户与豆列:')
    .description('默认用户（me、book me、stats、export 默认查看的用户）')
    .option('--user <id>', '默认用户 ID（个人主页地址 /people/<id>/ 中的部分）')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'config',
      suggestion: '可尝试：douban config --user <id>'
    }, async (opts) => {
      const current = readConfig();

      if (opts.user !== undefined) {
        const userId = String(opts.user).trim();
        if (!userId) throw new Error('用户 ID 不能为空');
        current.user = userId;
        writeConfig(current);
      }

      if (opts.json) {
        console.log(JSON.stringify(current, null, 2));
      } else {
        console.log(`\n⚙️  配置文件: ${resolveCliStoragePaths().configPath}`);
        if (current.login) {
          console.log(`登录浏览器: ${current.login.browser}${current.login.profile ? ` (${current.login.profile})` : ''}`);
        }
        if (current.user) {
          console.log(`默认用户 ID: ${current.user}`);
          console.log('可直接运行: douban me');
        } else {
          console.log('默认用户 ID: 未设置');
          console.log('设置方式: douban config --user <用户ID>');
          console.log('用户 ID 可从个人主页 URL /people/xxx/ 中获取');
        }
      }
    }));
}
