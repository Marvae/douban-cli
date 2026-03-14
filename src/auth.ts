import { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export interface AuthSession {
  dbcl2: string;
  ck?: string;
  cookies: string;
  source: string;
  updatedAt: string;
}

interface EncryptedAuthCache {
  version: 1;
  source: string;
  updatedAt: string;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

const AUTH_CACHE_PATH = path.join(os.homedir(), '.douban-cli-auth.json');
const DOUBAN_LOGIN_URL = 'https://accounts.douban.com/passport/login';

function machineSecret(): Buffer {
  const payload = `${os.userInfo().username}|${os.hostname()}|${os.homedir()}|douban-cli`;
  return createHash('sha256').update(payload).digest();
}

function encryptCache(auth: AuthSession): EncryptedAuthCache {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(machineSecret(), salt, 120000, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(auth), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    source: auth.source,
    updatedAt: auth.updatedAt,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64')
  };
}

function decryptCache(payload: EncryptedAuthCache): AuthSession | null {
  try {
    if (payload.version !== 1) return null;

    const salt = Buffer.from(payload.salt, 'base64');
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const data = Buffer.from(payload.data, 'base64');
    const key = pbkdf2Sync(machineSecret(), salt, 120000, 32, 'sha256');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);

    const parsed = JSON.parse(plaintext.toString('utf8')) as AuthSession;
    if (!parsed || typeof parsed.dbcl2 !== 'string' || !parsed.dbcl2) return null;
    if (typeof parsed.cookies !== 'string' || !parsed.cookies.includes('dbcl2=')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readAuthCache(): AuthSession | null {
  if (!existsSync(AUTH_CACHE_PATH)) return null;

  try {
    const stat = statSync(AUTH_CACHE_PATH);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 30 * 24 * 60 * 60 * 1000) return null;

    const raw = JSON.parse(readFileSync(AUTH_CACHE_PATH, 'utf8')) as EncryptedAuthCache;
    return decryptCache(raw);
  } catch {
    return null;
  }
}

function saveAuthCache(auth: AuthSession): void {
  const encrypted = encryptCache(auth);
  writeFileSync(AUTH_CACHE_PATH, `${JSON.stringify(encrypted, null, 2)}\n`, { mode: 0o600 });
}

function buildCookieHeader(dbcl2: string, ck?: string): string {
  const parts = [`dbcl2=${dbcl2}`];
  if (ck) parts.push(`ck=${ck}`);
  return parts.join('; ');
}

function createSession(dbcl2: string, ck: string | undefined, source: string): AuthSession {
  return {
    dbcl2,
    ck,
    cookies: buildCookieHeader(dbcl2, ck),
    source,
    updatedAt: new Date().toISOString()
  };
}

function withTempSqliteCopy<T>(dbPath: string, fn: (tmpPath: string) => T): T {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'douban-cli-cookie-'));
  const tmpDbPath = path.join(tmpDir, path.basename(dbPath));
  copyFileSync(dbPath, tmpDbPath);

  const wal = `${dbPath}-wal`;
  const shm = `${dbPath}-shm`;
  if (existsSync(wal)) copyFileSync(wal, `${tmpDbPath}-wal`);
  if (existsSync(shm)) copyFileSync(shm, `${tmpDbPath}-shm`);

  try {
    return fn(tmpDbPath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function querySqliteRows(dbPath: string, sql: string): string[][] {
  try {
    const out = execFileSync('sqlite3', ['-readonly', '-separator', '\t', dbPath, sql], { encoding: 'utf8' });
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split('\t'));
  } catch {
    return [];
  }
}

function getKeychainPassword(service: string): string | null {
  try {
    const value = execFileSync('security', ['find-generic-password', '-wa', service], { encoding: 'utf8' }).trim();
    return value || null;
  } catch {
    return null;
  }
}

function decryptChromiumEncryptedValue(encryptedHex: string, keychainService: string): string {
  if (!encryptedHex) return '';

  const raw = Buffer.from(encryptedHex, 'hex');
  if (raw.length === 0) return '';

  if (
    raw.length > 3
    && (raw.subarray(0, 3).equals(Buffer.from('v10')) || raw.subarray(0, 3).equals(Buffer.from('v11')))
  ) {
    const password = getKeychainPassword(keychainService);
    if (!password) return '';

    try {
      const key = pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from('saltysalt', 'utf8'), 1003, 16, 'sha1');
      const iv = Buffer.alloc(16, 0x20);
      const decipher = createDecipheriv('aes-128-cbc', key, iv);
      decipher.setAutoPadding(true);
      const decrypted = Buffer.concat([decipher.update(raw.subarray(3)), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      return '';
    }
  }

  return raw.toString('utf8');
}

function extractFromChromium(cookiesPath: string, source: string, keychainService: string): AuthSession | null {
  if (!existsSync(cookiesPath)) return null;

  return withTempSqliteCopy(cookiesPath, (tmpDbPath) => {
    const rows = querySqliteRows(
      tmpDbPath,
      "SELECT name, value, hex(encrypted_value) FROM cookies WHERE host_key LIKE '%douban.com%' AND name IN ('dbcl2','ck') ORDER BY last_access_utc DESC"
    );

    let dbcl2 = '';
    let ck = '';

    for (const [name, value = '', encryptedHex = ''] of rows) {
      const finalValue = value || decryptChromiumEncryptedValue(encryptedHex, keychainService);
      if (!finalValue) continue;
      if (name === 'dbcl2' && !dbcl2) dbcl2 = finalValue;
      if (name === 'ck' && !ck) ck = finalValue;
      if (dbcl2 && ck) break;
    }

    if (!dbcl2) return null;
    return createSession(dbcl2, ck || undefined, source);
  });
}

function extractFromFirefox(): AuthSession | null {
  const profilesRoot = path.join(os.homedir(), 'Library', 'Application Support', 'Firefox', 'Profiles');
  if (!existsSync(profilesRoot)) return null;

  const dirs = readdirSync(profilesRoot, { withFileTypes: true });
  const cookiePaths = dirs
    .filter((dir) => dir.isDirectory())
    .map((dir) => path.join(profilesRoot, dir.name, 'cookies.sqlite'))
    .filter((candidate) => existsSync(candidate));

  for (const cookiesPath of cookiePaths) {
    const found = withTempSqliteCopy(cookiesPath, (tmpDbPath) => {
      const rows = querySqliteRows(
        tmpDbPath,
        "SELECT name, value FROM moz_cookies WHERE host LIKE '%douban.com%' AND name IN ('dbcl2','ck') ORDER BY lastAccessed DESC"
      );

      let dbcl2 = '';
      let ck = '';

      for (const [name, value = ''] of rows) {
        if (!value) continue;
        if (name === 'dbcl2' && !dbcl2) dbcl2 = value;
        if (name === 'ck' && !ck) ck = value;
      }

      if (!dbcl2) return null;
      return createSession(dbcl2, ck || undefined, 'Firefox');
    });

    if (found) return found;
  }

  return null;
}

function readCString(buffer: Buffer, start: number): string {
  let end = start;
  while (end < buffer.length && buffer[end] !== 0) end += 1;
  return buffer.toString('utf8', start, end);
}

function parseSafariBinaryCookies(filePath: string): Array<{ domain: string; name: string; value: string }> {
  const buffer = readFileSync(filePath);
  if (buffer.length < 8 || buffer.toString('ascii', 0, 4) !== 'cook') return [];

  const pageCount = buffer.readUInt32BE(4);
  let offset = 8;
  const pageSizes: number[] = [];

  for (let i = 0; i < pageCount; i += 1) {
    if (offset + 4 > buffer.length) return [];
    pageSizes.push(buffer.readUInt32BE(offset));
    offset += 4;
  }

  const cookies: Array<{ domain: string; name: string; value: string }> = [];

  for (const pageSize of pageSizes) {
    if (offset + pageSize > buffer.length) break;
    const page = buffer.subarray(offset, offset + pageSize);
    offset += pageSize;

    if (page.length < 8) continue;
    const cookieCount = page.readUInt32LE(4);
    if (cookieCount <= 0) continue;

    const cookieOffsets: number[] = [];
    let pointer = 8;
    for (let i = 0; i < cookieCount; i += 1) {
      if (pointer + 4 > page.length) break;
      cookieOffsets.push(page.readUInt32LE(pointer));
      pointer += 4;
    }

    for (const cookieOffset of cookieOffsets) {
      if (cookieOffset + 32 > page.length) continue;
      const size = page.readUInt32LE(cookieOffset);
      if (size <= 0 || cookieOffset + size > page.length) continue;

      const domainOffset = page.readUInt32LE(cookieOffset + 16);
      const nameOffset = page.readUInt32LE(cookieOffset + 20);
      const valueOffset = page.readUInt32LE(cookieOffset + 28);
      const cookieData = page.subarray(cookieOffset, cookieOffset + size);

      if (domainOffset >= cookieData.length || nameOffset >= cookieData.length || valueOffset >= cookieData.length) {
        continue;
      }

      const domain = readCString(cookieData, domainOffset);
      const name = readCString(cookieData, nameOffset);
      const value = readCString(cookieData, valueOffset);

      if (!domain || !name) continue;
      cookies.push({ domain, name, value });
    }
  }

  return cookies;
}

function extractFromSafari(): AuthSession | null {
  const candidates = [
    path.join(os.homedir(), 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library', 'Cookies', 'Cookies.binarycookies'),
    path.join(os.homedir(), 'Library', 'Cookies', 'Cookies.binarycookies')
  ];

  for (const cookieFile of candidates) {
    if (!existsSync(cookieFile)) continue;

    try {
      const rows = parseSafariBinaryCookies(cookieFile).filter(
        (item) => item.domain.includes('douban.com') && (item.name === 'dbcl2' || item.name === 'ck')
      );

      let dbcl2 = '';
      let ck = '';
      for (const row of rows) {
        if (row.name === 'dbcl2' && !dbcl2) dbcl2 = row.value;
        if (row.name === 'ck' && !ck) ck = row.value;
      }

      if (dbcl2) return createSession(dbcl2, ck || undefined, 'Safari');
    } catch {
      // Continue with next candidate.
    }
  }

  return null;
}

function extractFromBrowsers(): AuthSession | null {
  if (process.platform !== 'darwin') return null;

  const chromiumCandidates = [
    {
      source: 'Chrome',
      cookiesPath: path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies'),
      keychainService: 'Chrome Safe Storage'
    },
    {
      source: 'Edge',
      cookiesPath: path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'Default', 'Cookies'),
      keychainService: 'Microsoft Edge Safe Storage'
    }
  ];

  for (const browser of chromiumCandidates) {
    const found = extractFromChromium(browser.cookiesPath, browser.source, browser.keychainService);
    if (found) return found;
  }

  const firefox = extractFromFirefox();
  if (firefox) return firefox;

  return extractFromSafari();
}

function openLoginPage(): void {
  if (process.platform === 'darwin') {
    spawnSync('open', [DOUBAN_LOGIN_URL], { stdio: 'ignore' });
    return;
  }

  if (process.platform === 'linux') {
    spawnSync('xdg-open', [DOUBAN_LOGIN_URL], { stdio: 'ignore' });
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'start', '', DOUBAN_LOGIN_URL], { stdio: 'ignore' });
    return;
  }

  throw new Error('Unsupported platform for browser login flow');
}

async function waitForEnter(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question('完成豆瓣登录后，按回车继续提取 Cookie...');
  } finally {
    rl.close();
  }
}

export async function ensureAuth(): Promise<AuthSession> {
  const cached = readAuthCache();
  if (cached) return cached;

  const extracted = extractFromBrowsers();
  if (extracted) {
    saveAuthCache(extracted);
    return extracted;
  }

  console.log('未检测到可用豆瓣登录态，正在打开浏览器登录页面...');
  openLoginPage();
  await waitForEnter();

  const retried = extractFromBrowsers();
  if (!retried) {
    throw new Error('登录后仍未提取到 dbcl2 Cookie，请确认已在浏览器完成登录。');
  }

  saveAuthCache(retried);
  return retried;
}
