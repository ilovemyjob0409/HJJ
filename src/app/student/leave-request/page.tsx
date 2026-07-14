'use client';

import { useEffect, useState } from 'react';

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

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">請假申請</h1>
      <form onSubmit={handleSubmit} className="mb-6 flex max-w-md flex-col gap-2">
        <select className="border p-2" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
          <option value="">選擇班級</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input className="border p-2" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        <input className="border p-2" placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
        <button className="bg-black p-2 text-white" type="submit">送出請假</button>
      </form>

      <h2 className="mb-2 font-bold">我的請假紀錄</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">班級</th>
            <th className="p-2">日期</th>
            <th className="p-2">原因</th>
            <th className="p-2">狀態</th>
            <th className="p-2">補課狀態</th>
          </tr>
        </thead>
        <tbody>
          {leaves.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="p-2">{l.class.name}</td>
              <td className="p-2">{new Date(l.date).toLocaleDateString()}</td>
              <td className="p-2">{l.reason}</td>
              <td className="p-2">{l.status}</td>
              <td className="p-2">{l.makeupRequest ? `${l.makeupRequest.type} / ${l.makeupRequest.status}` : '尚未申請'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
