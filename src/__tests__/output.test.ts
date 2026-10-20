import { afterEach, describe, expect, it, vi } from 'vitest';
import { idColumn, renderTable } from '../ui/output.ts';

const originalIsTTY = process.stdout.isTTY;

afterEach(() => {
  process.stdout.isTTY = originalIsTTY;
  vi.restoreAllMocks();
});

function printTable(isTTY: boolean): string {
  process.stdout.isTTY = isTTY;
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  renderTable([
    { id: '1292052', title: '肖申克的救赎', url: 'https://movie.douban.com/subject/1292052/' },
    { id: '2', title: '注入', url: 'https://example.com/\u0007evil' }
  ], [{ header: '片名', value: (row) => row.title }, idColumn()]);
  const output = log.mock.calls.map(([line]) => String(line)).join('\n');
  log.mockRestore();
  return output;
}

describe('terminal links', () => {
  it('link IDs only in a terminal, keep alignment and never link unsafe URLs', () => {
    const plain = printTable(false);
    expect(plain).not.toContain('\u001b');

    const linked = printTable(true);
    expect(linked).toContain('\u001b]8;;https://movie.douban.com/subject/1292052/\u00071292052\u001b]8;;\u0007');
    expect(linked).not.toContain('evil');
    // Removing each `ESC ]8;; url BEL` leaves exactly the plain table.
    const stripped = linked.split('\u001b]8;;').map((part, index) => (index === 0 ? part : part.slice(part.indexOf('\u0007') + 1))).join('');
    expect(stripped).toBe(plain);
  });
});
