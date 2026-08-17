import { describe, it, expect } from 'vitest';
import { nextSortState, sortRows } from './dataTableSort';

describe('nextSortState', () => {
  it('sets ascending when no current sort', () => {
    expect(nextSortState(null, 0)).toEqual({ columnIndex: 0, direction: 'asc' });
  });

  it('sets ascending when switching to a different column', () => {
    expect(nextSortState({ columnIndex: 0, direction: 'desc' }, 1)).toEqual({ columnIndex: 1, direction: 'asc' });
  });

  it('cycles the same column from ascending to descending', () => {
    expect(nextSortState({ columnIndex: 0, direction: 'asc' }, 0)).toEqual({ columnIndex: 0, direction: 'desc' });
  });

  it('clears the sort when cycling past descending on the same column', () => {
    expect(nextSortState({ columnIndex: 0, direction: 'desc' }, 0)).toBeNull();
  });
});

describe('sortRows', () => {
  interface Row {
    id: number;
    name: string;
    date: Date | null;
    count: number;
  }

  const rows: Row[] = [
    { id: 1, name: '王小明', date: new Date('2026-08-05'), count: 3 },
    { id: 2, name: '陳小華', date: new Date('2026-08-01'), count: 1 },
    { id: 3, name: '林小美', date: null, count: 2 },
  ];

  const columns = [
    { sortValue: (r: Row) => r.name },
    { sortValue: (r: Row) => r.date },
    { sortValue: (r: Row) => r.count },
    {},
  ];

  it('returns the same array reference when sort is null', () => {
    expect(sortRows(rows, columns, null)).toBe(rows);
  });

  it('returns rows unchanged when the target column has no sortValue', () => {
    expect(sortRows(rows, columns, { columnIndex: 3, direction: 'asc' })).toEqual(rows);
  });

  it('sorts strings using zh-Hant collation, ascending', () => {
    const result = sortRows(rows, columns, { columnIndex: 0, direction: 'asc' });
    expect(result.map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it('sorts strings descending', () => {
    const result = sortRows(rows, columns, { columnIndex: 0, direction: 'desc' });
    expect(result.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('sorts dates ascending and puts null last', () => {
    const result = sortRows(rows, columns, { columnIndex: 1, direction: 'asc' });
    expect(result.map((r) => r.id)).toEqual([2, 1, 3]);
  });

  it('sorts dates descending and still puts null last', () => {
    const result = sortRows(rows, columns, { columnIndex: 1, direction: 'desc' });
    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('sorts numbers descending', () => {
    const result = sortRows(rows, columns, { columnIndex: 2, direction: 'desc' });
    expect(result.map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it('does not mutate the input array', () => {
    const original = [...rows];
    sortRows(rows, columns, { columnIndex: 2, direction: 'asc' });
    expect(rows).toEqual(original);
  });
});
