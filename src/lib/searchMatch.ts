export function matchesKeyword(parts: string[], query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return parts.join(' ').toLowerCase().includes(q);
}
