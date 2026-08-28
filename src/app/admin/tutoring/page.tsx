'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import WeekdayAlertModal, { WeekdayAlertInfo } from '@/components/WeekdayAlertModal';
import { withStopPropagation } from '@/components/ui/stopPropagation';
import EnrollmentManager from './EnrollmentManager';
import TutoringPolicyModal from '@/components/tutoring/TutoringPolicyModal';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

interface WindowFormValues {
  weekday: string;
  startTime: string;
  endTime: string;
  capacity: string;
  teacherId: string;
  teacherId2: string; // ''＝不設第二老師
}

interface WindowRow {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  active: boolean;
  teacherId: string;
  teacher: { user: { name: string } };
  teacherId2: string | null;
  teacher2: { user: { name: string } } | null;
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

const DEFAULT_WINDOW_FORM: WindowFormValues = { weekday: '0', startTime: '', endTime: '', capacity: '', teacherId: '', teacherId2: '' };

function KebabIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

function WindowFieldInputs({
  values,
  onChange,
  teachers,
}: {
  values: WindowFormValues;
  onChange: (patch: Partial<WindowFormValues>) => void;
  teachers: TeacherOption[];
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-inkMuted">
        星期
        <Select value={values.weekday} onChange={(e) => onChange({ weekday: e.target.value })} className="text-sm">
          {WEEKDAY_LABELS.map((label, i) => (
            <option key={i} value={i}>
              週{label}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-inkMuted">
        開始
        <Input type="time" value={values.startTime} onChange={(e) => onChange({ startTime: e.target.value })} className="w-24 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-inkMuted">
        結束
        <Input type="time" value={values.endTime} onChange={(e) => onChange({ endTime: e.target.value })} className="w-24 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-inkMuted">
        容量
        <Input
          type="number"
          min={1}
          value={values.capacity}
          onChange={(e) => onChange({ capacity: e.target.value })}
          className="w-20 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-inkMuted">
        老師
        <Select
          value={values.teacherId}
          onChange={(e) => onChange({ teacherId: e.target.value, ...(e.target.value === values.teacherId2 ? { teacherId2: '' } : {}) })}
          className={`text-sm ${values.teacherId ? '' : 'text-inkMuted'}`}
        >
          <option value="">請選擇</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.user.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-inkMuted">
        第二老師（選填）
        <Select
          value={values.teacherId2}
          onChange={(e) => onChange({ teacherId2: e.target.value })}
          className={`text-sm ${values.teacherId2 ? '' : 'text-inkMuted'}`}
        >
          <option value="">無</option>
          {teachers
            .filter((t) => t.id !== values.teacherId)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.user.name}
              </option>
            ))}
        </Select>
      </label>
    </>
  );
}

export default function AdminTutoringPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [newProgramName, setNewProgramName] = useState('');
  const [windowForm, setWindowForm] = useState<Record<string, WindowFormValues>>({});
  const [closureDate, setClosureDate] = useState<Record<string, string>>({});
  const [weekdayAlert, setWeekdayAlert] = useState<WeekdayAlertInfo | null>(null);
  const [editingWindowId, setEditingWindowId] = useState<string | null>(null);
  const [windowEditForm, setWindowEditForm] = useState<Record<string, WindowFormValues>>({});
  const [openKebabId, setOpenKebabId] = useState<string | null>(null);
  const [openClosuresId, setOpenClosuresId] = useState<Record<string, boolean>>({});

  async function load() {
    const [programsRes, teachersRes] = await Promise.all([fetch('/api/tutoring-programs'), fetch('/api/teachers')]);
    setPrograms(await programsRes.json());
    setTeachers(await teachersRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    // React 18's delegated click handler and this listener both sit on `document`,
    // so calling stopPropagation() in the toggle button's onClick does not stop this
    // listener from also firing on the same click — it only blocks propagation to
    // nodes further up the tree, not other listeners on the same node. Filtering by
    // the click target instead of relying on stopPropagation sidesteps that.
    function closeKebab(e: MouseEvent) {
      if ((e.target as HTMLElement).closest('[data-kebab-root]')) return;
      setOpenKebabId(null);
    }
    document.addEventListener('click', closeKebab);
    return () => document.removeEventListener('click', closeKebab);
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
        teacherId2: form.teacherId2 || null,
      }),
    });
    if (!res.ok) {
      showToast('新增窗口失敗');
      return;
    }
    setWindowForm((prev) => ({ ...prev, [programId]: { ...DEFAULT_WINDOW_FORM } }));
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

  function startEditWindow(window: WindowRow) {
    setWindowEditForm((prev) => ({
      ...prev,
      [window.id]: {
        weekday: String(window.weekday),
        startTime: window.startTime,
        endTime: window.endTime,
        capacity: String(window.capacity),
        teacherId: window.teacherId,
        teacherId2: window.teacherId2 ?? '',
      },
    }));
    setEditingWindowId(window.id);
  }

  function cancelEditWindow() {
    setEditingWindowId(null);
  }

  async function saveEditWindow(windowId: string) {
    const form = windowEditForm[windowId];
    if (!form?.startTime || !form?.endTime || !form?.capacity || !form?.teacherId) {
      showToast('請填寫完整的窗口資訊');
      return;
    }
    const res = await fetch(`/api/tutoring-windows/${windowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weekday: Number(form.weekday),
        startTime: form.startTime,
        endTime: form.endTime,
        capacity: Number(form.capacity),
        teacherId: form.teacherId,
        teacherId2: form.teacherId2 || null,
      }),
    });
    if (!res.ok) {
      showToast('更新窗口失敗');
      return;
    }
    setEditingWindowId(null);
    showToast('已更新窗口');
    load();
  }

  async function addClosure(window: WindowRow) {
    const date = closureDate[window.id];
    if (!date) return;
    const closureAlert: WeekdayAlertInfo = { title: '停開日選錯了', name: '這個時段', weekday: window.weekday, noun: '停開日', verb: '開課' };
    if (new Date(date).getUTCDay() !== window.weekday) {
      setWeekdayAlert(closureAlert);
      return;
    }
    const res = await fetch('/api/tutoring-window-closures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowId: window.id, date }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.error === 'INVALID_WEEKDAY') setWeekdayAlert(closureAlert);
      else showToast('新增停開日失敗');
      return;
    }
    setClosureDate((prev) => ({ ...prev, [window.id]: '' }));
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/tutoring/bookings" className="text-sm font-semibold text-brand hover:underline">
          查看每日預約總覽 →
        </Link>
        <TutoringPolicyModal />
      </div>

      <details className="group mb-6">
        <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brandInk transition-colors hover:bg-brandDark [&::-webkit-details-marker]:hidden">
          <span className="inline-block transition-transform group-open:rotate-45">＋</span>
          新增課程
        </summary>
        <Card className="mt-3">
          <div className="flex gap-2">
            <Input placeholder="課程名稱，例如：英文個別輔導" value={newProgramName} onChange={(e) => setNewProgramName(e.target.value)} className="flex-1" />
            <Button onClick={createProgram}>新增</Button>
          </div>
        </Card>
      </details>

      {programs.map((program) => (
        <Card key={program.id} className="mb-4">
          <details className="group/program">
            <summary className="mb-3 flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <div className="flex items-center gap-2">
                <span className="text-inkMuted transition-transform group-open/program:rotate-180">▾</span>
                <p className="font-semibold text-ink">{program.name}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="px-3 py-1 text-xs"
                  onClick={withStopPropagation(() => toggleProgramActive(program))}
                >
                  {program.active ? '停用' : '啟用'}
                </Button>
                <Button variant="secondary" className="px-3 py-1 text-xs" onClick={withStopPropagation(() => deleteProgram(program))}>
                  刪除
                </Button>
              </div>
            </summary>

            <div className="flex flex-col gap-2">
              {program.windows.map((window) =>
                editingWindowId === window.id ? (
                  <div key={window.id} className="flex flex-wrap items-end gap-2 rounded-lg border border-borderStrong p-3">
                    <WindowFieldInputs
                      values={windowEditForm[window.id] ?? DEFAULT_WINDOW_FORM}
                      onChange={(patch) =>
                        setWindowEditForm((prev) => ({ ...prev, [window.id]: { ...(prev[window.id] ?? DEFAULT_WINDOW_FORM), ...patch } }))
                      }
                      teachers={teachers}
                    />
                    <Button className="px-3 py-1 text-xs" onClick={() => saveEditWindow(window.id)}>
                      儲存
                    </Button>
                    <Button variant="secondary" className="px-3 py-1 text-xs" onClick={cancelEditWindow}>
                      取消
                    </Button>
                  </div>
                ) : (
                  <div key={window.id} className="rounded-lg border border-borderSubtle p-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 min-w-[3rem] shrink-0 items-center justify-center rounded-lg bg-brand/15 px-2 text-sm font-bold text-brandDark">
                        週{WEEKDAY_LABELS[window.weekday]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-ink">
                          {window.startTime}–{window.endTime}
                          {!window.active && <span className="ml-2 text-xs font-normal text-inkMuted">（已停用）</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-inkMuted">
                          容量 {window.capacity}・{[window.teacher.user.name, window.teacher2?.user.name].filter(Boolean).join('／')}
                        </p>
                      </div>
                      <div className="relative flex shrink-0 items-center gap-2" data-kebab-root>
                        <Link
                          href={`/admin/tutoring/windows/${window.id}/attendance`}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-borderStrong bg-card px-2 py-1 text-xs font-semibold text-ink transition-colors hover:bg-stripe"
                        >
                          查看出缺勤
                        </Link>
                        <button
                          type="button"
                          aria-label="更多操作"
                          onClick={() => setOpenKebabId((prev) => (prev === window.id ? null : window.id))}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-inkMuted hover:bg-stripe"
                        >
                          <KebabIcon className="h-4 w-4" />
                        </button>
                        {openKebabId === window.id && (
                          <div className="absolute right-0 top-9 z-20 min-w-[8rem] rounded-lg border border-borderStrong bg-card p-1 shadow-lg">
                            <button
                              type="button"
                              onClick={() => {
                                startEditWindow(window);
                                setOpenKebabId(null);
                              }}
                              className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-ink hover:bg-stripe"
                            >
                              編輯
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                toggleWindowActive(window);
                                setOpenKebabId(null);
                              }}
                              className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-ink hover:bg-stripe"
                            >
                              {window.active ? '停用' : '啟用'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                deleteWindow(window);
                                setOpenKebabId(null);
                              }}
                              className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-rejected hover:bg-stripe"
                            >
                              刪除
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenClosuresId((prev) => ({ ...prev, [window.id]: !prev[window.id] }))}
                      className="mt-2 flex w-full items-center gap-1 border-t border-borderSubtle pt-2 text-left text-xs font-semibold text-inkMuted hover:text-ink"
                    >
                      停開日
                      {window.closures.length > 0 && <span className="font-normal">・{window.closures.length}</span>}
                      <span className={`ml-auto transition-transform ${openClosuresId[window.id] ? 'rotate-180' : ''}`}>▾</span>
                    </button>
                    {openClosuresId[window.id] && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-stripe p-2">
                        {window.closures.map((c) => (
                          <span key={c.id} className="flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs text-inkMuted">
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
                        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => addClosure(window)}>
                          加入停開日
                        </Button>
                      </div>
                    )}
                  </div>
                )
              )}

              <details className="group/addwin">
                <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg border border-borderStrong bg-card px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-stripe [&::-webkit-details-marker]:hidden">
                  <span className="inline-block transition-transform group-open/addwin:rotate-45">＋</span>
                  新增窗口
                </summary>
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-borderStrong p-3">
                  <WindowFieldInputs
                    values={windowForm[program.id] ?? DEFAULT_WINDOW_FORM}
                    onChange={(patch) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...(prev[program.id] ?? DEFAULT_WINDOW_FORM), ...patch } }))}
                    teachers={teachers}
                  />
                  <Button className="px-3 py-1 text-xs" onClick={() => createWindow(program.id)}>
                    新增
                  </Button>
                </div>
              </details>
            </div>
          </details>
        </Card>
      ))}

      <EnrollmentManager />
      <WeekdayAlertModal info={weekdayAlert} onClose={() => setWeekdayAlert(null)} />
      {ConfirmDialog}
    </>
  );
}
