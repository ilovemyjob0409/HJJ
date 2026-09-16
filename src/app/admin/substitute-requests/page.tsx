'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Modal from '@/components/ui/Modal';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday, WEEKDAY_LABELS } from '@/lib/dateFormat';
import WeekdayAlertModal, { WeekdayAlertInfo } from '@/components/WeekdayAlertModal';
import SubstituteHistoryTable from '../SubstituteHistoryTable';

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface ClassOption {
  id: string;
  name: string;
  weekday: number;
  teacher: { id: string; user: { name: string } };
}

const EMPTY_LEAVE_FORM = { classId: '', date: '', reason: '', substituteTeacherId: '' };

interface PendingRow {
  id: string;
  date: string;
  reason: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
}

interface HistoryRow {
  id: string;
  date: Date;
  reason: string;
  status: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
  substituteTeacher: { user: { name: string } } | null;
}

export default function AdminSubstituteRequestsPage() {
  const { showToast } = useToast();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveForm, setLeaveForm] = useState(EMPTY_LEAVE_FORM);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [weekdayAlert, setWeekdayAlert] = useState<WeekdayAlertInfo | null>(null);

  async function load() {
    try {
      const [reqRes, teacherRes, historyRes, classRes] = await Promise.all([
        fetch('/api/substitute-requests'),
        fetch('/api/teachers'),
        fetch('/api/substitute-requests/all'),
        fetch('/api/classes'),
      ]);
      setRows(await reqRes.json());
      setTeachers(await teacherRes.json());
      setHistory(await historyRes.json());
      setClasses(await classRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const leaveClass = classes.find((c) => c.id === leaveForm.classId) ?? null;

  async function submitLeave(e: React.FormEvent) {
    e.preventDefault();
    const weekdayInfo: WeekdayAlertInfo | null = leaveClass
      ? { title: '請假日期選錯了', name: leaveClass.name, weekday: leaveClass.weekday, noun: '日期' }
      : null;
    if (leaveClass && leaveForm.date && new Date(leaveForm.date).getUTCDay() !== leaveClass.weekday) {
      setWeekdayAlert(weekdayInfo);
      return;
    }
    setLeaveSubmitting(true);
    try {
      const res = await fetch('/api/substitute-requests', {
        method: 'POST',
        body: JSON.stringify({
          classId: leaveForm.classId,
          date: leaveForm.date,
          reason: leaveForm.reason,
          substituteTeacherId: leaveForm.substituteTeacherId || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'INVALID_WEEKDAY' && weekdayInfo) setWeekdayAlert(weekdayInfo);
        else showToast('送出失敗');
        return;
      }
      showToast(leaveForm.substituteTeacherId ? '已登記請假並指派代課' : '已登記請假，請接著安排代課');
      setLeaveForm(EMPTY_LEAVE_FORM);
      setLeaveOpen(false);
      load();
    } finally {
      setLeaveSubmitting(false);
    }
  }

  async function assign(id: string) {
    const substituteTeacherId = selected[id];
    if (!substituteTeacherId) return;
    setPendingId(id);
    try {
      await fetch(`/api/substitute-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ substituteTeacherId }) });
      showToast('已指派');
      load();
    } finally {
      setPendingId(null);
    }
  }

  const columns: Column<PendingRow>[] = [
    { header: '班級', render: (r) => r.class.name, sortValue: (r) => r.class.name },
    { header: '原老師', render: (r) => r.originalTeacher.user.name, sortValue: (r) => r.originalTeacher.user.name },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
    { header: '原因', render: (r) => r.reason, sortValue: (r) => r.reason },
    { header: '狀態', render: () => <StatusBadge status="PENDING_ASSIGNMENT" /> },
    {
      header: '指派代課',
      render: (r) => (
        <div className="flex items-center gap-2">
          <Select onChange={(e) => setSelected({ ...selected, [r.id]: e.target.value })}>
            <option value="">選擇代課老師</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.user.name}
              </option>
            ))}
          </Select>
          <Button className="px-3 py-1 text-xs" onClick={() => assign(r.id)} loading={pendingId === r.id}>
            指派
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-ink">待安排代課</h1>
        <Button onClick={() => setLeaveOpen(true)}>幫老師請假</Button>
      </div>
      <Card className="mb-6">
        <DataTable columns={columns} rows={rows} keyField={(r) => r.id} loading={loading} emptyText="目前沒有待安排的代課" />
      </Card>

      <SubstituteHistoryTable title="安排代課紀錄" rows={history} />

      <Modal open={leaveOpen} onClose={() => setLeaveOpen(false)} title="幫老師請假">
        <form onSubmit={submitLeave} className="flex flex-col gap-2">
          <Select
            value={leaveForm.classId}
            onChange={(e) => setLeaveForm({ ...leaveForm, classId: e.target.value, substituteTeacherId: '' })}
            required
          >
            <option value="">選擇班級</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（週{WEEKDAY_LABELS[c.weekday]}／{c.teacher.user.name}）
              </option>
            ))}
          </Select>
          <Input type="date" value={leaveForm.date} onChange={(e) => setLeaveForm({ ...leaveForm, date: e.target.value })} required />
          <Input placeholder="原因" value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} required />
          <Select
            value={leaveForm.substituteTeacherId}
            onChange={(e) => setLeaveForm({ ...leaveForm, substituteTeacherId: e.target.value })}
          >
            <option value="">代課老師（可先不選，稍後再指派）</option>
            {teachers
              .filter((t) => t.id !== leaveClass?.teacher.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.user.name}
                </option>
              ))}
          </Select>
          <Button type="submit" loading={leaveSubmitting}>
            送出
          </Button>
        </form>
      </Modal>
      <WeekdayAlertModal info={weekdayAlert} onClose={() => setWeekdayAlert(null)} />
    </>
  );
}
