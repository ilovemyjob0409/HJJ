'use client';

import { useEffect, useState } from 'react';
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
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
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
    setShowAddForm(false);
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
      setEditError(data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : `錯誤：${data.error}`);
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
            <Button type="submit">新增</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable columns={columns} rows={filteredTeachers} keyField={(t) => t.id} />
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
          <Button type="submit">儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除老師
        </button>
      </Modal>
    </>
  );
}
