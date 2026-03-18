#!/usr/bin/env node
import { Command } from 'commander';
import { registerBookCommands } from './commands/book.js';
import { registerCelebrityCommands } from './commands/celebrity.js';
import { registerListCommands } from './commands/list.js';
import { registerMovieCommands } from './commands/movie.js';
import { registerUserCommands } from './commands/user.js';
import { registerMarkCommands } from './commands/mark.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerSocialCommands } from './commands/social.js';
import { handleProgramError } from './utils/error.js';

const program = new Command();

program
  .name('douban')
  .description('豆瓣命令行工具（电影 / 书籍 / 用户）')
  .version('0.2.0');

program.configureHelp({
  formatHelp: (cmd) => {
    const title = `douban - 豆瓣命令行工具 v${cmd.version()}\n`;
    const usage = `用法: douban <command> [options]\n`;

    const groups: Record<string, string[]> = {
      '电影': ['hot', 'tv', 'rank', 'top250', 'now', 'coming', 'weekly', 'movie', 'rating', 'reviews', 'comments', 'celebrity'],
      '书籍': ['book'],
      '用户': ['me', 'user', 'config', 'list', 'login', 'whoami', 'logout', 'mark', 'unmark', 'rate', 'comment', 'review', 'feed', 'stats', 'export', 'follow', 'unfollow'],
      '搜索': ['search']
    };

    let output = title + usage + '\n';
    const cmds = cmd.commands;

    for (const [group, names] of Object.entries(groups)) {
      const matched = cmds.filter((c) => names.includes(c.name()));
      if (matched.length === 0) continue;

      output += `${group}:\n`;
      for (const c of matched) {
        output += `  ${c.name().padEnd(16)} ${c.description().replace('，需要登录', '').trim()}\n`;
      }
      output += '\n';
    }

    output += '示例:\n';
    output += '  douban hot             查看热门电影\n';
    output += '  douban search 沙丘     搜索电影\n';
    output += '  douban top250          豆瓣 Top 250\n';
    output += '  douban movie 1292052   查看电影详情\n';

    return output;
  }
});

registerMovieCommands(program);
registerBookCommands(program);
registerUserCommands(program);
registerCelebrityCommands(program);
registerListCommands(program);
registerAuthCommands(program);
registerMarkCommands(program);
registerSocialCommands(program);

program.parseAsync().catch((error) => {
  handleProgramError(error);
});
