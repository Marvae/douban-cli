import { BASE, cleanText, decodeHtml, escapeRegExp, fetchHtml, isChallengePage } from './common.js';

export interface CelebrityDetail {
  id: string;
  name: string;
  name_en: string;
  gender: string;
  horoscope: string;
  birthday: string;
  birthplace: string;
  profession: string;
  summary: string;
  url: string;
  source: 'celebrity' | 'personage';
}

function parseCelebrityFromHtml(id: string, html: string): CelebrityDetail | null {
  if (isChallengePage(html)) return null;

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (!h1Match) return null;

  const nameLine = cleanText(h1Match[1]);
  const parts = nameLine.split(/\s{2,}|\s+-\s+/).map((v) => v.trim()).filter(Boolean);

  const introHiddenMatch = html.match(/<div id="intro"[\s\S]*?<span class="all hidden">([\s\S]*?)<\/span>/);
  const introNormalMatch = html.match(/<div id="intro"[\s\S]*?<div class="bd">([\s\S]*?)<\/div>/);

  const field = (label: string): string => {
    const reg = new RegExp(`<li[^>]*>\\s*<span[^>]*>${escapeRegExp(label)}<\\/span>\\s*:?\\s*([\\s\\S]*?)<\\/li>`, 'i');
    const m = html.match(reg);
    return m ? cleanText(m[1]) : '-';
  };

  return {
    id,
    name: parts[0] || nameLine,
    name_en: parts[1] || '-',
    gender: field('性别'),
    horoscope: field('星座'),
    birthday: field('出生日期'),
    birthplace: field('出生地'),
    profession: field('职业'),
    summary: introHiddenMatch ? cleanText(introHiddenMatch[1]) : introNormalMatch ? cleanText(introNormalMatch[1]) : '-',
    url: `${BASE}/celebrity/${id}/`,
    source: 'celebrity'
  };
}

function parsePersonageSidFromChallenge(html: string): string {
  const redMatch = html.match(/id="red"[^>]*value="https:\/\/www\.douban\.com\/personage\/(\d+)\/?"/);
  return redMatch ? redMatch[1] : '';
}

/**
 * Get celebrity detail.
 * Priority: movie celebrity page -> fallback to personage page metadata when blocked.
 */
export async function getCelebrityDetail(id: string): Promise<CelebrityDetail> {
  const celebrityId = id.trim();
  if (!/^\d+$/.test(celebrityId)) throw new Error('人物 ID 必须是纯数字');

  const celebrityUrl = `${BASE}/celebrity/${celebrityId}/`;

  try {
    const html = await fetchHtml(celebrityUrl, { Referer: BASE });
    const parsed = parseCelebrityFromHtml(celebrityId, html);
    if (parsed) return parsed;

    const sid = parsePersonageSidFromChallenge(html);
    if (sid) {
      const mobilePersonageHtml = await fetchHtml(`https://m.douban.com/personage/${sid}/`, {
        Referer: 'https://m.douban.com/'
      });

      if (mobilePersonageHtml.includes('404 Oops')) {
        throw new Error(`人物页面不存在 sid=${sid}`);
      }

      const titleMatch = mobilePersonageHtml.match(/<meta\s+property="og:title"\s+content="([^"]+)"\s*\/>/)
        || mobilePersonageHtml.match(/<meta\s+itemprop="name"\s+content="([^"]+)"\s*\/>/);
      const descMatch = mobilePersonageHtml.match(/<meta\s+property="og:description"\s+content="([^"]*)"\s*\/>/)
        || mobilePersonageHtml.match(/<meta\s+name="description"\s+content="([^"]*)"\s*\/>/);

      const title = titleMatch ? decodeHtml(titleMatch[1]).trim() : '';
      const nameParts = title.split(/\s+-\s+/).map((v) => v.trim()).filter(Boolean);
      const summaryRaw = descMatch ? decodeHtml(descMatch[1]).trim() : '';
      const summary = summaryRaw.replace(/简介[:：]?\s*$/, '').trim() || '-';

      return {
        id: celebrityId,
        name: nameParts[0] || `personage-${sid}`,
        name_en: nameParts[1] || '-',
        gender: '-',
        horoscope: '-',
        birthday: '-',
        birthplace: '-',
        profession: '-',
        summary,
        url: `https://www.douban.com/personage/${sid}/`,
        source: 'personage'
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[celebrity] 获取人物详情失败: ${message}`);
  }

  throw new Error(`获取人物信息失败，ID=${celebrityId}`);
}
