import { getStatusBadgeConfig } from '@/components/ui/StatusBadge';
import { matchesKeyword } from '@/lib/searchMatch';

interface SubstituteSearchRow {
  reason: string;
  status: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
  substituteTeacher: { user: { name: string } } | null;
}

export function matchesSubstituteSearch(row: SubstituteSearchRow, query: string): boolean {
  const parts = [
    row.class.name,
    row.originalTeacher.user.name,
    row.reason,
    row.substituteTeacher?.user.name ?? '',
    getStatusBadgeConfig(row.status).label,
  ];

  return matchesKeyword(parts, query);
}
