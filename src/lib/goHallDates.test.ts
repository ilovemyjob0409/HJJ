import { describe, it, expect } from 'vitest';
import { previewSessionDates } from './goHallDates';

describe('previewSessionDates', () => {
  it('returns every Saturday in July 2026', () => {
    // July 2026: the 1st is a Wednesday, so Saturdays fall on 4, 11, 18, 25.
    const dates = previewSessionDates(6, '2026-07');
    expect(dates.map((d) => d.getUTCDate())).toEqual([4, 11, 18, 25]);
    expect(dates.every((d) => d.getUTCDay() === 6 && d.getUTCMonth() === 6)).toBe(true);
  });

  it('returns every Friday in August 2026', () => {
    // August 2026: the 1st is a Saturday, so Fridays fall on 7, 14, 21, 28.
    const dates = previewSessionDates(5, '2026-08');
    expect(dates.map((d) => d.getUTCDate())).toEqual([7, 14, 21, 28]);
  });

  it('does not spill into the next month on a leap-year February', () => {
    // 2028 is a leap year; February 1 2028 is a Tuesday, so Tuesdays fall
    // on 1, 8, 15, 22, 29 (the 29th exists — this is the edge case).
    const dates = previewSessionDates(2, '2028-02');
    expect(dates.map((d) => d.getUTCDate())).toEqual([1, 8, 15, 22, 29]);
    expect(dates.every((d) => d.getUTCMonth() === 1)).toBe(true);
  });

  it('returns an empty array for a weekday/month combination with zero matches is impossible, but returns exactly 4 for a short-month edge case', () => {
    // September 2026: the 1st is a Tuesday, so Sundays fall on 6, 13, 20, 27.
    const dates = previewSessionDates(0, '2026-09');
    expect(dates.map((d) => d.getUTCDate())).toEqual([6, 13, 20, 27]);
  });

  it('returns UTC-midnight dates, matching the app-wide calendar-date convention', () => {
    // Local-midnight dates would serialize (toISOString) and display
    // (formatDateWithWeekday, which formats in UTC) as the PREVIOUS day
    // on any GMT+ browser — sessions stored at 16:00Z were the result.
    const dates = previewSessionDates(6, '2026-07');
    expect(dates.map((d) => d.toISOString())).toEqual([
      '2026-07-04T00:00:00.000Z',
      '2026-07-11T00:00:00.000Z',
      '2026-07-18T00:00:00.000Z',
      '2026-07-25T00:00:00.000Z',
    ]);
  });
});
