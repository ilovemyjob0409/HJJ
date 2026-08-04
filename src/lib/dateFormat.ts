export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

// Default to zh-TW so server-rendered pages don't follow the host's locale
// (Vercel/Node defaults to en-US and produced M/D/YYYY on the dashboard).
export function formatDateWithWeekday(date: Date | string, locale: string = 'zh-TW'): string {
  const d = new Date(date);
  // Every caller passes a pure calendar date (a leave/class/session/target
  // date, not "the current moment") serialized as UTC midnight — either a
  // date-only string or a Prisma DateTime over JSON. Reading local
  // components here would make the displayed date and weekday depend on
  // the server's timezone instead of the calendar date itself.
  const dateStr = d.toLocaleDateString(locale, { timeZone: 'UTC' });
  return `${dateStr}（${WEEKDAY_LABELS[d.getUTCDay()]}）`;
}
