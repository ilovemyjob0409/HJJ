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
  // Work in UTC: calendar dates are stored and displayed as UTC midnight
  // app-wide (see dateFormat.ts). Local-midnight dates would serialize to
  // the previous day at 16:00Z from a GMT+8 browser.
  const cursor = new Date(Date.UTC(year, monthIndex, 1));
  while (cursor.getUTCMonth() === monthIndex) {
    if (cursor.getUTCDay() === weekday) {
      dates.push(new Date(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
