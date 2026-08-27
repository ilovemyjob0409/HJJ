'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import DataTable, { Column } from '@/components/ui/DataTable';
import { WEEKDAY_LABELS, formatDateWithWeekday } from '@/lib/dateFormat';

interface OverviewMakeup {
  status: 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED';
  type: 'INSERTION' | 'ONE_ON_ONE';
  label: string;
}

interface OverviewRecord {
  date: string;
  status: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED';
  checkInTime: string | null;
  checkOutTime: string | null;
  makeup: OverviewMakeup | null;
}

interface OverviewStudent {
  studentId: string;
  studentName: string;
  records: OverviewRecord[];
}

interface OverviewResponse {
  class: {
    id: string;
    name: string;
    subject: string;
    level: string;
    weekday: number;
    startTime: string;
    endTime: string;
    teacherName: string;
  };
  students: OverviewStudent[];
}

const recordColumns: Column<OverviewRecord>[] = [
  { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
  { header: '狀態', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
  {
    header: '補課狀態',
    render: (r) =>
      r.status !== 'ON_LEAVE' ? (
        <span className="text-inkMuted">—</span>
      ) : r.makeup === null ? (
        <span className="text-inkMuted">尚未安排</span>
      ) : r.makeup.status === 'APPROVED' ? (
        <span className="text-approved">已核准・{r.makeup.label}</span>
      ) : (
        <StatusBadge status={r.makeup.status} />
      ),
  },
];

// 整班出缺勤總表：依學生分組，每個學生區塊預設收合（比照
// src/app/admin/tutoring/page.tsx 的 <details className="group"> 慣例），
// 點開才看到完整表格。老師／行政共用同一個元件，權限與範圍差異都在 API
// 層（見 /api/classes/[id]/attendance-overview），這裡只負責顯示。
export default function ClassAttendanceOverview({
  classId,
  backHref,
  backLabel,
}: {
  classId: string;
  backHref: string;
  backLabel: string;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/classes/${classId}/attendance-overview`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [classId]);

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
        <p className="text-sm text-inkMuted">找不到班級或沒有權限查看</p>
      ) : (
        <>
          <h1 className="mb-1 text-xl font-bold text-ink">{data.class.name}・出缺勤總表</h1>
          <p className="mb-4 text-sm text-inkMuted">
            {data.class.subject}・{data.class.level}｜週{WEEKDAY_LABELS[data.class.weekday]} {data.class.startTime}-{data.class.endTime}｜
            {data.class.teacherName}
          </p>
          {data.students.length === 0 ? (
            <p className="text-sm text-inkMuted">目前沒有學生</p>
          ) : (
            data.students.map((s) => {
              const pendingCount = s.records.filter((r) => r.status === 'ON_LEAVE' && r.makeup === null).length;
              return (
                <Card key={s.studentId} className="mb-3">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <span className="text-inkMuted transition-transform group-open:rotate-180">▾</span>
                        {s.studentName}
                      </span>
                      {pendingCount > 0 && <span className="text-xs text-pending">{pendingCount} 筆待安排補課</span>}
                    </summary>
                    <div className="mt-3">
                      <DataTable columns={recordColumns} rows={s.records} keyField={(r) => r.date} emptyText="尚無紀錄" />
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
