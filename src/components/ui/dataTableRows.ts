export function getVisibleRows<T>(rows: T[], maxRows: number | undefined, expanded: boolean): T[] {
  if (maxRows == null || expanded || rows.length <= maxRows) return rows;
  return rows.slice(0, maxRows);
}
