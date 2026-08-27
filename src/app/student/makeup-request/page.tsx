'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday, WEEKDAY_LABELS } from '@/lib/dateFormat';
import { ONE_ON_ONE_DURATION_MINUTES } from '@/lib/oneOnOneSlot';
import WeekdayAlertModal, { WeekdayAlertInfo } from '@/components/WeekdayAlertModal';

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

interface SlotOption {
  startTime: string;
  endTime: string;
  available: boolean;
}

export default function MakeupRequestPage() {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [selectedLeaveId, setSelectedLeaveId] = useState('');
  const [makeupType, setMakeupType] = useState<'INSERTION' | 'ONE_ON_ONE'>('INSERTION');
  const [eligibleClasses, setEligibleClasses] = useState<ClassOption[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const { showToast } = useToast();
  const [weekdayAlert, setWeekdayAlert] = useState<WeekdayAlertInfo | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [notices, setNotices] = useState<NoticeItem[]>([]);

  const [insertionForm, setInsertionForm] = useState({ targetClassId: '', targetDate: '' });
  const [oneOnOneForm, setOneOnOneForm] = useState({ teacherId: '', slotDate: '', slotStartTime: '' });
  const [slotOptions, setSlotOptions] = useState<SlotOption[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // 老師或日期一變就重抓可預約起點，並清掉已選的時間
  useEffect(() => {
    setOneOnOneForm((f) => ({ ...f, slotStartTime: '' }));
    if (!oneOnOneForm.teacherId || !oneOnOneForm.slotDate) {
      setSlotOptions([]);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    fetch(`/api/one-on-one-slots?teacherId=${oneOnOneForm.teacherId}&date=${oneOnOneForm.slotDate}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setSlotOptions(Array.isArray(data) ? data : []);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oneOnOneForm.teacherId, oneOnOneForm.slotDate]);
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
    const targetClass = eligibleClasses.find((c) => c.id === insertionForm.targetClassId);
    const insertionAlert: WeekdayAlertInfo | null = targetClass
      ? { title: '插班日期選錯了', name: targetClass.name, weekday: targetClass.weekday, noun: '插班日期' }
      : null;
    if (targetClass && insertionForm.targetDate && new Date(insertionForm.targetDate).getUTCDay() !== targetClass.weekday) {
      setWeekdayAlert(insertionAlert);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/makeup-requests', {
        method: 'POST',
        body: JSON.stringify({ type: 'INSERTION', leaveRequestId: selectedLeaveId, ...insertionForm }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('已送出插班申請，待行政確認');
      } else if (data.error === 'INVALID_WEEKDAY' && insertionAlert) {
        setWeekdayAlert(insertionAlert);
      } else {
        showToast(`錯誤：${data.error}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitOneOnOne(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
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
        showToast('已送出一對一補課申請，待行政確認');
      } else if (data.error === 'QUOTA_EXCEEDED') {
        showToast('本期一對一補課名額已使用');
      } else if (data.error === 'NOT_AVAILABLE') {
        showToast('此班級科目不提供一對一補課');
      } else if (data.error === 'OUTSIDE_AVAILABILITY') {
        showToast('該時段不在老師可補課時段內');
      } else if (data.error === 'SLOT_CONFLICT') {
        showToast('該時段已被其他學生預約');
      } else {
        showToast(`錯誤：${data.error}`);
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
              {oneOnOneForm.teacherId && oneOnOneForm.slotDate && (
                <div>
                  <p className="mb-1.5 text-sm text-inkMuted">
                    選擇開始時間（每次固定 {ONE_ON_ONE_DURATION_MINUTES} 分鐘，灰色代表已被預約）
                  </p>
                  {slotsLoading ? (
                    <div className="skeleton-shimmer h-9 w-full rounded-lg" />
                  ) : slotOptions.length === 0 ? (
                    <p className="text-sm text-inkMuted">這一天不在老師的可補課時段，請換個日期。</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {slotOptions.map((s) => (
                        <button
                          key={s.startTime}
                          type="button"
                          disabled={!s.available}
                          onClick={() => setOneOnOneForm({ ...oneOnOneForm, slotStartTime: s.startTime })}
                          className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                            oneOnOneForm.slotStartTime === s.startTime
                              ? 'border-brand bg-brand text-brandInk'
                              : s.available
                                ? 'border-borderStrong bg-card text-ink hover:bg-stripe'
                                : 'cursor-not-allowed border-borderSubtle bg-stripe text-inkMuted line-through opacity-60'
                          }`}
                        >
                          {s.startTime}-{s.endTime}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <Button type="submit" loading={submitting} disabled={!oneOnOneForm.slotStartTime}>
                送出一對一申請
              </Button>
            </form>
          )}
        </Card>
      )}

      <WeekdayAlertModal info={weekdayAlert} onClose={() => setWeekdayAlert(null)} />
    </>
  );
}
