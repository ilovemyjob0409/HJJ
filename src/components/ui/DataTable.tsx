'use client';

import { ReactNode, useState } from 'react';
import { getVisibleRows } from './dataTableRows';

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  onRowMouseLeave?: (row: T) => void;
  maxRows?: number;
}

export default function DataTable<T>({
  columns,
  rows,
  keyField,
  onRowClick,
  rowClassName,
  onRowMouseLeave,
  maxRows,
}: DataTableProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = getVisibleRows(rows, maxRows, expanded);
  const showFooter = maxRows != null && rows.length > maxRows;

  return (
    <div className="overflow-x-auto rounded-lg border border-borderSubtle">
      <table className="w-full table-auto border-collapse text-sm md:table-fixed">
        <thead>
          <tr className="border-b border-brandDark bg-brand text-center text-brandInk">
            {columns.map((col, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-2 font-semibold md:whitespace-normal">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, index) => {
            const key = keyField(row);
            const customClass = rowClassName?.(row) ?? '';
            // Only a base bg-* utility (e.g. a highlight override) should suppress
            // the zebra stripe — a variant like hover:bg-stripe shouldn't, since it
            // only paints on hover and layers fine on top of the stripe underneath.
            const hasBaseBackground = customClass.split(/\s+/).some((c) => c.startsWith('bg-'));
            const stripeClass = hasBaseBackground ? '' : index % 2 === 1 ? 'bg-stripe' : 'bg-card';
            return (
              <tr
                key={key}
                id={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onMouseLeave={onRowMouseLeave ? () => onRowMouseLeave(row) : undefined}
                className={`border-b border-borderSubtle ${stripeClass} ${customClass}`}
              >
                {columns.map((col, i) => (
                  <td key={i} className="whitespace-nowrap px-4 py-3 text-center text-ink md:whitespace-normal">
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {showFooter && (
        <div className="flex items-center justify-between border-t border-borderSubtle px-4 py-2 text-sm text-inkMuted">
          <span>
            顯示 {visibleRows.length} / {rows.length} 筆
          </span>
          <button
            type="button"
            className="font-medium text-brandDark hover:underline"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? '收合' : '展開全部'}
          </button>
        </div>
      )}
    </div>
  );
}
