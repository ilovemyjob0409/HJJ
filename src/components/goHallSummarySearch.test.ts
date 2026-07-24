import { describe, it, expect } from 'vitest';
import { matchesGoHallSummarySearch } from './goHallSummarySearch';

const baseRow = {
  date: new Date('2026-07-25'),
  capacity: 8,
  registeredCount: 3,
};

describe('matchesGoHallSummarySearch', () => {
  it('returns true for an empty query', () => {
    expect(matchesGoHallSummarySearch(baseRow, '')).toBe(true);
  });

  it('matches "尚有名額" when registeredCount is below capacity', () => {
    expect(matchesGoHallSummarySearch(baseRow, '尚有名額')).toBe(true);
    expect(matchesGoHallSummarySearch(baseRow, '已額滿')).toBe(false);
  });

  it('matches "已額滿" when registeredCount reaches capacity', () => {
    const row = { ...baseRow, registeredCount: 8 };
    expect(matchesGoHallSummarySearch(row, '已額滿')).toBe(true);
    expect(matchesGoHallSummarySearch(row, '尚有名額')).toBe(false);
  });

  it('matches on the formatted date text', () => {
    expect(matchesGoHallSummarySearch(baseRow, '2026')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesGoHallSummarySearch(baseRow, '不存在的關鍵字')).toBe(false);
  });
});
