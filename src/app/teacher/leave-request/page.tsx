'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';
import WeekdayAlertModal, { WeekdayAlertInfo } from '@/components/WeekdayAlertModal';

interface ClassOption {
  id: string;
  name: string;
  weekday: number;
}

export default function TeacherLeaveRequestPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [form, setForm] = useState({ classId: '', date: '', reason: '' });
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [weekdayAlert, setWeekdayAlert] = useState<WeekdayAlertInfo | null>(null);

  useEffect(() => {
    fetch('/api/classes').then((r) => r.json()).then(setClasses);
  }, []);

  const selectedClass = classes.find((c) => c.id === form.classId) ?? null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    const weekdayInfo: WeekdayAlertInfo | null = selectedClass
      ? { title: '代課日期選錯了', name: selectedClass.name, weekday: selectedClass.weekday, noun: '日期' }
      : null;
    if (selectedClass && form.date && new Date(form.date).getUTCDay() !== selectedClass.weekday) {
      setWeekdayAlert(weekdayInfo);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/substitute-requests', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'INVALID_WEEKDAY' && weekdayInfo) setWeekdayAlert(weekdayInfo);
        else setMessage('送出失敗');
        return;
      }
      setMessage('已送出，行政將安排代課老師');
      setForm({ classId: '', date: '', reason: '' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">請假/調課申請（代課安排）</h1>
      <Card className="max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
            <option value="">選擇班級</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（週{WEEKDAY_LABELS[c.weekday]}）
              </option>
            ))}
          </Select>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <Input placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          <Button type="submit" loading={submitting}>送出</Button>
        </form>
        {message && <p className="mt-4 text-sm text-ink">{message}</p>}
      </Card>
      <WeekdayAlertModal info={weekdayAlert} onClose={() => setWeekdayAlert(null)} />
    </>
  );
}
