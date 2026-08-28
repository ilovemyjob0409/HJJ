import { describe, expect, it, afterEach } from 'vitest';
import { isBeforeToday } from './pastDate';

describe('isBeforeToday', () => {
  describe('Taipei day boundary (server clock running in UTC)', () => {
    const originalTZ = process.env.TZ;
    afterEach(() => {
      process.env.TZ = originalTZ;
    });

    it('treats a Taipei-yesterday date as already past even though the UTC server day has not rolled over', () => {
      process.env.TZ = 'UTC';
      // 瞬間 = UTC 2026-01-15 20:00 = 台北 2026-01-16 04:00：台北已經跨到
      // 1/16，但伺服器（UTC）當地日期仍是 1/15。
      const now = new Date('2026-01-15T20:00:00.000Z');
      const taipeiYesterday = new Date('2026-01-15T00:00:00.000Z'); // 台北 1/15 這一天
      expect(isBeforeToday(taipeiYesterday, now)).toBe(true);
    });

    it('does not treat a Taipei-today date as past', () => {
      process.env.TZ = 'UTC';
      const now = new Date('2026-01-15T20:00:00.000Z');
      const taipeiToday = new Date('2026-01-16T00:00:00.000Z'); // 台北 1/16 這一天
      expect(isBeforeToday(taipeiToday, now)).toBe(false);
    });
  });

  it('returns true for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isBeforeToday(yesterday)).toBe(true);
  });

  it('returns false for today, even at midnight', () => {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    expect(isBeforeToday(new Date())).toBe(false);
    expect(isBeforeToday(todayMidnight)).toBe(false);
  });

  it('returns false for tomorrow', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isBeforeToday(tomorrow)).toBe(false);
  });

  it('accepts ISO strings as the API serialises dates', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isBeforeToday(yesterday.toISOString())).toBe(true);
  });
});
