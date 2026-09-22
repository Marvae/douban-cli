import { debug } from '../utils/debug.js';
import { getOptionalSessionCookies } from '../auth.js';
import {
  getUserCollectionPage,
  type CollectionStatus,
  type UserCollectionItem,
  type UserCollectionPage,
  type UserCollectionPageOptions
} from './collection.js';

/**
 * Get a user's movie collection while preserving the original array API.
 */
export async function getUserCollection(
  userId: string,
  status: CollectionStatus = 'collect',
  limit = 50
): Promise<UserCollectionItem[]> {
  if (!Number.isInteger(limit) || limit <= 0) return [];
  const page: UserCollectionPage = await getUserCollectionPage(
    {
      kind: 'movie',
      userId,
      status,
      start: 0,
      count: limit
    } satisfies UserCollectionPageOptions,
    await getOptionalSessionCookies()
  );

  if (page.partial) {
    debug('user', `用户片单仅返回部分结果: ${page.warnings.join('; ')}`);
  }
  return page.items;
}
