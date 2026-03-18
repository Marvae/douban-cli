import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { detectAuthSession, getCachedAuthSession } from '../auth.js';
import { getCurrentUserProfile, getUserCollection } from '../api/index.js';
import { withErrorHandler } from '../utils/error.js';
import { parsePositiveInt } from '../utils/parsing.js';
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[config] 读取配置失败: ${message}`);
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
        console.log('如何找到用户 ID:');
        console.log('  打开豆瓣个人主页 URL，例如 https://www.douban.com/people/xxx/');
        console.log('  其中 /people/ 后面的 xxx 就是用户 ID\n');
        console.log('选项:');
        console.log('  --wish   想看列表');
        console.log('  --doing  在看列表');
        console.log('  (默认)   看过列表\n');
        console.log('示例: douban user USER_ID --wish');
        return;
      }
      const status = opts.wish ? 'wish' : opts.doing ? 'do' : 'collect';
      const statusLabel = opts.wish ? '想看' : opts.doing ? '在看' : '看过';
      const limit = parsePositiveInt(opts.limit, '--limit', 30);

      const items = await withSpinner(
        `正在获取用户 ${userId} 的${statusLabel}片单...`,
        () => getUserCollection(userId, status, limit),
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

  program
    .command('me')
    .description('获取配置用户的个人片单')
    .option('--wish', '查看"想看"列表（默认看过）')
    .option('--doing', '查看"在看"列表')
    .option('-n, --limit <n>', '返回数量', '30')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'me',
      suggestion: '可先运行 douban login 或 douban config --user <id>'
    }, async (opts) => {
      const config = readConfig();
      let userId = config.user?.trim();

      if (!userId) {
        const cached = getCachedAuthSession();
        if (cached) {
          try {
            const profile = await withSpinner('正在识别当前登录用户...', () => getCurrentUserProfile(cached.cookies), !opts.json);
            userId = profile.id;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[me] 读取缓存登录用户失败: ${message}`);
          }
        }
      }

      if (!userId) {
        try {
          const auth = await detectAuthSession();
          if (!auth) {
            throw new Error('NO_AUTH');
          }
          const profile = await withSpinner('正在识别当前登录用户...', () => getCurrentUserProfile(auth.cookies), !opts.json);
          userId = profile.id;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[me] 检测登录用户失败: ${message}`);
          throw new Error('未配置默认用户，也未检测到登录 Cookie。请先运行 douban login 或 douban config --user <id>');
        }
      }

      const status = opts.wish ? 'wish' : opts.doing ? 'do' : 'collect';
      const statusLabel = opts.wish ? '想看' : opts.doing ? '在看' : '看过';
      const limit = parsePositiveInt(opts.limit, '--limit', 30);
      const items = await withSpinner(
        `正在获取我的${statusLabel}片单...`,
        () => getUserCollection(userId as string, status, limit),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n🙋 我的片单 (${userId}) ${statusLabel}\n`);
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title}`);
        });
      }
    }));
}
