import { describe, it, expect } from 'vitest';
import { formatActivityDateRange } from './activityDateRange';

describe('formatActivityDateRange', () => {
  it('renders a single-day activity as one formatted date', () => {
    const day = new Date(2026, 7, 1);
    expect(formatActivityDateRange(day, day, 'zh-TW')).toBe('2026/8/1（六）');
  });

  it('renders a multi-day activity as start ~ end, each side individually formatted', () => {
    const start = new Date(2026, 7, 15);
    const end = new Date(2026, 7, 17);
    expect(formatActivityDateRange(start, end, 'zh-TW')).toBe('2026/8/15（六） ~ 2026/8/17（一）');
  });
});
