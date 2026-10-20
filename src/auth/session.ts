// Verifying and using the saved session.
import { getCurrentUserProfile } from '../api/account.js';
import {
  AUTH_CACHE_MAX_AGE_MS,
  readAuthCache,
  saveAuthCache,
  clearAuthCache,
  expiredCacheDiscarded
} from './cache.js';
import { type AuthSession, type VerifiedAuthSession, stripControlCharacters } from './cookies.js';

const EXPIRY_WARNING_DAYS = 3;
async function verifyAuthSession(session: AuthSession): Promise<VerifiedAuthSession> {
  const profile = await getCurrentUserProfile(session.cookies);
  const accountId = stripControlCharacters(profile.id);
  const accountName = stripControlCharacters(profile.name);
  if (!accountId || !accountName) {
    throw new Error('豆瓣账号信息无效');
  }
  return {
    ...session,
    accountId,
    accountName
  };
}
export async function selectVerifiedSession(candidates: AuthSession[]): Promise<VerifiedAuthSession> {
  const verified: VerifiedAuthSession[] = [];
  const failures: Array<{ source: string; error: unknown }> = [];

  for (const candidate of candidates) {
    try {
      verified.push(await verifyAuthSession(candidate));
    } catch (error) {
      failures.push({ source: candidate.source, error });
    }
  }

  if (verified.length === 0) {
    const firstFailure = failures[0]?.error;
    if (failures.length === 1) {
      throw firstFailure instanceof Error ? firstFailure : new Error(String(firstFailure));
    }
    throw new Error('未找到可验证的豆瓣登录态，请确认登录完成后重试', {
      cause: firstFailure instanceof Error ? firstFailure : undefined
    });
  }

  if (candidates.length > 1 && failures.length > 0) {
    throw new Error(`部分浏览器登录态无法验证（${failures.map(({ source }) => source).join(', ')}），请使用 --browser 并按需配合 --profile 明确选择`, {
      cause: failures[0]?.error instanceof Error ? failures[0].error : undefined
    });
  }

  const accounts = new Map<string, VerifiedAuthSession[]>();
  for (const session of verified) {
    const accountId = session.accountId;
    const bucket = accounts.get(accountId) || [];
    bucket.push(session);
    accounts.set(accountId, bucket);
  }

  if (accounts.size > 1) {
    const choices = verified
      .map((session) => `${session.source}: ${session.accountId}`)
      .join(', ');
    throw new Error(`检测到多个豆瓣账号（${choices}），请使用 --browser 并按需配合 --profile 明确选择`);
  }

  return verified[0];
}
export async function detectAuthSession(): Promise<AuthSession | null> {
  return readAuthCache();
}
/**
 * Cookie header of the local login session, or `undefined` when no session is cached.
 *
 * Never throws or scans browsers. Commands can reuse a cached session for collections
 * that reject anonymous access or expose fewer entries while signed out.
 */
export async function getOptionalSessionCookies(): Promise<string | undefined> {
  try {
    const session = readAuthCache();
    return session?.cookies.trim() || undefined;
  } catch {
    return undefined;
  }
}
export async function ensureAuth(): Promise<VerifiedAuthSession> {
  const cached = readAuthCache();
  if (!cached) {
    throw new Error(expiredCacheDiscarded()
      ? '本地登录已过期（保存超过 30 天）'
      : '还没有登录豆瓣');
  }

  let verified: VerifiedAuthSession;
  try {
    verified = await verifyAuthSession(cached);
  } catch (error) {
    const rejected = error instanceof Error && 'code' in error && error.code === 'AUTH_REQUIRED';
    throw new Error(rejected
      ? '本地登录已失效（可能已在浏览器中退出或修改了密码）'
      : `无法验证本地登录态，已阻止本次操作：${error instanceof Error ? error.message : String(error)}`, {
      cause: error
    });
  }

  const daysLeft = Math.ceil((Date.parse(cached.updatedAt) + AUTH_CACHE_MAX_AGE_MS - Date.now()) / 86_400_000);
  if (daysLeft <= EXPIRY_WARNING_DAYS) {
    console.error(`⚠️ 本地登录将在 ${Math.max(daysLeft, 0)} 天内过期，届时运行 douban login 重新登录`);
  }

  if (cached.accountId && cached.accountId !== verified.accountId) {
    clearAuthCache();
    throw new Error(`登录账号校验失败：缓存账号 ${cached.accountId}，当前账号 ${verified.accountId}。请重新运行 douban login`);
  }

  if (cached.accountId !== verified.accountId || cached.accountName !== verified.accountName) {
    saveAuthCache(verified);
  }
  return verified;
}
