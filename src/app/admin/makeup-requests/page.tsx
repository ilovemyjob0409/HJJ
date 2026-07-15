'use client';

import { useEffect, useState } from 'react';

interface PendingRow {
  id: string;
  type: 'INSERTION' | 'ONE_ON_ONE';
  leaveRequest: { student: { user: { name: string } }; class: { name: string } };
  targetClass: { name: string } | null;
  targetDate: string | null;
  teacher: { user: { name: string } } | null;
  slotDate: string | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
}

export default function AdminMakeupRequestsPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);

  async function load() {
    const res = await fetch('/api/makeup-requests/pending');
    setRows(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    await fetch(`/api/makeup-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
    load();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">待確認補課申請</h1>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">學生</th>
            <th className="p-2">原班級</th>
            <th className="p-2">類型</th>
            <th className="p-2">目標</th>
            <th className="p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-2">{r.leaveRequest.student.user.name}</td>
              <td className="p-2">{r.leaveRequest.class.name}</td>
              <td className="p-2">{r.type === 'INSERTION' ? '插班' : '一對一'}</td>
              <td className="p-2">
                {r.type === 'INSERTION'
                  ? `${r.targetClass?.name} @ ${r.targetDate ? new Date(r.targetDate).toLocaleDateString() : ''}`
                  : `${r.teacher?.user.name} @ ${r.slotDate ? new Date(r.slotDate).toLocaleDateString() : ''} ${r.slotStartTime}-${r.slotEndTime}`}
              </td>
              <td className="p-2">
                <button className="mr-2 bg-black px-3 py-1 text-white" onClick={() => decide(r.id, 'APPROVED')}>核准</button>
                <button className="bg-white border px-3 py-1" onClick={() => decide(r.id, 'REJECTED')}>拒絕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
