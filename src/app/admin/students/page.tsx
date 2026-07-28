'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface EnrollmentQuota {
  classId: string;
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
}

interface StudentRow {
  id: string;
  parentPhone: string | null;
  user: { name: string; email: string };
  enrollments: EnrollmentQuota[];
}

interface ClassOption {
  id: string;
  name: string;
  subject: string;
}

export default function StudentsPage() {
  const { showToast } = useToast();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', parentPhone: '' });
  const [formEnrollments, setFormEnrollments] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', parentPhone: '' });
  const [editEnrollments, setEditEnrollments] = useState<Record<string, string>>({});
  const [addAmount, setAddAmount] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [studentsRes, classesRes] = await Promise.all([fetch('/api/students'), fetch('/api/classes')]);
      setStudents(await studentsRes.json());
      setClasses(await classesRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function enrollmentsFromMap(map: Record<string, string>) {
    return Object.entries(map).map(([classId, val]) => ({
      classId,
      totalSessions: val === '' ? null : Number(val),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      setFormError('');
      const res = await fetch('/api/students', {
        method: 'POST',
        body: JSON.stringify({ ...form, enrollments: enrollmentsFromMap(formEnrollments) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : `錯誤：${data.error}`);
        return;
      }
      setForm({ name: '', email: '', password: '', parentPhone: '' });
      setFormEnrollments({});
      setShowAddForm(false);
      showToast('已新增');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function toggleFormClass(classId: string) {
    setFormEnrollments((prev) => {
      if (classId in prev) {
        const { [classId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [classId]: '' };
    });
  }

  function openEdit(s: StudentRow) {
    setEditing(s);
    setEditForm({ name: s.user.name, email: s.user.email, password: '', parentPhone: s.parentPhone ?? '' });
    setEditEnrollments(Object.fromEntries(s.enrollments.map((e) => [e.classId, e.totalSessions === null ? '' : String(e.totalSessions)])));
    setAddAmount({});
    setEditError('');
  }

  function toggleClass(classId: string) {
    setEditEnrollments((prev) => {
      if (classId in prev) {
        const { [classId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [classId]: '' };
    });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      setEditError('');
      const res = await fetch(`/api/students/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...editForm, enrollments: enrollmentsFromMap(editEnrollments) }),
      });
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

  async function handleAddSessions(classId: string) {
    if (!editing) return;
    const amount = Number(addAmount[classId]);
    if (!amount || amount <= 0) return;
    const res = await fetch(`/api/classes/${classId}/enrollments`, {
      method: 'PATCH',
      body: JSON.stringify({ studentId: editing.id, addSessions: amount }),
    });
    if (!res.ok) {
      const data = await res.json();
      setEditError(`錯誤：${data.error}`);
      return;
    }
    setAddAmount((prev) => ({ ...prev, [classId]: '' }));
    showToast('已加堂');
    const studentsRes = await fetch('/api/students');
    const updatedStudents: StudentRow[] = await studentsRes.json();
    setStudents(updatedStudents);
    const updatedEditing = updatedStudents.find((s) => s.id === editing.id);
    if (updatedEditing) {
      setEditing(updatedEditing);
      setEditEnrollments(
        Object.fromEntries(updatedEditing.enrollments.map((en) => [en.classId, en.totalSessions === null ? '' : String(en.totalSessions)]))
      );
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm(`確定要刪除學生「${editing.user.name}」嗎？此操作無法復原。`)) return;
    setEditError('');
    const res = await fetch(`/api/students/${editing.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setEditError(data.error === 'STUDENT_HAS_RECORDS' ? '此學生仍有請假紀錄，請先處理後再刪除' : `錯誤：${data.error}`);
      return;
    }
    setEditing(null);
    showToast('已刪除');
    load();
  }

  const filteredStudents = students.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.user.name.toLowerCase().includes(q) ||
      s.user.email.toLowerCase().includes(q) ||
      (s.parentPhone ?? '').toLowerCase().includes(q)
    );
  });

  const columns: Column<StudentRow>[] = [
    { header: '姓名', render: (s) => s.user.name },
    { header: '帳號', render: (s) => s.user.email },
    { header: '家長電話', render: (s) => s.parentPhone ?? '-' },
    { header: '班級數', render: (s) => s.enrollments.length },
    {
      header: '操作',
      render: (s) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(s)}>
          編輯
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">學生名單</h1>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="搜尋姓名、帳號或家長電話"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        {!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增學生</Button>}
      </div>
      {showAddForm && (
        <Card className="mb-6 max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增學生</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input placeholder="帳號" type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <Input
              placeholder="初始密碼（留空預設 12345678）"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <Input placeholder="家長電話" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
            <div>
              <p className="mb-1 text-sm font-medium text-ink">所屬班級（可複選，可留空）</p>
              <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-lg border border-borderStrong p-2">
                {classes.map((c) => {
                  const checked = c.id in formEnrollments;
                  return (
                    <div key={c.id} className="flex items-center gap-2">
                      <label className="flex flex-1 items-center gap-2 text-sm text-ink">
                        <input type="checkbox" checked={checked} onChange={() => toggleFormClass(c.id)} />
                        {c.name}（{c.subject}）
                      </label>
                      {checked && (
                        <Input
                          type="number"
                          placeholder="總堂數"
                          value={formEnrollments[c.id] ?? ''}
                          onChange={(e) => setFormEnrollments((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          className="w-24"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {formError && <p className="text-sm text-rejected">{formError}</p>}
            <Button type="submit" loading={submitting}>新增</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={filteredStudents}
          keyField={(s) => s.id}
          loading={loading}
          onRowClick={openEdit}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯學生">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
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
            placeholder="家長電話"
            value={editForm.parentPhone}
            onChange={(e) => setEditForm({ ...editForm, parentPhone: e.target.value })}
          />

          <div>
            <p className="mb-1 text-sm font-medium text-ink">所屬班級</p>
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border border-borderStrong p-2">
              {classes.map((c) => {
                const checked = c.id in editEnrollments;
                const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                return (
                  <div key={c.id} className="flex flex-col gap-1 border-b border-borderSubtle pb-2 last:border-b-0 last:pb-0">
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={checked} onChange={() => toggleClass(c.id)} />
                      {c.name}（{c.subject}）
                    </label>
                    {checked && (
                      <div className="ml-6 flex flex-wrap items-center gap-2">
                        <Input
                          type="number"
                          placeholder="總堂數"
                          value={editEnrollments[c.id] ?? ''}
                          onChange={(e) => setEditEnrollments((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          className="w-24"
                        />
                        {enrollment && (
                          <>
                            {enrollment.totalSessions !== null && (
                              <span className="text-xs text-inkMuted">
                                已上 {enrollment.usedSessions}／剩餘 {enrollment.remaining}
                              </span>
                            )}
                            <Input
                              type="number"
                              placeholder="+堂數"
                              value={addAmount[c.id] ?? ''}
                              onChange={(e) => setAddAmount((prev) => ({ ...prev, [c.id]: e.target.value }))}
                              className="w-20"
                            />
                            <button
                              type="button"
                              className="text-xs text-brandDark hover:underline"
                              onClick={() => handleAddSessions(c.id)}
                            >
                              加堂
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {editError && <p className="text-sm text-rejected">{editError}</p>}
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除學生
        </button>
      </Modal>
    </>
  );
}
