import { Command } from 'commander';
import {
  CITIES,
  GENRES,
  getComing,
  getComments,
  getHot,
  getMovieDetail,
  getNowPlaying,
  getRank,
  getRatingStats,
  getReviews,
  getTop250,
  getWeekly,
  searchMovies
} from '../api/index.js';

export function registerMovieCommands(program: Command): void {
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

  program
    .command('rating <id>')
    .description('Get movie rating distribution')
    .option('--json', 'Output as JSON')
    .action(async (id, opts) => {
      const stats = await getRatingStats(id);

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`\n⭐ 评分分布 (${stats.value}分，${stats.count.toLocaleString()}人评价)\n`);

        const labels = ['5星', '4星', '3星', '2星', '1星'];
        const maxPercent = Math.max(...stats.stars);

        stats.stars.slice().reverse().forEach((percent, i) => {
          const barLen = maxPercent > 0 ? Math.round((percent / maxPercent) * 30) : 0;
          const bar = '█'.repeat(barLen);
          console.log(`${labels[i]} ${bar} ${percent}%`);
        });

        console.log('\n📊 统计');
        console.log(`想看: ${stats.wish_count.toLocaleString()}`);
        console.log(`看过: ${stats.done_count.toLocaleString()}`);

        if (stats.type_ranks.length > 0) {
          console.log('\n🏆 类型排名');
          stats.type_ranks.forEach((r) => {
            console.log(`${r.type}: 超过 ${Math.round(r.rank * 100)}% 同类作品`);
          });
        }
      }
    });

  program
    .command('coming')
    .description('Get coming soon movies')
    .option('-n, --limit <n>', 'Number of results', '20')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const items = await getComing(parseInt(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log('\n📅 即将上映\n');
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.title} (${item.release_date})`);
          console.log(`    类型: ${item.types.join(' / ') || '-'}`);
          console.log(`    地区: ${item.regions.join(' / ') || '-'}`);
          console.log(`    想看: ${item.wish_count}`);
        });
      }
    });

  program
    .command('weekly')
    .description('Get weekly reputation chart')
    .option('-n, --limit <n>', 'Number of results', '10')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const items = await getWeekly(parseInt(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log('\n📈 一周口碑榜\n');
        items.forEach((item) => {
          console.log(`${item.rank.toString().padStart(2)}. ${item.title} [${item.trend}]`);
        });
      }
    });

  program
    .command('reviews <movieId>')
    .description('Get hot comments for a movie by subject id')
    .option('-s, --start <n>', 'Start offset', '0')
    .option('-n, --limit <n>', 'Number of results', '20')
    .option('--json', 'Output as JSON')
    .action(async (movieId, opts) => {
      const items = await getReviews(movieId, parseInt(opts.start), parseInt(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n💬 电影短评 ${movieId}\n`);
        if (items.length === 0) {
          console.log('No reviews found.');
          return;
        }
        items.forEach((item, i) => {
          console.log(`${(i + 1).toString().padStart(2)}. ${item.user} ⭐${item.rating} 👍${item.votes} ${item.time}`);
          console.log(`    ${item.content}`);
        });
      }
    });

  program
    .command('comments <movieId>')
    .description('Get short comments/reviews for a movie')
    .option('--latest', 'Sort by latest instead of hot')
    .option('-s, --start <n>', 'Start offset', '0')
    .option('-n, --limit <n>', 'Number of results', '10')
    .option('--json', 'Output as JSON')
    .action(async (movieId, opts) => {
      const orderBy = opts.latest ? 'latest' : 'hot';
      const items = await getComments(movieId, orderBy, parseInt(opts.start), parseInt(opts.limit));

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n💬 ${opts.latest ? '最新' : '热门'}短评 (${movieId})\n`);
        if (items.length === 0) {
          console.log('暂无短评');
          return;
        }
        items.forEach((item, i) => {
          const stars = item.rating ? '⭐'.repeat(item.rating) : '';
          console.log(`${(i + 1).toString().padStart(2)}. ${item.user} ${stars} 👍${item.votes}`);
          console.log(`    ${item.content}`);
          console.log(`    ${item.time}\n`);
        });
      }
    });
}
