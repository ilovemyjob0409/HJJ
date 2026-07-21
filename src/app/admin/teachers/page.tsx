'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface TeacherRow {
  id: string;
  subjects: string;
  phone: string | null;
  user: { name: string; email: string };
}

export default function TeachersPage() {
  const { showToast } = useToast();
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', subjects: '', phone: '' });
  const [editing, setEditing] = useState<TeacherRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', subjects: '', phone: '' });
  const [editError, setEditError] = useState('');

  async function load() {
    const res = await fetch('/api/teachers');
    setTeachers(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/teachers', { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', email: '', password: '', subjects: '', phone: '' });
    showToast('已新增');
    load();
  }

  function openEdit(t: TeacherRow) {
    setEditing(t);
    setEditForm({ name: t.user.name, email: t.user.email, password: '', subjects: t.subjects, phone: t.phone ?? '' });
    setEditError('');
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditError('');
    const res = await fetch(`/api/teachers/${editing.id}`, { method: 'PATCH', body: JSON.stringify(editForm) });
    if (!res.ok) {
      const data = await res.json();
      setEditError(data.error === 'EMAIL_TAKEN' ? '此 Email 已被使用' : `錯誤：${data.error}`);
      return;
    }
    setEditing(null);
    showToast('已儲存');
    load();
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm(`確定要刪除老師「${editing.user.name}」嗎？此操作無法復原。`)) return;
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

  const columns: Column<TeacherRow>[] = [
    { header: '姓名', render: (t) => t.user.name },
    { header: 'Email', render: (t) => t.user.email },
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
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">老師名單</h1>
      <Card className="mb-6">
        <DataTable columns={columns} rows={teachers} keyField={(t) => t.id} />
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 font-bold text-ink">新增老師</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Input
            placeholder="初始密碼"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Input placeholder="任教科目" value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} required />
          <Input placeholder="電話" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Button type="submit">新增</Button>
        </form>
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯老師">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-2">
          <Input placeholder="姓名" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
          <Input
            placeholder="Email"
            type="email"
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
          <Button type="submit">儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除老師
        </button>
      </Modal>
    </AppShell>
  );
}
