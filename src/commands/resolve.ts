import { parseIsbn, resolveBookIdByIsbn, searchBooks, type BookSearchItem } from '../api/book.js';
import { searchMovies, type SearchItem } from '../api/search.js';
import type { SubjectKind } from '../api/subject.js';
import { getOptionalSessionCookies } from '../auth/index.js';
import { ask, canPrompt } from '../ui/prompt.js';
import { compactNumber, subjectLabel } from '../ui/output.js';
import { AmbiguousMatchError, CliArgumentError, printWarnings } from '../utils/error.js';
import { isNumericId } from '../utils/parsing.js';

export interface ResolvedSubject {
  id: string;
  title?: string;
  /** Matched by searching a title, so it may not be the one the user meant. */
  searched: boolean;
  /** Search rating, when the match came from search. */
  rating?: string;
  /** Search subtitle: author / publisher / year, or movie year / type. */
  meta?: string;
  /** The user chose this subject from an interactive list. */
  picked?: boolean;
}

export interface ResolveOptions {
  /** When false, never ask which match to use. Default: prompt in a terminal unless quiet. */
  prompt?: boolean;
}

const NOUN = { movie: '电影', book: '图书' } as const;

interface ResolveCandidate {
  id: string;
  title: string;
  rating: string;
  rating_count: number;
  meta: string;
}

function extraField(value: string | undefined): string | undefined {
  return value && value !== '-' ? value : undefined;
}

function bookTitleKey(title: string): string {
  return title.toLocaleLowerCase().split(/\s*[:：]\s*/)[0] ?? title.toLocaleLowerCase();
}

function movieCandidate(item: SearchItem): ResolveCandidate {
  const meta = [
    item.type === 'tv' ? '剧集' : '电影',
    item.year,
    extraField(item.meta)
  ].filter((value): value is string => Boolean(value)).join(' · ');
  return {
    id: item.id,
    title: item.title,
    rating: item.rating,
    rating_count: item.rating_count ?? 0,
    meta: meta || '-'
  };
}

function bookCandidate(item: BookSearchItem): ResolveCandidate {
  return {
    id: item.id,
    title: item.title,
    rating: item.rating,
    rating_count: item.rating_count,
    meta: item.meta
  };
}

/** Exact title, then (books only) the part before a subtitle; movies skip that — sequels use a colon too. */
function matchingChoices(kind: SubjectKind, query: string, candidates: ResolveCandidate[]): {
  choices: ResolveCandidate[];
  sameTitle: boolean;
} {
  const wanted = query.toLocaleLowerCase();
  const exact = candidates.filter((item) => item.title.toLocaleLowerCase() === wanted);
  if (exact.length > 0) return { choices: exact, sameTitle: true };
  if (kind === 'book') {
    const prefix = candidates.filter((item) => bookTitleKey(item.title) === wanted);
    if (prefix.length > 0) return { choices: prefix, sameTitle: true };
  }
  return { choices: candidates, sameTitle: false };
}

function formatChoiceExtras(item: ResolveCandidate): string {
  return [
    extraField(item.rating),
    item.rating_count > 0 ? `${compactNumber(item.rating_count)}人评价` : undefined,
    extraField(item.meta)
  ].filter((value): value is string => Boolean(value)).join(' · ');
}

function formatChoice(item: ResolveCandidate, withTitle: boolean): string {
  const extras = formatChoiceExtras(item);
  if (withTitle) {
    const label = subjectLabel(item.id, item.title);
    return extras ? `${label} ${extras}` : label;
  }
  return extras ? `${extras}  ${item.id}` : item.id;
}

function sameTitleNoun(kind: SubjectKind, count: number): string {
  return kind === 'book' ? `${count} 个版本` : `${count} 部同名作品`;
}

function formatChoiceWarning(
  kind: SubjectKind,
  query: string,
  choices: ResolveCandidate[],
  sameTitle: boolean,
  chosen: ResolveCandidate
): string {
  const list = choices.map((item) => {
    const bits = [item.id, extraField(item.rating), extraField(item.meta)].filter(Boolean).join(' ');
    return sameTitle ? bits : `《${item.title}》 ${bits}`;
  }).join('；');
  if (sameTitle) return `《${chosen.title}》有 ${sameTitleNoun(kind, choices.length)}，当前 ${chosen.id}：${list}`;
  return `未找到与“${query}”完全同名的${NOUN[kind]}，已匹配 ${chosen.id}：《${chosen.title}》。搜索结果：${list}`;
}

async function askChoiceIndex(count: number): Promise<number | null> {
  while (true) {
    const answer = (await ask('编号，回车用 1，q 取消：')).toLowerCase();
    if (answer === 'q' || answer === 'n') return null;
    if (answer === '') return 0;
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= count) return index - 1;
    console.error(`请输入 1-${count} 的编号`);
  }
}

function toResolved(item: ResolveCandidate, picked: boolean): ResolvedSubject {
  return {
    id: item.id,
    title: item.title,
    searched: true,
    rating: extraField(item.rating),
    meta: extraField(item.meta),
    ...(picked ? { picked: true } : {})
  };
}

/**
 * Label used in match lines and write confirmations: title, id, rating and edition.
 */
export function formatResolvedLabel(subject: Pick<ResolvedSubject, 'id' | 'title' | 'rating' | 'meta'>): string {
  const extras = [extraField(subject.rating), extraField(subject.meta)];
  const suffix = extras.filter((value): value is string => Boolean(value)).join(' · ');
  const label = subjectLabel(subject.id, subject.title);
  return suffix ? `${label} ${suffix}` : label;
}

/** A subject ID, or for books an ISBN; anything else is rejected. Used for batch files, which never search. */
export function parseSubjectRef(kind: SubjectKind, value: string): { id?: string; isbn?: string } {
  const text = value.trim();
  const isbn = kind === 'book' ? parseIsbn(text) : null;
  if (isbn) return { isbn };
  if (isNumericId(text) && text.length < 10) return { id: text };
  throw new CliArgumentError(`无效${NOUN[kind]} ID${kind === 'book' ? ' 或 ISBN' : ''}: ${value}`);
}

function toMatch(item: ResolveCandidate): { id: string; title: string; rating?: string; meta?: string } {
  return {
    id: item.id,
    title: item.title,
    ...(extraField(item.rating) ? { rating: extraField(item.rating) } : {}),
    ...(extraField(item.meta) ? { meta: extraField(item.meta) } : {})
  };
}

async function pickResolved(
  kind: SubjectKind,
  query: string,
  candidates: ResolveCandidate[],
  quiet: boolean,
  options: ResolveOptions
): Promise<ResolvedSubject> {
  const { choices, sameTitle } = matchingChoices(kind, query, candidates);
  if (choices.length === 0) throw new Error(`未找到${NOUN[kind]}：${query}`);

  const shouldPrompt = options.prompt !== false && canPrompt() && choices.length > 1;
  let index = 0;
  let picked = false;

  if (shouldPrompt) {
    const header = sameTitle
      ? `🔎 《${choices[0].title}》有 ${sameTitleNoun(kind, choices.length)}：`
      : `🔎 未找到与“${query}”完全同名的${NOUN[kind]}，搜索结果：`;
    console.error(`\n${header}`);
    choices.forEach((item, choiceIndex) => {
      console.error(`  ${choiceIndex + 1}  ${formatChoice(item, !sameTitle)}`);
    });
    const selected = await askChoiceIndex(choices.length);
    if (selected === null) throw new CliArgumentError('已取消');
    index = selected;
    picked = true;
  } else if (choices.length > 1) {
    const message = sameTitle
      ? `《${choices[0].title}》有 ${sameTitleNoun(kind, choices.length)}，请指定其中一个`
      : `未找到与“${query}”完全同名的${NOUN[kind]}，请从搜索结果中指定`;
    throw new AmbiguousMatchError(message, choices.map(toMatch));
  } else if (!sameTitle) {
    if (quiet) printWarnings([formatChoiceWarning(kind, query, choices, false, choices[0])]);
    else {
      console.log(`\n🔎 未找到与“${query}”完全同名的${NOUN[kind]}，已匹配搜索第一条：`);
      console.log(`  1  ${formatChoice(choices[0], true)}`);
    }
  }

  const resolved = toResolved(choices[index], picked);
  if (!quiet && (picked || sameTitle)) {
    console.log(`\n🔎 已匹配为 ${formatResolvedLabel(resolved)}`);
  }
  return resolved;
}

/**
 * What the user typed as a subject: an ID, an ISBN for books (resolved
 * exactly) or a title (the best search match, printed unless quiet).
 */
export async function resolveSubject(
  kind: SubjectKind,
  input: string,
  quiet: boolean,
  options: ResolveOptions = {}
): Promise<ResolvedSubject> {
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
  const candidates = kind === 'movie'
    ? (await searchMovies(query, 0, 10, { cookies, warnings })).map(movieCandidate)
    : (await searchBooks(query, 0, 10, { cookies, warnings })).map(bookCandidate);
  printWarnings(warnings);
  return pickResolved(kind, query, candidates, quiet, options);
}
