import { describe, it, expect } from 'vitest';
import { isActionColumn, buildSortOptions, sortStateToValue, parseSortValue } from './dataTableCard';

describe('isActionColumn', () => {
  it('treats a 操作 header as an action column', () => {
    expect(isActionColumn('操作')).toBe(true);
  });

  it('treats an empty or missing header as an action column', () => {
    expect(isActionColumn('')).toBe(true);
    expect(isActionColumn(null)).toBe(true);
    expect(isActionColumn(undefined)).toBe(true);
  });

  it('treats a normal text header as a field column', () => {
    expect(isActionColumn('日期')).toBe(false);
    expect(isActionColumn('簽到')).toBe(false);
  });
});

describe('buildSortOptions', () => {
  it('emits asc and desc options for each sortable string-header column, keyed by column index', () => {
    const columns = [
      { header: '日期', sortValue: () => 1 },
      { header: '時間' },
      { header: '老師', sortValue: () => 'a' },
    ];
    expect(buildSortOptions(columns)).toEqual([
      { value: '0:asc', label: '日期 ↑' },
      { value: '0:desc', label: '日期 ↓' },
      { value: '2:asc', label: '老師 ↑' },
      { value: '2:desc', label: '老師 ↓' },
    ]);
  });

  it('skips sortable columns whose header is not a plain string', () => {
    const columns = [{ header: 123 as unknown as string, sortValue: () => 1 }];
    expect(buildSortOptions(columns)).toEqual([]);
  });

  it('returns an empty list when no column is sortable', () => {
    expect(buildSortOptions([{ header: '日期' }, { header: '操作' }])).toEqual([]);
  });
});

describe('sortStateToValue / parseSortValue', () => {
  it('round-trips a sort state through its select value', () => {
    expect(sortStateToValue({ columnIndex: 2, direction: 'desc' })).toBe('2:desc');
    expect(parseSortValue('2:desc')).toEqual({ columnIndex: 2, direction: 'desc' });
    expect(parseSortValue('0:asc')).toEqual({ columnIndex: 0, direction: 'asc' });
  });

  it('maps the empty value to no sorting and back', () => {
    expect(sortStateToValue(null)).toBe('');
    expect(parseSortValue('')).toBeNull();
  });
});
