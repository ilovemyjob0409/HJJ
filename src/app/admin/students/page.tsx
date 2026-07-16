'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';

interface StudentRow {
  id: string;
  parentPhone: string | null;
  user: { name: string; email: string };
}

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', parentPhone: '' });

  async function load() {
    const res = await fetch('/api/students');
    setStudents(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/students', { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', email: '', password: '', parentPhone: '' });
    load();
  }

  const columns: Column<StudentRow>[] = [
    { header: '姓名', render: (s) => s.user.name },
    { header: 'Email', render: (s) => s.user.email },
    { header: '家長電話', render: (s) => s.parentPhone ?? '-' },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">學生名單</h1>
      <Card className="mb-6">
        <DataTable columns={columns} rows={students} keyField={(s) => s.id} />
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 font-bold text-ink">新增學生</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Input
            placeholder="初始密碼"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Input placeholder="家長電話" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
          <Button type="submit">新增</Button>
        </form>
      </Card>
    </AppShell>
  );
}
