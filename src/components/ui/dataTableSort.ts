export type SortDirection = 'asc' | 'desc';

export interface SortState {
  columnIndex: number;
  direction: SortDirection;
}

export interface SortableColumn<T> {
  sortValue?: (row: T) => string | number | Date | null | undefined;
}

const collator = new Intl.Collator('zh-Hant');

export function nextSortState(current: SortState | null, columnIndex: number): SortState | null {
  if (!current || current.columnIndex !== columnIndex) return { columnIndex, direction: 'asc' };
  if (current.direction === 'asc') return { columnIndex, direction: 'desc' };
  return null;
}

export function sortRows<T>(rows: T[], columns: SortableColumn<T>[], sort: SortState | null): T[] {
  if (!sort) return rows;
  const sortValue = columns[sort.columnIndex]?.sortValue;
  if (!sortValue) return rows;

  return [...rows].sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;

    let cmp: number;
    if (av instanceof Date && bv instanceof Date) {
      cmp = av.getTime() - bv.getTime();
    } else if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv;
    } else {
      cmp = collator.compare(String(av), String(bv));
    }
    return sort.direction === 'asc' ? cmp : -cmp;
  });
}
