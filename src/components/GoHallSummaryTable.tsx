'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import CollapsibleSearchInput from '@/components/ui/CollapsibleSearchInput';
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
  title,
  rows,
  basePath,
  searchable = false,
}: {
  title?: string;
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
      {(title || searchable) && (
        <div className="mb-2 flex items-center gap-3">
          {title && <h2 className="shrink-0 whitespace-nowrap font-bold text-ink">{title}</h2>}
          {searchable && <CollapsibleSearchInput placeholder="搜尋日期或狀態" value={search} onChange={setSearch} />}
        </div>
      )}
      <Card>
        <CollapsibleDataTable
          columns={columns}
          rows={filteredRows}
          keyField={(r) => r.id}
          onRowClick={(r) => router.push(`${basePath}?highlight=${r.id}`)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          maxRows={searchable && search.trim() ? undefined : 3}
          emptyText="目前沒有相關紀錄"
        />
      </Card>
    </>
  );
}
