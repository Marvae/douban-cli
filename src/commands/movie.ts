import { Command } from 'commander';
import {
  GENRES,
  getComing,
  getComments,
  getHot,
  getMovieDetail,
  getNowShowing,
  getRank,
  getRatingStats,
  getReviews,
  getTop250,
  getWeekly
} from '../api/movie.js';
import { searchMovies } from '../api/search.js';
import { getTrending, TRENDING_LIMIT } from '../api/trending.js';
import { getOptionalSessionCookies } from '../auth/index.js';
import { CliArgumentError, printWarnings, withErrorHandler } from '../utils/error.js';
import {
  getPageRange,
  pageToOffset,
  parseNonNegativeInt,
  parsePositiveInt,
  parsePositiveIntAtMost
} from '../utils/parsing.js';
import { withSpinner } from '../ui/spinner.js';
import {
  compactNumber,
  formatTrend,
  idColumn,
  printListHeading,
  printPosts,
  printRatingBars,
  renderTable,
  subjectLabel
} from '../ui/output.js';
import { withPagination } from '../ui/pagination.js';
import { resolveSubject } from './resolve.js';

const TV_TAGS = ['热门', '美剧', '英剧', '日剧', '韩剧', '国产剧', '综艺', '最新'] as const;

function normalizeDate(value: string | undefined): string {
  if (!value) return '-';
  const trimmed = value.trim();

  const cnMatch = trimmed.match(/(\d{1,2})月(\d{1,2})日?/);
  if (cnMatch) {
    return `${cnMatch[1].padStart(2, '0')}-${cnMatch[2].padStart(2, '0')}`;
  }

  const dashMatch = trimmed.match(/\d{4}[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (dashMatch) {
    return `${dashMatch[1].padStart(2, '0')}-${dashMatch[2].padStart(2, '0')}`;
  }

  return trimmed;
}

function normalizeYear(value: string | undefined): string {
  if (!value) return '-';
  const match = value.match(/(19|20)\d{2}/);
  return match ? match[0] : '-';
}

function formatTags(values: string[] | undefined): string {
  if (!values || values.length === 0) return '-';
  return values.join('/');
}

function formatRegion(values: string[] | undefined): string {
  if (!values || values.length === 0) return '-';
  return values.join('/');
}

function formatDetailList(values: string[] | undefined): string {
  if (!values || values.length === 0) return '-';
  return values.join(' / ');
}

export function registerMovieCommands(program: Command): void {
  program
    .command('hot')
    .helpGroup('电影:')
    .description('热门电影，加 --tv 看剧集')
    .option('--tv', '显示剧集而非电影')
    .option('-t, --tag <tag>', '按标签筛选（热门/美剧/英剧/日剧/韩剧/国产剧/综艺/最新）', '热门')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'hot',
      options: `标签：${TV_TAGS.join('、')}`,
      suggestion: '可尝试：douban hot -t 热门'
    }, async (opts) => {
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const type = opts.tv ? 'tv' : 'movie';
      const items = await withSpinner(
        `正在获取热门${opts.tv ? '剧集' : '电影'}...`,
        () => getHot(type, opts.tag, limit),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n🔥 热门${opts.tv ? '剧集' : '电影'} (${opts.tag})\n`);
        renderTable(items, [
          { header: '#', value: (_, i) => String(i + 1), minWidth: 2 },
          { header: '片名', value: (item) => item.title, minWidth: 18 },
          { header: '评分', value: (item) => item.rating },
          idColumn()
        ]);
      }
    }));

  program
    .command('trending')
    .helpGroup('电影:')
    .description('豆瓣实时热门（书影音综合，--movie / --tv 看分榜，每小时更新）')
    .option('--movie', '只看电影榜')
    .option('--tv', '只看电视榜（剧集和综艺）')
    .option('-n, --limit <n>', `返回数量（最多 ${TRENDING_LIMIT}）`, String(TRENDING_LIMIT))
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'trending',
      suggestion: '可尝试：douban trending --tv'
    }, async (opts) => {
      if (opts.movie && opts.tv) throw new CliArgumentError('--movie 与 --tv 不能同时使用');
      const chart = opts.movie ? 'movie' : opts.tv ? 'tv' : 'all';
      const limit = parsePositiveIntAtMost(opts.limit, '--limit', TRENDING_LIMIT, TRENDING_LIMIT);
      const result = await withSpinner('正在获取实时热门...', () => getTrending(chart, limit), !opts.json);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      // The 书影音 chart reports an updated_at hours older than its items, so the heading does not show it.
      console.log(`\n🔥 ${result.name} · 每小时更新\n`);
      renderTable(result.items, [
        { header: '#', value: (item) => String(item.rank), minWidth: 2 },
        { header: '变化', value: (item) => formatTrend(item.trend) || '—' },
        { header: '片名', value: (item) => item.title, maxWidth: 24 },
        { header: '类型', value: (item) => item.type_name },
        { header: '评分', value: (item) => item.rating },
        { header: '热度', value: (item) => compactNumber(item.heat) },
        idColumn()
      ]);
    }));

  program
    .command('tv <tag>')
    .helpGroup('电影:')
    .description('按标签看剧集（美剧/日剧/韩剧/国产剧/综艺…）')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'tv',
      target: `标签: ${String(args[0] || '未指定')}`,
      options: TV_TAGS.join('、'),
      suggestion: '可尝试：douban tv 美剧'
    }), async (tag, opts) => {
      if (!TV_TAGS.includes(tag as (typeof TV_TAGS)[number])) {
        throw new CliArgumentError('不支持这个标签');
      }
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const items = await withSpinner(
        `正在获取${tag}剧集...`,
        () => getHot('tv', tag, limit),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n📺 ${tag}\n`);
        renderTable(items, [
          { header: '#', value: (_, i) => String(i + 1), minWidth: 2 },
          { header: '片名', value: (item) => item.title, minWidth: 18 },
          { header: '评分', value: (item) => item.rating },
          idColumn()
        ]);
      }
    }));

  program
    .command('rank <genre>')
    .helpGroup('电影:')
    .description('各类型高分电影（科幻/动作/爱情/动画/悬疑…）')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'rank',
      target: `类型: ${String(args[0] || '未指定')}`,
      options: Object.keys(GENRES).join('、'),
      suggestion: '可尝试：douban rank 科幻'
    }), async (genre, opts) => {
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const typeId = GENRES[genre];
      if (!typeId) {
        throw new CliArgumentError('不支持这个类型');
      }

      const items = await withSpinner(
        `正在获取${genre}排行...`,
        () => getRank(typeId, limit),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n🏆 ${genre}片排行\n`);
        renderTable(items, [
          { header: '#', value: (_, i) => String(i + 1), minWidth: 2 },
          { header: '片名', value: (item) => item.title, minWidth: 18 },
          { header: '年份', value: (item) => normalizeYear(item.release_date) },
          { header: '类型', value: (item) => formatTags(item.types), minWidth: 14 },
          { header: '评分', value: (item) => item.rating },
          { header: '评价', value: (item) => compactNumber(item.rating_count) },
          idColumn()
        ]);
      }
    }));

  program
    .command('top250')
    .helpGroup('电影:')
    .description('豆瓣电影 Top250')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '每页数量', '25')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'top250',
      suggestion: '可尝试：douban top250 -n 10 --page 2'
    }, async (opts) => {
      const total = 250;
      const limit = parsePositiveIntAtMost(opts.limit, '--limit', 25, total);
      const page = parsePositiveIntAtMost(opts.page, '--page', 1, Math.ceil(total / limit));

      if (opts.json) {
        const start = pageToOffset(page, limit);
        const items = await withSpinner(
          '正在获取豆瓣 Top 250...',
          () => getTop250(start, limit),
          false
        );
        console.log(JSON.stringify(items, null, 2));
        return;
      }

      await withPagination({
        startPage: page,
        pageSize: limit,
        fetchPage: async (currentPage) => {
          const start = pageToOffset(currentPage, limit);
          const items = await withSpinner(
            '正在获取豆瓣 Top 250...',
            () => getTop250(start, limit),
            true
          );
          return {
            items,
            total,
            hasMore: start + items.length < total
          };
        },
        renderPage: (items, currentPage) => {
          const { from, to } = getPageRange(currentPage, limit, items.length);

          console.log(`\n🎬 豆瓣电影 Top250 · 第 ${from}-${to} 部\n`);
          renderTable(items, [
            { header: '#', value: (item) => String(item.rank), minWidth: 3 },
            { header: '片名', value: (item) => item.title, minWidth: 14 },
            { header: '年份', value: (item) => item.year || '-', minWidth: 4 },
            { header: '评分', value: (item) => item.rating || '-', minWidth: 4 },
            { header: '导演', value: (item) => item.director, maxWidth: 20 },
            idColumn()
          ]);
        }
      });
    }));

  program
    .command('now')
    .helpGroup('电影:')
    .description('正在热映（全国）')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'now',
      suggestion: '可尝试：douban now -n 10'
    }, async (opts) => {
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const items = await withSpinner('正在获取正在热映电影...', () => getNowShowing(limit), !opts.json);

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log('\n🍿 正在热映\n');
        renderTable(items, [
          { header: '#', value: (_, i) => String(i + 1), minWidth: 2 },
          { header: '片名', value: (item) => item.title, minWidth: 18 },
          { header: '评分', value: (item) => item.rating },
          { header: '上映', value: (item) => item.release_date },
          idColumn()
        ]);
      }
    }));

  program
    .command('coming')
    .helpGroup('电影:')
    .description('即将上映')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'coming',
      suggestion: '可尝试：douban coming -n 30'
    }, async (opts) => {
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const items = await withSpinner(
        '正在获取即将上映电影...',
        () => getComing(limit),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log('\n📅 即将上映\n');
        renderTable(items, [
          { header: '#', value: (_, i) => String(i + 1), minWidth: 2 },
          { header: '片名', value: (item) => item.title, minWidth: 18 },
          { header: '日期', value: (item) => normalizeDate(item.release_date) },
          { header: '类型', value: (item) => formatTags(item.types), minWidth: 16 },
          { header: '地区', value: (item) => formatRegion(item.regions), minWidth: 10 },
          { header: '想看', value: (item) => compactNumber(item.wish_count) },
          idColumn()
        ]);
      }
    }));

  program
    .command('weekly')
    .helpGroup('电影:')
    .description('一周口碑榜')
    .option('-n, --limit <n>', '返回数量', '10')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({
      command: 'weekly',
      suggestion: '可尝试：douban weekly'
    }, async (opts) => {
      const limit = parsePositiveInt(opts.limit, '--limit', 10);
      const items = await withSpinner(
        '正在获取一周口碑榜...',
        () => getWeekly(limit),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log('\n📈 一周口碑榜\n');
        renderTable(items, [
          { header: '#', value: (item) => String(item.rank), minWidth: 2 },
          { header: '片名', value: (item) => item.title, minWidth: 18 },
          { header: '变化', value: (item) => formatTrend(item.trend) || '—' },
          idColumn()
        ]);
      }
    }));

  program
    .command('search <keyword>')
    .helpGroup('电影:')
    .description('搜索电影和剧集')
    .option('-s, --start <n>', '起始偏移', '0')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'search',
      target: `关键词: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban search 沙丘'
    }), async (keyword, opts) => {
      const start = parseNonNegativeInt(opts.start, '--start', 0);
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const warnings: string[] = [];
      const cookies = await getOptionalSessionCookies();
      const items = await withSpinner(
        `正在搜索“${keyword}”...`,
        () => searchMovies(keyword, start, limit, { cookies, warnings }),
        !opts.json
      );
      printWarnings(warnings);

      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
      } else {
        console.log(`\n🔍 搜索: ${keyword}\n`);
        if (items.length === 0) {
          console.log('未找到相关结果。');
          return;
        }

        renderTable(items, [
          { header: '#', value: (_, i) => String(i + 1), minWidth: 2 },
          { header: '片名', value: (item) => item.title, minWidth: 18 },
          { header: '类型', value: (item) => (item.type === 'tv' ? '剧集' : item.type === 'movie' ? '电影' : '-') },
          { header: '年份', value: (item) => normalizeYear(item.year) },
          { header: '评分', value: (item) => (item.rating && item.rating !== '-' ? item.rating : '-') },
          idColumn()
        ]);
      }
    }));

  program
    .command('movie <id-or-title>')
    .helpGroup('电影:')
    .description('电影详情和相似推荐（ID 或片名）')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'movie',
      target: `ID: ${String(args[0] || '未指定')}`,
      suggestion: '确认 ID 是否正确，可使用 douban search 搜索'
    }), async (id, opts) => {
      const { id: movieId } = await resolveSubject('movie', id, Boolean(opts.json));

      const detail = await withSpinner(
        '正在获取电影详情...',
        () => getMovieDetail(movieId),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(detail, null, 2));
      } else {
        const titleSuffix = detail.year ? ` (${detail.year})` : '';
        const originalTitle = detail.original_title ? ` / ${detail.original_title}` : '';
        const kind = detail.type === 'tv' ? '📺' : '🎬';
        console.log(`\n${kind} ${detail.title}${titleSuffix}${originalTitle}${detail.type === 'tv' ? ' · 剧集' : ''}`);
        console.log(`ID: ${detail.id}`);
        console.log(`评分: ${detail.rating || '-'}`);
        console.log(`类型: ${formatDetailList(detail.genres)}`);
        console.log(`国家: ${formatDetailList(detail.countries)}`);
        console.log(`时长: ${formatDetailList(detail.durations)}`);
        if (detail.episodes_info) {
          console.log(`集数: ${detail.episodes_info}`);
        } else if (detail.episodes_count) {
          console.log(`集数: ${detail.episodes_count}`);
        }
        console.log(`语言: ${formatDetailList(detail.languages)}`);
        console.log(`短评: ${detail.comment_count.toLocaleString()}`);
        console.log(`影评: ${detail.review_count.toLocaleString()}`);
        console.log(`别名: ${formatDetailList(detail.aka)}`);
        console.log(`导演: ${detail.directors.length > 0 ? detail.directors.join(' / ') : '-'}`);
        const actors = detail.actors.slice(0, 8).join(' / ');
        console.log(`演员: ${actors || '-'}${detail.actors.length > 8 ? ` 等 ${detail.actors.length} 人` : ''}`);
        console.log(`\n简介:\n${detail.summary || '-'}`);
        if (detail.recommendations.length > 0) {
          console.log(`\n相似推荐: ${detail.recommendations.map((item) => `${item.title}(${item.rating})`).join(' / ')}`);
        }
        console.log(`\n链接: ${detail.url}`);
      }
    }));

  program
    .command('rating <id-or-title>')
    .helpGroup('电影:')
    .description('评分分布（ID 或片名）')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'rating',
      target: `ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban rating 1292052'
    }), async (id, opts) => {
      const { id: movieId } = await resolveSubject('movie', id, Boolean(opts.json));
      const stats = await withSpinner(
        '正在获取评分分布...',
        () => getRatingStats(movieId),
        !opts.json
      );

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`\n⭐ 评分分布 (${stats.value}分，${compactNumber(stats.count)}人评价)\n`);

        printRatingBars(stats.stars);

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
    }));

  program
    .command('comments <id-or-title>')
    .helpGroup('电影:')
    .description('热门短评（ID 或片名）')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'comments',
      target: `ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban comments 1292052'
    }), async (movieId, opts) => {
      const { id, title } = await resolveSubject('movie', movieId, Boolean(opts.json));
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const page = parsePositiveInt(opts.page, '--page', 1);

      if (opts.json) {
        // JSON mode returns one page without an interactive prompt.
        const start = pageToOffset(page, limit);
        const { items, total } = await withSpinner(
          '正在获取热门短评...',
          () => getComments(id, 'hot', start, limit),
          false
        );
        console.log(JSON.stringify({ items, total }, null, 2));
        return;
      }

      await withPagination({
        startPage: page,
        pageSize: limit,
        fetchPage: async (currentPage) => {
          const start = pageToOffset(currentPage, limit);
          const { items, total } = await withSpinner(
            '正在获取热门短评...',
            () => getComments(id, 'hot', start, limit),
            true
          );
          return {
            items,
            total,
            hasMore: start + items.length < total
          };
        },
        renderPage: (items, currentPage, total) => {
          const start = pageToOffset(currentPage, limit);
          const { from, to } = getPageRange(currentPage, limit, items.length);

          printListHeading(`💬 热门短评 · ${subjectLabel(id, title)}`, total, from, to);
          printPosts(items, start);
        }
      });
    }));

  program
    .command('reviews <id-or-title>')
    .helpGroup('电影:')
    .description('热门影评（ID 或片名）')
    .option('-p, --page <n>', '页码（从 1 开始）', '1')
    .option('-n, --limit <n>', '返回数量', '20')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler((args) => ({
      command: 'reviews',
      target: `ID: ${String(args[0] || '未指定')}`,
      suggestion: '可尝试：douban reviews 1292052 --page 2'
    }), async (movieId, opts) => {
      const { id, title } = await resolveSubject('movie', movieId, Boolean(opts.json));
      const limit = parsePositiveInt(opts.limit, '--limit', 20);
      const page = parsePositiveInt(opts.page, '--page', 1);

      if (opts.json) {
        // JSON mode returns one page without an interactive prompt.
        const start = pageToOffset(page, limit);
        const { items, total } = await withSpinner(
          '正在获取热门影评...',
          () => getReviews(id, start, limit),
          false
        );
        console.log(JSON.stringify({ items, total }, null, 2));
        return;
      }

      await withPagination({
        startPage: page,
        pageSize: limit,
        fetchPage: async (currentPage) => {
          const start = pageToOffset(currentPage, limit);
          const { items, total } = await withSpinner(
            '正在获取热门影评...',
            () => getReviews(id, start, limit),
            true
          );
          return {
            items,
            total,
            hasMore: start + items.length < total
          };
        },
        renderPage: (items, currentPage, total) => {
          const start = pageToOffset(currentPage, limit);
          const { from, to } = getPageRange(currentPage, limit, items.length);

          printListHeading(`📝 热门影评 · ${subjectLabel(id, title)}`, total, from, to);
          printPosts(items, start);
        }
      });
    }));
}
