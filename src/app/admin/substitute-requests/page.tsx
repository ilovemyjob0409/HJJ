'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import SubstituteHistoryTable from '../SubstituteHistoryTable';

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface PendingRow {
  id: string;
  date: string;
  reason: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
}

interface HistoryRow {
  id: string;
  date: Date;
  reason: string;
  status: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
  substituteTeacher: { user: { name: string } } | null;
}

export default function AdminSubstituteRequestsPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function load() {
    try {
      const [reqRes, teacherRes, historyRes] = await Promise.all([
        fetch('/api/substitute-requests'),
        fetch('/api/teachers'),
        fetch('/api/substitute-requests/all'),
      ]);
      setRows(await reqRes.json());
      setTeachers(await teacherRes.json());
      setHistory(await historyRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function assign(id: string) {
    const substituteTeacherId = selected[id];
    if (!substituteTeacherId) return;
    setPendingId(id);
    try {
      await fetch(`/api/substitute-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ substituteTeacherId }) });
      showToast('已指派');
      load();
    } finally {
      setPendingId(null);
    }
  }

  const columns: Column<PendingRow>[] = [
    { header: '班級', render: (r) => r.class.name },
    { header: '原老師', render: (r) => r.originalTeacher.user.name },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date) },
    { header: '原因', render: (r) => r.reason },
    { header: '狀態', render: () => <StatusBadge status="PENDING_ASSIGNMENT" /> },
    {
      header: '指派代課',
      render: (r) => (
        <div className="flex items-center gap-2">
          <Select onChange={(e) => setSelected({ ...selected, [r.id]: e.target.value })}>
            <option value="">選擇代課老師</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.user.name}
              </option>
            ))}
          </Select>
          <Button className="px-3 py-1 text-xs" onClick={() => assign(r.id)} loading={pendingId === r.id}>
            指派
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">待安排代課</h1>
      <Card className="mb-6">
        <DataTable columns={columns} rows={rows} keyField={(r) => r.id} loading={loading} />
      </Card>

      <SubstituteHistoryTable title="安排代課紀錄" rows={history} />
    </>
  );
}
