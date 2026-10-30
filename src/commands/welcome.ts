import { detectAuthSession } from '../auth/index.js';
import { getDisplayWidth, padDisplayEnd } from '../ui/text.js';

const COMMON_COMMANDS: Array<[string, string]> = [
  ['douban trending', '豆瓣实时热门（每小时更新）'],
  ['douban now', '正在热映'],
  ['douban top250', '豆瓣电影 Top250'],
  ['douban movie 沙丘', '电影详情（ID 或片名），附相似推荐'],
  ['douban comments 沙丘', '热门短评'],
  ['douban book info 三体', '图书详情（ID、ISBN 或书名）'],
  ['douban list 240962', '读取豆列'],
  ['douban export -o me.json', '备份自己的看过/想看/在看（需登录）']
];

async function loginStatus(): Promise<string> {
  const session = await detectAuthSession().catch(() => null);
  if (!session) return '未登录 · 运行 douban login 后可以标记、评分、写短评，并导出自己的记录';
  const daysLeft = 30 - Math.floor((Date.now() - Date.parse(session.updatedAt)) / 86_400_000);
  const who = session.accountName || session.accountId || '已登录';
  return `已登录：${who}${daysLeft <= 3 ? ` · ${Math.max(daysLeft, 0)} 天内过期，到时运行 douban login` : ''}`;
}

/** Shown when `douban` runs without arguments; reads only the local login cache. */
export async function printWelcome(version: string): Promise<void> {
  const width = Math.max(...COMMON_COMMANDS.map(([command]) => getDisplayWidth(command))) + 4;
  console.log(`douban-cli ${version} · 在终端和 AI 里用豆瓣\n`);
  console.log('常用命令');
  for (const [command, description] of COMMON_COMMANDS) {
    console.log(`  ${padDisplayEnd(command, width)}${description}`);
  }
  console.log(`\n${await loginStatus()}`);
  console.log('全部命令：douban --help');
}
