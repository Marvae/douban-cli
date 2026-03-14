#!/usr/bin/env node
import { Command } from 'commander';
import {
  getHot,
  getRank,
  getTop250,
  getNowPlaying,
  getUserCollection,
  searchMovies,
  getMovieDetail,
  GENRES,
  CITIES
} from './api.js';

const program = new Command();

program
  .name('douban')
  .description('Douban CLI - browse movies, TV shows, and user collections')
  .version('0.1.0');

// Hot movies/TV
program
  .command('hot')
  .description('Get trending movies or TV shows')
  .option('--tv', 'Show TV shows instead of movies')
  .option('-t, --tag <tag>', 'Filter by tag (热门/美剧/日剧/韩剧/国产剧/综艺/最新)', '热门')
  .option('-n, --limit <n>', 'Number of results', '20')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const type = opts.tv ? 'tv' : 'movie';
    const items = await getHot(type, opts.tag, parseInt(opts.limit));
    
    if (opts.json) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      console.log(`\n🔥 热门${opts.tv ? '剧集' : '电影'} (${opts.tag})\n`);
      items.forEach((item, i) => {
        const rating = item.rate ? `⭐${item.rate}` : '';
        console.log(`${(i + 1).toString().padStart(2)}. ${item.title} ${rating}`);
      });
    }
  });

// TV by region/type
program
  .command('tv <tag>')
  .description('Get TV shows by tag (美剧/日剧/韩剧/国产剧/综艺)')
  .option('-n, --limit <n>', 'Number of results', '20')
  .option('--json', 'Output as JSON')
  .action(async (tag, opts) => {
    const items = await getHot('tv', tag, parseInt(opts.limit));
    
    if (opts.json) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      console.log(`\n📺 ${tag}\n`);
      items.forEach((item, i) => {
        const rating = item.rate ? `⭐${item.rate}` : '';
        console.log(`${(i + 1).toString().padStart(2)}. ${item.title} ${rating}`);
      });
    }
  });

// Genre ranking
program
  .command('rank <genre>')
  .description('Get top rated movies by genre (科幻/动作/爱情/动画/悬疑...)')
  .option('-n, --limit <n>', 'Number of results', '20')
  .option('--json', 'Output as JSON')
  .action(async (genre, opts) => {
    const typeId = GENRES[genre];
    if (!typeId) {
      console.error(`Unknown genre: ${genre}`);
      console.error(`Available: ${Object.keys(GENRES).join(', ')}`);
      process.exit(1);
    }
    
    const items = await getRank(typeId, parseInt(opts.limit));
    
    if (opts.json) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      console.log(`\n🏆 ${genre}片排行\n`);
      items.forEach((item, i) => {
        console.log(`${(i + 1).toString().padStart(2)}. ${item.title} ⭐${item.score} (${item.vote_count.toLocaleString()}人评价)`);
      });
    }
  });

// Top 250
program
  .command('top250')
  .description('Get Douban Top 250 movies')
  .option('-n, --limit <n>', 'Number of results', '25')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const items = await getTop250(0, parseInt(opts.limit));
    
    if (opts.json) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      console.log('\n🎬 豆瓣 Top 250\n');
      items.forEach((item, i) => {
        console.log(`${(i + 1).toString().padStart(2)}. ${item.title} ⭐${item.rating}`);
      });
    }
  });

// Now playing
program
  .command('now')
  .description('Get now playing movies')
  .option('-c, --city <city>', 'City name (北京/上海/苏州/...)', '北京')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const cityCode = CITIES[opts.city] || opts.city;
    const items = await getNowPlaying(cityCode);
    
    if (opts.json) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      console.log(`\n🎬 ${opts.city}正在热映\n`);
      items.forEach((item, i) => {
        const score = item.score !== '-' ? `⭐${item.score}` : '';
        console.log(`${(i + 1).toString().padStart(2)}. ${item.title} ${score}`);
      });
    }
  });

// User collection
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

// Search movies
program
  .command('search <keyword>')
  .description('Search movies by keyword')
  .option('-s, --start <n>', 'Start offset', '0')
  .option('-n, --limit <n>', 'Number of results', '20')
  .option('--json', 'Output as JSON')
  .action(async (keyword, opts) => {
    const items = await searchMovies(keyword, parseInt(opts.start), parseInt(opts.limit));

    if (opts.json) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      console.log(`\n🔍 搜索: ${keyword}\n`);
      if (items.length === 0) {
        console.log('No results found.');
        return;
      }
      items.forEach((item, i) => {
        const rating = item.rating && item.rating !== '-' ? `⭐${item.rating}` : '';
        const year = item.year ? ` (${item.year})` : '';
        console.log(`${(i + 1).toString().padStart(2)}. ${item.title}${year} ${rating}`.trim());
        if (item.id) console.log(`    ID: ${item.id}`);
      });
    }
  });

// Movie detail
program
  .command('movie <id>')
  .description('Get movie detail by subject id')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    const detail = await getMovieDetail(id);

    if (opts.json) {
      console.log(JSON.stringify(detail, null, 2));
    } else {
      console.log(`\n🎬 ${detail.title}`);
      console.log(`ID: ${detail.id}`);
      console.log(`评分: ${detail.rating || '-'}`);
      console.log(`导演: ${detail.directors.length > 0 ? detail.directors.join(' / ') : '-'}`);
      console.log(`演员: ${detail.actors.length > 0 ? detail.actors.join(' / ') : '-'}`);
      console.log(`\n简介:\n${detail.summary || '-'}`);
      console.log(`\n链接: ${detail.url}`);
    }
  });

program.parseAsync().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
