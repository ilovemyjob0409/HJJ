'use client';

import { useEffect, useState } from 'react';

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

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">學生名單</h1>
      <table className="mb-6 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">姓名</th>
            <th className="p-2">Email</th>
            <th className="p-2">家長電話</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="p-2">{s.user.name}</td>
              <td className="p-2">{s.user.email}</td>
              <td className="p-2">{s.parentPhone}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 font-bold">新增學生</h2>
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-2">
        <input className="border p-2" placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="border p-2" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input className="border p-2" placeholder="初始密碼" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <input className="border p-2" placeholder="家長電話" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
        <button className="bg-black p-2 text-white" type="submit">新增</button>
      </form>
    </div>
  );
}
