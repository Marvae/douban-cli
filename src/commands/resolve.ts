import { parseIsbn, resolveBookIdByIsbn, searchBooks, type BookSearchItem } from '../api/book.js';
import { searchMovies } from '../api/search.js';
import type { SubjectKind } from '../api/subject.js';
import { getOptionalSessionCookies } from '../auth/index.js';
import { subjectLabel } from '../ui/output.js';
import { CliArgumentError, printWarnings } from '../utils/error.js';
import { isNumericId } from '../utils/parsing.js';

export interface ResolvedSubject {
  id: string;
  title?: string;
  /** Matched by searching a title, so it may not be the one the user meant. */
  searched: boolean;
}

const NOUN = { movie: '电影', book: '图书' } as const;

/** Prefer a book whose title, or the part before a subtitle, equals the query. */
function bestBookMatch(query: string, candidates: BookSearchItem[]): BookSearchItem | undefined {
  const wanted = query.toLocaleLowerCase();
  return candidates.find((item) => {
    const title = item.title.toLocaleLowerCase();
    return title === wanted || title.split(/\s*[:：]\s*/)[0] === wanted;
  }) ?? candidates[0];
}

/** A subject ID, or for books an ISBN; anything else is rejected. Used for batch files, which never search. */
export function parseSubjectRef(kind: SubjectKind, value: string): { id?: string; isbn?: string } {
  const text = value.trim();
  const isbn = kind === 'book' ? parseIsbn(text) : null;
  if (isbn) return { isbn };
  if (isNumericId(text) && text.length < 10) return { id: text };
  throw new CliArgumentError(`无效${NOUN[kind]} ID${kind === 'book' ? ' 或 ISBN' : ''}: ${value}`);
}

/**
 * What the user typed as a subject: an ID, an ISBN for books (resolved
 * exactly) or a title (the best search match, printed unless quiet).
 */
export async function resolveSubject(kind: SubjectKind, input: string, quiet: boolean): Promise<ResolvedSubject> {
  const query = input.trim();
  if (!query) throw new CliArgumentError(`请提供${NOUN[kind]} ID${kind === 'book' ? '、ISBN 或书名' : '或片名'}`);
  const isbn = kind === 'book' ? parseIsbn(query) : null;
  if (isbn) {
    const id = await resolveBookIdByIsbn(isbn);
    if (!quiet) console.log(`\n🔎 ISBN ${isbn} 对应条目 ${id}`);
    return { id, searched: false };
  }
  if (isNumericId(query) && query.length < 10) return { id: query, searched: false };

  const warnings: string[] = [];
  const cookies = await getOptionalSessionCookies();
  const matched = kind === 'movie'
    ? (await searchMovies(query, 0, 1, { cookies, warnings }))[0]
    : bestBookMatch(query, await searchBooks(query, 0, 10, { cookies, warnings }));
  printWarnings(warnings);
  if (!matched) throw new Error(`未找到${NOUN[kind]}：${query}`);
  if (!quiet) console.log(`\n🔎 已匹配为 ${subjectLabel(matched.id, matched.title)}`);
  return { id: matched.id, title: matched.title, searched: true };
}
