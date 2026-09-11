'use client';

import { ReactNode } from 'react';
import Button from '@/components/ui/Button';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import { isBeforeToday } from '@/lib/pastDate';

export interface ActivityCardData {
  id: string;
  coverUrl: string | null;
  title: string;
  category: { name: string };
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teachers: { teacher: { user: { name: string } } }[];
  _count: { registrations: number };
}

interface ActivityCardGridProps<T extends ActivityCardData> {
  activities: T[];
  loading?: boolean;
  emptyText: string;
  // 點「查看詳情」或封面：開詳情彈窗（各端自帶）
  onView: (activity: T) => void;
  // 卡片右下角動作（依角色）：學生報名鈕／行政編輯連結；不給就留白
  action?: (activity: T) => ReactNode;
}

// 活動首頁卡片（三端同款版型，2026-09 卡片改版）：封面＋分類 chip＋狀態徽章
// ＋日期/地點/老師＋報名進度條。狀態：已結束（台北曆日）＞已額滿＞進行中。
export default function ActivityCardGrid<T extends ActivityCardData>({
  activities,
  loading = false,
  emptyText,
  onView,
  action,
}: ActivityCardGridProps<T>) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-xl bg-card shadow-sm" aria-hidden>
            <div className="skeleton-shimmer aspect-video w-full" />
            <div className="flex flex-col gap-2 p-4">
              <div className="skeleton-shimmer h-4 w-3/4 rounded" />
              <div className="skeleton-shimmer h-3 w-1/2 rounded" />
              <div className="skeleton-shimmer h-3 w-2/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (activities.length === 0) {
    return <p className="py-8 text-center text-sm text-inkMuted">{emptyText}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {activities.map((a) => {
        const ended = isBeforeToday(a.endDate);
        const full = a._count.registrations >= a.capacity;
        const ratio = Math.min((a._count.registrations / Math.max(a.capacity, 1)) * 100, 100);
        return (
          <div key={a.id} data-row-key={a.id} className="flex flex-col overflow-hidden rounded-xl bg-card shadow-sm">
            <button
              type="button"
              className="relative block aspect-video w-full bg-stripe text-left"
              onClick={() => onView(a)}
              aria-label={`查看「${a.title}」詳情`}
            >
              {a.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
                <img src={a.coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-4xl" aria-hidden>
                  🎈
                </span>
              )}
              <span className="absolute left-2.5 top-2.5 rounded-full bg-ink px-2.5 py-1 text-[11px] font-bold text-card">
                {a.category.name}
              </span>
              {ended ? (
                <span className="absolute right-2.5 top-2.5 rounded-full bg-borderSubtle px-2.5 py-1 text-[11px] font-bold text-inkMuted">已結束</span>
              ) : full ? (
                <span className="absolute right-2.5 top-2.5 rounded-full bg-rejectedBg px-2.5 py-1 text-[11px] font-bold text-rejected">已額滿</span>
              ) : (
                <span className="absolute right-2.5 top-2.5 rounded-full bg-approvedBg px-2.5 py-1 text-[11px] font-bold text-approved">進行中</span>
              )}
            </button>
            <div className="flex flex-1 flex-col gap-2 p-4">
              <p className="font-bold text-ink">{a.title}</p>
              <div className="flex flex-col gap-1 text-xs text-inkMuted">
                <span>📅 {formatActivityDateRange(a.startDate, a.endDate, 'zh-TW')}</span>
                <span>📍 {a.location ?? '地點未定'}</span>
                <span>🧑‍🏫 {a.teachers.map((t) => t.teacher.user.name).join('、') || '—'}</span>
              </div>
              <div className="text-xs text-inkMuted">
                已報名 {a._count.registrations}／名額 {a.capacity}
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stripe">
                  <div className="h-full bg-brandDark" style={{ width: `${ratio}%` }} />
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between pt-2">
                <Button variant="link" className="text-sm" onClick={() => onView(a)}>
                  查看詳情
                </Button>
                {action?.(a)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
