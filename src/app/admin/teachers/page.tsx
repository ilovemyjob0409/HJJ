'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface TeacherRow {
  id: string;
  subjects: string;
  phone: string | null;
  user: { name: string; email: string };
}

interface OneOnOneSlotRow {
  id: string;
  status: string;
  slotDate: string;
  slotStartTime: string;
  slotEndTime: string;
  leaveRequest: {
    student: { user: { name: string } };
    class: { name: string };
  };
}

export default function TeachersPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', subjects: '', phone: '' });
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<TeacherRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', subjects: '', phone: '' });
  const [editError, setEditError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [oneOnOneSlots, setOneOnOneSlots] = useState<OneOnOneSlotRow[]>([]);
  const [oneOnOneLoading, setOneOnOneLoading] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/teachers');
      setTeachers(await res.json());
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
      const res = await fetch('/api/teachers', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : `錯誤：${data.error}`);
        return;
      }
      setForm({ name: '', email: '', password: '', subjects: '', phone: '' });
      setShowAddForm(false);
      showToast('已新增');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(t: TeacherRow) {
    setEditing(t);
    setEditForm({ name: t.user.name, email: t.user.email, password: '', subjects: t.subjects, phone: t.phone ?? '' });
    setEditError('');
    setOneOnOneLoading(true);
    fetch(`/api/teachers/${t.id}/one-on-one-slots`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setOneOnOneSlots)
      .catch(() => setOneOnOneSlots([]))
      .finally(() => setOneOnOneLoading(false));
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      setEditError('');
      const res = await fetch(`/api/teachers/${editing.id}`, { method: 'PATCH', body: JSON.stringify(editForm) });
      if (!res.ok) {
        const data = await res.json();
        setEditError(data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : `錯誤：${data.error}`);
        return;
      }
      setEditing(null);
      showToast('已儲存');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!(await confirm(`確定要刪除老師「${editing.user.name}」嗎？此操作無法復原。`, { danger: true }))) return;
    setEditError('');
    const res = await fetch(`/api/teachers/${editing.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setEditError(data.error === 'TEACHER_HAS_RECORDS' ? '此老師仍有帶班或代課紀錄，請先處理後再刪除' : `錯誤：${data.error}`);
      return;
    }
    setEditing(null);
    showToast('已刪除');
    load();
  }

  const filteredTeachers = teachers.filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      t.user.name.toLowerCase().includes(q) ||
      t.user.email.toLowerCase().includes(q) ||
      t.subjects.toLowerCase().includes(q) ||
      (t.phone ?? '').toLowerCase().includes(q)
    );
  });

  const oneOnOneColumns: Column<OneOnOneSlotRow>[] = [
    { header: '日期', render: (r) => formatDateWithWeekday(r.slotDate) },
    { header: '時段', render: (r) => `${r.slotStartTime}-${r.slotEndTime}` },
    { header: '學生', render: (r) => r.leaveRequest.student.user.name },
    { header: '原班級', render: (r) => r.leaveRequest.class.name },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const columns: Column<TeacherRow>[] = [
    { header: '姓名', render: (t) => t.user.name },
    { header: '帳號', render: (t) => t.user.email },
    { header: '科目', render: (t) => t.subjects },
    { header: '電話', render: (t) => t.phone ?? '-' },
    {
      header: '操作',
      render: (t) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(t)}>
          編輯
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">老師名單</h1>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="搜尋姓名、帳號、科目或電話"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        {!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增老師</Button>}
      </div>
      {showAddForm && (
        <Card className="mb-6 max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增老師</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input placeholder="帳號" type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <Input
              placeholder="初始密碼"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            <Input placeholder="任教科目" value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} required />
            <Input placeholder="電話" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            {formError && <p className="text-sm text-rejected">{formError}</p>}
            <Button type="submit" loading={submitting}>新增</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable columns={columns} rows={filteredTeachers} keyField={(t) => t.id} loading={loading} emptyText="目前沒有老師" />
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯老師">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-2">
          <Input placeholder="姓名" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
          <Input
            placeholder="帳號"
            type="text"
            value={editForm.email}
            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
            required
          />
          <Input
            placeholder="新密碼（留空＝不變更）"
            type="password"
            value={editForm.password}
            onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
          />
          <Input
            placeholder="任教科目"
            value={editForm.subjects}
            onChange={(e) => setEditForm({ ...editForm, subjects: e.target.value })}
            required
          />
          <Input placeholder="電話" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          {editError && <p className="text-sm text-rejected">{editError}</p>}
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除老師
        </button>

        {editing && (
          <div className="mt-4 border-t border-borderStrong pt-3">
            <p className="mb-2 text-sm font-medium text-ink">一對一補課時段（{oneOnOneSlots.length}）</p>
            {oneOnOneLoading ? (
              <p className="text-sm text-inkMuted">載入中…</p>
            ) : oneOnOneSlots.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無一對一補課時段</p>
            ) : (
              <CollapsibleDataTable
                columns={oneOnOneColumns}
                rows={oneOnOneSlots}
                keyField={(r) => r.id}
                maxRows={3}
              />
            )}
          </div>
        )}
      </Modal>
      {ConfirmDialog}
    </>
  );
}
