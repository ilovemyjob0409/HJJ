import { ReactNode } from 'react';

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
}

export default function DataTable<T>({ columns, rows, keyField }: DataTableProps<T>) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-inkMuted">
          {columns.map((col, i) => (
            <th key={i} className="py-2 pr-4 font-medium">
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={keyField(row)} className="border-b border-gray-100">
            {columns.map((col, i) => (
              <td key={i} className="py-3 pr-4 text-ink">
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
