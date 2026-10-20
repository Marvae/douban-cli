// Public entry point of the auth module.
export type { AuthSession, VerifiedAuthSession, ParsedAuthCookies } from './cookies.js';
export { parseCookieHeader, parseNetscapeCookies } from './cookies.js';
export { clearAuthCache } from './cache.js';
export type { BrowserName, BrowserCookieTarget, LoginOptions, BrowserCookieReader } from './browser-cookies.js';
export { resolveBrowserCookieTarget, hasStoredDoubanLogin } from './browser-cookies.js';
export { browserFromSystemIdentifier, detectDefaultBrowser, resolveLoginLaunchCommand } from './browser-open.js';
export { detectAuthSession, getOptionalSessionCookies, ensureAuth } from './session.js';
export type { CookieInputStream } from './login.js';
export { loginFromCookieStdin, loginFromCookieFile, assertInteractiveLogin, loginFromBrowserCookies, loginWithBrowser } from './login.js';
