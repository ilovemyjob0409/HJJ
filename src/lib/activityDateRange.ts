import { formatDateWithWeekday } from './dateFormat';

export function formatActivityDateRange(startDate: Date | string, endDate: Date | string, locale?: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startStr = formatDateWithWeekday(start, locale);
  if (start.toDateString() === end.toDateString()) return startStr;
  return `${startStr} ~ ${formatDateWithWeekday(end, locale)}`;
}
