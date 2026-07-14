'use client';

import { useEffect, useState } from 'react';

interface TeacherRow {
  id: string;
  subjects: string;
  phone: string | null;
  user: { name: string; email: string };
}

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', subjects: '', phone: '' });

  async function load() {
    const res = await fetch('/api/teachers');
    setTeachers(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/teachers', { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', email: '', password: '', subjects: '', phone: '' });
    load();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">老師名單</h1>
      <table className="mb-6 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">姓名</th>
            <th className="p-2">Email</th>
            <th className="p-2">科目</th>
            <th className="p-2">電話</th>
          </tr>
        </thead>
        <tbody>
          {teachers.map((t) => (
            <tr key={t.id} className="border-b">
              <td className="p-2">{t.user.name}</td>
              <td className="p-2">{t.user.email}</td>
              <td className="p-2">{t.subjects}</td>
              <td className="p-2">{t.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 font-bold">新增老師</h2>
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-2">
        <input className="border p-2" placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="border p-2" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input className="border p-2" placeholder="初始密碼" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <input className="border p-2" placeholder="任教科目" value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} required />
        <input className="border p-2" placeholder="電話" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button className="bg-black p-2 text-white" type="submit">新增</button>
      </form>
    </div>
  );
}
