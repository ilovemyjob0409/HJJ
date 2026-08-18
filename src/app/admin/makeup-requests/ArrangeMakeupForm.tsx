'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';
import { ONE_ON_ONE_DURATION_MINUTES } from '@/lib/oneOnOneSlot';

interface SlotOption {
  startTime: string;
  endTime: string;
  available: boolean;
}

interface StudentRow {
  id: string;
  studentNumber: string | null;
  user: { name: string };
}

interface AdminClassRow {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  enrollments: { studentId: string; student: { user: { name: string } } }[];
}

interface TeacherOption {
  id: string;
  subjects: string;
  user: { name: string };
}

interface AvailabilityWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_WEEKDAY: '日期跟班級上課的星期對不上，請重新選擇',
  NOT_ENROLLED: '該學生未就讀所選班級',
  NOT_AVAILABLE: '該班科目不提供一對一補課',
  QUOTA_EXCEEDED: '本期一對一補課額度已使用完畢',
  OUTSIDE_AVAILABILITY: '不在老師可補課時段內',
  SLOT_CONFLICT: '該時段已被其他學生預約',
  ALREADY_ON_LEAVE: '該學生該日已有請假紀錄；要補排補課請勾選「同時安排補課」',
  ALREADY_HAS_MAKEUP: '該筆請假已安排過補課',
};

// 代辦請假／補課：選學生＋原課程建立請假（直接核准）；可勾選同時
// 安排插班或一對一（同樣直接核准，立即進點名名單）。選到已請假的
// 日期時，補課會掛在原本的請假上。
export default function ArrangeMakeupForm({ onArranged }: { onArranged?: () => void }) {
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<AdminClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);

  const [search, setSearch] = useState('');
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('行政代辦');
  // 補課可選：不勾就只代辦請假，勾了才展開插班／一對一一併送出
  const [withMakeup, setWithMakeup] = useState(false);
  const [type, setType] = useState<'INSERTION' | 'ONE_ON_ONE'>('INSERTION');
  const [targetClassId, setTargetClassId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [oneOnOne, setOneOnOne] = useState({ teacherId: '', slotDate: '', slotStartTime: '' });
  const [slotOptions, setSlotOptions] = useState<SlotOption[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 老師或日期一變就重抓可預約起點，並清掉已選的時間
  useEffect(() => {
    setOneOnOne((f) => ({ ...f, slotStartTime: '' }));
    if (!oneOnOne.teacherId || !oneOnOne.slotDate) {
      setSlotOptions([]);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    fetch(`/api/one-on-one-slots?teacherId=${oneOnOne.teacherId}&date=${oneOnOne.slotDate}`)
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
  }, [oneOnOne.teacherId, oneOnOne.slotDate]);

  useEffect(() => {
    if (!expanded || students.length > 0) return;
    fetch('/api/students').then((r) => (r.ok ? r.json() : [])).then(setStudents);
    fetch('/api/classes').then((r) => (r.ok ? r.json() : [])).then(setClasses);
    fetch('/api/teachers').then((r) => (r.ok ? r.json() : [])).then(setTeachers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  useEffect(() => {
    if (!oneOnOne.teacherId) {
      setAvailability([]);
      return;
    }
    fetch(`/api/makeup-requests?teacherId=${oneOnOne.teacherId}`)
      .then((r) => (r.ok ? r.json() : { availability: [] }))
      .then((data) => setAvailability(data.availability ?? []));
  }, [oneOnOne.teacherId]);

  const studentClassNames = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of classes) {
      for (const e of c.enrollments) {
        (map[e.studentId] ??= []).push(c.name);
      }
    }
    return map;
  }, [classes]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (s) =>
          s.user.name.toLowerCase().includes(q) ||
          (s.studentNumber ?? '').toLowerCase().includes(q) ||
          (studentClassNames[s.id] ?? []).some((n) => n.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [students, search, studentClassNames]);

  const selectedStudent = students.find((s) => s.id === studentId);
  const enrolledClasses = useMemo(
    () => classes.filter((c) => c.enrollments.some((e) => e.studentId === studentId)),
    [classes, studentId]
  );
  const originalClass = classes.find((c) => c.id === classId);
  const isGo = originalClass?.subject === '圍棋';
  const insertionTargets = useMemo(
    () =>
      originalClass
        ? classes.filter((c) => c.id !== originalClass.id && c.subject === originalClass.subject && c.level === originalClass.level)
        : [],
    [classes, originalClass]
  );

  useEffect(() => {
    if (!isGo && type === 'ONE_ON_ONE') setType('INSERTION');
  }, [isGo, type]);

  function reset() {
    setStudentId('');
    setClassId('');
    setDate('');
    setReason('行政代辦');
    setWithMakeup(false);
    setType('INSERTION');
    setTargetClassId('');
    setTargetDate('');
    setOneOnOne({ teacherId: '', slotDate: '', slotStartTime: '' });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (withMakeup && type === 'ONE_ON_ONE' && !oneOnOne.slotStartTime) {
      showToast('請先選擇一對一補課的開始時間');
      return;
    }
    if (originalClass && date && new Date(date).getUTCDay() !== originalClass.weekday) {
      showToast(`請假日期跟班級對不上：${originalClass.name}是週${WEEKDAY_LABELS[originalClass.weekday]}上課`);
      return;
    }
    const targetClass = classes.find((c) => c.id === targetClassId);
    if (withMakeup && type === 'INSERTION' && targetClass && targetDate && new Date(targetDate).getUTCDay() !== targetClass.weekday) {
      showToast(`插班日期跟班級對不上：${targetClass.name}是週${WEEKDAY_LABELS[targetClass.weekday]}上課`);
      return;
    }
    setSubmitting(true);
    try {
      const body = !withMakeup
        ? { type: 'LEAVE_ONLY', studentId, classId, date, reason }
        : type === 'INSERTION'
          ? { type, studentId, classId, date, reason, targetClassId, targetDate }
          : { type, studentId, classId, date, reason, teacherId: oneOnOne.teacherId, slotDate: oneOnOne.slotDate, slotStartTime: oneOnOne.slotStartTime };
      const res = await fetch('/api/makeup-requests/arrange', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json();
        showToast(ERROR_MESSAGES[data.error] ?? (withMakeup ? '補課安排失敗，請稍後再試' : '代辦請假失敗，請稍後再試'));
        return;
      }
      showToast(withMakeup ? '已完成請假＋補課，點名名單已更新' : '已代辦請假');
      reset();
      setExpanded(false);
      onArranged?.();
    } finally {
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <div className="mb-6">
        <Button onClick={() => setExpanded(true)}>＋ 代辦請假／補課</Button>
      </div>
    );
  }

  return (
    <Card className="mb-6 max-w-2xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-ink">代辦請假／補課</h2>
        <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setExpanded(false)}>
          收合
        </button>
      </div>

      <p className="mb-1 text-sm font-medium text-ink">選擇學生</p>
      <Input placeholder="搜尋姓名、學號或班級名稱…" value={search} onChange={(e) => setSearch(e.target.value)} />
      {matches.length > 0 && (
        <div className="mt-2 flex max-h-40 flex-col overflow-y-auto rounded-lg border border-borderStrong">
          {matches.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setStudentId(s.id);
                setClassId('');
                setSearch('');
              }}
              className="flex items-center justify-between border-b border-borderSubtle px-3 py-2 text-left text-sm last:border-b-0 hover:bg-stripe"
            >
              <span className="text-ink">{s.user.name}</span>
              <span className="text-xs text-inkMuted">{(studentClassNames[s.id] ?? []).join('、') || '-'}</span>
            </button>
          ))}
        </div>
      )}

      {selectedStudent && (
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
          <p className="text-sm text-ink">
            學生：<span className="font-semibold">{selectedStudent.user.name}</span>
          </p>

          <Select value={classId} onChange={(e) => setClassId(e.target.value)} required>
            <option value="">選擇要請假的班級</option>
            {enrolledClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（{c.subject}）
              </option>
            ))}
          </Select>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          <Input placeholder="請假原因" value={reason} onChange={(e) => setReason(e.target.value)} required />

          {classId && (
            <>
              <label className="mt-1 flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={withMakeup} onChange={(e) => setWithMakeup(e.target.checked)} />
                同時安排補課（不勾就只代辦請假）
              </label>
              <p className="text-xs text-inkMuted">
                選到已請過假的日期時，勾選補課會直接掛在原本的請假上，不會重複請假。
              </p>

              {withMakeup && (
              <>
              <div className="mt-1 flex gap-6 text-sm text-ink">
                <label className="flex items-center gap-1">
                  <input type="radio" checked={type === 'INSERTION'} onChange={() => setType('INSERTION')} />
                  插班
                </label>
                {isGo && (
                  <label className="flex items-center gap-1">
                    <input type="radio" checked={type === 'ONE_ON_ONE'} onChange={() => setType('ONE_ON_ONE')} />
                    一對一
                  </label>
                )}
              </div>

              {type === 'INSERTION' && (
                <>
                  <Select value={targetClassId} onChange={(e) => setTargetClassId(e.target.value)} required>
                    <option value="">選擇插班班級</option>
                    {insertionTargets.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}（週{WEEKDAY_LABELS[c.weekday]}，目前 {c.enrollments.length} 人）
                      </option>
                    ))}
                  </Select>
                  <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} required />
                </>
              )}

              {type === 'ONE_ON_ONE' && (
                <>
                  <Select
                    value={oneOnOne.teacherId}
                    onChange={(e) => setOneOnOne({ ...oneOnOne, teacherId: e.target.value })}
                    required
                  >
                    <option value="">選擇老師</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.user.name}（{t.subjects}）
                      </option>
                    ))}
                  </Select>
                  {oneOnOne.teacherId && (
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
                    value={oneOnOne.slotDate}
                    onChange={(e) => setOneOnOne({ ...oneOnOne, slotDate: e.target.value })}
                    required
                  />
                  {oneOnOne.teacherId && oneOnOne.slotDate && (
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
                              onClick={() => setOneOnOne({ ...oneOnOne, slotStartTime: s.startTime })}
                              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                                oneOnOne.slotStartTime === s.startTime
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
                </>
              )}
              </>
              )}

              <Button type="submit" loading={submitting}>
                {withMakeup ? '送出請假＋補課（直接核准）' : '送出請假（直接核准）'}
              </Button>
            </>
          )}
        </form>
      )}
    </Card>
  );
}
