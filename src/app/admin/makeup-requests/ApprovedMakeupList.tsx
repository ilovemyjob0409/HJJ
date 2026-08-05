'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface ApprovedRow {
  id: string;
  type: 'INSERTION' | 'ONE_ON_ONE';
  targetDate: string | null;
  slotDate: string | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
  cancelRequestedAt: string | null;
  leaveRequest: { date: string; student: { user: { name: string } }; class: { name: string } };
  targetClass: { name: string } | null;
  teacher: { user: { name: string } } | null;
}

export interface ApprovedMakeupListHandle {
  reload: () => void;
}

// 未來場次的已核准補課：行政可直接撤銷；家長的撤銷申請置頂，
// 行政「同意撤銷」或「駁回」。撤銷＝刪單，原請假回到未申請。
const ApprovedMakeupList = forwardRef<ApprovedMakeupListHandle>(function ApprovedMakeupList(_props, ref) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<ApprovedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/makeup-requests/approved');
      if (res.ok) setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useImperativeHandle(ref, () => ({ reload: load }));

  async function revoke(row: ApprovedRow, viaRequest: boolean) {
    if (!viaRequest && !confirm(`確定撤銷「${row.leaveRequest.student.user.name}」的這筆補課嗎？撤銷後原請假可重新安排補課。`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/makeup-requests/${row.id}/revoke`, { method: 'POST' });
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

  async function rejectCancellation(row: ApprovedRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/makeup-requests/${row.id}/reject-cancellation`, { method: 'POST' });
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

  const columns: Column<ApprovedRow>[] = [
    { header: '學生', render: (r) => r.leaveRequest.student.user.name },
    {
      header: '原班級（請假日）',
      render: (r) => (
        <span>
          <span className="whitespace-nowrap">{r.leaveRequest.class.name}</span>
          <span className="whitespace-nowrap">（{formatDateWithWeekday(r.leaveRequest.date)}）</span>
        </span>
      ),
    },
    {
      header: '類型',
      render: (r) =>
        r.type === 'INSERTION' ? (
          <span className="whitespace-nowrap rounded-full bg-stripe px-2.5 py-0.5 text-xs font-bold text-ink">插班</span>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">一對一</span>
        ),
    },
    {
      header: '補課時間',
      render: (r) =>
        r.type === 'INSERTION' ? (
          <div className="flex flex-col items-center">
            <span className="whitespace-nowrap">{r.targetClass?.name}</span>
            <span className="whitespace-nowrap">{r.targetDate ? formatDateWithWeekday(r.targetDate) : ''}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <span className="whitespace-nowrap">{r.teacher?.user.name}</span>
            <span className="whitespace-nowrap">{r.slotDate ? formatDateWithWeekday(r.slotDate) : ''}</span>
            <span className="whitespace-nowrap">{r.slotStartTime}-{r.slotEndTime}</span>
          </div>
        ),
    },
    {
      header: '狀態',
      render: (r) =>
        r.cancelRequestedAt ? (
          <span className="inline-block rounded-full bg-pendingBg px-3 py-1 text-xs font-semibold text-pending">家長申請撤銷</span>
        ) : (
          <span className="inline-block rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">已核准</span>
        ),
    },
    {
      header: '操作',
      render: (r) =>
        r.cancelRequestedAt ? (
          <div className="flex gap-2">
            <Button className="px-3 py-1 text-xs" onClick={() => revoke(r, true)} loading={busyId === r.id}>
              同意撤銷
            </Button>
            <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => rejectCancellation(r)} loading={busyId === r.id}>
              駁回
            </Button>
          </div>
        ) : (
          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => revoke(r, false)} loading={busyId === r.id}>
            撤銷
          </Button>
        ),
    },
  ];

  return (
    <>
      <h2 className="mb-2 mt-6 font-bold text-ink">已核准補課（未來場次）</h2>
      <Card>
        {!loading && rows.length === 0 ? (
          <p className="text-sm text-inkMuted">目前沒有未來場次的已核准補課</p>
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            keyField={(r) => r.id}
            loading={loading}
            rowClassName={(r) => (r.cancelRequestedAt ? 'bg-pendingBg/40' : '')}
          />
        )}
      </Card>
    </>
  );
});

export default ApprovedMakeupList;
