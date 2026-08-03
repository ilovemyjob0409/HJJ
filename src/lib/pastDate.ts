// Shared "has this date passed?" rule for registration cancellation, matching
// the listOpen* boundary (date >= today midnight counts as still open).
export function isBeforeToday(date: Date | string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(date) < today;
}
