import { formatDateWithWeekday } from '@/lib/dateFormat';
import { matchesKeyword } from '@/lib/searchMatch';

interface GoHallSummarySearchRow {
  date: Date;
  capacity: number;
  registeredCount: number;
}

export function matchesGoHallSummarySearch(row: GoHallSummarySearchRow, query: string): boolean {
  const statusLabel = row.registeredCount >= row.capacity ? '已額滿' : '尚有名額';
  const parts = [formatDateWithWeekday(row.date, 'zh-TW'), statusLabel];

  return matchesKeyword(parts, query);
}
