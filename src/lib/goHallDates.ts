// Returns every date in the given month ("YYYY-MM") that falls on the
// given weekday (0 = Sunday ... 6 = Saturday). Used by the admin go-hall
// "batch open sessions" form to preview which dates a weekday+month
// combination would generate, before any exclusions or the actual
// POST /api/go-hall-sessions call.
export function previewSessionDates(weekday: number, month: string): Date[] {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const dates: Date[] = [];
  const cursor = new Date(year, monthIndex, 1);
  while (cursor.getMonth() === monthIndex) {
    if (cursor.getDay() === weekday) {
      dates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}
