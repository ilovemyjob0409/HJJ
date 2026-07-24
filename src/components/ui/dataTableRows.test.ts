import { describe, it, expect } from 'vitest';
import { getVisibleRows } from './dataTableRows';

describe('getVisibleRows', () => {
  it('returns all rows when maxRows is undefined', () => {
    expect(getVisibleRows([1, 2, 3, 4], undefined, false)).toEqual([1, 2, 3, 4]);
  });

  it('returns all rows when rows.length is less than or equal to maxRows', () => {
    expect(getVisibleRows([1, 2, 3], 3, false)).toEqual([1, 2, 3]);
  });

  it('slices to maxRows when collapsed and rows exceed maxRows', () => {
    expect(getVisibleRows([1, 2, 3, 4, 5], 3, false)).toEqual([1, 2, 3]);
  });

  it('returns all rows when expanded is true regardless of maxRows', () => {
    expect(getVisibleRows([1, 2, 3, 4, 5], 3, true)).toEqual([1, 2, 3, 4, 5]);
  });
});
