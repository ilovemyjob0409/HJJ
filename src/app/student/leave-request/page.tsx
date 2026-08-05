'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import RevokeLeaveButton from '@/components/RevokeLeaveButton';

interface ClassOption {
  id: string;
  name: string;
}

interface LeaveRow {
  id: string;
  date: string;
  reason: string;
  status: string;
  class: { name: string };
  makeupRequest: {
    type: 'INSERTION' | 'ONE_ON_ONE';
    status: string;
    targetDate: string | null;
    targetClass: { name: string } | null;
    slotDate: string | null;
    slotStartTime: string | null;
    slotEndTime: string | null;
    teacher: { user: { name: string } } | null;
  } | null;
}

export default function StudentLeaveRequestPage() {
  const { showToast } = useToast();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [form, setForm] = useState({ classId: '', date: '', reason: '' });
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [classesRes, leavesRes] = await Promise.all([fetch('/api/classes'), fetch('/api/leave-requests')]);
      setClasses(await classesRes.json());
      setLeaves(await leavesRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      setFormError('');
      const res = await fetch('/api/leave-requests', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) {
        const data = await res.json();
        setFormError(`錯誤：${data.error}`);
        return;
      }
      setForm({ classId: '', date: '', reason: '' });
      showToast('已送出');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  const columns: Column<LeaveRow>[] = [
    { header: '班級', render: (l) => l.class.name },
    { header: '日期', render: (l) => formatDateWithWeekday(l.date) },
    { header: '原因', render: (l) => l.reason },
    { header: '狀態', render: (l) => <StatusBadge status={l.status} /> },
    {
      header: '補課日期',
      render: (l) => {
        const m = l.makeupRequest;
        if (!m) return <span className="text-inkMuted">—</span>;
        const d = m.type === 'INSERTION' ? m.targetDate : m.slotDate;
        return <span className="whitespace-nowrap">{d ? formatDateWithWeekday(d) : '-'}</span>;
      },
    },
    {
      header: '補課安排',
      render: (l) => {
        const m = l.makeupRequest;
        if (!m) return <span className="text-inkMuted">—</span>;
        if (m.type === 'INSERTION') {
          return (
            <div className="flex flex-col items-center gap-1">
              <span className="whitespace-nowrap rounded-full bg-approvedBg px-2.5 py-0.5 text-xs font-bold text-approved">插班</span>
              <span className="whitespace-nowrap">{m.targetClass?.name ?? '-'}</span>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center gap-1">
            <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">一對一</span>
            <span className="whitespace-nowrap">{m.teacher?.user.name ?? '-'}</span>
            <span className="whitespace-nowrap">{m.slotStartTime}-{m.slotEndTime}</span>
          </div>
        );
      },
    },
    {
      header: '補課狀態',
      render: (l) =>
        l.makeupRequest ? (
          <StatusBadge status={l.makeupRequest.status} />
        ) : (
          <span className="text-inkMuted">尚未申請</span>
        ),
    },
    {
      header: '操作',
      render: (l) => <RevokeLeaveButton leaveRequestId={l.id} hasMakeup={l.makeupRequest !== null} onDone={load} />,
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">請假申請</h1>
      <Card className="mb-6 max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
            <option value="">選擇班級</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <Input placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          {formError && <p className="text-sm text-rejected">{formError}</p>}
          <Button type="submit" loading={submitting}>送出請假</Button>
        </form>
      </Card>

      <h2 className="mb-2 font-bold text-ink">我的請假紀錄</h2>
      <Card>
        <DataTable columns={columns} rows={leaves} keyField={(l) => l.id} loading={loading} />
      </Card>
    </>
  );
}
