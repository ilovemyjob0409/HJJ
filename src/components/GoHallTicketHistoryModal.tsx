'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { Column } from '@/components/ui/DataTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface TicketHistoryRow {
  id: string;
  amount: number;
  kind: string;
  reason: string | null;
  createdAt: string;
  sessionDate: string | null;
  checkInTime: string | null;
  balanceAfter: number;
}

const TICKET_KIND_LABELS: Record<string, string> = {
  PURCHASE: '購買',
  ATTEND: '到場扣堂',
  ADMIN_ADJUST: '調整',
  ATTEND_SEASON_PASS: '到場（季票）',
  ATTEND_SINGLE: '到場（單堂）',
  ABSENT: '缺席未到',
};

// 學生自己的弈廳堂票紀錄彈窗：票券管理卡片（首頁、/student/go-hall）都能觸發，
// 只是外層的觸發元件不同，資料抓取與呈現統一在這裡，不要各自複製一份。
export default function GoHallTicketHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [history, setHistory] = useState<TicketHistoryRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setHistory(null);
    fetch('/api/go-hall-tickets/me/detail')
      .then((res) => (res.ok ? res.json() : { history: [] }))
      .then((data) => setHistory(data.history))
      .catch(() => setHistory([]));
  }, [open]);

  const columns: Column<TicketHistoryRow>[] = [
    { header: '日期', render: (h) => formatDateWithWeekday(h.createdAt, 'zh-TW') },
    { header: '類型', render: (h) => TICKET_KIND_LABELS[h.kind] ?? h.kind },
    {
      header: '堂數',
      render: (h) => {
        if (h.kind === 'ABSENT') return <span className="text-inkMuted">-</span>;
        if (h.amount === 0) return <span className="text-inkMuted">不扣堂</span>;
        return (
          <span className={h.amount > 0 ? 'font-semibold text-approved' : 'font-semibold text-rejected'}>
            {h.amount > 0 ? `+${h.amount}` : h.amount}
          </span>
        );
      },
    },
    {
      header: '說明',
      render: (h) => {
        if (h.reason) return h.reason;
        if (h.sessionDate) {
          return (
            <span>
              場次 {formatDateWithWeekday(h.sessionDate, 'zh-TW')}
              {h.checkInTime && <span className="text-inkMuted">・{h.checkInTime} 到場</span>}
            </span>
          );
        }
        return '-';
      },
    },
    { header: '剩餘堂數', render: (h) => <span className="font-semibold">{h.balanceAfter}</span> },
  ];

  return (
    <Modal open={open} onClose={onClose} title="堂票紀錄" maxWidthClassName="max-w-2xl">
      {history === null ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton-shimmer h-4 w-full rounded" />
          <div className="skeleton-shimmer h-4 w-full rounded" />
          <div className="skeleton-shimmer h-4 w-full rounded" />
        </div>
      ) : (
        <CollapsibleDataTable columns={columns} rows={history} keyField={(h) => h.id} maxRows={5} emptyText="尚無堂票異動紀錄" />
      )}
    </Modal>
  );
}
