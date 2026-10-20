import { debug } from '../utils/debug.js';
import { cleanText, fetchHtml, fetchHtmlPage } from './common.js';

interface ProfileMatch {
  id: string;
  name?: string;
}

export interface CurrentUserProfile {
  id: string;
  name: string;
  url: string;
}

function parseMineAnchor(html: string): ProfileMatch | null {
  const byClassThenHref = html.match(/<a[^>]*class=["'][^"']*\blnk-mine\b[^"']*["'][^>]*href=["']https:\/\/www\.douban\.com\/people\/([^/"']+)\/["'][^>]*>([\s\S]*?)<\/a>/i);
  if (byClassThenHref?.[1]) {
    return { id: byClassThenHref[1], name: cleanText(byClassThenHref[2] || '') };
  }

  const byHrefThenClass = html.match(/<a[^>]*href=["']https:\/\/www\.douban\.com\/people\/([^/"']+)\/["'][^>]*class=["'][^"']*\blnk-mine\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  if (byHrefThenClass?.[1]) {
    return { id: byHrefThenClass[1], name: cleanText(byHrefThenClass[2] || '') };
  }

  return null;
}

function parseProfileFromHtml(html: string): CurrentUserProfile {
  const mine = parseMineAnchor(html);
  if (!mine?.id) {
    throw new Error('当前页面未提供可靠的登录账号标记');
  }

  return {
    id: mine.id,
    name: mine.name || mine.id,
    url: `https://www.douban.com/people/${mine.id}/`
  };
}

function profileIdFromUrl(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'www.douban.com') return null;
    return url.pathname.match(/^\/people\/([^/]+)\/?$/)?.[1] || null;
  } catch {
    return null;
  }
}

function profileNameFromHtml(html: string, fallback: string): string {
  const heading = cleanText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '')
    .replace(/\s*[（(]\s*(?:添加签名档|编辑)\s*[）)]\s*$/, '')
    .trim();
  if (heading) return heading;

  const title = cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/\s*的豆瓣\s*$/, '')
    .trim();
  return title || fallback;
}

function parseRedirectedProfile(html: string, pageUrl: string): CurrentUserProfile | null {
  const id = profileIdFromUrl(pageUrl);
  if (!id) return null;

  return {
    id,
    name: profileNameFromHtml(html, id),
    url: `https://www.douban.com/people/${id}/`
  };
}

export async function getCurrentUserProfile(cookies: string): Promise<CurrentUserProfile> {
  const minePage = await fetchHtmlPage('https://www.douban.com/mine/', {
    Referer: 'https://www.douban.com/',
    Cookie: cookies
  });

  const redirectedProfile = parseRedirectedProfile(minePage.html, minePage.url);
  if (redirectedProfile) return redirectedProfile;

  try {
    return parseProfileFromHtml(minePage.html);
  } catch (error) {
    debug('account', `/mine/ 页面未提供可靠的当前账号标记: ${error instanceof Error ? error.message : String(error)}`);
  }

  const html = await fetchHtml('https://www.douban.com/', {
    Referer: 'https://www.douban.com/',
    Cookie: cookies
  });

  try {
    return parseProfileFromHtml(html);
  } catch {
    throw new Error('无法识别当前登录用户，请重新登录后重试');
  }
}

