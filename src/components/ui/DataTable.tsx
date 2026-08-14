'use client';

import { Fragment, ReactNode, useState } from 'react';
import { getCellClass } from './dataTableCellClass';
import { SortState, nextSortState, sortRows } from './dataTableSort';

export interface Column<T> {
  header: ReactNode;
  render: (row: T) => ReactNode;
  // 欄寬 class（如 w-40）：md:table-fixed 下由表頭寬度決定整欄，其餘未指定的欄平分剩餘寬度
  width?: string;
  // 額外套用到該欄 th 與 td 的 class
  className?: string;
  // 有給這個欄位，表頭才會顯示排序按鈕；回傳可比較的值，null/undefined 一律排最後
  sortValue?: (row: T) => string | number | Date | null | undefined;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  onRowMouseLeave?: (row: T) => void;
  footer?: ReactNode;
  loading?: boolean;
  // 展開列：expandedKey 對到哪一列，就在該列下方插入一列跨欄內容
  expandedKey?: string | null;
  renderExpanded?: (row: T) => ReactNode;
  // 無資料時顯示的提示文字；未傳則維持只剩表頭的現狀
  emptyText?: string;
  // 受控排序：有傳 onSortChange 就不自己排序 rows（信任呼叫端已經排好），只負責顯示狀態與回報點擊
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
}

function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  if (direction === 'asc') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0 text-[#4A2E1D]"
        aria-hidden="true"
      >
        <polyline points="6 15 12 9 18 15" />
      </svg>
    );
  }
  if (direction === 'desc') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0 text-[#4A2E1D]"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0 opacity-35 transition-opacity group-hover:opacity-100 group-hover:text-[#4A2E1D]"
      aria-hidden="true"
    >
      <polyline points="7 10 12 6 17 10" />
      <polyline points="7 14 12 18 17 14" />
    </svg>
  );
}

export default function DataTable<T>({
  columns,
  rows,
  keyField,
  onRowClick,
  rowClassName,
  onRowMouseLeave,
  footer,
  loading,
  expandedKey,
  renderExpanded,
  emptyText,
  sort,
  onSortChange,
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = useState<SortState | null>(null);
  const controlled = onSortChange !== undefined;
  const activeSort = controlled ? (sort ?? null) : internalSort;
  const displayRows = controlled ? rows : sortRows(rows, columns, internalSort);

  function handleSortClick(columnIndex: number) {
    const next = nextSortState(activeSort, columnIndex);
    if (controlled) {
      onSortChange!(next);
    } else {
      setInternalSort(next);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-borderSubtle">
      <table className="w-full table-auto border-collapse text-sm md:table-fixed">
        <thead>
          <tr className="border-b border-brandDark bg-brand text-center text-brandInk">
            {columns.map((col, i) => {
              const isSortable = !!col.sortValue;
              const direction = activeSort?.columnIndex === i ? activeSort.direction : null;
              return (
                <th
                  key={i}
                  aria-sort={isSortable ? (direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none') : undefined}
                  className={getCellClass(
                    isSortable
                      ? 'whitespace-nowrap font-semibold md:whitespace-normal'
                      : 'whitespace-nowrap px-4 py-2 font-semibold md:whitespace-normal',
                    col
                  )}
                >
                  {isSortable ? (
                    <button
                      type="button"
                      onClick={() => handleSortClick(i)}
                      className="group flex w-full items-center justify-center gap-1 px-4 py-2 transition-colors hover:bg-[#4A2E1D]/10"
                    >
                      {col.header}
                      <SortIcon direction={direction} />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {loading ? (
          <tbody aria-hidden>
            {Array.from({ length: 5 }).map((_, r) => (
              <tr key={r} className={`border-b border-borderSubtle ${r % 2 === 1 ? 'bg-stripe' : 'bg-card'}`}>
                {columns.map((col, c) => (
                  <td key={c} className={getCellClass('px-4 py-3', col)}>
                    <div className="skeleton-shimmer mx-auto h-4 w-3/4 rounded" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : displayRows.length === 0 && emptyText ? (
          <tbody>
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-inkMuted">
                {emptyText}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody className="animate-fade-in">
            {displayRows.map((row, index) => {
              const key = keyField(row);
              const customClass = rowClassName?.(row) ?? '';
              // Only a base bg-* utility (e.g. a highlight override) should suppress
              // the zebra stripe — a variant like hover:bg-stripe shouldn't, since it
              // only paints on hover and layers fine on top of the stripe underneath.
              const hasBaseBackground = customClass.split(/\s+/).some((c) => c.startsWith('bg-'));
              const stripeClass = hasBaseBackground ? '' : index % 2 === 1 ? 'bg-stripe' : 'bg-card';
              return (
                <Fragment key={key}>
                  <tr
                    id={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onMouseLeave={onRowMouseLeave ? () => onRowMouseLeave(row) : undefined}
                    className={`border-b border-borderSubtle ${stripeClass} ${customClass}`}
                  >
                    {columns.map((col, i) => (
                      <td
                        key={i}
                        className={getCellClass('whitespace-nowrap px-4 py-3 text-center text-ink md:whitespace-normal', col)}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                  {renderExpanded && expandedKey === key && (
                    <tr className="border-b border-borderSubtle bg-stripe">
                      <td colSpan={columns.length} className="px-4 py-4">
                        <div className="animate-fade-in text-left">{renderExpanded(row)}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        )}
      </table>
      {footer}
    </div>
  );
}
