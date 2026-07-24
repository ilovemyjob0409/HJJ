import { formatDateWithWeekday } from '@/lib/dateFormat';
import { matchesKeyword } from '@/lib/searchMatch';

interface SessionSearchRow {
  date: string;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
}

export function matchesSessionSearch(row: SessionSearchRow, query: string): boolean {
  const parts = [
    formatDateWithWeekday(row.date, 'zh-TW'),
    `${row.startTime}-${row.endTime}`,
    row.teacher.user.name,
  ];

  return matchesKeyword(parts, query);
}
