'use client';

import { useState } from 'react';
import GoHallTicketHistoryModal from '@/components/GoHallTicketHistoryModal';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface MyTickets {
  balance: number;
  activePassEndDate: Date | string | null;
}

// 票券管理卡片裡的「弈廳資格」區塊：可點擊，打開跟 /student/go-hall 共用的
// 堂票紀錄彈窗（GoHallTicketHistoryModal）。抽成獨立 client component 是因為
// 首頁本身是 server component，只有這一小塊需要互動狀態。
export default function GoHallQualificationCard({ tickets }: { tickets: MyTickets }) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <>
      <div
        className="flex cursor-pointer flex-col gap-2 border-t border-borderSubtle pt-4 transition-opacity hover:opacity-80 sm:border-t-0 sm:pt-0"
        role="button"
        tabIndex={0}
        onClick={() => setHistoryOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setHistoryOpen(true);
        }}
      >
        <p className="text-xs font-semibold text-inkMuted">弈廳資格</p>
        {tickets.activePassEndDate ? (
          <>
            <span className="self-start rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">季票使用中</span>
            <p className="text-xs text-inkMuted">有效期至 {formatDateWithWeekday(tickets.activePassEndDate, 'zh-TW')}</p>
            {tickets.balance > 0 && <p className="text-xs text-inkMuted">另有堂票 {tickets.balance} 堂（季票期間不扣）</p>}
          </>
        ) : tickets.balance > 0 ? (
          <>
            <p className="text-sm text-ink">
              <span className="text-2xl font-bold tabular-nums">{tickets.balance}</span> 堂票剩餘
            </p>
            <p className="text-xs text-inkMuted">點名到場自動扣 1 堂・缺席不扣</p>
          </>
        ) : (
          <>
            <span className="self-start rounded-full bg-pendingBg px-3 py-1 text-xs font-semibold text-pending">單堂計費</span>
            <p className="text-xs text-inkMuted">現場收費</p>
          </>
        )}
        <p className="text-xs text-brandDark">查看堂票紀錄 →</p>
      </div>
      <GoHallTicketHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}
