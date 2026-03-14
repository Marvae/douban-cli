#!/usr/bin/env node
import { Command } from 'commander';
import { registerBookCommands } from './commands/book.js';
import { registerCelebrityCommands } from './commands/celebrity.js';
import { registerListCommands } from './commands/list.js';
import { registerMovieCommands } from './commands/movie.js';
import { registerUserCommands } from './commands/user.js';
import { registerMarkCommands } from './commands/mark.js';

const program = new Command();

program
  .name('douban')
  .description('Douban CLI - browse movies, books, and user collections')
  .version('0.2.0');

registerMovieCommands(program);
registerBookCommands(program);
registerUserCommands(program);
registerCelebrityCommands(program);
registerListCommands(program);
registerMarkCommands(program);

program.parseAsync().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
