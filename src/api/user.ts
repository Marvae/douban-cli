import { BASE, fetchHtml, isChallengePage } from './common.js';

export interface UserCollectionItem {
  title: string;
  url: string;
  id: string;
}

/**
 * Get user's movie collection
 */
export async function getUserCollection(
  userId: string,
  status: 'collect' | 'wish' | 'do' = 'collect',
  limit = 50
): Promise<UserCollectionItem[]> {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) {
    throw new Error('用户 ID 不能为空');
  }
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const results: UserCollectionItem[] = [];
  const seen = new Set<string>();
  const encodedUserId = encodeURIComponent(trimmedUserId);
  let start = 0;

  while (results.length < limit) {
    const html = await fetchHtml(`${BASE}/people/${encodedUserId}/${status}?start=${start}&sort=time&mode=list`);

    if (isChallengePage(html)) {
      throw new Error('触发豆瓣反爬挑战页面，无法继续获取用户片单，请稍后重试');
    }

    const regex = /<div class="title">\s*<a href="https:\/\/movie\.douban\.com\/subject\/(\d+)\/">\s*([^<]+?)\s*<\/a>/g;
    let match;
    let found = false;

    while ((match = regex.exec(html)) !== null && results.length < limit) {
      const id = match[1];
      const title = match[2].trim();
      if (title && !seen.has(id)) {
        found = true;
        seen.add(id);
        results.push({
          title,
          url: `https://movie.douban.com/subject/${id}/`,
          id
        });
      }
    }

    if (!found) break;
    start += 15;
  }

  return results;
}
