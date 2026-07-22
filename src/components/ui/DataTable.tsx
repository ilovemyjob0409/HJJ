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
    <div className="overflow-x-auto rounded-lg border border-borderSubtle">
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b border-brandDark bg-brand text-center text-brandInk">
            {columns.map((col, i) => (
              <th key={i} className="px-4 py-2 font-semibold" style={{ width: `${100 / columns.length}%` }}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
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
                  <td key={i} className="px-4 py-3 text-center text-ink">
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
