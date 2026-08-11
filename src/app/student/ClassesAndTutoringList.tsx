'use client';

import { useState } from 'react';
import Link from 'next/link';
import ClassAttendanceLedgerModal from '@/components/ClassAttendanceLedgerModal';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';

interface ClassRow {
  id: string;
  name: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
  quota: { totalSessions: number | null; usedSessions: number; remaining: number | null };
}

interface TutoringRow {
  id: string;
  programName: string;
  locked: number;
  monthlyQuota: number;
}

// 票券管理卡片裡的「課堂」清單：點某個班級可以開它自己的扣堂紀錄
// （ClassAttendanceLedgerModal）；個別輔導維持連到 /student/tutoring 不變。
// 抽成獨立 client component 是因為首頁本身是 server component。
export default function ClassesAndTutoringList({ myClasses, activeTutoring }: { myClasses: ClassRow[]; activeTutoring: TutoringRow[] }) {
  const [openClass, setOpenClass] = useState<ClassRow | null>(null);

  if (myClasses.length === 0 && activeTutoring.length === 0) {
    return <p className="py-2 text-sm text-inkMuted">尚未報名任何課堂</p>;
  }

  return (
    <>
      {myClasses.map((c, i) => (
        <button
          key={c.id}
          type="button"
          onClick={() => setOpenClass(c)}
          className={`flex w-full flex-col gap-1.5 py-2.5 text-left transition-opacity hover:opacity-80 ${i > 0 ? 'border-t border-borderSubtle' : ''}`}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-ink">{c.name}</span>
            <span className="whitespace-nowrap text-xs tabular-nums text-inkMuted">
              {c.quota.remaining !== null ? (
                <>
                  <span className="font-semibold text-ink">{c.quota.usedSessions}</span>／{c.quota.totalSessions} 堂
                </>
              ) : (
                <>
                  <span className="font-semibold text-ink">{c.quota.usedSessions}</span> 堂・未設定
                </>
              )}
            </span>
          </div>
          <p className="text-xs text-inkMuted">
            每週{WEEKDAY_LABELS[c.weekday]} {c.startTime}-{c.endTime}・{c.teacher.user.name}
          </p>
          {c.quota.totalSessions !== null && c.quota.totalSessions > 0 && (
            <div className="h-1 overflow-hidden rounded-full bg-stripe">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min(100, (c.quota.usedSessions / c.quota.totalSessions) * 100)}%` }}
              />
            </div>
          )}
        </button>
      ))}
      {activeTutoring.map((e, i) => (
        <Link
          key={e.id}
          href="/student/tutoring"
          className={`flex items-baseline justify-between gap-3 py-2.5 transition-opacity hover:opacity-80 ${
            myClasses.length + i > 0 ? 'border-t border-borderSubtle' : ''
          }`}
        >
          <span className="text-sm font-semibold text-ink">{e.programName}</span>
          <span className="whitespace-nowrap text-xs tabular-nums text-inkMuted">
            本月<span className="font-semibold text-ink"> {e.locked}</span>／{e.monthlyQuota} 堂
          </span>
        </Link>
      ))}
      <ClassAttendanceLedgerModal
        classId={openClass?.id ?? null}
        className={openClass?.name ?? ''}
        open={openClass !== null}
        onClose={() => setOpenClass(null)}
      />
    </>
  );
}
