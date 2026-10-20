import { existsSync, statSync } from 'node:fs';
import { Command } from 'commander';
import { getCurrentUserProfile } from '../api/account.js';
import { getNowShowing } from '../api/movie.js';
import { searchMovies } from '../api/search.js';
import { detectAuthSession } from '../auth.js';
import { resolveCliStoragePaths } from '../storage/paths.js';
import { withErrorHandler } from '../utils/error.js';

const MIN_NODE = [22, 13] as const;

type CheckStatus = 'ok' | 'warn' | 'fail';
interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

function permissionCheck(name: string, file: string): Check {
  if (!existsSync(file)) return { name, status: 'ok', detail: '尚未创建' };
  if (process.platform === 'win32') return { name, status: 'ok', detail: file };
  const mode = statSync(file).mode & 0o777;
  return mode & 0o077
    ? { name, status: 'warn', detail: `${file} 权限为 ${mode.toString(8)}，建议 600` }
    : { name, status: 'ok', detail: file };
}

async function probe(name: string, run: () => Promise<string>): Promise<Check> {
  try {
    return { name, status: 'ok', detail: await run() };
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    const message = error instanceof Error ? error.message : String(error);
    return { name, status: code === 'RATE_LIMITED' ? 'warn' : 'fail', detail: code ? `[${code}] ${message}` : message };
  }
}

async function runDoctor(online: boolean): Promise<Check[]> {
  const checks: Check[] = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
  checks.push({ name: 'Node.js', status: nodeOk ? 'ok' : 'fail', detail: `${process.versions.node}${nodeOk ? '' : `，需要 ${MIN_NODE.join('.')}+`}` });

  const paths = resolveCliStoragePaths();
  checks.push(permissionCheck('登录缓存文件', paths.authCachePath));
  checks.push(permissionCheck('配置文件', paths.configPath));

  const session = await detectAuthSession().catch(() => null);
  if (!session) {
    checks.push({ name: '登录态', status: 'warn', detail: '未登录：公开查询可用，搜索容易被限流；运行 douban login' });
  } else {
    const ageDays = Math.floor((Date.now() - Date.parse(session.updatedAt)) / 86_400_000);
    const who = session.accountName ? `${session.accountName} (${session.accountId})` : session.accountId || '未知账号';
    const left = 30 - ageDays;
    checks.push({ name: '登录态', status: left > 3 ? 'ok' : 'warn', detail: `${who}，来源 ${session.source}，${left > 0 ? `${left} 天后过期` : '已过期'}${left > 3 ? '' : '，请重新运行 douban login'}` });
  }

  if (online) {
    checks.push(await probe('公开接口', async () => `正在热映 ${(await getNowShowing(1)).length > 0 ? '可读取' : '为空'}`));
    checks.push(await probe(session ? '搜索（复用登录态）' : '搜索（匿名）', async () => {
      const items = await searchMovies('肖申克的救赎', 0, 1, { cookies: session?.cookies });
      return items.length > 0 ? '可用' : '无结果';
    }));
    if (session) {
      checks.push(await probe('登录验证', async () => {
        const profile = await getCurrentUserProfile(session.cookies);
        return `已登录为 ${profile.name} (${profile.id})`;
      }));
    }
  }
  return checks;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .helpGroup('工具:')
    .description('检查运行环境、登录态和文件权限；--online 再检查网络、搜索限流和登录有效性')
    .option('--online', '额外发送 2-3 个只读请求，检查公开接口、搜索限流和登录有效性')
    .option('--json', '以 JSON 输出')
    .action(withErrorHandler({ command: 'doctor' }, async (opts) => {
      const checks = await runDoctor(Boolean(opts.online));
      const ok = checks.every((check) => check.status !== 'fail');
      if (opts.json) {
        console.log(JSON.stringify({ ok, checks }, null, 2));
      } else {
        const icon: Record<CheckStatus, string> = { ok: '✓', warn: '⚠️', fail: '✗' };
        checks.forEach((check) => console.log(`${icon[check.status]} ${check.name}: ${check.detail}`));
        if (!opts.online) console.log('\n加 --online 可检查网络、搜索限流和登录是否仍然有效。');
      }
      if (!ok) process.exitCode = 1;
    }));
}
