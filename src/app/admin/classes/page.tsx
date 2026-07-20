'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface EnrollmentRow {
  id: string;
  studentId: string;
  student: { user: { name: string } };
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
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [form, setForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });

  async function load() {
    const [classesRes, teachersRes] = await Promise.all([fetch('/api/classes'), fetch('/api/teachers')]);
    setClasses(await classesRes.json());
    setTeachers(await teachersRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/classes', {
      method: 'POST',
      body: JSON.stringify({ ...form, weekday: Number(form.weekday) }),
    });
    setForm({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
    load();
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
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    await fetch(`/api/classes/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...editForm, weekday: Number(editForm.weekday) }),
    });
    setEditing(null);
    load();
  }

  async function removeStudent(studentId: string) {
    if (!editing) return;
    await fetch(`/api/classes/${editing.id}/enrollments`, { method: 'DELETE', body: JSON.stringify({ studentId }) });
    const res = await fetch('/api/classes');
    const updatedClasses: ClassRow[] = await res.json();
    setClasses(updatedClasses);
    const updatedEditing = updatedClasses.find((c) => c.id === editing.id);
    if (updatedEditing) setEditing(updatedEditing);
  }

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
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">班級名單</h1>
      <Card className="mb-6">
        <DataTable columns={columns} rows={classes} keyField={(c) => c.id} />
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 font-bold text-ink">新增班級</h2>
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
          <Button type="submit">新增</Button>
        </form>
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
          <Button type="submit">儲存</Button>
        </form>

        {editing && (
          <div className="mt-4 border-t border-gray-200 pt-3">
            <p className="mb-2 text-sm font-medium text-ink">已加入學生（{editing.enrollments.length}）</p>
            {editing.enrollments.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生加入</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {editing.enrollments.map((en) => (
                  <li key={en.id} className="flex items-center justify-between text-sm text-ink">
                    {en.student.user.name}
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
    </AppShell>
  );
}
