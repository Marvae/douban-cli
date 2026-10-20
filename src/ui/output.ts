import type { UserCollectionItem } from '../api/collection.js';
import type { SubjectKind } from '../api/subject.js';
import { getDisplayWidth, padDisplayEnd, truncateDisplay } from './text.js';

// Terminal presentation shared by every command. JSON output does not use it.

/** Chinese names of Douban's statuses for movies and books. */
export const STATUS_LABELS: Record<SubjectKind, Record<'wish' | 'do' | 'collect' | 'none', string>> = {
  movie: { wish: '想看', do: '在看', collect: '看过', none: '未标记' },
  book: { wish: '想读', do: '在读', collect: '读过', none: '未标记' }
};

export interface TableColumn<Row> {
  header: string;
  value: (row: Row, index: number) => string;
  minWidth?: number;
  /** Longer values are cut with "…" so wide tables fit a terminal. */
  maxWidth?: number;
  /** Page the cell links to in terminals that support links. */
  link?: (row: Row) => string | undefined;
}

// Douban data is untrusted: only plain https URLs may go into an escape sequence.
function isSafeUrl(url: string): boolean {
  return /^https:\/\/\S+$/.test(url) && [...url].every((char) => char.charCodeAt(0) > 0x1f && char.charCodeAt(0) !== 0x7f);
}

/**
 * A terminal hyperlink (OSC 8) when stdout is a terminal; plain text otherwise,
 * so pipes, --json and agents never see escape codes.
 */
export function hyperlink(text: string, url: string | undefined): string {
  if (!url || !isSafeUrl(url) || !process.stdout.isTTY || process.env.TERM === 'dumb') return text;
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

/** The ID column of a list; the ID opens its Douban page in terminals that support links. */
export function idColumn<Row extends { id: string; url?: string }>(): TableColumn<Row> {
  return { header: 'ID', value: (row) => row.id, link: (row) => row.url };
}

export function renderTable<Row>(rows: Row[], columns: TableColumn<Row>[]): void {
  if (rows.length === 0) return;
  const cells = rows.map((row, rowIndex) => columns.map((column) => {
    const value = column.value(row, rowIndex) || '-';
    return column.maxWidth ? truncateDisplay(value, column.maxWidth) : value;
  }));
  const widths = columns.map((column, index) => Math.max(
    getDisplayWidth(column.header),
    column.minWidth ?? 0,
    ...cells.map((row) => getDisplayWidth(row[index]))
  ));
  // Widths come from the plain text; links wrap a cell only once it is padded.
  const line = (values: string[], row?: Row) => values.map((value, index) => {
    const url = row && columns[index].link?.(row);
    const padding = ' '.repeat(Math.max(0, widths[index] - getDisplayWidth(value)));
    return url ? hyperlink(value, url) + padding : padDisplayEnd(value, widths[index]);
  }).join('   ').trimEnd();
  console.log(line(columns.map((column) => column.header)));
  cells.forEach((cellRow, index) => console.log(line(cellRow, rows[index])));
}

/** 9,999 below ten thousand, 1.2万 above; '-' when unknown. */
export function compactNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '-';
  if (value < 10000) return value.toLocaleString();
  const scaled = Math.round((value / 10000) * 10) / 10;
  return `${Number.isInteger(scaled) ? scaled.toFixed(0) : scaled.toFixed(1)}万`;
}

export function formatStars(rating: number | null | undefined): string {
  return rating && rating > 0 ? '★'.repeat(rating) : '未评分';
}

/** 🔺3 / 🔻1 / — from Douban trend markers such as "up 3", "down1" or "stay". */
export function formatTrend(trend: string | undefined): string {
  const match = trend?.match(/^(up|down)\s*(\d*)/);
  if (match) return `${match[1] === 'up' ? '🔺' : '🔻'}${match[2]}`;
  return trend === 'stay' ? '—' : '';
}

/** Five-to-one star distribution as bars; `stars` lists one star first. */
export function printRatingBars(stars: number[]): void {
  const max = Math.max(...stars, 0);
  stars.slice().reverse().forEach((percent, index) => {
    const bar = '█'.repeat(max > 0 ? Math.round((percent / max) * 30) : 0);
    console.log(`${5 - index}星 ${bar}${bar ? ' ' : ''}${percent.toFixed(1)}%`);
  });
}

export function subjectLabel(id: string, title?: string): string {
  return title ? `《${title}》(${id})` : id;
}

/** One line per collection entry, plus the short comment when there is one. */
export function printCollectionItems(items: UserCollectionItem[], offset = 0): void {
  if (items.length === 0) {
    console.log('暂无记录');
    return;
  }
  items.forEach((item, index) => {
    console.log(`${String(offset + index + 1).padStart(2)}. ${item.title}  ${formatStars(item.rating)}  ${item.date || '-'}  ID ${hyperlink(item.id, item.url)}`);
    if (item.comment) console.log(`    “${item.comment}”`);
  });
}

/** Heading of a paged list: what it is, how many exist and which are shown. */
export function printListHeading(heading: string, total: number | undefined, from: number, to: number): void {
  console.log(`\n${heading}`);
  console.log(total && to >= from ? `共 ${total.toLocaleString()} 条，当前第 ${from}-${to} 条\n` : '');
}

/** Short comments and reviews: who, how they rated, likes and when, then the text. */
export function printPosts(
  items: Array<{ user: string; rating: number; votes: number; time: string; content: string }>,
  offset: number
): void {
  if (items.length === 0) console.log('暂无内容');
  items.forEach((item, index) => {
    const stars = item.rating > 0 ? `  ${formatStars(item.rating)}` : '';
    if (index > 0) console.log('');
    console.log(`${String(offset + index + 1).padStart(2)}. ${item.user}${stars}  👍${item.votes}  ${item.time}`);
    console.log(`    ${item.content}`);
  });
}
