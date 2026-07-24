import { describe, it, expect } from 'vitest';
import { matchesSessionSearch } from './sessionSearch';

const baseRow = {
  date: '2026-07-25',
  startTime: '14:00',
  endTime: '16:00',
  teacher: { user: { name: '王老師' } },
};

describe('matchesSessionSearch', () => {
  it('returns true for an empty query', () => {
    expect(matchesSessionSearch(baseRow, '')).toBe(true);
  });

  it('matches on the formatted date text', () => {
    expect(matchesSessionSearch(baseRow, '2026')).toBe(true);
  });

  it('matches on the time range text', () => {
    expect(matchesSessionSearch(baseRow, '14:00-16:00')).toBe(true);
  });

  it('matches on teacher name', () => {
    expect(matchesSessionSearch(baseRow, '王老師')).toBe(true);
  });

  it('is case-insensitive', () => {
    const row = { ...baseRow, teacher: { user: { name: 'Amy Wang' } } };
    expect(matchesSessionSearch(row, 'amy')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesSessionSearch(baseRow, '不存在的關鍵字')).toBe(false);
  });
});
