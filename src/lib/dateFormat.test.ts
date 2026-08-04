import { describe, it, expect, vi, afterEach } from 'vitest';
import { isTodayTaipei } from './dateFormat';

describe('isTodayTaipei', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('crosses the day boundary on Taipei time, not UTC', () => {
    vi.useFakeTimers();
    // UTC 還在 8/4 晚上，但台北已是 8/5 凌晨 02:30
    vi.setSystemTime(new Date('2026-08-04T18:30:00Z'));

    expect(isTodayTaipei(new Date('2026-08-05T00:00:00Z'))).toBe(true);
    expect(isTodayTaipei(new Date('2026-08-04T00:00:00Z'))).toBe(false);
  });

  it('accepts date-only strings (UTC calendar days)', () => {
    vi.useFakeTimers();
    // 台北 8/5 中午
    vi.setSystemTime(new Date('2026-08-05T04:00:00Z'));

    expect(isTodayTaipei('2026-08-05')).toBe(true);
    expect(isTodayTaipei('2026-08-06')).toBe(false);
  });
});
