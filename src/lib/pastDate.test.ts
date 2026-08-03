import { describe, expect, it } from 'vitest';
import { isBeforeToday } from './pastDate';

describe('isBeforeToday', () => {
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
