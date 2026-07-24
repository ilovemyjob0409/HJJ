'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { matchesGoHallSummarySearch } from './goHallSummarySearch';

export interface GoHallSummaryRow {
  id: string;
  date: Date;
  capacity: number;
  registeredCount: number;
}

export default function GoHallSummaryTable({
  rows,
  basePath,
  searchable = false,
}: {
  rows: GoHallSummaryRow[];
  basePath: string;
  searchable?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const filteredRows = searchable ? rows.filter((r) => matchesGoHallSummarySearch(r, search)) : rows;

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
    <>
      {searchable && (
        <div className="mb-3">
          <Input
            placeholder="搜尋日期或狀態"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
        </div>
      )}
      <Card>
        <CollapsibleDataTable
          columns={columns}
          rows={filteredRows}
          keyField={(r) => r.id}
          onRowClick={(r) => router.push(`${basePath}?highlight=${r.id}`)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          maxRows={searchable ? (search.trim() ? undefined : 3) : undefined}
        />
      </Card>
    </>
  );
}
