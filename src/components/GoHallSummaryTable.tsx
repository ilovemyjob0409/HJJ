'use client';

import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';

export interface GoHallSummaryRow {
  id: string;
  date: Date;
  capacity: number;
  registeredCount: number;
}

export default function GoHallSummaryTable({ rows, basePath }: { rows: GoHallSummaryRow[]; basePath: string }) {
  const router = useRouter();

  const columns: Column<GoHallSummaryRow>[] = [
    { header: '日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW') },
    { header: '人數', render: (r) => `${r.registeredCount}/${r.capacity}` },
    {
      header: '狀態',
      render: (r) =>
        r.registeredCount >= r.capacity ? (
          <span className="inline-block rounded-full bg-rejectedBg px-3 py-1 text-xs font-semibold text-rejected">已額滿</span>
        ) : (
          <span className="inline-block rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">尚有名額</span>
        ),
    },
  ];

  return (
    <Card>
      <DataTable
        columns={columns}
        rows={rows}
        keyField={(r) => r.id}
        onRowClick={(r) => router.push(`${basePath}?highlight=${r.id}`)}
        rowClassName={() => 'cursor-pointer hover:bg-gray-50'}
      />
    </Card>
  );
}
