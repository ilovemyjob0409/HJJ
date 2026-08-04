import { Fragment, ReactNode } from 'react';
import { getCellClass } from './dataTableCellClass';

export interface Column<T> {
  header: ReactNode;
  render: (row: T) => ReactNode;
  // 欄寬 class（如 w-40）：md:table-fixed 下由表頭寬度決定整欄，其餘未指定的欄平分剩餘寬度
  width?: string;
  // 額外套用到該欄 th 與 td 的 class
  className?: string;
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
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-borderSubtle">
      <table className="w-full table-auto border-collapse text-sm md:table-fixed">
        <thead>
          <tr className="border-b border-brandDark bg-brand text-center text-brandInk">
            {columns.map((col, i) => (
              <th
                key={i}
                className={getCellClass('whitespace-nowrap px-4 py-2 font-semibold md:whitespace-normal', col)}
              >
                {col.header}
              </th>
            ))}
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
        ) : (
          <tbody className="animate-fade-in">
            {rows.map((row, index) => {
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
