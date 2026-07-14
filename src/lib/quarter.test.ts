import { describe, it, expect } from 'vitest';
import { getQuarter, isSameQuarter, getQuarterRange } from './quarter';

describe('getQuarter', () => {
  it('returns Q1 for January', () => {
    expect(getQuarter(new Date(2026, 0, 15))).toEqual({ year: 2026, quarter: 1 });
  });
  it('returns Q2 for April', () => {
    expect(getQuarter(new Date(2026, 3, 1))).toEqual({ year: 2026, quarter: 2 });
  });
  it('returns Q3 for September', () => {
    expect(getQuarter(new Date(2026, 8, 30))).toEqual({ year: 2026, quarter: 3 });
  });
  it('returns Q4 for December', () => {
    expect(getQuarter(new Date(2026, 11, 31))).toEqual({ year: 2026, quarter: 4 });
  });
});

describe('isSameQuarter', () => {
  it('is true for two dates in the same quarter', () => {
    expect(isSameQuarter(new Date(2026, 0, 1), new Date(2026, 2, 31))).toBe(true);
  });
  it('is false for dates in different quarters', () => {
    expect(isSameQuarter(new Date(2026, 2, 31), new Date(2026, 3, 1))).toBe(false);
  });
  it('is false for the same quarter number in different years', () => {
    expect(isSameQuarter(new Date(2025, 0, 1), new Date(2026, 0, 1))).toBe(false);
  });
});

describe('getQuarterRange', () => {
  it('returns the full Q1 range', () => {
    const { start, end } = getQuarterRange(new Date(2026, 1, 10));
    expect(start).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 2, 31, 23, 59, 59, 999));
  });
  it('returns the full Q4 range', () => {
    const { start, end } = getQuarterRange(new Date(2026, 10, 5));
    expect(start).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999));
  });
});
