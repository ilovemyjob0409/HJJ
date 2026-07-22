import { describe, it, expect } from 'vitest';
import { previewSessionDates } from './goHallDates';

describe('previewSessionDates', () => {
  it('returns every Saturday in July 2026', () => {
    // July 2026: the 1st is a Wednesday, so Saturdays fall on 4, 11, 18, 25.
    const dates = previewSessionDates(6, '2026-07');
    expect(dates.map((d) => d.getDate())).toEqual([4, 11, 18, 25]);
    expect(dates.every((d) => d.getDay() === 6 && d.getMonth() === 6)).toBe(true);
  });

  it('returns every Friday in August 2026', () => {
    // August 2026: the 1st is a Saturday, so Fridays fall on 7, 14, 21, 28.
    const dates = previewSessionDates(5, '2026-08');
    expect(dates.map((d) => d.getDate())).toEqual([7, 14, 21, 28]);
  });

  it('does not spill into the next month on a leap-year February', () => {
    // 2028 is a leap year; February 1 2028 is a Tuesday, so Tuesdays fall
    // on 1, 8, 15, 22, 29 (the 29th exists — this is the edge case).
    const dates = previewSessionDates(2, '2028-02');
    expect(dates.map((d) => d.getDate())).toEqual([1, 8, 15, 22, 29]);
    expect(dates.every((d) => d.getMonth() === 1)).toBe(true);
  });

  it('returns an empty array for a weekday/month combination with zero matches is impossible, but returns exactly 4 for a short-month edge case', () => {
    // September 2026: the 1st is a Tuesday, so Sundays fall on 6, 13, 20, 27.
    const dates = previewSessionDates(0, '2026-09');
    expect(dates.map((d) => d.getDate())).toEqual([6, 13, 20, 27]);
  });
});
