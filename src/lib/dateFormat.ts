const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export function formatDateWithWeekday(date: Date | string, locale?: string): string {
  const d = new Date(date);
  const dateStr = d.toLocaleDateString(locale);
  return `${dateStr}（${WEEKDAY_LABELS[d.getDay()]}）`;
}
