'use client';

import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import CancelMakeupButton from './CancelMakeupButton';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface LeaveRow {
  id: string;
  date: Date;
  reason: string;
  class: { name: string };
  makeupRequest: {
    id: string;
    type: string;
    status: string;
    targetDate: Date | null;
    cancelRequestedAt: Date | null;
  } | null;
}

export default function LeaveHistoryTable({ rows }: { rows: LeaveRow[] }) {
  const columns: Column<LeaveRow>[] = [
    { header: '請假班級', render: (r) => r.class.name, sortValue: (r) => r.class.name },
    { header: '請假日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
    {
      header: '插班日期',
      render: (r) =>
        r.makeupRequest?.type === 'INSERTION' && r.makeupRequest.targetDate
          ? formatDateWithWeekday(r.makeupRequest.targetDate)
          : '-',
      sortValue: (r) => (r.makeupRequest?.type === 'INSERTION' ? r.makeupRequest.targetDate : null),
    },
    {
      header: '補課狀態',
      render: (r) => {
        if (!r.makeupRequest) return <span className="text-inkMuted">尚未申請</span>;
        return (
          <div className="flex flex-col items-center gap-1">
            <StatusBadge status={r.makeupRequest.status} />
            {r.makeupRequest.status === 'APPROVED' &&
              (r.makeupRequest.cancelRequestedAt ? (
                <span className="text-xs text-pending">撤銷申請中</span>
              ) : (
                <CancelMakeupButton makeupRequestId={r.makeupRequest.id} />
              ))}
          </div>
        );
      },
      sortValue: (r) => r.makeupRequest?.status ?? null,
    },
  ];

  return (
    <CollapsibleDataTable
      columns={columns}
      rows={rows}
      keyField={(r) => r.id}
      maxRows={3}
      emptyText="目前沒有請假與插班紀錄"
    />
  );
}
