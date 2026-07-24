'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
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

export default function SubstituteHistoryTable({ rows }: { rows: SubstituteRow[] }) {
  const [search, setSearch] = useState('');
  const filteredRows = rows.filter((r) => matchesSubstituteSearch(r, search));

  const columns: Column<SubstituteRow>[] = [
    { header: '班級', render: (r) => r.class.name },
    { header: '原老師', render: (r) => r.originalTeacher.user.name },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW') },
    { header: '原因', render: (r) => r.reason },
    { header: '代課老師', render: (r) => r.substituteTeacher?.user.name ?? '-' },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="mb-3">
        <Input
          placeholder="搜尋班級、老師或原因"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>
      <Card>
        <DataTable
          columns={columns}
          rows={filteredRows}
          keyField={(r) => r.id}
          maxRows={search.trim() ? undefined : 3}
        />
      </Card>
    </>
  );
}
