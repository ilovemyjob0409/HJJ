import { ReactNode } from 'react';

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
}

export default function DataTable<T>({ columns, rows, keyField, onRowClick, rowClassName, onRowMouseLeave }: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-brandDark bg-brand text-left text-ink">
            {columns.map((col, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-2 font-semibold">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const key = keyField(row);
            const customClass = rowClassName?.(row) ?? '';
            const stripeClass = customClass ? '' : index % 2 === 1 ? 'bg-gray-50' : 'bg-white';
            return (
              <tr
                key={key}
                id={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onMouseLeave={onRowMouseLeave ? () => onRowMouseLeave(row) : undefined}
                className={`border-b border-gray-100 ${stripeClass} ${customClass}`}
              >
                {columns.map((col, i) => (
                  <td key={i} className="whitespace-nowrap px-4 py-3 text-ink">
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
