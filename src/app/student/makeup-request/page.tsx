'use client';

import { useEffect, useState } from 'react';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface LeaveRow {
  id: string;
  date: string;
  class: { name: string; subject: string; level: string };
  makeupRequest: { id: string } | null;
}

interface ClassOption {
  id: string;
  name: string;
  weekday: number;
  startTime: string;
  endTime: string;
  enrollments: { id: string }[];
}

interface TeacherOption {
  id: string;
  user: { name: string };
  subjects: string;
}

interface AvailabilityWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

export default function MakeupRequestPage() {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [selectedLeaveId, setSelectedLeaveId] = useState('');
  const [makeupType, setMakeupType] = useState<'INSERTION' | 'ONE_ON_ONE'>('INSERTION');
  const [eligibleClasses, setEligibleClasses] = useState<ClassOption[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [message, setMessage] = useState('');

  const [insertionForm, setInsertionForm] = useState({ targetClassId: '', targetDate: '' });
  const [oneOnOneForm, setOneOnOneForm] = useState({ teacherId: '', slotDate: '', slotStartTime: '16:00', slotEndTime: '17:00' });

  useEffect(() => {
    fetch('/api/leave-requests').then((r) => r.json()).then(setLeaves);
    fetch('/api/teachers').then((r) => r.json()).then(setTeachers);
  }, []);

  useEffect(() => {
    if (!selectedLeaveId) return;
    fetch(`/api/makeup-requests?leaveRequestId=${selectedLeaveId}`)
      .then((r) => r.json())
      .then((data) => setEligibleClasses(data.eligibleClasses));
  }, [selectedLeaveId]);

  useEffect(() => {
    if (!oneOnOneForm.teacherId) {
      setAvailability([]);
      return;
    }
    fetch(`/api/makeup-requests?teacherId=${oneOnOneForm.teacherId}`)
      .then((r) => r.json())
      .then((data) => setAvailability(data.availability));
  }, [oneOnOneForm.teacherId]);

  async function submitInsertion(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    const res = await fetch('/api/makeup-requests', {
      method: 'POST',
      body: JSON.stringify({ type: 'INSERTION', leaveRequestId: selectedLeaveId, ...insertionForm }),
    });
    const data = await res.json();
    setMessage(res.ok ? '已送出插班申請，待行政確認' : `錯誤：${data.error}`);
  }

  async function submitOneOnOne(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    const res = await fetch('/api/makeup-requests', {
      method: 'POST',
      body: JSON.stringify({
        type: 'ONE_ON_ONE',
        leaveRequestId: selectedLeaveId,
        teacherId: oneOnOneForm.teacherId,
        slotDate: oneOnOneForm.slotDate,
        slotStartTime: oneOnOneForm.slotStartTime,
        slotEndTime: oneOnOneForm.slotEndTime,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage('已送出一對一補課申請，待行政確認');
    } else if (data.error === 'QUOTA_EXCEEDED') {
      setMessage('本季一對一補課名額已使用');
    } else if (data.error === 'OUTSIDE_AVAILABILITY') {
      setMessage('該時段不在老師可補課時段內');
    } else if (data.error === 'SLOT_CONFLICT') {
      setMessage('該時段已被其他學生預約');
    } else {
      setMessage(`錯誤：${data.error}`);
    }
  }

  const leavesWithoutMakeup = leaves.filter((l) => !l.makeupRequest);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">申請補課</h1>

      <select className="mb-4 border p-2" value={selectedLeaveId} onChange={(e) => setSelectedLeaveId(e.target.value)}>
        <option value="">選擇要補課的請假紀錄</option>
        {leavesWithoutMakeup.map((l) => (
          <option key={l.id} value={l.id}>
            {l.class.name} - {new Date(l.date).toLocaleDateString()}
          </option>
        ))}
      </select>

      {selectedLeaveId && (
        <>
          <div className="mb-4 flex gap-4">
            <label>
              <input type="radio" checked={makeupType === 'INSERTION'} onChange={() => setMakeupType('INSERTION')} /> 插班補課
            </label>
            <label>
              <input type="radio" checked={makeupType === 'ONE_ON_ONE'} onChange={() => setMakeupType('ONE_ON_ONE')} /> 一對一補課
            </label>
          </div>

          {makeupType === 'INSERTION' && (
            <form onSubmit={submitInsertion} className="flex max-w-md flex-col gap-2">
              <select className="border p-2" value={insertionForm.targetClassId} onChange={(e) => setInsertionForm({ ...insertionForm, targetClassId: e.target.value })} required>
                <option value="">選擇班級</option>
                {eligibleClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（週{WEEKDAYS[c.weekday]} {c.startTime}-{c.endTime}，目前 {c.enrollments.length} 人）
                  </option>
                ))}
              </select>
              <input className="border p-2" type="date" value={insertionForm.targetDate} onChange={(e) => setInsertionForm({ ...insertionForm, targetDate: e.target.value })} required />
              <button className="bg-black p-2 text-white" type="submit">送出插班申請</button>
            </form>
          )}

          {makeupType === 'ONE_ON_ONE' && (
            <form onSubmit={submitOneOnOne} className="flex max-w-md flex-col gap-2">
              <select className="border p-2" value={oneOnOneForm.teacherId} onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, teacherId: e.target.value })} required>
                <option value="">選擇老師</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.user.name}（{t.subjects}）</option>
                ))}
              </select>
              {oneOnOneForm.teacherId && (
                <p className="text-sm text-gray-600">
                  可補課時段：
                  {availability.length === 0
                    ? '尚未設定'
                    : availability.map((w, i) => (
                        <span key={i}>
                          週{WEEKDAYS[w.weekday]} {w.startTime}-{w.endTime}
                          {i < availability.length - 1 ? '、' : ''}
                        </span>
                      ))}
                </p>
              )}
              <input className="border p-2" type="date" value={oneOnOneForm.slotDate} onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotDate: e.target.value })} required />
              <div className="flex gap-2">
                <input className="border p-2" type="time" value={oneOnOneForm.slotStartTime} onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotStartTime: e.target.value })} />
                <input className="border p-2" type="time" value={oneOnOneForm.slotEndTime} onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotEndTime: e.target.value })} />
              </div>
              <button className="bg-black p-2 text-white" type="submit">送出一對一申請</button>
            </form>
          )}
        </>
      )}

      {message && <p className="mt-4">{message}</p>}
    </div>
  );
}
