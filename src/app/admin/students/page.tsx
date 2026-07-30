'use client';

import { ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import Link from 'next/link';
import QRCode from 'qrcode';

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
  lineUserId: string | null;
  user: { name: string; email: string };
  enrollments: EnrollmentQuota[];
}

interface ClassOption {
  id: string;
  name: string;
  subject: string;
}

function LowQuotaIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline h-3.5 w-3.5 shrink-0"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function HintButton({
  label,
  active,
  onToggle,
  children,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative flex shrink-0 items-center">
      <button
        type="button"
        aria-label={label}
        onClick={onToggle}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-borderStrong text-xs text-inkMuted hover:bg-stripe"
      >
        ?
      </button>
      {active && (
        <div className="animate-fade-in absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-borderStrong bg-card p-3 text-left text-xs text-inkMuted shadow-md">
          {children}
        </div>
      )}
    </div>
  );
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
  const [openHintClassId, setOpenHintClassId] = useState<string | null>(null);
  const [editError, setEditError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [lineBindInfo, setLineBindInfo] = useState<{ code: string; addFriendUrl: string } | null>(null);
  const [lineBinding, setLineBinding] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const editingIdRef = useRef<string | null>(null);

  useEffect(() => {
    editingIdRef.current = editing?.id ?? null;
  }, [editing]);

  useEffect(() => {
    if (lineBindInfo && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, lineBindInfo.addFriendUrl, { width: 200 });
    }
  }, [lineBindInfo]);

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
    setAddClassQuery('');
    setEditError('');
    setLineBindInfo(null);
    setLineBinding(false);
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

  async function refreshEditingFromServer() {
    if (!editing) return;
    const targetId = editing.id;
    const res = await fetch('/api/students');
    const fresh: StudentRow[] = await res.json();
    if (editingIdRef.current !== targetId) return;
    setStudents(fresh);
    const match = fresh.find((s) => s.id === targetId);
    if (match) setEditing(match);
  }

  async function handleGenerateLineBindCode() {
    if (!editing) return;
    const targetId = editing.id;
    setLineBinding(true);
    try {
      const res = await fetch(`/api/students/${targetId}/line-bind-code`, { method: 'POST' });
      if (!res.ok) {
        if (editingIdRef.current === targetId) showToast('產生綁定碼失敗');
        return;
      }
      const data = await res.json();
      if (editingIdRef.current !== targetId) return;
      setLineBindInfo(data);
    } finally {
      if (editingIdRef.current === targetId) setLineBinding(false);
    }
  }

  async function handleLineUnbind() {
    if (!editing) return;
    if (!confirm('確定要解除這位學生的 LINE 綁定嗎？')) return;
    const res = await fetch(`/api/students/${editing.id}/line-unbind`, { method: 'POST' });
    if (!res.ok) {
      showToast('解除綁定失敗');
      return;
    }
    showToast('已解除綁定');
    await refreshEditingFromServer();
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
    { header: '學號', render: (s) => s.studentNumber ?? '-' },
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
                      <div className="flex items-center justify-center gap-1">
                        <Input
                          type="number"
                          value={editEnrollments[c.id] ?? ''}
                          onChange={(e) => setEditEnrollments((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          className="w-24"
                        />
                        <HintButton
                          label="總堂數說明"
                          active={openHintClassId === c.id}
                          onToggle={() => setOpenHintClassId((prev) => (prev === c.id ? null : c.id))}
                        >
                          留空表示不追蹤堂數——「已上／剩餘」會顯示「未追蹤」，點名也不會扣堂。填數字才會開始計算已上與剩餘堂數。
                        </HintButton>
                      </div>
                    ),
                  },
                  {
                    header: '已上／剩餘',
                    render: (c) => {
                      const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                      if (!enrollment || enrollment.totalSessions === null) {
                        return <span className="text-xs text-inkMuted">未追蹤</span>;
                      }
                      const low = enrollment.remaining !== null && enrollment.remaining <= 3;
                      return (
                        <span className={`flex items-center justify-center gap-1 text-xs ${low ? 'font-semibold text-pending' : 'text-inkMuted'}`}>
                          {low && <LowQuotaIcon />}
                          已上 {enrollment.usedSessions}／剩餘 {enrollment.remaining}
                        </span>
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

          <div>
            <p className="mb-1 text-sm font-medium text-ink">LINE 通知</p>
            <div className="rounded-lg border border-borderStrong p-3">
              {editing?.lineUserId ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-approved">已綁定</span>
                  <button type="button" className="text-xs text-rejected hover:underline" onClick={handleLineUnbind}>
                    解除綁定
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-inkMuted">未綁定</span>
                    <div className="flex items-center gap-3">
                      <button type="button" className="text-xs text-brandDark hover:underline" onClick={refreshEditingFromServer}>
                        重新查詢狀態
                      </button>
                      <Button type="button" variant="secondary" loading={lineBinding} onClick={handleGenerateLineBindCode}>
                        產生綁定 QR code
                      </Button>
                    </div>
                  </div>
                  {lineBindInfo && (
                    <div className="flex flex-col items-center gap-2 rounded-lg bg-background p-3">
                      <canvas ref={qrCanvasRef} />
                      <p className="text-xs text-inkMuted">綁定碼：{lineBindInfo.code}</p>
                    </div>
                  )}
                </div>
              )}
              <Link
                href="/admin/line-setup"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs text-brandDark hover:underline"
              >
                查看設定教學
              </Link>
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

export default function StudentsPage() {
  return (
    <Suspense fallback={null}>
      <StudentsContent />
    </Suspense>
  );
}
