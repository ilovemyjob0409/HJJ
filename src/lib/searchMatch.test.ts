import { describe, it, expect } from 'vitest';
import { matchesKeyword } from './searchMatch';

describe('matchesKeyword', () => {
  it('returns true for an empty query', () => {
    expect(matchesKeyword(['王小明', '週三班'], '')).toBe(true);
  });

  it('returns true when the query matches any part', () => {
    expect(matchesKeyword(['王小明', '週三班'], '週三')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesKeyword(['John Smith'], 'john')).toBe(true);
  });

  it('trims whitespace from the query', () => {
    expect(matchesKeyword(['王小明'], '  小明  ')).toBe(true);
  });

  it('returns false when no part matches', () => {
    expect(matchesKeyword(['王小明', '週三班'], '不存在')).toBe(false);
  });

  it('ignores empty-string parts', () => {
    expect(matchesKeyword(['', '週三班'], '週三')).toBe(true);
  });
});
