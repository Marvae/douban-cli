#!/usr/bin/env node
import { Command, Help } from 'commander';
import { createRequire } from 'node:module';
import { registerBookCommands } from './commands/book.js';

import { registerListCommands } from './commands/list.js';
import { registerMovieCommands } from './commands/movie.js';
import { registerUserCommands } from './commands/user.js';
import { registerMarkCommands } from './commands/mark.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerSocialCommands } from './commands/social.js';
import { handleProgramError } from './utils/error.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: string };

const program = new Command();

program
  .name('douban')
  .description('豆瓣命令行工具（电影 / 图书 / 豆列 / 账号）')
  .helpCommand(false)
  .version(pkg.version || '0.0.0', '-V, --version', '显示版本')
  .helpOption('-h, --help', '显示帮助')
  .exitOverride()
  .configureOutput({
    // Commander errors are rendered by the shared CLI error handler below.
    outputError: () => undefined
  });

// Registration order sets the help group order: movies, books, users and
// doulists, account, writes.
registerMovieCommands(program);
const bookCommand = registerBookCommands(program);
registerUserCommands(program);
registerListCommands(program);
registerAuthCommands(program);
registerMarkCommands(program, bookCommand);
registerSocialCommands(program);

const defaultHelp = new Help();
program.configureHelp({
  visibleCommands: (command) => {
    const visibleCommands = defaultHelp.visibleCommands(command);
    if (command !== program) return visibleCommands;
    // List `book` subcommands at the root. Book writes follow the movie writes
    // so the 写入操作 group reads movie, then book, then reviews and follows.
    const bookCommands = defaultHelp.visibleCommands(bookCommand).filter((sub) => sub.name() !== 'help');
    const bookWrites = bookCommands.filter((sub) => sub.helpGroup() === '写入操作:');
    const flattened = visibleCommands.flatMap((sub) => (
      sub === bookCommand ? bookCommands.filter((bookSub) => !bookWrites.includes(bookSub)) : [sub]
    ));
    let lastMovieWrite = -1;
    flattened.forEach((sub, index) => { if (sub.name() === 'record') lastMovieWrite = index; });
    flattened.splice(lastMovieWrite + 1, 0, ...bookWrites);
    return flattened;
  },
  subcommandTerm: (command) => (
    command.parent === bookCommand
      ? `book ${defaultHelp.subcommandTerm(command)}`
      : defaultHelp.subcommandTerm(command)
  )
});

program.addHelpText('beforeAll', () => `douban - 豆瓣命令行工具 v${program.version()}\n`);
program.addHelpText('after', () => `
示例:
  douban now                     正在热映
  douban movie 沙丘              电影详情（ID 或片名）
  douban book info 三体          图书详情（ID、ISBN 或书名）
  douban list 240962             读取豆列
  douban login                   登录后可标记、评分、写短评
  douban <命令> --help           查看某个命令的完整参数
  文档: https://github.com/Marvae/douban-cli#readme
`);

program.parseAsync().catch((error) => {
  handleProgramError(error);
});
