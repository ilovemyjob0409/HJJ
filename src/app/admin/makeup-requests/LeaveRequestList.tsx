'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import CollapsibleSearchInput from '@/components/ui/CollapsibleSearchInput';
import StatusBadge from '@/components/ui/StatusBadge';
import RevokeLeaveButton from '@/components/RevokeLeaveButton';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { matchesLeaveSearch } from '../leaveSearch';

interface LeaveRow {
  id: string;
  date: string;
  reason: string;
  origin: 'STUDENT' | 'ADMIN' | null;
  student: { user: { name: string } };
  class: { name: string };
  makeupRequest: {
    id: string;
    type: 'INSERTION' | 'ONE_ON_ONE';
    status: string;
    cancelRequestedAt: string | null;
    targetDate: string | null;
    targetClass: { name: string } | null;
    slotDate: string | null;
    slotStartTime: string | null;
    slotEndTime: string | null;
    teacher: { user: { name: string } } | null;
  } | null;
}

export interface LeaveRequestListHandle {
  reload: () => void;
}

// 已核准補課（無撤銷申請中）點「撤銷」時，用彈窗讓行政選擇撤銷範圍：
// 連補課一起撤銷、或只撤銷補課保留請假可重排。
function RevokeChoiceButton({ row, onDone }: { row: LeaveRow; onDone: () => void }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'leave' | 'makeup' | null>(null);

  async function revokeLeave() {
    setBusy('leave');
    try {
      const res = await fetch(`/api/leave-requests/${row.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showToast(data?.error === 'MAKEUP_HAS_ATTENDANCE' ? '補課已有點名紀錄，無法撤銷' : '撤銷失敗，請稍後再試');
        return;
      }
      showToast('已撤銷請假');
      setOpen(false);
      onDone();
    } finally {
      setBusy(null);
    }
  }

  async function revokeMakeupOnly() {
    setBusy('makeup');
    try {
      const res = await fetch(`/api/makeup-requests/${row.makeupRequest!.id}/revoke`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error === 'MAKEUP_HAS_ATTENDANCE' ? '此補課已有點名紀錄，無法撤銷' : '撤銷失敗，請稍後再試');
        return;
      }
      showToast('已撤銷補課');
      setOpen(false);
      onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-pending px-3 py-1 text-xs font-semibold text-pending transition-colors hover:bg-pendingBg"
      >
        撤銷
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`撤銷「${row.student.user.name}」的請假`}>
        <p className="mb-4 text-sm text-inkMuted">這筆請假已安排補課，請選擇要撤銷的範圍：</p>
        <div className="flex flex-col gap-2">
          <Button onClick={revokeLeave} loading={busy === 'leave'} disabled={busy === 'makeup'}>
            撤銷請假（連補課一起撤銷）
          </Button>
          <Button variant="secondary" onClick={revokeMakeupOnly} loading={busy === 'makeup'} disabled={busy === 'leave'}>
            只撤銷補課（保留請假）
          </Button>
        </div>
      </Modal>
    </>
  );
}

// 請假申請總表：學生自請＋行政代辦都在這裡。已核准補課
// 點「撤銷」由 RevokeChoiceButton 彈窗二選一；家長申請撤銷中則改顯示
// 同意撤銷／駁回，回應的是家長的撤銷申請，不走選擇彈窗。
const LeaveRequestList = forwardRef<LeaveRequestListHandle>(function LeaveRequestList(_props, ref) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const filteredRows = rows.filter((r) => matchesLeaveSearch(r, search));

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

  async function approveCancellation(row: LeaveRow) {
    const makeupId = row.makeupRequest!.id;
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
    { header: '學生', render: (r) => r.student.user.name, sortValue: (r) => r.student.user.name },
    {
      header: '班級',
      render: (r) => <span className="whitespace-nowrap">{r.class.name}</span>,
      sortValue: (r) => r.class.name,
    },
    { header: '請假日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
    { header: '原因', render: (r) => r.reason, sortValue: (r) => r.reason },
    {
      header: '補課日期',
      render: (r) => {
        const m = r.makeupRequest;
        if (!m) return <span className="text-inkMuted">—</span>;
        const d = m.type === 'INSERTION' ? m.targetDate : m.slotDate;
        return <span className="whitespace-nowrap">{d ? formatDateWithWeekday(d) : '-'}</span>;
      },
      sortValue: (r) => {
        const m = r.makeupRequest;
        if (!m) return null;
        return m.type === 'INSERTION' ? m.targetDate : m.slotDate;
      },
    },
    {
      header: '補課安排',
      render: (r) => {
        const m = r.makeupRequest;
        if (!m) return <span className="text-inkMuted">—</span>;
        if (m.type === 'INSERTION') {
          return (
            <div className="flex flex-col items-center gap-1">
              <span className="whitespace-nowrap rounded-full bg-approvedBg px-2.5 py-0.5 text-xs font-bold text-approved">插班</span>
              <span className="whitespace-nowrap">{m.targetClass?.name ?? '-'}</span>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center gap-1">
            <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">一對一</span>
            <span className="whitespace-nowrap">{m.teacher?.user.name ?? '-'}</span>
            <span className="whitespace-nowrap">{m.slotStartTime}-{m.slotEndTime}</span>
          </div>
        );
      },
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
      sortValue: (r) => (r.makeupRequest && !r.makeupRequest.cancelRequestedAt ? r.makeupRequest.status : null),
    },
    {
      header: '操作',
      render: (r) => {
        const m = r.makeupRequest;
        if (m?.status === 'APPROVED' && m.cancelRequestedAt) {
          return (
            <div className="flex flex-col items-center gap-1.5">
              <Button className="px-3 py-1 text-xs" onClick={() => approveCancellation(r)} loading={busyId === m.id}>
                同意撤銷
              </Button>
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => rejectCancellation(r)} loading={busyId === m.id}>
                駁回
              </Button>
            </div>
          );
        }
        if (m?.status === 'APPROVED') {
          return <RevokeChoiceButton row={r} onDone={load} />;
        }
        return <RevokeLeaveButton leaveRequestId={r.id} hasMakeup={m !== null} onDone={load} />;
      },
    },
  ];

  return (
    <>
      <div className="mb-2 mt-6 flex items-center gap-3">
        <h2 className="shrink-0 whitespace-nowrap font-bold text-ink">請假申請紀錄</h2>
        <CollapsibleSearchInput placeholder="搜尋學生、班級或補課狀態" value={search} onChange={setSearch} />
      </div>
      <Card>
        <CollapsibleDataTable
          columns={columns}
          rows={filteredRows}
          keyField={(r) => r.id}
          loading={loading}
          maxRows={search.trim() ? undefined : 3}
          emptyText="目前沒有請假紀錄"
          rowClassName={(r) => (r.makeupRequest?.cancelRequestedAt ? 'bg-pendingBg/40' : '')}
        />
      </Card>
    </>
  );
});

export default LeaveRequestList;
