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
    slotDate: Date | null;
    cancelRequestedAt: Date | null;
  } | null;
}

export default function LeaveHistoryTable({ rows }: { rows: LeaveRow[] }) {
  const columns: Column<LeaveRow>[] = [
    { header: '請假班級', render: (r) => r.class.name, sortValue: (r) => r.class.name },
    { header: '請假日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
    {
      header: '類別',
      render: (r) => {
        const m = r.makeupRequest;
        if (!m) return <span className="text-inkMuted">—</span>;
        return m.type === 'INSERTION' ? (
          <span className="whitespace-nowrap rounded-full bg-approvedBg px-2.5 py-0.5 text-xs font-bold text-approved">插班</span>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">一對一</span>
        );
      },
      sortValue: (r) => r.makeupRequest?.type ?? null,
    },
    {
      header: '補課日期',
      render: (r) => {
        const m = r.makeupRequest;
        if (!m) return '-';
        const d = m.type === 'INSERTION' ? m.targetDate : m.slotDate;
        return d ? formatDateWithWeekday(d) : '-';
      },
      sortValue: (r) => {
        const m = r.makeupRequest;
        if (!m) return null;
        return m.type === 'INSERTION' ? m.targetDate : m.slotDate;
      },
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
