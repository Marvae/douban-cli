import { BASE, fetchHtml } from './common.js';

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
  if (!Number.isFinite(limit) || limit <= 0) return [];

  const results: UserCollectionItem[] = [];
  const seen = new Set<string>();
  const encodedUserId = encodeURIComponent(userId.trim());
  let start = 0;

  while (results.length < limit) {
    const html = await fetchHtml(`${BASE}/people/${encodedUserId}/${status}?start=${start}&sort=time&mode=list`);

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
