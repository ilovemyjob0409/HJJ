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
  remainingAfter: number | null;
}

// 學生自己的班級扣堂紀錄彈窗：由票券管理卡片（首頁）點某一個課堂觸發，
// className 只用來當彈窗標題，資料抓取／呈現統一在這裡。是一份完整的堂數
// 增減帳本——報課／續報（GRANT）加上每一堂真的扣掉名額的點名（DEDUCT）。
export default function ClassAttendanceLedgerModal({
  classId,
  className,
  open,
  onClose,
}: {
  classId: string | null;
  className: string;
  open: boolean;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<LedgerRow[] | null>(null);

  useEffect(() => {
    if (!open || !classId) return;
    setHistory(null);
    fetch(`/api/classes/${classId}/attendance-ledger`)
      .then((res) => (res.ok ? res.json() : { history: [] }))
      .then((data) => setHistory(data.history))
      .catch(() => setHistory([]));
  }, [open, classId]);

  const columns: Column<LedgerRow>[] = [
    { header: '日期', render: (h) => formatDateWithWeekday(h.date, 'zh-TW'), sortValue: (h) => h.date },
    { header: '項目', render: (h) => (h.kind === 'GRANT' ? '報課／續報' : <StatusBadge status={h.status ?? ''} />) },
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
    {
      header: '剩餘堂數',
      render: (h) => <span className="font-semibold">{h.remainingAfter ?? '-'}</span>,
      sortValue: (h) => h.remainingAfter,
    },
  ];

  return (
    <Modal open={open} onClose={onClose} title={`扣堂紀錄 - ${className}`} maxWidthClassName="max-w-2xl">
      {history === null ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton-shimmer h-4 w-full rounded" />
          <div className="skeleton-shimmer h-4 w-full rounded" />
          <div className="skeleton-shimmer h-4 w-full rounded" />
        </div>
      ) : (
        <CollapsibleDataTable columns={columns} rows={history} keyField={(h) => h.id} maxRows={5} emptyText="尚無堂數異動紀錄" />
      )}
    </Modal>
  );
}
