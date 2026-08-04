import { describe, it, expect } from 'vitest';
import { oneOnOneEndTime, ONE_ON_ONE_DURATION_MINUTES } from './oneOnOneSlot';

describe('oneOnOneEndTime', () => {
  it('adds the fixed duration', () => {
    expect(ONE_ON_ONE_DURATION_MINUTES).toBe(40);
    expect(oneOnOneEndTime('16:00')).toBe('16:40');
  });

  it('rolls over the hour and zero-pads', () => {
    expect(oneOnOneEndTime('17:30')).toBe('18:10');
    expect(oneOnOneEndTime('09:25')).toBe('10:05');
  });
});
