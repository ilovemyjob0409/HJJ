'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';

interface ClassOption {
  id: string;
  name: string;
}

export default function TeacherLeaveRequestPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [form, setForm] = useState({ classId: '', date: '', reason: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/classes').then((r) => r.json()).then(setClasses);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/substitute-requests', { method: 'POST', body: JSON.stringify(form) });
    setMessage(res.ok ? '已送出，行政將安排代課老師' : '送出失敗');
    setForm({ classId: '', date: '', reason: '' });
  }

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">請假/調課申請（代課安排）</h1>
      <Card className="max-w-md">
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
          <Button type="submit">送出</Button>
        </form>
        {message && <p className="mt-4 text-sm text-ink">{message}</p>}
      </Card>
    </>
  );
}
