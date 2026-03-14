import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Command } from 'commander';
import { getUserCollection } from '../api/index.js';

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
    .command('user <userId>')
    .description('Get user movie collection')
    .option('--wish', 'Show wish list instead of watched')
    .option('--doing', 'Show currently watching')
    .option('-n, --limit <n>', 'Number of results', '30')
    .option('--json', 'Output as JSON')
    .action(async (userId, opts) => {
      const status = opts.wish ? 'wish' : opts.doing ? 'do' : 'collect';
      const statusLabel = opts.wish ? '想看' : opts.doing ? '在看' : '看过';

      const items = await getUserCollection(userId, status, parseInt(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n👤 用户 ${userId} ${statusLabel}\n`);
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title}`);
        });
      }
    });

  program
    .command('config')
    .description('Set local douban-cli config')
    .option('--user <id>', 'Set default user id for me command')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
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
    });

  program
    .command('me')
    .description('Get my movie collection from configured user id')
    .option('--wish', 'Show wish list instead of watched')
    .option('--doing', 'Show currently watching')
    .option('-n, --limit <n>', 'Number of results', '30')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const config = readConfig();
      if (!config.user) {
        throw new Error('No user configured. Use: douban config --user <id>');
      }

      const status = opts.wish ? 'wish' : opts.doing ? 'do' : 'collect';
      const statusLabel = opts.wish ? '想看' : opts.doing ? '在看' : '看过';
      const items = await getUserCollection(config.user, status, parseInt(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n🙋 我的片单 (${config.user}) ${statusLabel}\n`);
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title}`);
        });
      }
    });
}
