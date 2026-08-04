export function getCellClass(base: string, col: { width?: string; className?: string }): string {
  return [base, col.width, col.className].filter(Boolean).join(' ');
}
