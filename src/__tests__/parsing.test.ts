import { describe, expect, it } from 'vitest';
import { formEncode, getPageRange, pageToOffset, parsePositiveInt, parsePositiveIntAtMost } from '../utils/parsing.ts';

describe('parsing', () => {
  it('validates numeric options with their limits', () => {
    expect(parsePositiveInt(undefined, '--limit', 20)).toBe(20);
    expect(() => parsePositiveInt('0', '--limit', 20)).toThrow('--limit 必须是正整数');
    expect(parsePositiveIntAtMost('20', '--limit', 10, 20)).toBe(20);
    expect(() => parsePositiveIntAtMost('21', '--limit', 10, 20)).toThrow('--limit 不能超过 20');
  });

  it('turns pages into safe offsets and ranges', () => {
    expect(pageToOffset(3, 20)).toBe(40);
    expect(getPageRange(3, 20, 5)).toEqual({ from: 41, to: 45 });
    expect(() => pageToOffset(0, 20)).toThrow('--page 必须是安全范围内的正整数');
    expect(() => pageToOffset(Number.MAX_SAFE_INTEGER, 2)).toThrow('超出安全整数范围');
  });

  it('form-encodes without nullish fields', () => {
    expect(formEncode({ a: '1', b: undefined, c: null, d: 'ok' })).toBe('a=1&d=ok');
  });
});
