'use client';

import { ReactNode } from 'react';
import { formatDateWithWeekday } from '@/lib/dateFormat';

export interface GoHallSessionCardData {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  teacher: { user: { name: string } };
}

interface GoHallSessionCardsProps<T extends GoHallSessionCardData> {
  sessions: T[];
  loading?: boolean;
  emptyText: string;
  registeredCount: (session: T) => number;
  // 卡片底部動作列（依角色）：行政＝查看名單；學生＝查看名單＋報名/取消
  footer: (session: T) => ReactNode;
  // 通知深連結的高亮（沿用 scrollToRow 的 data-row-key 機制）
  highlightId?: string | null;
  // 整卡點擊（開場次名單）；內部 footer 動作自行擋冒泡
  onView?: (session: T) => void;
}

// 弈廳場次卡片（2026-09 卡片改版）：日期大字（星期）＋時間・老師＋報名進度條。
export default function GoHallSessionCards<T extends GoHallSessionCardData>({
  sessions,
  loading = false,
  emptyText,
  registeredCount,
  footer,
  highlightId = null,
  onView,
}: GoHallSessionCardsProps<T>) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl bg-card p-4 shadow-sm" aria-hidden>
            <div className="skeleton-shimmer h-5 w-1/2 rounded" />
            <div className="skeleton-shimmer h-3 w-2/3 rounded" />
            <div className="skeleton-shimmer h-3 w-full rounded" />
          </div>
        ))}
      </div>
    );
  }
  if (sessions.length === 0) {
    return <p className="py-8 text-center text-sm text-inkMuted">{emptyText}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sessions.map((s) => {
        const registered = registeredCount(s);
        const full = registered >= s.capacity;
        const ratio = Math.min((registered / Math.max(s.capacity, 1)) * 100, 100);
        return (
          <div
            key={s.id}
            data-row-key={s.id}
            className={`flex flex-col gap-2 rounded-xl p-4 shadow-sm ${s.id === highlightId ? 'bg-pendingBg' : 'bg-card'} ${
              onView ? 'cursor-pointer transition-shadow hover:shadow-md' : ''
            }`}
            onClick={onView ? () => onView(s) : undefined}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-base font-bold text-ink">{formatDateWithWeekday(s.date, 'zh-TW')}</p>
              {full && (
                <span className="rounded-full bg-rejectedBg px-2.5 py-1 text-[11px] font-bold text-rejected">已額滿</span>
              )}
            </div>
            <p className="text-sm text-inkMuted">
              {s.startTime}–{s.endTime} · {s.teacher.user.name}
            </p>
            <div className="text-xs text-inkMuted">
              已報名 {registered}／名額 {s.capacity}
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stripe">
                <div className="h-full bg-brandDark" style={{ width: `${ratio}%` }} />
              </div>
            </div>
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
            <div className="mt-auto flex items-center justify-between pt-1" onClick={(e) => e.stopPropagation()}>
              {footer(s)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
