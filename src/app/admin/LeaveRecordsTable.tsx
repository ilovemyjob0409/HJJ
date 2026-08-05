'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import CollapsibleSearchInput from '@/components/ui/CollapsibleSearchInput';
import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { matchesLeaveSearch } from './leaveSearch';

interface LeaveRow {
  id: string;
  date: Date;
  reason: string;
  student: { user: { name: string } };
  class: { name: string };
  makeupRequest: {
    id: string;
    type: string;
    status: string;
    targetDate: Date | null;
    targetClass: { name: string } | null;
    slotDate: Date | null;
    slotStartTime: string | null;
    slotEndTime: string | null;
    teacher: { user: { name: string } } | null;
  } | null;
}

export default function LeaveRecordsTable({ title, rows }: { title: string; rows: LeaveRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const filteredRows = rows.filter((r) => matchesLeaveSearch(r, search));

  const columns: Column<LeaveRow>[] = [
    { header: '學生', render: (r) => r.student.user.name },
    { header: '請假班級', render: (r) => <span className="whitespace-nowrap">{r.class.name}</span> },
    { header: '請假日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW') },
    {
      header: '補課安排',
      render: (r) => {
        const m = r.makeupRequest;
        if (!m) return <span className="text-inkMuted">—</span>;
        if (m.type === 'INSERTION') {
          return (
            <div className="flex flex-col items-center gap-1">
              <span className="whitespace-nowrap rounded-full bg-stripe px-2.5 py-0.5 text-xs font-bold text-ink">插班</span>
              <span>
                <span className="whitespace-nowrap">{m.targetClass?.name ?? '-'}</span>・
                <span className="whitespace-nowrap">{m.targetDate ? formatDateWithWeekday(m.targetDate, 'zh-TW') : '-'}</span>
              </span>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center gap-1">
            <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">一對一</span>
            <span>
              {m.teacher?.user.name ?? '-'}・
              <span className="whitespace-nowrap">{m.slotDate ? formatDateWithWeekday(m.slotDate, 'zh-TW') : '-'}</span>{' '}
              <span className="whitespace-nowrap">{m.slotStartTime}-{m.slotEndTime}</span>
            </span>
          </div>
        );
      },
    },
    {
      header: '補課狀態',
      render: (r) => (r.makeupRequest ? <StatusBadge status={r.makeupRequest.status} /> : <span className="text-inkMuted">尚未申請</span>),
    },
  ];

  function handleRowClick(r: LeaveRow) {
    if (r.makeupRequest?.status === 'PENDING_ADMIN') {
      router.push(`/admin/makeup-requests?highlight=${r.makeupRequest.id}`);
    }
  }

  return (
    <>
      <div className="mb-2 flex items-center gap-3">
        <h2 className="shrink-0 whitespace-nowrap font-bold text-ink">{title}</h2>
        <CollapsibleSearchInput placeholder="搜尋學生、班級或補課狀態" value={search} onChange={setSearch} />
      </div>
      <Card>
        <CollapsibleDataTable
          columns={columns}
          rows={filteredRows}
          keyField={(r) => r.id}
          onRowClick={handleRowClick}
          rowClassName={(r) => (r.makeupRequest?.status === 'PENDING_ADMIN' ? 'cursor-pointer hover:bg-stripe' : '')}
          maxRows={search.trim() ? undefined : 3}
        />
      </Card>
    </>
  );
}
