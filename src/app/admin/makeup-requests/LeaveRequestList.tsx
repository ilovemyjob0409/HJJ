'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import RevokeLeaveButton from '@/components/RevokeLeaveButton';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface LeaveRow {
  id: string;
  date: string;
  reason: string;
  origin: 'STUDENT' | 'ADMIN' | null;
  student: { user: { name: string } };
  class: { name: string };
  makeupRequest: { id: string; type: 'INSERTION' | 'ONE_ON_ONE'; status: string; cancelRequestedAt: string | null } | null;
}

export interface LeaveRequestListHandle {
  reload: () => void;
}

// 請假申請總表：學生自請＋行政代辦都在這裡，操作者欄區分。已核准補課
// 的撤銷分兩種——撤銷請假（連補課一起刪）與只撤銷補課（保留請假，
// 可重新安排）；家長申請撤銷中則改顯示同意撤銷／駁回。
const LeaveRequestList = forwardRef<LeaveRequestListHandle>(function LeaveRequestList(_props, ref) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  useImperativeHandle(ref, () => ({ reload: load }));

  async function revokeMakeupOnly(row: LeaveRow, viaRequest: boolean) {
    const makeupId = row.makeupRequest!.id;
    if (!viaRequest && !confirm(`確定只撤銷「${row.student.user.name}」的這筆補課嗎？請假本身會保留，之後可重新安排補課。`)) return;
    setBusyId(makeupId);
    try {
      const res = await fetch(`/api/makeup-requests/${makeupId}/revoke`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error === 'MAKEUP_HAS_ATTENDANCE' ? '此補課已有點名紀錄，無法撤銷' : '撤銷失敗，請稍後再試');
        return;
      }
      showToast('已撤銷補課');
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function rejectCancellation(row: LeaveRow) {
    const makeupId = row.makeupRequest!.id;
    setBusyId(makeupId);
    try {
      const res = await fetch(`/api/makeup-requests/${makeupId}/reject-cancellation`, { method: 'POST' });
      if (!res.ok) {
        showToast('操作失敗，請稍後再試');
        return;
      }
      showToast('已駁回撤銷申請，補課維持不變');
      load();
    } finally {
      setBusyId(null);
    }
  }

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
      header: '類型',
      render: (r) =>
        r.makeupRequest ? (
          <span className="text-xs text-inkMuted">{r.makeupRequest.type === 'INSERTION' ? '插班' : '一對一'}</span>
        ) : (
          <span className="text-inkMuted">無</span>
        ),
    },
    {
      header: '狀態',
      render: (r) =>
        r.makeupRequest?.cancelRequestedAt ? (
          <span className="inline-block rounded-full bg-pendingBg px-3 py-1 text-xs font-semibold text-pending">家長申請撤銷</span>
        ) : r.makeupRequest ? (
          <StatusBadge status={r.makeupRequest.status} />
        ) : (
          <span className="text-inkMuted">—</span>
        ),
    },
    {
      header: '操作',
      render: (r) => {
        const m = r.makeupRequest;
        if (m?.status === 'APPROVED' && m.cancelRequestedAt) {
          return (
            <div className="flex flex-col items-center gap-1.5">
              <Button className="px-3 py-1 text-xs" onClick={() => revokeMakeupOnly(r, true)} loading={busyId === m.id}>
                同意撤銷
              </Button>
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => rejectCancellation(r)} loading={busyId === m.id}>
                駁回
              </Button>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center gap-1.5">
            <RevokeLeaveButton leaveRequestId={r.id} hasMakeup={m !== null} onDone={load} />
            {m?.status === 'APPROVED' && (
              <button
                type="button"
                onClick={() => revokeMakeupOnly(r, false)}
                disabled={busyId === m.id}
                className="text-xs text-inkMuted underline hover:text-rejected disabled:opacity-50"
              >
                只撤銷補課
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <h2 className="mb-2 mt-6 font-bold text-ink">請假申請紀錄</h2>
      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          keyField={(r) => r.id}
          loading={loading}
          emptyText="目前沒有請假紀錄"
          rowClassName={(r) => (r.makeupRequest?.cancelRequestedAt ? 'bg-pendingBg/40' : '')}
        />
      </Card>
    </>
  );
});

export default LeaveRequestList;
