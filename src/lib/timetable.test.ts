import { describe, it, expect } from 'vitest';
import { stripWeekday, levelColor, LEVEL_PALETTE } from './timetable';

describe('stripWeekday', () => {
  it('removes a 週X prefix from the name', () => {
    expect(stripWeekday('週一基礎2A')).toBe('基礎2A');
  });

  it('removes a parenthesized 週X and the emptied parentheses', () => {
    expect(stripWeekday('MPM（週一）')).toBe('MPM');
  });

  it('leaves a name without any weekday reference unchanged', () => {
    expect(stripWeekday('數學A班')).toBe('數學A班');
  });

  it('removes multiple weekday references', () => {
    expect(stripWeekday('週三物理（週三）')).toBe('物理');
  });
});

describe('levelColor', () => {
  it('returns the same color for the same level string', () => {
    expect(levelColor('基礎2')).toBe(levelColor('基礎2'));
  });

  it('always returns a palette entry', () => {
    for (const level of ['基礎', '基礎1', '基礎2', '進階', '段位1', '國一', '-', '']) {
      expect(LEVEL_PALETTE).toContain(levelColor(level));
    }
  });
});
