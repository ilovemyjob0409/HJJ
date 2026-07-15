'use client';

import { useEffect, useState } from 'react';

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
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">請假/調課申請（代課安排）</h1>
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-2">
        <select className="border p-2" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
          <option value="">選擇班級</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input className="border p-2" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        <input className="border p-2" placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
        <button className="bg-black p-2 text-white" type="submit">送出</button>
      </form>
      {message && <p className="mt-4">{message}</p>}
    </div>
  );
}
