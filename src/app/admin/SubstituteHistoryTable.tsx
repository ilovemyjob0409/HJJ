'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import CollapsibleSearchInput from '@/components/ui/CollapsibleSearchInput';
import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import StatusBadge, { getStatusBadgeConfig } from '@/components/ui/StatusBadge';
import ExportExcelButton from '@/components/ui/ExportExcelButton';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { matchesSubstituteSearch } from './substituteSearch';

interface SubstituteRow {
  id: string;
  date: Date;
  reason: string;
  status: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
  substituteTeacher: { user: { name: string } } | null;
}

export default function SubstituteHistoryTable({ title, rows }: { title: string; rows: SubstituteRow[] }) {
  const [search, setSearch] = useState('');
  const filteredRows = rows.filter((r) => matchesSubstituteSearch(r, search));

  const columns: Column<SubstituteRow>[] = [
    { header: '班級', render: (r) => r.class.name, sortValue: (r) => r.class.name },
    { header: '原老師', render: (r) => r.originalTeacher.user.name, sortValue: (r) => r.originalTeacher.user.name },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW'), sortValue: (r) => r.date },
    { header: '原因', render: (r) => r.reason, sortValue: (r) => r.reason },
    {
      header: '代課老師',
      render: (r) => r.substituteTeacher?.user.name ?? '-',
      sortValue: (r) => r.substituteTeacher?.user.name ?? null,
    },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
  ];

  const exportColumns = [
    { header: '班級', value: (r: SubstituteRow) => r.class.name },
    { header: '原老師', value: (r: SubstituteRow) => r.originalTeacher.user.name },
    { header: '日期', value: (r: SubstituteRow) => formatDateWithWeekday(r.date, 'zh-TW') },
    { header: '原因', value: (r: SubstituteRow) => r.reason },
    { header: '代課老師', value: (r: SubstituteRow) => r.substituteTeacher?.user.name ?? '' },
    { header: '狀態', value: (r: SubstituteRow) => getStatusBadgeConfig(r.status).label },
  ];

  return (
    <>
      <div className="mb-2 flex items-center gap-3">
        <h2 className="shrink-0 whitespace-nowrap font-bold text-ink">{title}</h2>
        <CollapsibleSearchInput placeholder="搜尋班級、老師或原因" value={search} onChange={setSearch} />
        <ExportExcelButton rows={filteredRows} columns={exportColumns} filename="代課紀錄" className="ml-auto shrink-0" />
      </div>
      <Card>
        <CollapsibleDataTable
          columns={columns}
          rows={filteredRows}
          keyField={(r) => r.id}
          maxRows={search.trim() ? undefined : 3}
          emptyText="目前沒有代課紀錄"
        />
      </Card>
    </>
  );
}
