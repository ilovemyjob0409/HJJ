'use client';

import { useState } from 'react';
import DataTable, { Column } from './DataTable';
import { getVisibleRows } from './dataTableRows';
import { SortState, sortRows } from './dataTableSort';

interface CollapsibleDataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  onRowMouseLeave?: (row: T) => void;
  maxRows?: number;
  loading?: boolean;
  emptyText?: string;
}

export default function CollapsibleDataTable<T>({
  columns,
  rows,
  keyField,
  onRowClick,
  rowClassName,
  onRowMouseLeave,
  maxRows,
  loading,
  emptyText,
}: CollapsibleDataTableProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const sortedRows = sortRows(rows, columns, sort);
  const visibleRows = getVisibleRows(sortedRows, maxRows, expanded);
  const showFooter = maxRows != null && rows.length > maxRows;

  return (
    <DataTable
      columns={columns}
      rows={visibleRows}
      keyField={keyField}
      onRowClick={onRowClick}
      rowClassName={rowClassName}
      onRowMouseLeave={onRowMouseLeave}
      loading={loading}
      emptyText={emptyText}
      sort={sort}
      onSortChange={setSort}
      footer={
        showFooter ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex w-full cursor-pointer items-center justify-center gap-1 border-t border-borderSubtle px-4 py-2 text-sm font-medium text-brandDark transition-colors hover:bg-stripe"
          >
            {expanded ? '收合' : `展開全部（共 ${rows.length} 筆）`}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        ) : undefined
      }
    />
  );
}
