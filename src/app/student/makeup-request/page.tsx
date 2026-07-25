'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { formatDateWithWeekday } from '@/lib/dateFormat';

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

interface Quota {
  insertionRemaining: number;
  oneOnOneRemaining: number;
}

export default function MakeupRequestPage() {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [selectedLeaveId, setSelectedLeaveId] = useState('');
  const [makeupType, setMakeupType] = useState<'INSERTION' | 'ONE_ON_ONE'>('INSERTION');
  const [eligibleClasses, setEligibleClasses] = useState<ClassOption[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [message, setMessage] = useState('');
  const [quota, setQuota] = useState<Quota | null>(null);

  const [insertionForm, setInsertionForm] = useState({ targetClassId: '', targetDate: '' });
  const [oneOnOneForm, setOneOnOneForm] = useState({ teacherId: '', slotDate: '', slotStartTime: '16:00', slotEndTime: '17:00' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/leave-requests').then((r) => r.json()).then(setLeaves);
    fetch('/api/teachers').then((r) => r.json()).then(setTeachers);
  }, []);

  useEffect(() => {
    if (!selectedLeaveId) return;
    fetch(`/api/makeup-requests?leaveRequestId=${selectedLeaveId}`)
      .then((r) => r.json())
      .then((data) => {
        setEligibleClasses(data.eligibleClasses);
        setQuota(data.quota);
      });
  }, [selectedLeaveId]);

  useEffect(() => {
    if (!quota) return;
    if (makeupType === 'INSERTION' && quota.insertionRemaining === 0 && quota.oneOnOneRemaining > 0) {
      setMakeupType('ONE_ON_ONE');
    } else if (makeupType === 'ONE_ON_ONE' && quota.oneOnOneRemaining === 0 && quota.insertionRemaining > 0) {
      setMakeupType('INSERTION');
    }
  }, [quota, makeupType]);

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
    setSubmitting(true);
    try {
      setMessage('');
      const res = await fetch('/api/makeup-requests', {
        method: 'POST',
        body: JSON.stringify({ type: 'INSERTION', leaveRequestId: selectedLeaveId, ...insertionForm }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('已送出插班申請，待行政確認');
      } else if (data.error === 'QUOTA_EXCEEDED') {
        setMessage('本季補課名額已使用完畢');
      } else {
        setMessage(`錯誤：${data.error}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitOneOnOne(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
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
    } finally {
      setSubmitting(false);
    }
  }

  const leavesWithoutMakeup = leaves.filter((l) => !l.makeupRequest);

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">申請補課</h1>

      <Select className="mb-4" value={selectedLeaveId} onChange={(e) => setSelectedLeaveId(e.target.value)}>
        <option value="">選擇要補課的請假紀錄</option>
        {leavesWithoutMakeup.map((l) => (
          <option key={l.id} value={l.id}>
            {l.class.name} - {formatDateWithWeekday(l.date)}
          </option>
        ))}
      </Select>

      {selectedLeaveId && (
        <Card className="max-w-md">
          <div className="mb-4 flex gap-6 text-sm text-ink">
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={makeupType === 'INSERTION'}
                  disabled={quota?.insertionRemaining === 0}
                  onChange={() => setMakeupType('INSERTION')}
                />
                插班補課
              </span>
              {quota && (
                <span className="text-xs text-inkMuted">
                  {quota.insertionRemaining > 0 ? `剩餘 ${quota.insertionRemaining} 次` : '補課次數已使用完畢，請洽櫃檯了解'}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={makeupType === 'ONE_ON_ONE'}
                  disabled={quota?.oneOnOneRemaining === 0}
                  onChange={() => setMakeupType('ONE_ON_ONE')}
                />
                一對一補課
              </span>
              {quota && (
                <span className="text-xs text-inkMuted">
                  {quota.oneOnOneRemaining > 0 ? `剩餘 ${quota.oneOnOneRemaining} 次` : '補課次數已使用完畢，請洽櫃檯了解'}
                </span>
              )}
            </label>
          </div>

          {makeupType === 'INSERTION' && (
            <form onSubmit={submitInsertion} className="flex flex-col gap-2">
              <Select
                value={insertionForm.targetClassId}
                onChange={(e) => setInsertionForm({ ...insertionForm, targetClassId: e.target.value })}
                required
              >
                <option value="">選擇班級</option>
                {eligibleClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（週{WEEKDAYS[c.weekday]} {c.startTime}-{c.endTime}，目前 {c.enrollments.length} 人）
                  </option>
                ))}
              </Select>
              <Input
                type="date"
                value={insertionForm.targetDate}
                onChange={(e) => setInsertionForm({ ...insertionForm, targetDate: e.target.value })}
                required
              />
              <Button type="submit" loading={submitting}>送出插班申請</Button>
            </form>
          )}

          {makeupType === 'ONE_ON_ONE' && (
            <form onSubmit={submitOneOnOne} className="flex flex-col gap-2">
              <Select
                value={oneOnOneForm.teacherId}
                onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, teacherId: e.target.value })}
                required
              >
                <option value="">選擇老師</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.user.name}（{t.subjects}）
                  </option>
                ))}
              </Select>
              {oneOnOneForm.teacherId && (
                <p className="text-sm text-inkMuted">
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
              <Input
                type="date"
                value={oneOnOneForm.slotDate}
                onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotDate: e.target.value })}
                required
              />
              <div className="flex gap-2">
                <Input
                  type="time"
                  value={oneOnOneForm.slotStartTime}
                  onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotStartTime: e.target.value })}
                />
                <Input
                  type="time"
                  value={oneOnOneForm.slotEndTime}
                  onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotEndTime: e.target.value })}
                />
              </div>
              <Button type="submit" loading={submitting}>送出一對一申請</Button>
            </form>
          )}
        </Card>
      )}

      {message && <p className="mt-4 text-sm text-ink">{message}</p>}
    </>
  );
}
