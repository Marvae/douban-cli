// The encrypted local session cache. AES-256-GCM; the key is derived from the
// current username, hostname and home directory so a copied file is not
// plaintext. That is not a password: anyone with the file and those machine
// values can decrypt it.
import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveCliStoragePaths } from '../storage/paths.js';
import {
  ensurePrivateDirectory,
  migratePrivateFile,
  secureAtomicWriteFile
} from '../storage/secure-file.js';
import {
  type AuthSession,
  asObject,
  normalizeAuthCookieValue,
  normalizeDisplayText,
  buildCookieHeader,
  reportRecoverableError
} from './cookies.js';

interface EncryptedAuthCache {
  version: 1 | 2;
  source?: string;
  updatedAt?: string;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}
const AUTH_CACHE_MAX_BYTES = 64 * 1024;
export const AUTH_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_CACHE_CLOCK_SKEW_MS = 5 * 60 * 1000;
class InvalidAuthCacheError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidAuthCacheError';
  }
}

function parseEncryptedAuthCache(raw: unknown): EncryptedAuthCache | null {
  const obj = asObject(raw);
  if (!obj) return null;

  if (obj.version !== 1 && obj.version !== 2) return null;

  const source = typeof obj.source === 'string' ? obj.source : '';
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : '';
  const salt = typeof obj.salt === 'string' ? obj.salt : '';
  const iv = typeof obj.iv === 'string' ? obj.iv : '';
  const tag = typeof obj.tag === 'string' ? obj.tag : '';
  const data = typeof obj.data === 'string' ? obj.data : '';

  if (obj.version === 1 && (!source || !updatedAt)) return null;
  if (!salt || !iv || !tag || !data) return null;

  return {
    version: obj.version,
    ...(obj.version === 1 ? { source, updatedAt } : {}),
    salt,
    iv,
    tag,
    data
  };
}
function parseAuthSession(raw: unknown): AuthSession | null {
  const obj = asObject(raw);
  if (!obj) return null;

  const dbcl2 = typeof obj.dbcl2 === 'string'
    ? normalizeAuthCookieValue(obj.dbcl2, true)
    : null;
  if (!dbcl2) return null;

  const ck = typeof obj.ck === 'string'
    ? normalizeAuthCookieValue(obj.ck) ?? undefined
    : undefined;
  const source = normalizeDisplayText(obj.source) ?? 'Browser';
  const accountId = normalizeDisplayText(obj.accountId);
  const accountName = normalizeDisplayText(obj.accountName);
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt.trim() : '';
  if (!updatedAt) return null;
  const cookies = buildCookieHeader(dbcl2, ck);

  return {
    dbcl2,
    ck,
    cookies,
    source,
    accountId,
    accountName,
    updatedAt
  };
}
function machineSecret(): Buffer {
  const payload = `${os.userInfo().username}|${os.hostname()}|${os.homedir()}|douban-cli`;
  return createHash('sha256').update(payload).digest();
}
function deriveCacheKey(salt: Buffer): Buffer {
  const secret = machineSecret();
  try {
    return pbkdf2Sync(secret, salt, 120000, 32, 'sha256');
  } finally {
    secret.fill(0);
  }
}
function encryptCache(auth: AuthSession): EncryptedAuthCache {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveCacheKey(salt);
  const plaintext = Buffer.from(JSON.stringify(auth), 'utf8');
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      version: 2,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: ciphertext.toString('base64')
    };
  } finally {
    plaintext.fill(0);
    key.fill(0);
  }
}
function decryptCache(payload: EncryptedAuthCache): AuthSession {
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const data = Buffer.from(payload.data, 'base64');
  const key = deriveCacheKey(salt);
  let plaintext: Buffer | undefined;

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    const decoded = JSON.parse(plaintext.toString('utf8')) as unknown;
    const session = parseAuthSession(decoded);
    if (!session) throw new InvalidAuthCacheError('登录缓存内容无效');
    return session;
  } catch (error) {
    if (error instanceof InvalidAuthCacheError) throw error;
    throw new InvalidAuthCacheError('登录缓存无法解密', { cause: error });
  } finally {
    plaintext?.fill(0);
    key.fill(0);
  }
}
function decodeAuthCache(contents: string): AuthSession {
  try {
    const raw = JSON.parse(contents) as unknown;
    const parsed = parseEncryptedAuthCache(raw);
    if (!parsed) throw new InvalidAuthCacheError('登录缓存格式无效');
    return decryptCache(parsed);
  } catch (error) {
    if (error instanceof InvalidAuthCacheError) throw error;
    throw new InvalidAuthCacheError('登录缓存不是有效的 JSON', { cause: error });
  }
}
/** Set when readAuthCache discards a cache older than AUTH_CACHE_MAX_AGE_MS. */
let discardedExpiredCache = false;
function isExpiredAuthSession(session: AuthSession): boolean {
  const updatedAt = Date.parse(session.updatedAt);
  if (!Number.isFinite(updatedAt)) return true;
  const age = Date.now() - updatedAt;
  return age > AUTH_CACHE_MAX_AGE_MS || age < -AUTH_CACHE_CLOCK_SKEW_MS;
}
function unlinkIfExists(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export function readAuthCache(): AuthSession | null {
  const storagePaths = resolveCliStoragePaths();
  let cachePath = storagePaths.authCachePath;
  let migrationFailed = false;

  try {
    migratePrivateFile(
      storagePaths.legacyAuthCachePath,
      storagePaths.authCachePath,
      (contents) => {
        decodeAuthCache(contents);
      }
    );
  } catch (error) {
    if (error instanceof InvalidAuthCacheError) {
      reportRecoverableError('旧登录缓存无效，已忽略', error);
      try {
        unlinkIfExists(storagePaths.legacyAuthCachePath);
      } catch (unlinkError) {
        reportRecoverableError('清理无效旧登录缓存失败', unlinkError);
      }
      return null;
    }
    migrationFailed = true;
    cachePath = storagePaths.legacyAuthCachePath;
    reportRecoverableError('迁移登录缓存失败，继续使用旧缓存', error);
  }

  try {
    const stat = lstatSync(cachePath);
    if (stat.isSymbolicLink()) {
      throw new Error('登录缓存不能是符号链接');
    }
    if (!stat.isFile()) {
      throw new Error('登录缓存不是普通文件');
    }
    if (stat.size > AUTH_CACHE_MAX_BYTES) {
      throw new InvalidAuthCacheError('登录缓存文件过大');
    }
    if ((stat.mode & 0o077) !== 0) chmodSync(cachePath, 0o600);

    const session = decodeAuthCache(readFileSync(cachePath, 'utf8'));
    if (isExpiredAuthSession(session)) {
      unlinkIfExists(cachePath);
      discardedExpiredCache = true;
      return null;
    }
    if (!migrationFailed && cachePath !== storagePaths.legacyAuthCachePath) {
      try {
        unlinkIfExists(storagePaths.legacyAuthCachePath);
      } catch (error) {
        reportRecoverableError('清理旧登录缓存失败', error);
      }
    }
    return session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    reportRecoverableError('读取登录缓存失败', error);
    if (!migrationFailed && error instanceof InvalidAuthCacheError) {
      try {
        unlinkIfExists(cachePath);
        return readAuthCache();
      } catch (clearError) {
        reportRecoverableError('清理无效登录缓存失败', clearError);
      }
    }
    return null;
  }
}
export function saveAuthCache(auth: AuthSession): void {
  const { authCachePath } = resolveCliStoragePaths();
  const encrypted = encryptCache(auth);
  ensurePrivateDirectory(path.dirname(authCachePath));
  secureAtomicWriteFile(authCachePath, `${JSON.stringify(encrypted, null, 2)}\n`);
}
export function clearAuthCache(): void {
  const { authCachePath, legacyAuthCachePath } = resolveCliStoragePaths();
  let firstError: unknown;

  for (const cachePath of new Set([authCachePath, legacyAuthCachePath])) {
    try {
      unlinkIfExists(cachePath);
    } catch (error) {
      if (firstError === undefined) firstError = error;
    }
  }

  if (firstError !== undefined) throw firstError;
}

/** Whether the last cache read dropped a session older than 30 days. */
export function expiredCacheDiscarded(): boolean {
  return discardedExpiredCache;
}
