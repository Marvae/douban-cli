// Cookie values and the session objects built from them.


/** Upper bounds for pasted or file-provided cookie input. */
export const MAX_COOKIE_STDIN_BYTES = 16 * 1024;
export const MAX_COOKIE_FILE_BYTES = 128 * 1024;

export interface AuthSession {
  dbcl2: string;
  ck?: string;
  cookies: string;
  source: string;
  accountId?: string;
  accountName?: string;
  updatedAt: string;
}
export interface VerifiedAuthSession extends AuthSession {
  accountId: string;
  accountName: string;
}
export interface ParsedAuthCookies {
  dbcl2: string;
  ck?: string;
}
export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeAuthCookieValue(value: string, stripQuotes = false): string | null {
  const trimmed = value.trim();
  const startsWithQuote = trimmed.startsWith('"');
  const endsWithQuote = trimmed.endsWith('"');
  if (stripQuotes && startsWithQuote !== endsWithQuote) return null;

  const normalized = stripQuotes && startsWithQuote
    ? trimmed.slice(1, -1).trim()
    : trimmed;
  const hasInvalidCharacters = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f || character === ';';
  });
  return normalized && !hasInvalidCharacters ? normalized : null;
}
function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
function addParsedCookie(
  parsed: Partial<ParsedAuthCookies>,
  name: keyof ParsedAuthCookies,
  rawValue: string
): boolean {
  if (parsed[name] !== undefined) return false;
  const value = normalizeAuthCookieValue(rawValue, true);
  if (!value) return false;
  parsed[name] = value;
  return true;
}
/** Parse a Cookie request header and retain only the authentication cookies. */
export function parseCookieHeader(header: string): ParsedAuthCookies | null {
  if (!header || Buffer.byteLength(header, 'utf8') > MAX_COOKIE_STDIN_BYTES) return null;
  const withoutTrailingNewline = header.endsWith('\r\n')
    ? header.slice(0, -2)
    : header.endsWith('\n')
      ? header.slice(0, -1)
      : header;
  if (hasControlCharacters(withoutTrailingNewline)) return null;

  const cleaned = withoutTrailingNewline.trim().replace(/^cookie\s*:\s*/i, '');
  if (!cleaned) return null;

  const parsed: Partial<ParsedAuthCookies> = {};
  for (const rawSegment of cleaned.split(';')) {
    const segment = rawSegment.trim();
    if (!segment) continue;

    const separator = segment.indexOf('=');
    if (separator <= 0) return null;
    const name = segment.slice(0, separator).trim();
    if (name !== 'dbcl2' && name !== 'ck') continue;
    if (!addParsedCookie(parsed, name, segment.slice(separator + 1))) return null;
  }

  return parsed.dbcl2
    ? { dbcl2: parsed.dbcl2, ...(parsed.ck ? { ck: parsed.ck } : {}) }
    : null;
}
function isSupportedDoubanCookieScope(value: string, includeSubdomainsValue: string): boolean {
  const rawDomain = value.trim().toLowerCase();
  const domain = rawDomain.startsWith('.') ? rawDomain.slice(1) : rawDomain;
  const validLabels = domain.length <= 253 && domain.split('.').every((label) => (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  ));
  if (!validLabels) return false;

  const includeSubdomains = includeSubdomainsValue.trim().toUpperCase();
  if (includeSubdomains !== 'TRUE' && includeSubdomains !== 'FALSE') return false;
  if (domain === 'www.douban.com') return true;
  return domain === 'douban.com' && includeSubdomains === 'TRUE';
}
function isCurrentNetscapeCookie(expires: string): boolean {
  if (!/^\d+$/.test(expires)) return false;
  const timestamp = Number(expires);
  return Number.isSafeInteger(timestamp)
    && (timestamp === 0 || timestamp > Math.floor(Date.now() / 1000));
}
/** Parse a Netscape cookies.txt export and retain valid Douban authentication cookies. */
export function parseNetscapeCookies(contents: string): ParsedAuthCookies | null {
  if (!contents || Buffer.byteLength(contents, 'utf8') > MAX_COOKIE_FILE_BYTES) return null;

  const parsed: Partial<ParsedAuthCookies> = {};
  const lines = contents.replace(/^\uFEFF/, '').split(/\r?\n/);

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const withoutHttpOnlyPrefix = rawLine.replace(/^#HttpOnly_/i, '');
    if (withoutHttpOnlyPrefix.trimStart().startsWith('#')) continue;

    const fields = withoutHttpOnlyPrefix.split('\t');
    if (fields.length !== 7) continue;

    const [domain, includeSubdomains, cookiePath, , expires, rawName, rawValue] = fields;
    const name = rawName?.trim();
    if (name !== 'dbcl2' && name !== 'ck') continue;
    if (!domain || !includeSubdomains || !isSupportedDoubanCookieScope(domain, includeSubdomains)) continue;
    if (cookiePath?.trim() !== '/') continue;
    if (!expires || !isCurrentNetscapeCookie(expires.trim())) continue;
    if (rawValue === undefined || !addParsedCookie(parsed, name, rawValue)) return null;
  }

  return parsed.dbcl2
    ? { dbcl2: parsed.dbcl2, ...(parsed.ck ? { ck: parsed.ck } : {}) }
    : null;
}
export function normalizeDisplayText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return stripControlCharacters(value) || undefined;
}
export function buildCookieHeader(dbcl2: string, ck?: string): string {
  const parts = [`dbcl2=${dbcl2}`];
  if (ck) parts.push(`ck=${ck}`);
  return parts.join('; ');
}
export function createSession(dbcl2: string, ck: string | undefined, source: string): AuthSession {
  return {
    dbcl2,
    ck,
    cookies: buildCookieHeader(dbcl2, ck),
    source,
    updatedAt: new Date().toISOString()
  };
}
export function reportRecoverableError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[auth] ${context}: ${message}`);
}
export function stripControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? ' ' : character;
    })
    .join('')
    .trim();
}
