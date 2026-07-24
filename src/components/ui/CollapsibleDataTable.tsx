'use client';

import { useState } from 'react';
import DataTable, { Column } from './DataTable';
import { getVisibleRows } from './dataTableRows';

interface CollapsibleDataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  onRowMouseLeave?: (row: T) => void;
  maxRows?: number;
}

export default function CollapsibleDataTable<T>({
  columns,
  rows,
  keyField,
  onRowClick,
  rowClassName,
  onRowMouseLeave,
  maxRows,
}: CollapsibleDataTableProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = getVisibleRows(rows, maxRows, expanded);
  const showFooter = maxRows != null && rows.length > maxRows;

  return (
    <DataTable
      columns={columns}
      rows={visibleRows}
      keyField={keyField}
      onRowClick={onRowClick}
      rowClassName={rowClassName}
      onRowMouseLeave={onRowMouseLeave}
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
