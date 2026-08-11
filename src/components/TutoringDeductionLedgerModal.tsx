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
  kind: 'REGULAR' | 'MAKEUP';
  status: string;
  checkInTime: string | null;
  counted: boolean;
  remainingAfter: number;
}

// 學生自己的個別輔導扣堂紀錄彈窗：由票券管理卡片（首頁）點某一個個別輔導方
// 案觸發。月額度按月重置，所以「剩餘堂數」是當月的剩餘堂數，不是終身總數。
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
    { header: '日期', render: (h) => formatDateWithWeekday(h.date, 'zh-TW') },
    { header: '類型', render: (h) => (h.kind === 'MAKEUP' ? '補課' : '一般') },
    { header: '狀態', render: (h) => <StatusBadge status={h.status} /> },
    { header: '簽到', render: (h) => h.checkInTime ?? <span className="text-inkMuted">-</span> },
    { header: '扣堂', render: (h) => (h.counted ? <span className="font-semibold text-rejected">-1</span> : <span className="text-inkMuted">不扣</span>) },
    { header: '當月剩餘', render: (h) => <span className="font-semibold">{h.remainingAfter}</span> },
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
          <CollapsibleDataTable columns={columns} rows={data.history} keyField={(h) => h.id} maxRows={5} emptyText="尚無預約紀錄" />
        </>
      )}
    </Modal>
  );
}
