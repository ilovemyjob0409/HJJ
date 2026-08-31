import { ReactNode } from 'react';
import { SortState } from './dataTableSort';

// 卡片模式下視為「操作欄」：表頭空白或叫「操作」的欄位，內容移到卡片底部且不顯示標籤
export function isActionColumn(header: ReactNode): boolean {
  return header == null || header === '' || header === '操作';
}

export interface SortOption {
  value: string;
  label: string;
}

// 卡片模式的排序下拉選項；表頭不是純字串的欄位無法轉成選項文字，直接略過
export function buildSortOptions(columns: { header: ReactNode; sortValue?: unknown }[]): SortOption[] {
  const options: SortOption[] = [];
  columns.forEach((col, i) => {
    if (!col.sortValue || typeof col.header !== 'string') return;
    options.push({ value: `${i}:asc`, label: `${col.header} ↑` });
    options.push({ value: `${i}:desc`, label: `${col.header} ↓` });
  });
  return options;
}

export function sortStateToValue(sort: SortState | null): string {
  return sort ? `${sort.columnIndex}:${sort.direction}` : '';
}

export function parseSortValue(value: string): SortState | null {
  if (!value) return null;
  const [index, direction] = value.split(':');
  return { columnIndex: Number(index), direction: direction === 'desc' ? 'desc' : 'asc' };
}
