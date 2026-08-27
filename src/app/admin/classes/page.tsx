'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
import TimetableModal from './TimetableModal';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface TutoringWindowInfo {
  id: string;
  programName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  teacherNames: string[];
  upcomingBookedCount: number;
}

interface EnrollmentRow {
  id: string;
  studentId: string;
  student: { user: { name: string } };
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
}

interface ClassRow {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { id: string; user: { name: string } };
  enrollments: EnrollmentRow[];
}

export default function ClassesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
  const [showEditFields, setShowEditFields] = useState(false);
  const [editError, setEditError] = useState('');
  const [showTimetable, setShowTimetable] = useState(false);
  // 從週課表的資訊小卡按「前往編輯」時記下來源，關閉編輯彈窗後自動回到週課表
  const [returnToTimetable, setReturnToTimetable] = useState(false);
  // 週課表上點課堂卡／個別輔導卡疊出的資訊小卡（週課表保持開啟）
  const [infoClass, setInfoClass] = useState<ClassRow | null>(null);
  const [infoWindow, setInfoWindow] = useState<TutoringWindowInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [classesRes, teachersRes] = await Promise.all([fetch('/api/classes'), fetch('/api/teachers')]);
      setClasses(await classesRes.json());
      setTeachers(await teachersRes.json());
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
      await fetch('/api/classes', {
        method: 'POST',
        body: JSON.stringify({ ...form, weekday: Number(form.weekday) }),
      });
      setForm({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
      setShowAddForm(false);
      showToast('已新增');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function closeEdit() {
    setEditing(null);
    if (returnToTimetable) {
      setShowTimetable(true);
      setReturnToTimetable(false);
    }
  }

  function openEdit(c: ClassRow) {
    setEditing(c);
    setEditForm({
      name: c.name,
      subject: c.subject,
      level: c.level,
      teacherId: c.teacher.id,
      weekday: String(c.weekday),
      startTime: c.startTime,
      endTime: c.endTime,
    });
    setShowEditFields(false);
    setEditError('');
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      setEditError('');
      const res = await fetch(`/api/classes/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...editForm, weekday: Number(editForm.weekday) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setEditError(`錯誤：${data.error}`);
        return;
      }
      closeEdit();
      showToast('已儲存');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function removeStudent(studentId: string) {
    if (!editing) return;
    setEditError('');
    const delRes = await fetch(`/api/classes/${editing.id}/enrollments`, { method: 'DELETE', body: JSON.stringify({ studentId }) });
    if (!delRes.ok) {
      const data = await delRes.json();
      setEditError(`錯誤：${data.error}`);
      return;
    }
    const res = await fetch('/api/classes');
    const updatedClasses: ClassRow[] = await res.json();
    setClasses(updatedClasses);
    const updatedEditing = updatedClasses.find((c) => c.id === editing.id);
    if (updatedEditing) setEditing(updatedEditing);
    showToast('已移除');
  }

  async function handleDelete() {
    if (!editing) return;
    if (!(await confirm(`確定要刪除班級「${editing.name}」嗎？此操作無法復原。`, { danger: true }))) return;
    setEditError('');
    const res = await fetch(`/api/classes/${editing.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setEditError(`錯誤：${data.error}`);
      return;
    }
    closeEdit();
    showToast('已刪除');
    load();
  }

  const filteredClasses = classes.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.subject.toLowerCase().includes(q) ||
      c.level.toLowerCase().includes(q) ||
      c.teacher.user.name.toLowerCase().includes(q)
    );
  });

  const columns: Column<ClassRow>[] = [
    { header: '班名', render: (c) => c.name, sortValue: (c) => c.name },
    { header: '科目/等級', render: (c) => `${c.subject} / ${c.level}` },
    { header: '老師', render: (c) => c.teacher.user.name, sortValue: (c) => c.teacher.user.name },
    { header: '時間', render: (c) => `週${WEEKDAY_LABELS[c.weekday]} ${c.startTime}-${c.endTime}` },
    { header: '人數', render: (c) => c.enrollments.length, sortValue: (c) => c.enrollments.length },
    {
      header: '操作',
      render: (c) => (
        <Button variant="link" onClick={() => openEdit(c)}>
          編輯
        </Button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">班級名單</h1>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="搜尋班名、科目、等級或老師"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        {!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增班級</Button>}
        <Button variant="secondary" className="ml-auto" onClick={() => setShowTimetable(true)}>
          週課表
        </Button>
      </div>
      {showAddForm && (
        <Card className="mb-6 max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增班級</h2>
            <Button variant="link" tone="muted" className="text-sm" onClick={() => setShowAddForm(false)}>
              收合
            </Button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input placeholder="班名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input placeholder="科目" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
            <Input placeholder="等級" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} required />
            <Select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} required>
              <option value="">選擇老師</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.user.name}
                </option>
              ))}
            </Select>
            <Select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
              {WEEKDAY_LABELS.map((w, i) => (
                <option key={i} value={i}>
                  週{w}
                </option>
              ))}
            </Select>
            <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
            <Button type="submit" loading={submitting}>新增</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={filteredClasses}
          keyField={(c) => c.id}
          loading={loading}
          emptyText="目前沒有班級"
          onRowClick={openEdit}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={editing !== null} onClose={closeEdit} title="編輯班級">
        <div className="flex items-center justify-between gap-2">
          {editing && !showEditFields && (
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{editing.name}</p>
              <p className="truncate text-xs text-inkMuted">
                {editing.subject} / {editing.level} · {editing.teacher.user.name} · 週{WEEKDAY_LABELS[editing.weekday]} {editing.startTime}-
                {editing.endTime}
              </p>
            </div>
          )}
          <Button
            variant="link"
            className="ml-auto shrink-0 text-sm"
            onClick={() => setShowEditFields((v) => !v)}
          >
            {showEditFields ? '收合' : '編輯班級資料'}
          </Button>
        </div>
        {editing && (
          <Link href={`/admin/classes/${editing.id}/attendance`} className="mt-3 block text-sm text-brandDark hover:underline">
            查看出缺勤 →
          </Link>
        )}
        {showEditFields && (
          <form onSubmit={handleEditSubmit} className="mt-3 flex flex-col gap-2">
            <Input placeholder="班名" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
            <Input placeholder="科目" value={editForm.subject} onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })} required />
            <Input placeholder="等級" value={editForm.level} onChange={(e) => setEditForm({ ...editForm, level: e.target.value })} required />
            <Select value={editForm.teacherId} onChange={(e) => setEditForm({ ...editForm, teacherId: e.target.value })} required>
              <option value="">選擇老師</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.user.name}
                </option>
              ))}
            </Select>
            <Select value={editForm.weekday} onChange={(e) => setEditForm({ ...editForm, weekday: e.target.value })}>
              {WEEKDAY_LABELS.map((w, i) => (
                <option key={i} value={i}>
                  週{w}
                </option>
              ))}
            </Select>
            <Input type="time" value={editForm.startTime} onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })} />
            <Input type="time" value={editForm.endTime} onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })} />
            <Button type="submit" loading={submitting}>儲存</Button>
          </form>
        )}
        {editError && <p className="mt-3 text-sm text-rejected">{editError}</p>}
        <Button variant="link" tone="danger" className="mt-3 text-sm" onClick={handleDelete}>
          刪除班級
        </Button>

        {editing && (
          <div className="mt-4 border-t border-borderStrong pt-3">
            <p className="mb-2 text-sm font-medium text-ink">已加入學生（{editing.enrollments.length}）</p>
            {editing.enrollments.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生加入</p>
            ) : (
              <DataTable
                columns={[
                  {
                    header: '學生',
                    render: (en: EnrollmentRow) => en.student.user.name,
                    sortValue: (en: EnrollmentRow) => en.student.user.name,
                  },
                  {
                    header: '堂數',
                    render: (en: EnrollmentRow) =>
                      en.totalSessions !== null ? (
                        <span className="text-xs text-inkMuted">
                          總堂數 {en.totalSessions}／已上 {en.usedSessions}／剩餘 {en.remaining}
                        </span>
                      ) : (
                        <span className="text-xs text-inkMuted">未追蹤</span>
                      ),
                  },
                  {
                    header: '',
                    render: (en: EnrollmentRow) => (
                      <Button
                        variant="link"
                        tone="danger"
                        className="text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeStudent(en.studentId);
                        }}
                      >
                        移除
                      </Button>
                    ),
                  },
                ]}
                rows={editing.enrollments}
                keyField={(en) => en.id}
                onRowClick={(en) => router.push(`/admin/students?studentId=${en.studentId}`)}
                rowClassName={() => 'cursor-pointer hover:bg-stripe'}
              />
            )}
          </div>
        )}
      </Modal>

      <TimetableModal
        open={showTimetable}
        onClose={() => setShowTimetable(false)}
        onClassClick={(id) => {
          const c = classes.find((cls) => cls.id === id);
          if (!c) return;
          setInfoClass(c);
        }}
        onTutoringClick={async (id) => {
          const res = await fetch(`/api/tutoring-windows/${id}`);
          if (res.ok) setInfoWindow(await res.json());
        }}
      />

      <Modal open={infoClass !== null} onClose={() => setInfoClass(null)} title={infoClass?.name ?? ''}>
        {infoClass && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {infoClass.subject}・{infoClass.level}｜週{WEEKDAY_LABELS[infoClass.weekday]} {infoClass.startTime}-{infoClass.endTime}｜
              {infoClass.teacher.user.name}
            </p>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-ink">學生名單（{infoClass.enrollments.length} 人）</p>
              {infoClass.enrollments.length === 0 ? (
                <p className="text-sm text-inkMuted">目前沒有學生</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {infoClass.enrollments.map((e) => (
                    <span key={e.id} className="rounded-full border border-borderSubtle bg-stripe px-3 py-1 text-xs text-ink">
                      {e.student.user.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  const c = infoClass;
                  setInfoClass(null);
                  setShowTimetable(false);
                  setReturnToTimetable(true);
                  openEdit(c);
                }}
              >
                前往編輯
              </Button>
              <Button onClick={() => setInfoClass(null)}>關閉</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={infoWindow !== null} onClose={() => setInfoWindow(null)} title={infoWindow?.programName ?? ''}>
        {infoWindow && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              週{WEEKDAY_LABELS[infoWindow.weekday]} {infoWindow.startTime}-{infoWindow.endTime}｜{infoWindow.teacherNames.join('／')}
            </p>
            <p className="text-sm text-ink">
              每天名額 {infoWindow.capacity} 人・未來已預約 {infoWindow.upcomingBookedCount} 人次
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => router.push('/admin/tutoring/bookings')}>
                前往預約總覽
              </Button>
              <Button onClick={() => setInfoWindow(null)}>關閉</Button>
            </div>
          </div>
        )}
      </Modal>
      {ConfirmDialog}
    </>
  );
}
