'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import DataTable, { Column } from '@/components/ui/DataTable';
import { WEEKDAY_LABELS, formatDateWithWeekday } from '@/lib/dateFormat';

interface OverviewRecord {
  date: string;
  attendanceStatus: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED' | null;
  bookingStatus: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
  checkInTime: string | null;
  checkOutTime: string | null;
  isMakeup: boolean;
}

interface OverviewStudent {
  studentId: string;
  studentName: string;
  records: OverviewRecord[];
}

interface OverviewResponse {
  window: {
    id: string;
    weekday: number;
    startTime: string;
    endTime: string;
    programName: string;
    teacherName: string;
    teacherName2: string | null;
  };
  todayKey: string;
  students: OverviewStudent[];
}

const recordColumns: Column<OverviewRecord & { _key: string }>[] = [
  { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
  {
    header: '狀態',
    render: (r) => <StatusBadge status={r.attendanceStatus ?? r.bookingStatus} />,
    sortValue: (r) => r.attendanceStatus ?? r.bookingStatus,
  },
  { header: '類型', render: (r) => (r.isMakeup ? '補課' : '—'), sortValue: (r) => (r.isMakeup ? 1 : 0) },
];

// 個別輔導時段出缺勤總表：依學生分組，每個學生區塊預設收合，比照
// ClassAttendanceOverview.tsx 的慣例。跟班級版不同的地方：狀態只有一欄
// （這裡的補課本身就是同一張表裡的另一筆 booking，用「類型」欄的補課標籤
// 標示即可，不需要另一欄「補課狀態」），而且不排除未來日期（學生提前預約
// 是有意義的行為，不是預寫的髒資料）。「N 筆待點名」的過去/未來判斷用伺服器
// 算好的 todayKey 字串比較，不在前端用瀏覽器本機時間做時區換算。
export default function TutoringWindowAttendanceOverview({
  windowId,
  backHref,
  backLabel,
}: {
  windowId: string;
  backHref: string;
  backLabel: string;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tutoring-windows/${windowId}/attendance-overview`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [windowId]);

  return (
    <>
      <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-inkMuted transition-colors hover:text-ink">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        {backLabel}
      </Link>
      {loading ? (
        <p className="text-sm text-inkMuted">載入中…</p>
      ) : !data ? (
        <p className="text-sm text-inkMuted">找不到時段或沒有權限查看</p>
      ) : (
        <>
          <h1 className="mb-1 text-xl font-bold text-ink">
            {data.window.programName}・週{WEEKDAY_LABELS[data.window.weekday]} {data.window.startTime}-{data.window.endTime}・出缺勤總表
          </h1>
          <p className="mb-4 text-sm text-inkMuted">{[data.window.teacherName, data.window.teacherName2].filter(Boolean).join('／')}</p>
          {data.students.length === 0 ? (
            <p className="text-sm text-inkMuted">目前沒有預約紀錄</p>
          ) : (
            data.students.map((s) => {
              const pendingCount = s.records.filter(
                (r) => r.bookingStatus === 'BOOKED' && r.attendanceStatus === null && r.date.slice(0, 10) <= data.todayKey
              ).length;
              const rows = s.records.map((r, i) => ({ ...r, _key: `${r.date}-${i}` }));
              return (
                <Card key={s.studentId} className="mb-3">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <span className="text-inkMuted transition-transform group-open:rotate-180">▾</span>
                        {s.studentName}
                      </span>
                      {pendingCount > 0 && <span className="text-xs text-pending">{pendingCount} 筆待點名</span>}
                    </summary>
                    <div className="mt-3">
                      <DataTable columns={recordColumns} rows={rows} keyField={(r) => r._key} emptyText="尚無紀錄" />
                    </div>
                  </details>
                </Card>
              );
            })
          )}
        </>
      )}
    </>
  );
}
