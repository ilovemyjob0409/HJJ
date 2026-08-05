'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateWithWeekday, isTodayTaipei } from '@/lib/dateFormat';

// 代課與一對一補課合併成單一「被指派」列表，用類型欄位區分。
export interface AssignmentRow {
  id: string;
  kind: 'SUBSTITUTE' | 'ONE_ON_ONE';
  date: Date;
  startTime: string;
  endTime: string;
  className: string;
  counterpartName: string; // 代課：原老師；一對一：學生
  substituteReason: string | null;
  status: string;
  // 代課的整班名單；一對一只有單一學生（已在 counterpartName 顯示），固定空陣列。
  students: { id: string; name: string }[];
}

// 代課點列開整班名單（比照「我的帶班班級」）；一對一補課的對象已顯示在
// 「對象」欄，點列不需要再開名單，不套用可點擊樣式。
export default function AssignmentsTable({ rows }: { rows: AssignmentRow[] }) {
  const [viewing, setViewing] = useState<AssignmentRow | null>(null);

  const columns: Column<AssignmentRow>[] = [
    {
      header: '類型',
      render: (r) =>
        r.kind === 'SUBSTITUTE' ? (
          <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">代課</span>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-stripe px-2.5 py-0.5 text-xs font-bold text-ink">一對一補課</span>
        ),
    },
    {
      header: '日期',
      render: (r) => (
        <>
          <span className="whitespace-nowrap">{formatDateWithWeekday(r.date)}</span>
          {isTodayTaipei(r.date) && (
            <span className="ml-1.5 inline-block whitespace-nowrap rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-brandInk">
              今天
            </span>
          )}
        </>
      ),
    },
    { header: '時間', render: (r) => <span className="whitespace-nowrap">{`${r.startTime}-${r.endTime}`}</span> },
    { header: '班級', render: (r) => <span className="whitespace-nowrap">{r.className}</span> },
    {
      header: '對象',
      render: (r) =>
        r.kind === 'SUBSTITUTE' ? (
          <>
            {r.counterpartName}
            <span className="ml-1 text-xs text-inkMuted">（原老師{r.substituteReason ? `・${r.substituteReason}` : ''}）</span>
          </>
        ) : (
          r.counterpartName
        ),
    },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <Card className="mb-6">
      <DataTable
        columns={columns}
        rows={rows}
        keyField={(r) => `${r.kind}-${r.id}`}
        emptyText="目前沒有被指派的工作"
        onRowClick={(r) => {
          if (r.kind === 'SUBSTITUTE') setViewing(r);
        }}
        rowClassName={(r) => (r.kind === 'SUBSTITUTE' ? 'cursor-pointer hover:bg-stripe' : '')}
      />
      {rows.some((r) => r.kind === 'SUBSTITUTE') && <p className="mt-2 text-xs text-inkMuted">點代課列可開啟該班學生名單</p>}
      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={`${viewing?.className ?? ''} 學生名單`}>
        {viewing && (
          <>
            <p className="mb-3 text-sm text-inkMuted">
              {formatDateWithWeekday(viewing.date)} {viewing.startTime}-{viewing.endTime}・共 {viewing.students.length} 人
            </p>
            {viewing.students.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {viewing.students.map((s) => (
                  <li key={s.id} className="text-sm text-ink">
                    {s.name}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Modal>
    </Card>
  );
}
