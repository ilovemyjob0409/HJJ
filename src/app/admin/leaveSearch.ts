import { getStatusBadgeConfig } from '@/components/ui/StatusBadge';
import { matchesKeyword } from '@/lib/searchMatch';

interface LeaveSearchRow {
  student: { user: { name: string } };
  class: { name: string };
  makeupRequest: {
    type: string;
    status: string;
    targetClass: { name: string } | null;
    teacher: { user: { name: string } } | null;
  } | null;
}

export function matchesLeaveSearch(row: LeaveSearchRow, query: string): boolean {
  const parts = [
    row.student.user.name,
    row.class.name,
    row.makeupRequest?.type === 'INSERTION' ? row.makeupRequest.targetClass?.name ?? '' : '',
    row.makeupRequest?.type === 'ONE_ON_ONE' ? `一對一 ${row.makeupRequest.teacher?.user.name ?? ''}` : '',
    row.makeupRequest?.type === 'INSERTION' ? '插班' : '',
    row.makeupRequest ? getStatusBadgeConfig(row.makeupRequest.status).label : '尚未申請',
  ];

  return matchesKeyword(parts, query);
}
