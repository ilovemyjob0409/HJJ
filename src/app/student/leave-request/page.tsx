'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';

interface ClassOption {
  id: string;
  name: string;
}

interface LeaveRow {
  id: string;
  date: string;
  reason: string;
  status: string;
  class: { name: string };
  makeupRequest: { type: string; status: string } | null;
}

export default function StudentLeaveRequestPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [form, setForm] = useState({ classId: '', date: '', reason: '' });

  async function load() {
    const [classesRes, leavesRes] = await Promise.all([fetch('/api/classes'), fetch('/api/leave-requests')]);
    setClasses(await classesRes.json());
    setLeaves(await leavesRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/leave-requests', { method: 'POST', body: JSON.stringify(form) });
    setForm({ classId: '', date: '', reason: '' });
    load();
  }

  const columns: Column<LeaveRow>[] = [
    { header: '班級', render: (l) => l.class.name },
    { header: '日期', render: (l) => new Date(l.date).toLocaleDateString() },
    { header: '原因', render: (l) => l.reason },
    { header: '狀態', render: (l) => <StatusBadge status={l.status} /> },
    {
      header: '補課狀態',
      render: (l) =>
        l.makeupRequest ? <StatusBadge status={l.makeupRequest.status} /> : <span className="text-inkMuted">尚未申請</span>,
    },
  ];

  return (
    <AppShell role="STUDENT">
      <h1 className="mb-4 text-xl font-bold text-ink">請假申請</h1>
      <Card className="mb-6 max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
            <option value="">選擇班級</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <Input placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          <Button type="submit">送出請假</Button>
        </form>
      </Card>

      <h2 className="mb-2 font-bold text-ink">我的請假紀錄</h2>
      <Card>
        <DataTable columns={columns} rows={leaves} keyField={(l) => l.id} />
      </Card>
    </AppShell>
  );
}
