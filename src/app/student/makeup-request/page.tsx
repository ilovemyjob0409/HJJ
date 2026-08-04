'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { formatDateWithWeekday, WEEKDAY_LABELS } from '@/lib/dateFormat';
import { oneOnOneEndTime, ONE_ON_ONE_DURATION_MINUTES } from '@/lib/oneOnOneSlot';

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
  oneOnOneAvailable: boolean;
  oneOnOneRemaining: number;
}

interface NoticeItem {
  id: string;
  content: string;
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
  const [notices, setNotices] = useState<NoticeItem[]>([]);

  const [insertionForm, setInsertionForm] = useState({ targetClassId: '', targetDate: '' });
  const [oneOnOneForm, setOneOnOneForm] = useState({ teacherId: '', slotDate: '', slotStartTime: '16:00' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch('/api/leave-requests').then((r) => r.json()).then(setLeaves);
    fetch('/api/teachers').then((r) => r.json()).then(setTeachers);
    fetch('/api/makeup-notices').then((r) => r.json()).then(setNotices);
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
    if (makeupType === 'ONE_ON_ONE' && (!quota.oneOnOneAvailable || quota.oneOnOneRemaining === 0)) {
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
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('已送出一對一補課申請，待行政確認');
      } else if (data.error === 'QUOTA_EXCEEDED') {
        setMessage('本期一對一補課名額已使用');
      } else if (data.error === 'NOT_AVAILABLE') {
        setMessage('此班級科目不提供一對一補課');
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

      {notices.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-2 font-bold text-ink">補課須知</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-inkMuted">
            {notices.map((n) => (
              <li key={n.id} className="whitespace-pre-wrap">
                {n.content}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6 max-w-md">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brandInk">
            1
          </span>
          <span className="text-sm font-bold text-ink">選擇要補課的請假紀錄</span>
        </div>
        <Select className="w-full" value={selectedLeaveId} onChange={(e) => setSelectedLeaveId(e.target.value)}>
          <option value="">請選擇請假紀錄</option>
          {leavesWithoutMakeup.map((l) => (
            <option key={l.id} value={l.id}>
              {l.class.name} - {formatDateWithWeekday(l.date)}
            </option>
          ))}
        </Select>

        {!selectedLeaveId && (
          <div className="mt-4 flex items-center gap-2.5 border-t border-dashed border-borderSubtle pt-4 opacity-50">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-stripe text-xs font-bold text-inkMuted">
              2
            </span>
            <span className="text-sm font-semibold text-inkMuted">選擇補課方式</span>
          </div>
        )}
      </Card>

      {selectedLeaveId && (
        <Card className="max-w-md">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brandInk">
              2
            </span>
            <span className="text-sm font-bold text-ink">選擇補課方式</span>
          </div>
          {quota?.oneOnOneAvailable ? (
            <div className="mb-4 flex flex-col gap-3 text-sm text-ink">
              <div className="flex gap-6">
                <label className="flex flex-col gap-1">
                  <span className="flex items-center gap-1">
                    <input type="radio" checked={makeupType === 'INSERTION'} onChange={() => setMakeupType('INSERTION')} />
                    插班補課
                  </span>
                  <span className="text-xs text-inkMuted">不限次數</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={makeupType === 'ONE_ON_ONE'}
                      disabled={quota.oneOnOneRemaining === 0}
                      onChange={() => setMakeupType('ONE_ON_ONE')}
                    />
                    一對一補課
                  </span>
                  <span className="text-xs text-inkMuted">
                    {quota.oneOnOneRemaining > 0 ? `本期剩餘 ${quota.oneOnOneRemaining} 次` : '本期已使用完畢'}
                  </span>
                </label>
              </div>
              {quota.oneOnOneRemaining === 0 && (
                <p className="text-xs text-inkMuted">
                  本期一對一補課已使用完畢。若無法配合插班補課，該期未補課費用將於下一期學費扣除，詳情請洽櫃檯。
                </p>
              )}
            </div>
          ) : (
            quota && <p className="mb-4 text-xs text-inkMuted">此班級提供插班補課（不限次數）。</p>
          )}

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
                    {c.name}（週{WEEKDAY_LABELS[c.weekday]} {c.startTime}-{c.endTime}，目前 {c.enrollments.length} 人）
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
                          週{WEEKDAY_LABELS[w.weekday]} {w.startTime}-{w.endTime}
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
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={oneOnOneForm.slotStartTime}
                  onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotStartTime: e.target.value })}
                />
                <span className="whitespace-nowrap text-sm text-inkMuted">
                  至 {oneOnOneEndTime(oneOnOneForm.slotStartTime)}（固定 {ONE_ON_ONE_DURATION_MINUTES} 分鐘）
                </span>
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
