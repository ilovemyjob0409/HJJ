'use client';

import { useEffect, useState } from 'react';

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

export default function AdminSubstituteRequestsPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});

  async function load() {
    const [reqRes, teacherRes] = await Promise.all([fetch('/api/substitute-requests'), fetch('/api/teachers')]);
    setRows(await reqRes.json());
    setTeachers(await teacherRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function assign(id: string) {
    const substituteTeacherId = selected[id];
    if (!substituteTeacherId) return;
    await fetch(`/api/substitute-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ substituteTeacherId }) });
    load();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">待安排代課</h1>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">班級</th>
            <th className="p-2">原老師</th>
            <th className="p-2">日期</th>
            <th className="p-2">原因</th>
            <th className="p-2">指派代課</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-2">{r.class.name}</td>
              <td className="p-2">{r.originalTeacher.user.name}</td>
              <td className="p-2">{new Date(r.date).toLocaleDateString()}</td>
              <td className="p-2">{r.reason}</td>
              <td className="p-2">
                <select className="border p-2" onChange={(e) => setSelected({ ...selected, [r.id]: e.target.value })}>
                  <option value="">選擇代課老師</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>{t.user.name}</option>
                  ))}
                </select>
                <button className="ml-2 bg-black px-3 py-1 text-white" onClick={() => assign(r.id)}>指派</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
