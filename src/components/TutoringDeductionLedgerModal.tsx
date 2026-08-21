'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { Column } from '@/components/ui/DataTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface LedgerRow {
  id: string;
  date: string;
  kind: 'GRANT' | 'DEDUCT';
  amount: number;
  status: string | null;
  checkInTime: string | null;
  remainingAfter: number;
}

// 學生自己的個別輔導扣堂紀錄彈窗：由票券管理卡片（首頁）點某一個個別輔導方
// 案觸發。是一份完整的堂數增減帳本——每月月初核發額度（GRANT）加上每一堂真
// 的扣掉名額的預約（DEDUCT），不含還沒發生的預約或補課本身（未來預約看
// /student/tutoring 日曆的「已約」）。月額度按月重置，所以「剩餘堂數」是
// 當月的剩餘堂數，不是終身總數。
export default function TutoringDeductionLedgerModal({
  enrollmentId,
  programName,
  open,
  onClose,
}: {
  enrollmentId: string | null;
  programName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ monthlyQuota: number; history: LedgerRow[] } | null>(null);

  useEffect(() => {
    if (!open || !enrollmentId) return;
    setData(null);
    fetch(`/api/tutoring-enrollments/${enrollmentId}/ledger`)
      .then((res) => (res.ok ? res.json() : { monthlyQuota: 0, history: [] }))
      .then(setData)
      .catch(() => setData({ monthlyQuota: 0, history: [] }));
  }, [open, enrollmentId]);

  const columns: Column<LedgerRow>[] = [
    { header: '日期', render: (h) => formatDateWithWeekday(h.date, 'zh-TW'), sortValue: (h) => h.date },
    { header: '項目', render: (h) => (h.kind === 'GRANT' ? '本月核發' : <StatusBadge status={h.status ?? ''} />) },
    { header: '簽到', render: (h) => h.checkInTime ?? <span className="text-inkMuted">-</span>, sortValue: (h) => h.checkInTime },
    {
      header: '堂數',
      render: (h) => (
        <span className={`font-semibold ${h.amount > 0 ? 'text-approved' : 'text-rejected'}`}>
          {h.amount > 0 ? `+${h.amount}` : h.amount}
        </span>
      ),
      sortValue: (h) => h.amount,
    },
    { header: '當月剩餘', render: (h) => <span className="font-semibold">{h.remainingAfter}</span>, sortValue: (h) => h.remainingAfter },
  ];

  return (
    <Modal open={open} onClose={onClose} title={`扣堂紀錄 - ${programName}`} maxWidthClassName="max-w-2xl">
      {data === null ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton-shimmer h-4 w-full rounded" />
          <div className="skeleton-shimmer h-4 w-full rounded" />
          <div className="skeleton-shimmer h-4 w-full rounded" />
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-inkMuted">每月固定額度 {data.monthlyQuota} 堂，逾月不累計、不遞補。</p>
          <CollapsibleDataTable columns={columns} rows={data.history} keyField={(h) => h.id} maxRows={5} emptyText="尚無堂數異動紀錄" />
        </>
      )}
    </Modal>
  );
}
