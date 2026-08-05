'use client';

import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';

const KIND_LABELS: Record<string, string> = {
  TEACHER_AWARD: '加分',
  LOTTERY_COST: '抽獎',
  LOTTERY_WIN: '抽獎獲得',
  REDEMPTION: '兌換',
  ADMIN_ADJUST: '調整',
};

interface HistoryRow {
  id: string;
  amount: number;
  kind: string;
  reason: string;
  createdAt: Date;
  teacher: { user: { name: string } } | null;
}

export default function PointsHistoryTable({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-inkMuted">尚無點數紀錄</p>;
  }

  const columns: Column<HistoryRow>[] = [
    { header: '日期', render: (r) => formatDateWithWeekday(r.createdAt) },
    { header: '類型', render: (r) => KIND_LABELS[r.kind] ?? r.kind },
    { header: '說明', render: (r) => r.reason },
    {
      header: '點數',
      render: (r) => (
        <span className={r.amount > 0 ? 'font-semibold text-approved' : 'font-semibold text-rejected'}>
          {r.amount > 0 ? `+${r.amount}` : r.amount}
        </span>
      ),
    },
    { header: '加分老師', render: (r) => r.teacher?.user.name ?? '-' },
  ];

  return <CollapsibleDataTable columns={columns} rows={rows} keyField={(r) => r.id} maxRows={3} />;
}
