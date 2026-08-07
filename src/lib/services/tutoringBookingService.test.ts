import { describe, it, expect } from 'vitest';
import {
  toMinutes,
  minutesToHHMM,
  utcDateKey,
  taipeiDateKey,
  countOverlapsInSlot,
  buildSlotRemaining,
  hasCapacityForRange,
  isCancellationLate,
} from './tutoringBookingService';

describe('toMinutes / minutesToHHMM', () => {
  it('round-trips', () => {
    expect(toMinutes('16:00')).toBe(960);
    expect(toMinutes('21:30')).toBe(1290);
    expect(minutesToHHMM(960)).toBe('16:00');
    expect(minutesToHHMM(1290)).toBe('21:30');
  });
});

describe('utcDateKey / taipeiDateKey', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(utcDateKey(new Date('2026-08-07T00:00:00.000Z'))).toBe('2026-08-07');
  });
});

describe('countOverlapsInSlot', () => {
  it('counts ranges whose interval overlaps the slot, excluding head-to-tail touches', () => {
    const ranges = [
      { startTime: '16:00', endTime: '18:00' },
      { startTime: '18:00', endTime: '20:00' }, // touches the first range's end, not an overlap
    ];
    expect(countOverlapsInSlot(toMinutes('16:00'), toMinutes('16:30'), ranges)).toBe(1);
    expect(countOverlapsInSlot(toMinutes('17:30'), toMinutes('18:00'), ranges)).toBe(1);
    expect(countOverlapsInSlot(toMinutes('18:00'), toMinutes('18:30'), ranges)).toBe(1);
  });
});

describe('buildSlotRemaining', () => {
  it('returns one entry per 30-minute slot with remaining = capacity - overlap count', () => {
    const slots = buildSlotRemaining('16:00', '17:00', 8, [{ startTime: '16:00', endTime: '16:30' }]);
    expect(slots).toEqual([
      { startTime: '16:00', remaining: 7 },
      { startTime: '16:30', remaining: 8 },
    ]);
  });

  it('never goes below zero when already over capacity', () => {
    const existing = Array.from({ length: 9 }, () => ({ startTime: '16:00', endTime: '16:30' }));
    const slots = buildSlotRemaining('16:00', '16:30', 8, existing);
    expect(slots[0].remaining).toBe(0);
  });
});

describe('hasCapacityForRange', () => {
  it('allows a candidate when every covered slot is under capacity', () => {
    const existing = [{ startTime: '16:00', endTime: '18:00' }];
    expect(hasCapacityForRange('16:00', '21:00', 2, existing, { startTime: '16:00', endTime: '18:00' })).toBe(true);
  });

  it('rejects when any covered slot would reach capacity', () => {
    const existing = [{ startTime: '16:00', endTime: '18:00' }];
    expect(hasCapacityForRange('16:00', '21:00', 1, existing, { startTime: '17:00', endTime: '19:00' })).toBe(false);
  });

  it('allows a candidate that starts exactly when an existing one ends (no overlap at the boundary)', () => {
    const existing = [{ startTime: '16:00', endTime: '18:00' }];
    expect(hasCapacityForRange('16:00', '21:00', 1, existing, { startTime: '18:00', endTime: '20:00' })).toBe(true);
  });
});

describe('isCancellationLate', () => {
  it('is not late when today is before the booking date', () => {
    expect(isCancellationLate('2026-08-15', '2026-08-14')).toBe(false);
  });

  it('is late on the booking date itself', () => {
    expect(isCancellationLate('2026-08-15', '2026-08-15')).toBe(true);
  });

  it('is late after the booking date has passed', () => {
    expect(isCancellationLate('2026-08-15', '2026-08-20')).toBe(true);
  });
});
