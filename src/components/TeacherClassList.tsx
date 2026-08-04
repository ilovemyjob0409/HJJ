'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';
import type { TeacherClassSummary, TeacherClassStudent } from '@/lib/services/classService';

function timeLabel(c: TeacherClassSummary) {
  return `週${WEEKDAY_LABELS[c.weekday]} ${c.startTime}–${c.endTime}`;
}

export default function TeacherClassList({ classes }: { classes: TeacherClassSummary[] }) {
  const [viewing, setViewing] = useState<TeacherClassSummary | null>(null);

  const columns: Column<TeacherClassSummary>[] = [
    { header: '班級', render: (r) => r.name },
    { header: '時段', render: (r) => timeLabel(r) },
    { header: '人數', render: (r) => `${r.students.length} 人` },
  ];

  const studentColumns: Column<TeacherClassStudent>[] = [
    { header: '學生', render: (s) => s.name },
    {
      header: '堂數進度',
      render: (s) => (s.totalSessions === null ? `${s.usedSessions} 堂` : `${s.usedSessions}／${s.totalSessions} 堂`),
    },
  ];

  const lowQuota = viewing?.students.filter((s) => s.remaining !== null && s.remaining <= 2) ?? [];

  return (
    <Card className="mb-6">
      {classes.length === 0 ? (
        <p className="text-sm text-inkMuted">尚無帶班班級</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={classes}
            keyField={(r) => r.id}
            onRowClick={(r) => setViewing(r)}
            rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          />
          <p className="mt-2 text-xs text-inkMuted">點任一列開啟該班學生名單</p>
        </>
      )}
      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={`${viewing?.name ?? ''} 學生名單`}>
        {viewing && (
          <>
            <p className="mb-3 text-sm text-inkMuted">
              {timeLabel(viewing)}・共 {viewing.students.length} 人
            </p>
            {viewing.students.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生</p>
            ) : (
              <DataTable columns={studentColumns} rows={viewing.students} keyField={(s) => s.studentId} />
            )}
            {lowQuota.length > 0 && (
              <div className="mt-3 flex flex-col gap-1">
                {lowQuota.map((s) => (
                  <p key={s.studentId} className="text-sm text-pending">
                    ⚠ {s.name} 剩 {s.remaining} 堂
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>
    </Card>
  );
}
