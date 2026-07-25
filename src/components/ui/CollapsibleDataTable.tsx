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
  loading?: boolean;
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
      loading={loading}
      footer={
        showFooter ? (
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
        ) : undefined
      }
    />
  );
}
