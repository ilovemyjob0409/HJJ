'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import EnrollmentManager from './EnrollmentManager';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

interface WindowRow {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  active: boolean;
  teacher: { user: { name: string } };
  closures: { id: string; date: string }[];
}

interface ProgramRow {
  id: string;
  name: string;
  defaultMonthlyQuota: number;
  defaultDurationMinutes: number;
  active: boolean;
  windows: WindowRow[];
}

interface TeacherOption {
  id: string;
  user: { name: string };
}

export default function AdminTutoringPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [newProgramName, setNewProgramName] = useState('');
  const [windowForm, setWindowForm] = useState<Record<string, { weekday: string; startTime: string; endTime: string; capacity: string; teacherId: string }>>({});
  const [closureDate, setClosureDate] = useState<Record<string, string>>({});

  async function load() {
    const [programsRes, teachersRes] = await Promise.all([fetch('/api/tutoring-programs'), fetch('/api/teachers')]);
    setPrograms(await programsRes.json());
    setTeachers(await teachersRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function createProgram() {
    if (!newProgramName.trim()) return;
    const res = await fetch('/api/tutoring-programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newProgramName.trim() }),
    });
    if (!res.ok) {
      showToast('新增失敗');
      return;
    }
    setNewProgramName('');
    showToast('已新增課程');
    load();
  }

  async function toggleProgramActive(program: ProgramRow) {
    const res = await fetch(`/api/tutoring-programs/${program.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !program.active }),
    });
    if (!res.ok) {
      showToast('更新失敗，請稍後再試');
      return;
    }
    load();
  }

  async function deleteProgram(program: ProgramRow) {
    if (!(await confirm(`確定要刪除「${program.name}」嗎？此動作無法復原。`, { danger: true }))) return;
    const res = await fetch(`/api/tutoring-programs/${program.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，可能仍有預約紀錄');
      return;
    }
    showToast('已刪除');
    load();
  }

  async function createWindow(programId: string) {
    const form = windowForm[programId];
    if (!form?.startTime || !form?.endTime || !form?.capacity || !form?.teacherId) {
      showToast('請填寫完整的窗口資訊');
      return;
    }
    const res = await fetch('/api/tutoring-windows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        programId,
        weekday: Number(form.weekday || 0),
        startTime: form.startTime,
        endTime: form.endTime,
        capacity: Number(form.capacity),
        teacherId: form.teacherId,
      }),
    });
    if (!res.ok) {
      showToast('新增窗口失敗');
      return;
    }
    setWindowForm((prev) => ({ ...prev, [programId]: { weekday: '0', startTime: '', endTime: '', capacity: '', teacherId: '' } }));
    showToast('已新增窗口');
    load();
  }

  async function toggleWindowActive(window: WindowRow) {
    const res = await fetch(`/api/tutoring-windows/${window.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !window.active }),
    });
    if (!res.ok) {
      showToast('更新失敗，請稍後再試');
      return;
    }
    load();
  }

  async function deleteWindow(window: WindowRow) {
    if (!(await confirm('確定要刪除這個窗口嗎？', { danger: true }))) return;
    const res = await fetch(`/api/tutoring-windows/${window.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，可能仍有預約紀錄');
      return;
    }
    showToast('已刪除');
    load();
  }

  async function addClosure(windowId: string) {
    const date = closureDate[windowId];
    if (!date) return;
    const res = await fetch('/api/tutoring-window-closures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowId, date }),
    });
    if (!res.ok) {
      showToast('新增停開日失敗');
      return;
    }
    setClosureDate((prev) => ({ ...prev, [windowId]: '' }));
    load();
  }

  async function removeClosure(closureId: string) {
    const res = await fetch(`/api/tutoring-window-closures/${closureId}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，請稍後再試');
      return;
    }
    load();
  }

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">個別輔導管理</h1>

      <Card className="mb-6">
        <p className="mb-2 font-semibold text-ink">新增課程</p>
        <div className="flex gap-2">
          <Input placeholder="課程名稱，例如：英文個別輔導" value={newProgramName} onChange={(e) => setNewProgramName(e.target.value)} className="flex-1" />
          <Button onClick={createProgram}>新增</Button>
        </div>
      </Card>

      {programs.map((program) => (
        <Card key={program.id} className="mb-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="font-semibold text-ink">{program.name}</p>
              <p className="text-xs text-inkMuted">
                每月預設 {program.defaultMonthlyQuota} 堂・單次預設 {program.defaultDurationMinutes} 分鐘
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => toggleProgramActive(program)}>
                {program.active ? '停用' : '啟用'}
              </Button>
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => deleteProgram(program)}>
                刪除
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {program.windows.map((window) => (
              <div key={window.id} className="rounded-lg border border-borderSubtle p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-ink">
                    週{WEEKDAY_LABELS[window.weekday]} {window.startTime}-{window.endTime}・容量 {window.capacity}・{window.teacher.user.name}
                    {!window.active && <span className="ml-2 text-xs text-inkMuted">（已停用）</span>}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => toggleWindowActive(window)}>
                      {window.active ? '停用' : '啟用'}
                    </Button>
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => deleteWindow(window)}>
                      刪除
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-inkMuted">停開日：</span>
                  {window.closures.map((c) => (
                    <span key={c.id} className="flex items-center gap-1 rounded-full bg-stripe px-2 py-0.5 text-xs text-inkMuted">
                      {c.date.slice(0, 10)}
                      <button onClick={() => removeClosure(c.id)} className="text-rejected">
                        ✕
                      </button>
                    </span>
                  ))}
                  <Input
                    type="date"
                    value={closureDate[window.id] ?? ''}
                    onChange={(e) => setClosureDate((prev) => ({ ...prev, [window.id]: e.target.value }))}
                    className="w-36 py-1 text-xs"
                  />
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => addClosure(window.id)}>
                    加入停開日
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-borderStrong p-3">
              <label className="text-xs text-inkMuted">
                星期
                <select
                  value={windowForm[program.id]?.weekday ?? '0'}
                  onChange={(e) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...prev[program.id], weekday: e.target.value } }))}
                  className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                >
                  {WEEKDAY_LABELS.map((label, i) => (
                    <option key={i} value={i}>
                      週{label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-inkMuted">
                開始
                <Input
                  type="time"
                  value={windowForm[program.id]?.startTime ?? ''}
                  onChange={(e) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...prev[program.id], startTime: e.target.value } }))}
                  className="mt-1 w-24 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-inkMuted">
                結束
                <Input
                  type="time"
                  value={windowForm[program.id]?.endTime ?? ''}
                  onChange={(e) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...prev[program.id], endTime: e.target.value } }))}
                  className="mt-1 w-24 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-inkMuted">
                容量
                <Input
                  type="number"
                  min={1}
                  value={windowForm[program.id]?.capacity ?? ''}
                  onChange={(e) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...prev[program.id], capacity: e.target.value } }))}
                  className="mt-1 w-20 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-inkMuted">
                老師
                <select
                  value={windowForm[program.id]?.teacherId ?? ''}
                  onChange={(e) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...prev[program.id], teacherId: e.target.value } }))}
                  className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                >
                  <option value="">請選擇</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.user.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button className="px-3 py-1 text-xs" onClick={() => createWindow(program.id)}>
                新增窗口
              </Button>
            </div>
          </div>
        </Card>
      ))}

      <EnrollmentManager />
      {ConfirmDialog}
    </>
  );
}
