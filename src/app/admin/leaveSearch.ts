import { getStatusBadgeConfig } from '@/components/ui/StatusBadge';
import { matchesKeyword } from '@/lib/searchMatch';

interface LeaveSearchRow {
  student: { user: { name: string } };
  class: { name: string };
  makeupRequest: {
    type: string;
    status: string;
    targetClass: { name: string } | null;
  } | null;
}

export function matchesLeaveSearch(row: LeaveSearchRow, query: string): boolean {
  const parts = [
    row.student.user.name,
    row.class.name,
    row.makeupRequest?.type === 'INSERTION' ? row.makeupRequest.targetClass?.name ?? '' : '',
    row.makeupRequest ? getStatusBadgeConfig(row.makeupRequest.status).label : '尚未申請',
  ];

  return matchesKeyword(parts, query);
}
