'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateWithWeekday } from '@/lib/dateFormat';

type SessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY';

interface MyAttendanceRow {
  id: string;
  type: SessionType;
  date: string;
  title: string;
  status: string;
  checkInTime: string | null;
  checkOutTime: string | null;
}

const TYPE_LABEL: Record<SessionType, string> = {
  CLASS: '班級',
  ONE_ON_ONE: '一對一補課',
  GO_HALL: '弈廳',
  ACTIVITY: '活動',
};

export default function StudentAttendancePage() {
  const [rows, setRows] = useState<MyAttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/attendance/me')
      .then((res) => res.json())
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  const columns: Column<MyAttendanceRow>[] = [
    { header: '類型', render: (r) => TYPE_LABEL[r.type], sortValue: (r) => r.type },
    { header: '名稱', render: (r) => r.title, sortValue: (r) => r.title },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW'), sortValue: (r) => r.date },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
    { header: '簽到', render: (r) => r.checkInTime ?? '-', sortValue: (r) => r.checkInTime ?? null },
    { header: '簽退', render: (r) => r.checkOutTime ?? '-', sortValue: (r) => r.checkOutTime ?? null },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">我的出席紀錄</h1>
      <Card>
        <CollapsibleDataTable columns={columns} rows={rows} loading={loading} keyField={(r) => r.id} maxRows={3} />
      </Card>
    </>
  );
}
