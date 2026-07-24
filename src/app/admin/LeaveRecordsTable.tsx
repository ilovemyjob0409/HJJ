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
  } | null;
}

export default function LeaveRecordsTable({ title, rows }: { title: string; rows: LeaveRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const filteredRows = rows.filter((r) => matchesLeaveSearch(r, search));

  const columns: Column<LeaveRow>[] = [
    { header: '學生', render: (r) => r.student.user.name },
    { header: '請假班級', render: (r) => r.class.name },
    { header: '請假日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW') },
    {
      header: '插班班級',
      render: (r) => (r.makeupRequest?.type === 'INSERTION' ? (r.makeupRequest.targetClass?.name ?? '-') : '-'),
    },
    {
      header: '插班日期',
      render: (r) =>
        r.makeupRequest?.type === 'INSERTION' && r.makeupRequest.targetDate
          ? formatDateWithWeekday(r.makeupRequest.targetDate, 'zh-TW')
          : '-',
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
