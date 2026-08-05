'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import ArrangeMakeupForm from './ArrangeMakeupForm';
import LeaveRequestList, { LeaveRequestListHandle } from './LeaveRequestList';

interface PendingRow {
  id: string;
  type: 'INSERTION' | 'ONE_ON_ONE';
  leaveRequest: { student: { user: { name: string } }; class: { name: string } };
  targetClass: { name: string } | null;
  targetDate: string | null;
  teacher: { user: { name: string } } | null;
  slotDate: string | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
}

function AdminMakeupRequestsContent() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const leaveListRef = useRef<LeaveRequestListHandle>(null);

  async function load() {
    try {
      const res = await fetch('/api/makeup-requests/pending');
      setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!highlightId || rows.length === 0) return;
    document.getElementById(highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, rows]);

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    setPendingId(id);
    try {
      await fetch(`/api/makeup-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
      showToast(decision === 'APPROVED' ? '已核准' : '已拒絕');
      load();
      leaveListRef.current?.reload();
    } finally {
      setPendingId(null);
    }
  }

  const columns: Column<PendingRow>[] = [
    { header: '學生', render: (r) => r.leaveRequest.student.user.name },
    { header: '原班級', render: (r) => <span className="whitespace-nowrap">{r.leaveRequest.class.name}</span> },
    {
      header: '類型',
      render: (r) =>
        r.type === 'INSERTION' ? (
          <span className="whitespace-nowrap rounded-full bg-approvedBg px-2.5 py-0.5 text-xs font-bold text-approved">插班</span>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">一對一</span>
        ),
    },
    {
      header: '補課日期',
      render: (r) => {
        const d = r.type === 'INSERTION' ? r.targetDate : r.slotDate;
        return <span className="whitespace-nowrap">{d ? formatDateWithWeekday(d) : '-'}</span>;
      },
    },
    {
      header: '目標',
      render: (r) =>
        r.type === 'INSERTION' ? (
          <span className="whitespace-nowrap">{r.targetClass?.name}</span>
        ) : (
          <div className="flex flex-col items-center">
            <span className="whitespace-nowrap">{r.teacher?.user.name}</span>
            <span className="whitespace-nowrap">{r.slotStartTime}-{r.slotEndTime}</span>
          </div>
        ),
    },
    { header: '狀態', render: () => <StatusBadge status="PENDING_ADMIN" /> },
    {
      header: '操作',
      render: (r) => (
        <div className="flex gap-2">
          <Button className="px-3 py-1 text-xs" onClick={() => decide(r.id, 'APPROVED')} loading={pendingId === r.id}>
            核准
          </Button>
          <Button
            variant="secondary"
            className="px-3 py-1 text-xs"
            onClick={() => decide(r.id, 'REJECTED')}
            loading={pendingId === r.id}
          >
            拒絕
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">請假管理</h1>
      <ArrangeMakeupForm onArranged={() => leaveListRef.current?.reload()} />

      <h2 className="mb-2 font-bold text-ink">待確認補課申請</h2>
      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          keyField={(r) => r.id}
          rowClassName={(r) => (r.id === highlightId ? 'bg-pendingBg' : '')}
          loading={loading}
        />
      </Card>

      <LeaveRequestList ref={leaveListRef} />
    </>
  );
}

export default function AdminMakeupRequestsPage() {
  return (
    <Suspense fallback={null}>
      <AdminMakeupRequestsContent />
    </Suspense>
  );
}
