'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import RevokeLeaveButton from '@/components/RevokeLeaveButton';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface LeaveRow {
  id: string;
  date: string;
  reason: string;
  origin: 'STUDENT' | 'ADMIN' | null;
  student: { user: { name: string } };
  class: { name: string };
  makeupRequest: { id: string; type: 'INSERTION' | 'ONE_ON_ONE'; status: string } | null;
}

// 請假申請總表：學生自請＋行政代辦都在這裡，操作者欄區分。
export default function LeaveRequestList() {
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch('/api/leave-requests/all');
      setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const columns: Column<LeaveRow>[] = [
    { header: '學生', render: (r) => r.student.user.name },
    { header: '班級', render: (r) => <span className="whitespace-nowrap">{r.class.name}</span> },
    { header: '請假日期', render: (r) => formatDateWithWeekday(r.date) },
    { header: '原因', render: (r) => r.reason },
    {
      header: '操作者',
      render: (r) =>
        r.origin === 'ADMIN' ? (
          <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">行政代辦</span>
        ) : r.origin === 'STUDENT' ? (
          <span className="whitespace-nowrap rounded-full bg-stripe px-2.5 py-0.5 text-xs font-bold text-ink">學生</span>
        ) : (
          <span className="text-inkMuted">—</span>
        ),
    },
    {
      header: '補課',
      render: (r) =>
        r.makeupRequest ? <StatusBadge status={r.makeupRequest.status} /> : <span className="text-inkMuted">無</span>,
    },
    {
      header: '操作',
      render: (r) => <RevokeLeaveButton leaveRequestId={r.id} hasMakeup={r.makeupRequest !== null} onDone={load} />,
    },
  ];

  return (
    <>
      <h2 className="mb-2 mt-6 font-bold text-ink">請假申請紀錄</h2>
      <Card>
        <DataTable columns={columns} rows={rows} keyField={(r) => r.id} loading={loading} emptyText="目前沒有請假紀錄" />
      </Card>
    </>
  );
}
