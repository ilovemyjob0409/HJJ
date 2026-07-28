'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  studentNumber: string | null;
  user: { name: string; email: string };
  enrollments: EnrollmentQuota[];
}

interface ClassOption {
  id: string;
  name: string;
  subject: string;
}

function StudentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', parentPhone: '', studentNumber: '' });
  const [formEnrollments, setFormEnrollments] = useState<Record<string, string>>({});
  const [formClassQuery, setFormClassQuery] = useState('');
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', parentPhone: '', studentNumber: '' });
  const [editEnrollments, setEditEnrollments] = useState<Record<string, string>>({});
  const [addClassQuery, setAddClassQuery] = useState('');
  const [addAmount, setAddAmount] = useState<Record<string, string>>({});
  const [addingSessions, setAddingSessions] = useState<Record<string, boolean>>({});
  const [editError, setEditError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const editingRef = useRef<StudentRow | null>(null);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

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

  useEffect(() => {
    const studentId = searchParams.get('studentId');
    if (!studentId || students.length === 0) return;
    const s = students.find((st) => st.id === studentId);
    if (s) openEdit(s);
    router.replace('/admin/students');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, students]);

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
        setFormError(
          data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : data.error === 'STUDENT_NUMBER_TAKEN' ? '此學號已被使用' : `錯誤：${data.error}`
        );
        return;
      }
      setForm({ name: '', email: '', password: '', parentPhone: '', studentNumber: '' });
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
        const rest = { ...prev };
        delete rest[classId];
        return rest;
      }
      return { ...prev, [classId]: '' };
    });
  }

  function openEdit(s: StudentRow) {
    setEditing(s);
    setEditForm({ name: s.user.name, email: s.user.email, password: '', parentPhone: s.parentPhone ?? '', studentNumber: s.studentNumber ?? '' });
    setEditEnrollments(Object.fromEntries(s.enrollments.map((e) => [e.classId, e.totalSessions === null ? '' : String(e.totalSessions)])));
    setAddAmount({});
    setAddClassQuery('');
    setEditError('');
  }

  function toggleClass(classId: string) {
    setEditEnrollments((prev) => {
      if (classId in prev) {
        const rest = { ...prev };
        delete rest[classId];
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
        setEditError(
          data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : data.error === 'STUDENT_NUMBER_TAKEN' ? '此學號已被使用' : `錯誤：${data.error}`
        );
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
    if (addingSessions[classId]) return;
    const targetStudentId = editing.id;
    const amount = Number(addAmount[classId]);
    if (!amount || amount <= 0) return;
    setAddingSessions((prev) => ({ ...prev, [classId]: true }));
    try {
      const res = await fetch(`/api/classes/${classId}/enrollments`, {
        method: 'PATCH',
        body: JSON.stringify({ studentId: targetStudentId, addSessions: amount }),
      });
      if (!res.ok) {
        const data = await res.json();
        setEditError(`錯誤：${data.error}`);
        return;
      }
      const updated = await res.json();
      setAddAmount((prev) => ({ ...prev, [classId]: '' }));
      showToast('已加堂');
      // Refresh the outer table (and, below, this class's usedSessions/remaining
      // display inside the modal — editing.enrollments only ever holds
      // already-saved server values, never unsaved admin input, so it's safe
      // to replace wholesale from a fresh fetch).
      const studentsRes = await fetch('/api/students');
      const updatedStudents: StudentRow[] = await studentsRes.json();
      setStudents(updatedStudents);
      // Only touch the modal state if it's still showing the same student we
      // just updated — the admin may have closed the modal or switched to a
      // different student's modal while the PATCH/refetch were in flight.
      if (editingRef.current?.id === targetStudentId) {
        const updatedEditing = updatedStudents.find((s) => s.id === targetStudentId);
        if (updatedEditing) {
          setEditing(updatedEditing);
        }
        // editEnrollments holds the admin's own in-progress input values for
        // every class currently checked in the modal (including edits to
        // OTHER classes, or a newly-checked-but-unsaved class, not yet saved).
        // Wholesale-replacing it from the server would silently discard those.
        // Merge in only this one class's freshly-saved total instead.
        setEditEnrollments((prev) => ({ ...prev, [classId]: String(updated.totalSessions) }));
      }
    } finally {
      setAddingSessions((prev) => ({ ...prev, [classId]: false }));
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
        <Card className="mb-6 max-w-xl">
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
            <Input placeholder="學號" value={form.studentNumber} onChange={(e) => setForm({ ...form, studentNumber: e.target.value })} />
            <div>
              <p className="mb-1 text-sm font-medium text-ink">所屬班級（可複選，可留空）</p>
              <Input
                placeholder="搜尋班級名稱或科目"
                value={formClassQuery}
                onChange={(e) => setFormClassQuery(e.target.value)}
                className="mb-2"
              />
              <div className="max-h-64 overflow-y-auto">
                <DataTable
                  columns={[
                    {
                      header: '',
                      render: (c) => (
                        <input type="checkbox" checked={c.id in formEnrollments} onChange={() => toggleFormClass(c.id)} />
                      ),
                    },
                    {
                      header: '班級',
                      render: (c) => (
                        <div className="text-left">
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-inkMuted">{c.subject}</div>
                        </div>
                      ),
                    },
                    {
                      header: '總堂數',
                      render: (c) =>
                        c.id in formEnrollments ? (
                          <Input
                            type="number"
                            placeholder="留空＝不計"
                            value={formEnrollments[c.id] ?? ''}
                            onChange={(e) => setFormEnrollments((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            className="w-24"
                          />
                        ) : (
                          <span className="text-inkMuted">—</span>
                        ),
                    },
                  ]}
                  rows={classes.filter((c) => {
                    const q = formClassQuery.trim().toLowerCase();
                    if (!q) return true;
                    return c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q);
                  })}
                  keyField={(c) => c.id}
                />
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

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯學生" maxWidthClassName="max-w-2xl">
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
          <Input
            placeholder="學號"
            value={editForm.studentNumber}
            onChange={(e) => setEditForm({ ...editForm, studentNumber: e.target.value })}
          />

          <div>
            <p className="mb-1 text-sm font-medium text-ink">已加入班級</p>
            {Object.keys(editEnrollments).length === 0 ? (
              <p className="rounded-lg border border-dashed border-borderStrong p-3 text-center text-sm text-inkMuted">
                尚未加入任何班級
              </p>
            ) : (
              <DataTable
                columns={[
                  {
                    header: '班級',
                    render: (c) => (
                      <div className="text-left">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-inkMuted">{c.subject}</div>
                      </div>
                    ),
                  },
                  {
                    header: '總堂數',
                    render: (c) => (
                      <Input
                        type="number"
                        placeholder="留空＝不計"
                        value={editEnrollments[c.id] ?? ''}
                        onChange={(e) => setEditEnrollments((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        className="w-24"
                      />
                    ),
                  },
                  {
                    header: '已上／剩餘',
                    render: (c) => {
                      const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                      if (!enrollment || enrollment.totalSessions === null) {
                        return <span className="text-xs text-inkMuted">未追蹤</span>;
                      }
                      return (
                        <span className="text-xs text-inkMuted">
                          已上 {enrollment.usedSessions}／剩餘 {enrollment.remaining}
                        </span>
                      );
                    },
                  },
                  {
                    header: '加堂',
                    render: (c) => {
                      const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                      if (!enrollment) {
                        return <span className="text-xs text-inkMuted">先儲存</span>;
                      }
                      return (
                        <div className="flex items-center justify-center gap-1">
                          <Input
                            type="number"
                            placeholder="+堂數"
                            value={addAmount[c.id] ?? ''}
                            onChange={(e) => setAddAmount((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            className="w-16"
                          />
                          <button
                            type="button"
                            className="text-xs text-brandDark hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                            disabled={addingSessions[c.id]}
                            onClick={() => handleAddSessions(c.id)}
                          >
                            {addingSessions[c.id] ? '處理中' : '加堂'}
                          </button>
                        </div>
                      );
                    },
                  },
                  {
                    header: '',
                    render: (c) => (
                      <button type="button" className="text-xs text-rejected hover:underline" onClick={() => toggleClass(c.id)}>
                        移除
                      </button>
                    ),
                  },
                ]}
                rows={classes.filter((c) => c.id in editEnrollments)}
                keyField={(c) => c.id}
              />
            )}
          </div>

          <div>
            <p className="mb-1 text-sm font-medium text-ink">加入新班級</p>
            <Input
              placeholder="搜尋班級名稱或科目加入…"
              value={addClassQuery}
              onChange={(e) => setAddClassQuery(e.target.value)}
            />
            {addClassQuery.trim() &&
              (() => {
                const q = addClassQuery.trim().toLowerCase();
                const matches = classes
                  .filter((c) => !(c.id in editEnrollments))
                  .filter((c) => c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q))
                  .slice(0, 8);
                if (matches.length === 0) {
                  return <p className="mt-2 text-sm text-inkMuted">找不到符合的班級</p>;
                }
                return (
                  <div className="mt-2 flex max-h-40 flex-col overflow-y-auto rounded-lg border border-borderStrong">
                    {matches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          toggleClass(c.id);
                          setAddClassQuery('');
                        }}
                        className="flex items-center justify-between border-b border-borderSubtle px-3 py-2 text-left text-sm last:border-b-0 hover:bg-stripe"
                      >
                        <span>
                          {c.name}（{c.subject}）
                        </span>
                        <span className="text-xs text-brandDark">加入</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
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

export default function StudentsPage() {
  return (
    <Suspense fallback={null}>
      <StudentsContent />
    </Suspense>
  );
}
