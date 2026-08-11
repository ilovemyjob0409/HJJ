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
  status: string;
  checkInTime: string | null;
  counted: boolean;
  remainingAfter: number | null;
}

// 學生自己的班級扣堂紀錄彈窗：由票券管理卡片（首頁）點某一個課堂觸發，
// className 只用來當彈窗標題，資料抓取／呈現統一在這裡。
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
    { header: '日期', render: (h) => formatDateWithWeekday(h.date, 'zh-TW') },
    { header: '狀態', render: (h) => <StatusBadge status={h.status} /> },
    { header: '簽到', render: (h) => h.checkInTime ?? <span className="text-inkMuted">-</span> },
    { header: '扣堂', render: (h) => (h.counted ? <span className="font-semibold text-rejected">-1</span> : <span className="text-inkMuted">不扣</span>) },
    {
      header: '剩餘堂數',
      render: (h) => <span className="font-semibold">{h.remainingAfter ?? '-'}</span>,
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
        <CollapsibleDataTable columns={columns} rows={history} keyField={(h) => h.id} maxRows={5} emptyText="尚無點名紀錄" />
      )}
    </Modal>
  );
}
