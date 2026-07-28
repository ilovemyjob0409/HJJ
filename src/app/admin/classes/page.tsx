'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import TimetableModal from './TimetableModal';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface TeacherOption {
  id: string;
  user: { name: string };
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
  const { showToast } = useToast();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
  const [editError, setEditError] = useState('');
  const [showTimetable, setShowTimetable] = useState(false);
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
      setEditing(null);
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
    if (!confirm(`確定要刪除班級「${editing.name}」嗎？此操作無法復原。`)) return;
    setEditError('');
    const res = await fetch(`/api/classes/${editing.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setEditError(data.error === 'CLASS_HAS_RECORDS' ? '此班級仍有請假或代課紀錄，請先處理後再刪除' : `錯誤：${data.error}`);
      return;
    }
    setEditing(null);
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
    { header: '班名', render: (c) => c.name },
    { header: '科目/等級', render: (c) => `${c.subject} / ${c.level}` },
    { header: '老師', render: (c) => c.teacher.user.name },
    { header: '時間', render: (c) => `週${WEEKDAYS[c.weekday]} ${c.startTime}-${c.endTime}` },
    { header: '人數', render: (c) => c.enrollments.length },
    {
      header: '操作',
      render: (c) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(c)}>
          編輯
        </button>
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
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
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
              {WEEKDAYS.map((w, i) => (
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
          onRowClick={openEdit}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯班級">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-2">
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
            {WEEKDAYS.map((w, i) => (
              <option key={i} value={i}>
                週{w}
              </option>
            ))}
          </Select>
          <Input type="time" value={editForm.startTime} onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })} />
          <Input type="time" value={editForm.endTime} onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })} />
          {editError && <p className="text-sm text-rejected">{editError}</p>}
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除班級
        </button>

        {editing && (
          <div className="mt-4 border-t border-borderStrong pt-3">
            <p className="mb-2 text-sm font-medium text-ink">已加入學生（{editing.enrollments.length}）</p>
            {editing.enrollments.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生加入</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {editing.enrollments.map((en) => (
                  <li key={en.id} className="flex items-center justify-between text-sm text-ink">
                    <span>
                      {en.student.user.name}
                      {en.totalSessions !== null && (
                        <span className="ml-2 text-xs text-inkMuted">
                          （總堂數 {en.totalSessions}／已上 {en.usedSessions}／剩餘 {en.remaining}）
                        </span>
                      )}
                    </span>
                    <button type="button" className="text-rejected hover:underline" onClick={() => removeStudent(en.studentId)}>
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>

      <TimetableModal
        open={showTimetable}
        onClose={() => setShowTimetable(false)}
        classes={classes}
        onClassClick={(id) => {
          const c = classes.find((cls) => cls.id === id);
          if (!c) return;
          setShowTimetable(false);
          openEdit(c);
        }}
      />
    </>
  );
}
