import { describe, expect, it } from 'vitest';
import { csvRow } from '../utils/csv.ts';

describe('CSV cells', () => {
  it('quotes commas, quotes, newlines and Unicode text', () => {
    expect(csvRow(['书名, "特别版"', '第一行\n第二行 😊', 5, undefined]))
      .toBe('"书名, ""特别版""","第一行\n第二行 😊","5",""');
  });

  it.each([
    '=HYPERLINK("https://example.com")',
    '+cmd',
    '-2+3',
    '@SUM(1,2)',
    ' \t=1+1',
    '\uFEFF=1+1'
  ])('neutralizes spreadsheet formula input: %s', (formula) => {
    expect(csvRow([formula])).toBe(`"'${formula.replace(/"/g, '""')}"`);
  });

  it('leaves ordinary text and URLs alone', () => {
    expect(csvRow(['普通标题', 'https://movie.douban.com/subject/1/']))
      .toBe('"普通标题","https://movie.douban.com/subject/1/"');
  });
});
