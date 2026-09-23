'use client';

import { useState } from 'react';
import ClassAttendanceLedgerModal from '@/components/ClassAttendanceLedgerModal';
import TutoringDeductionLedgerModal from '@/components/TutoringDeductionLedgerModal';
import TutoringQuotaBar from '@/components/tutoring/TutoringQuotaBar';
import MakeupBacklogBadge, { classItemLabel } from '@/components/MakeupBacklogBadge';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';

interface ClassRow {
  id: string;
  name: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
  quota: { totalSessions: number | null; usedSessions: number; remaining: number | null };
  makeupBacklog: { count: number; items: { date: string; reason: 'LEAVE' | 'ABSENT'; makeupPending: boolean }[] };
}

interface TutoringRow {
  id: string;
  programName: string;
  locked: number;
  upcoming: number;
  monthlyQuota: number;
  makeupBacklog: { count: number; absentCount: number; rebooked: number; absentDates: string[] };
}

// 票券管理卡片裡的「課堂」清單：點某個班級開它自己的扣堂紀錄
// （ClassAttendanceLedgerModal），點個別輔導開它自己的扣堂紀錄
// （TutoringDeductionLedgerModal）；要實際預約個別輔導仍走側邊欄「個別輔導」
// 連結去 /student/tutoring。抽成獨立 client component 是因為首頁本身是 server
// component。
export default function ClassesAndTutoringList({ myClasses, activeTutoring }: { myClasses: ClassRow[]; activeTutoring: TutoringRow[] }) {
  const [openClass, setOpenClass] = useState<ClassRow | null>(null);
  const [openTutoring, setOpenTutoring] = useState<TutoringRow | null>(null);

  if (myClasses.length === 0 && activeTutoring.length === 0) {
    return <p className="py-2 text-sm text-inkMuted">尚未報名任何課堂</p>;
  }

  return (
    <>
      {myClasses.map((c, i) => (
        <div
          key={c.id}
          role="button"
          tabIndex={0}
          onClick={() => setOpenClass(c)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              setOpenClass(c);
            }
          }}
          className={`flex w-full cursor-pointer flex-col gap-1.5 py-2.5 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brandDark/50 ${i > 0 ? 'border-t border-borderSubtle' : ''}`}
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
          {c.makeupBacklog.count > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-pending">
              尚有
              <MakeupBacklogBadge
                count={c.makeupBacklog.count}
                modalTitle={`未補明細・${c.name}`}
                groups={[{ title: c.name, items: c.makeupBacklog.items.map((it) => ({ date: it.date, label: classItemLabel(it) })) }]}
              />
              未補
            </div>
          )}
          {c.quota.totalSessions !== null && c.quota.totalSessions > 0 && (
            <div className="h-1 overflow-hidden rounded-full bg-stripe">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${Math.min(100, (c.quota.usedSessions / c.quota.totalSessions) * 100)}%` }}
              />
            </div>
          )}
        </div>
      ))}
      {activeTutoring.map((e, i) => (
        <div
          key={e.id}
          role="button"
          tabIndex={0}
          onClick={() => setOpenTutoring(e)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              setOpenTutoring(e);
            }
          }}
          className={`flex w-full cursor-pointer flex-col gap-1.5 py-2.5 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brandDark/50 ${
            myClasses.length + i > 0 ? 'border-t border-borderSubtle' : ''
          }`}
        >
          <span className="text-sm font-semibold text-ink">{e.programName}</span>
          <TutoringQuotaBar locked={e.locked} upcoming={e.upcoming} quota={e.monthlyQuota} dense />
          {e.makeupBacklog.count > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-pending">
              本月尚有
              <MakeupBacklogBadge
                count={e.makeupBacklog.count}
                modalTitle={`未補明細・${e.programName}`}
                groups={[
                  {
                    title: e.programName,
                    note: `本月缺席 ${e.makeupBacklog.absentCount} 堂${e.makeupBacklog.rebooked > 0 ? `，已另約 ${e.makeupBacklog.rebooked} 堂` : ''}，請至個別輔導預約補課`,
                    items: e.makeupBacklog.absentDates.map((d) => ({ date: d, label: '缺席' })),
                  },
                ]}
              />
              未補
            </div>
          )}
        </div>
      ))}
      <ClassAttendanceLedgerModal
        classId={openClass?.id ?? null}
        className={openClass?.name ?? ''}
        open={openClass !== null}
        onClose={() => setOpenClass(null)}
      />
      <TutoringDeductionLedgerModal
        enrollmentId={openTutoring?.id ?? null}
        programName={openTutoring?.programName ?? ''}
        open={openTutoring !== null}
        onClose={() => setOpenTutoring(null)}
      />
    </>
  );
}
