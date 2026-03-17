import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { getUserCollection } from '../api/index.js';
import { withErrorHandler } from '../utils/error.js';
import { withSpinner } from '../utils/spinner.js';

type CliConfig = {
  user?: string;
};

const CONFIG_PATH = path.join(os.homedir(), '.douban-cli.json');

function readConfig(): CliConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const content = readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(content) as CliConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfig(config: CliConfig): void {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function registerUserCommands(program: Command): void {
  program
    .command('user [userId]')
    .description('获取指定用户的电影片单')
    .option('--wish', '查看"想看"列表（默认看过）')
    .option('--doing', '查看"在看"列表')
    .option('-n, --limit <n>', '返回数量', '30')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'user',
      target: `用户ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban user <userId> --wish'
    }), async (userId, opts) => {
      if (!userId) {
        console.log('\n👤 用户片单 - 请指定用户 ID\n');
        console.log('用法: douban user <用户ID>\n');
        console.log('选项:');
        console.log('  --wish   想看列表');
        console.log('  --doing  在看列表');
        console.log('  (默认)   看过列表\n');
        console.log('示例: douban user USER_ID --wish');
        return;
      }
      const status = opts.wish ? 'wish' : opts.doing ? 'do' : 'collect';
      const statusLabel = opts.wish ? '想看' : opts.doing ? '在看' : '看过';

      const items = await withSpinner(
        `正在获取用户 ${userId} 的${statusLabel}片单...`,
        () => getUserCollection(userId, status, parseInt(opts.limit, 10)),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n👤 用户 ${userId} ${statusLabel}\n`);
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title}`);
        });
      }
    }));

  program
    .command('config')
    .description('设置本地 douban-cli 配置')
    .option('--user <id>', '设置 me 命令默认用户 ID')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'config',
      suggestion: '可尝试：douban config --user <id>'
    }, async (opts) => {
      const current = readConfig();

      if (opts.user) {
        current.user = String(opts.user).trim();
        writeConfig(current);
      }

      if (opts.json) {
        console.log(JSON.stringify(current, null, 2));
      } else {
        console.log(`\n⚙️  配置文件: ${CONFIG_PATH}`);
        console.log(`user: ${current.user || '-'}`);
      }
    }));

  program
    .command('me')
    .description('获取配置用户的个人片单')
    .option('--wish', '查看"想看"列表（默认看过）')
    .option('--doing', '查看"在看"列表')
    .option('-n, --limit <n>', '返回数量', '30')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'me',
      suggestion: '请先运行 douban config --user <id> 设置默认用户'
    }, async (opts) => {
      const config = readConfig();
      if (!config.user) {
        throw new Error('未配置默认用户');
      }

      const status = opts.wish ? 'wish' : opts.doing ? 'do' : 'collect';
      const statusLabel = opts.wish ? '想看' : opts.doing ? '在看' : '看过';
      const items = await withSpinner(
        `正在获取我的${statusLabel}片单...`,
        () => getUserCollection(config.user as string, status, parseInt(opts.limit, 10)),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n🙋 我的片单 (${config.user}) ${statusLabel}\n`);
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title}`);
        });
      }
    }));
}
