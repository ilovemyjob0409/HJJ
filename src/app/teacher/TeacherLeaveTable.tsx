'use client';

import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import RevokeLeaveButton from '@/components/RevokeLeaveButton';
import { formatDateWithWeekday } from '@/lib/dateFormat';

// 合併「我的學生請假」與「別班插班進我班」兩種方向，用 direction 欄位區分：
// MY_STUDENT 的原班級是我自己的班（學生從這裡請假）；INCOMING 的原班級是
// 學生的本班（別班，插班進我班補課）。操作（撤銷請假）只對我自己的學生開放。
interface TeacherLeaveRow {
  id: string;
  direction: 'MY_STUDENT' | 'INCOMING';
  studentName: string;
  originClassName: string;
  date: Date;
  makeupDate: Date | null;
  makeupType: 'INSERTION' | 'ONE_ON_ONE' | null;
  destinationClassName: string | null;
  teacherName: string | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
  status: string | null;
  makeupRequestId: string | null;
}

export default function TeacherLeaveTable({ rows }: { rows: TeacherLeaveRow[] }) {
  const columns: Column<TeacherLeaveRow>[] = [
    { header: '學生', render: (r) => r.studentName, sortValue: (r) => r.studentName },
    {
      header: '方向',
      render: (r) =>
        r.direction === 'MY_STUDENT' ? (
          <span className="whitespace-nowrap rounded-full bg-stripe px-2.5 py-0.5 text-xs font-bold text-ink">我的學生請假</span>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-approvedBg px-2.5 py-0.5 text-xs font-bold text-approved">插班進我班</span>
        ),
      sortValue: (r) => r.direction,
    },
    {
      header: '原班級',
      render: (r) => <span className="whitespace-nowrap">{r.originClassName}</span>,
      sortValue: (r) => r.originClassName,
    },
    { header: '請假日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
    {
      header: '補課日期',
      render: (r) => (r.makeupDate ? formatDateWithWeekday(r.makeupDate) : <span className="text-inkMuted">—</span>),
      sortValue: (r) => r.makeupDate,
    },
    {
      header: '補課去向',
      render: (r) => {
        if (!r.makeupType) return <span className="text-inkMuted">—</span>;
        if (r.makeupType === 'INSERTION') {
          return (
            <div className="flex flex-col items-center gap-1">
              <span className="whitespace-nowrap rounded-full bg-approvedBg px-2.5 py-0.5 text-xs font-bold text-approved">插班</span>
              <span className="whitespace-nowrap">{r.destinationClassName ?? '-'}</span>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center gap-1">
            <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">一對一</span>
            <span className="whitespace-nowrap">{r.teacherName ?? '-'}</span>
            <span className="whitespace-nowrap">{r.slotStartTime}-{r.slotEndTime}</span>
          </div>
        );
      },
    },
    {
      header: '狀態',
      render: (r) => (r.status ? <StatusBadge status={r.status} /> : <span className="text-inkMuted">尚未申請</span>),
      sortValue: (r) => r.status,
    },
    {
      header: '操作',
      render: (r) =>
        r.direction === 'MY_STUDENT' ? (
          <RevokeLeaveButton leaveRequestId={r.id} hasMakeup={r.makeupRequestId !== null} />
        ) : (
          <span className="text-inkMuted">—</span>
        ),
    },
  ];

  return (
    <CollapsibleDataTable
      columns={columns}
      rows={rows}
      keyField={(r) => `${r.direction}-${r.id}`}
      emptyText="目前沒有相關紀錄"
      maxRows={3}
    />
  );
}
