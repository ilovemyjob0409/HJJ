import { describe, it, expect } from 'vitest';
import { isWithinAvailability, slotsOverlap } from './timeSlot';

describe('isWithinAvailability', () => {
  const availabilities = [
    { weekday: 1, startTime: '16:00', endTime: '18:00' },
    { weekday: 3, startTime: '16:00', endTime: '18:00' },
  ];

  it('is true when requested slot fits exactly inside a window', () => {
    expect(isWithinAvailability({ weekday: 1, startTime: '16:00', endTime: '17:00' }, availabilities)).toBe(true);
  });
  it('is false when weekday does not match any window', () => {
    expect(isWithinAvailability({ weekday: 2, startTime: '16:00', endTime: '17:00' }, availabilities)).toBe(false);
  });
  it('is false when requested slot starts before the window', () => {
    expect(isWithinAvailability({ weekday: 1, startTime: '15:00', endTime: '17:00' }, availabilities)).toBe(false);
  });
  it('is false when requested slot ends after the window', () => {
    expect(isWithinAvailability({ weekday: 1, startTime: '17:00', endTime: '19:00' }, availabilities)).toBe(false);
  });
});

describe('slotsOverlap', () => {
  it('is true when slots partially overlap', () => {
    expect(slotsOverlap({ startTime: '16:00', endTime: '17:00' }, { startTime: '16:30', endTime: '17:30' })).toBe(true);
  });
  it('is false when slots are back-to-back with no overlap', () => {
    expect(slotsOverlap({ startTime: '16:00', endTime: '17:00' }, { startTime: '17:00', endTime: '18:00' })).toBe(false);
  });
  it('is false when slots are entirely separate', () => {
    expect(slotsOverlap({ startTime: '16:00', endTime: '17:00' }, { startTime: '17:30', endTime: '18:00' })).toBe(false);
  });
});
