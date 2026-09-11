import { describe, it, expect } from 'vitest';
import { addDaysToKey, prizeDeadlineKey, prizeRemindFromKey, PRIZE_EXPIRY_DAYS } from './prizeDates';

describe('addDaysToKey', () => {
  it('adds days across month boundaries in UTC', () => {
    expect(addDaysToKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToKey('2026-02-28', 2)).toBe('2026-03-02');
    expect(addDaysToKey('2026-03-10', -7)).toBe('2026-03-03');
  });
});

describe('prizeDeadlineKey / prizeRemindFromKey', () => {
  it('deadline is Taipei calendar day of createdAt + 30 days', () => {
    // 2026-09-10T20:00:00Z = 台北 2026-09-11 04:00 → 台北曆日 09-11
    const createdAt = new Date('2026-09-10T20:00:00Z');
    expect(prizeDeadlineKey(createdAt)).toBe(addDaysToKey('2026-09-11', PRIZE_EXPIRY_DAYS));
    expect(prizeDeadlineKey(createdAt)).toBe('2026-10-11');
  });

  it('remind-from is 7 days before the deadline', () => {
    const createdAt = new Date('2026-09-10T20:00:00Z');
    expect(prizeRemindFromKey(createdAt)).toBe('2026-10-04');
  });
});
