import { describe, it, expect } from 'vitest';
import { matchesSubstituteSearch } from './substituteSearch';

const baseRow = {
  reason: '身體不適',
  status: 'PENDING_ASSIGNMENT',
  class: { name: '週四中階B班' },
  originalTeacher: { user: { name: '陳老師' } },
  substituteTeacher: null as null | { user: { name: string } },
};

describe('matchesSubstituteSearch', () => {
  it('returns true for an empty query', () => {
    expect(matchesSubstituteSearch(baseRow, '')).toBe(true);
  });

  it('matches on class name', () => {
    expect(matchesSubstituteSearch(baseRow, '中階B')).toBe(true);
  });

  it('matches on original teacher name', () => {
    expect(matchesSubstituteSearch(baseRow, '陳老師')).toBe(true);
  });

  it('matches on reason text', () => {
    expect(matchesSubstituteSearch(baseRow, '身體不適')).toBe(true);
  });

  it('matches on substitute teacher name when assigned', () => {
    const row = { ...baseRow, substituteTeacher: { user: { name: '林老師' } }, status: 'ASSIGNED' };
    expect(matchesSubstituteSearch(row, '林老師')).toBe(true);
  });

  it('matches the human-readable status label, not the raw status code', () => {
    expect(matchesSubstituteSearch(baseRow, '待確認')).toBe(true);
    expect(matchesSubstituteSearch(baseRow, 'PENDING_ASSIGNMENT')).toBe(false);
  });

  it('is case-insensitive', () => {
    const row = { ...baseRow, originalTeacher: { user: { name: 'Amy Chen' } } };
    expect(matchesSubstituteSearch(row, 'amy')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesSubstituteSearch(baseRow, '不存在的關鍵字')).toBe(false);
  });
});
