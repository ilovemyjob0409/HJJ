'use client';

import { useEffect, useState } from 'react';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface ClassRow {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
  enrollments: { id: string }[];
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [form, setForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });

  async function load() {
    const [classesRes, teachersRes] = await Promise.all([fetch('/api/classes'), fetch('/api/teachers')]);
    setClasses(await classesRes.json());
    setTeachers(await teachersRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/classes', {
      method: 'POST',
      body: JSON.stringify({ ...form, weekday: Number(form.weekday) }),
    });
    setForm({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
    load();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">班級名單</h1>
      <table className="mb-6 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">班名</th>
            <th className="p-2">科目/等級</th>
            <th className="p-2">老師</th>
            <th className="p-2">時間</th>
            <th className="p-2">人數</th>
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="p-2">{c.name}</td>
              <td className="p-2">{c.subject} / {c.level}</td>
              <td className="p-2">{c.teacher.user.name}</td>
              <td className="p-2">週{WEEKDAYS[c.weekday]} {c.startTime}-{c.endTime}</td>
              <td className="p-2">{c.enrollments.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 font-bold">新增班級</h2>
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-2">
        <input className="border p-2" placeholder="班名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="border p-2" placeholder="科目" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
        <input className="border p-2" placeholder="等級" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} required />
        <select className="border p-2" value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} required>
          <option value="">選擇老師</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>{t.user.name}</option>
          ))}
        </select>
        <select className="border p-2" value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
          {WEEKDAYS.map((w, i) => (
            <option key={i} value={i}>週{w}</option>
          ))}
        </select>
        <input className="border p-2" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
        <input className="border p-2" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
        <button className="bg-black p-2 text-white" type="submit">新增</button>
      </form>
    </div>
  );
}
