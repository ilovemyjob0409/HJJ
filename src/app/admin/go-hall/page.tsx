'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { previewSessionDates } from '@/lib/goHallDates';
import { formatDateWithWeekday } from '@/lib/dateFormat';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function defaultMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface SessionRow {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  teacher: { user: { name: string } };
  _count: { registrations: number };
}

interface RosterEntry {
  id: string;
  student: { user: { name: string } };
}

interface SessionDetail extends SessionRow {
  registrations: RosterEntry[];
}

function AdminGoHallContent() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ weekday: '6', month: defaultMonth(), startTime: '14:00', endTime: '16:00', capacity: '8', teacherId: '' });
  const [previewDates, setPreviewDates] = useState<Date[] | null>(null);
  const [excludedDates, setExcludedDates] = useState<Set<number>>(new Set());
  const [viewing, setViewing] = useState<SessionDetail | null>(null);
  const [highlightDismissed, setHighlightDismissed] = useState(false);

  async function load() {
    const [sessionsRes, teachersRes] = await Promise.all([fetch('/api/go-hall-sessions'), fetch('/api/teachers')]);
    setSessions(await sessionsRes.json());
    setTeachers(await teachersRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setHighlightDismissed(false);
  }, [highlightId]);

  useEffect(() => {
    if (!highlightId || sessions.length === 0) return;
    document.getElementById(highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    openRoster(highlightId);
  }, [highlightId, sessions]);

  function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    if (!form.month) return;
    setPreviewDates(previewSessionDates(Number(form.weekday), form.month));
    setExcludedDates(new Set());
  }

  function toggleExcluded(index: number) {
    setExcludedDates((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function handleConfirmCreate() {
    if (!previewDates) return;
    const dates = previewDates.filter((_, i) => !excludedDates.has(i)).map((d) => d.toISOString());
    if (dates.length === 0) return;
    await fetch('/api/go-hall-sessions', {
      method: 'POST',
      body: JSON.stringify({ dates, startTime: form.startTime, endTime: form.endTime, capacity: Number(form.capacity), teacherId: form.teacherId }),
    });
    setPreviewDates(null);
    setShowAddForm(false);
    showToast('已建立場次');
    load();
  }

  async function openRoster(id: string) {
    const res = await fetch(`/api/go-hall-sessions/${id}`);
    setViewing(await res.json());
  }

  async function handleDeleteSession() {
    if (!viewing) return;
    const confirmMessage =
      viewing.registrations.length > 0
        ? `此場次已有 ${viewing.registrations.length} 人報名，刪除將一併取消他們的報名，確定嗎？`
        : '確定要刪除此場次嗎？';
    if (!confirm(confirmMessage)) return;
    await fetch(`/api/go-hall-sessions/${viewing.id}`, { method: 'DELETE' });
    setViewing(null);
    showToast('已刪除');
    load();
  }

  async function handleRemoveRegistration(registrationId: string) {
    await fetch(`/api/go-hall-registrations/${registrationId}`, { method: 'DELETE' });
    if (viewing) {
      const res = await fetch(`/api/go-hall-sessions/${viewing.id}`);
      setViewing(await res.json());
    }
    showToast('已移除');
    load();
  }

  const columns: Column<SessionRow>[] = [
    { header: '日期', render: (s) => formatDateWithWeekday(s.date, 'zh-TW') },
    { header: '時間', render: (s) => `${s.startTime}-${s.endTime}` },
    { header: '老師', render: (s) => s.teacher.user.name },
    { header: '人數', render: (s) => `${s._count.registrations}/${s.capacity}` },
    {
      header: '操作',
      render: (s) => (
        <button className="text-brandDark hover:underline" onClick={() => openRoster(s.id)}>
          查看名單
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">弈廳場次管理</h1>

      {!showAddForm ? (
        <Button className="mb-6" onClick={() => setShowAddForm(true)}>
          ＋ 開放弈廳場次
        </Button>
      ) : (
        <Card className="mb-6 max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">開放弈廳場次</h2>
            <button
              type="button"
              className="text-sm text-inkMuted hover:underline"
              onClick={() => {
                setShowAddForm(false);
                setPreviewDates(null);
              }}
            >
              收合
            </button>
          </div>
          {!previewDates ? (
            <form onSubmit={handlePreview} className="flex flex-col gap-2">
              <Select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
                {WEEKDAYS.map((w, i) => (
                  <option key={i} value={i}>
                    每週{w}
                  </option>
                ))}
              </Select>
              <div className="flex gap-2">
                <Select
                  className="flex-1"
                  value={form.month.split('-')[0]}
                  onChange={(e) => setForm({ ...form, month: `${e.target.value}-${form.month.split('-')[1]}` })}
                >
                  {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() + i).map((year) => (
                    <option key={year} value={year}>
                      {year}年
                    </option>
                  ))}
                </Select>
                <Select
                  className="flex-1"
                  value={form.month.split('-')[1]}
                  onChange={(e) => setForm({ ...form, month: `${form.month.split('-')[0]}-${e.target.value}` })}
                >
                  {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((monthNum) => (
                    <option key={monthNum} value={monthNum}>
                      {Number(monthNum)}月
                    </option>
                  ))}
                </Select>
              </div>
              <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
              <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
              <Input
                type="number"
                min="1"
                placeholder="人數上限"
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                required
              />
              <Select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} required>
                <option value="">選擇老師</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.user.name}
                  </option>
                ))}
              </Select>
              <Button type="submit">預覽日期</Button>
            </form>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-inkMuted">取消勾選要排除的日期：</p>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-gray-300 p-2">
                {previewDates.map((d, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={!excludedDates.has(i)} onChange={() => toggleExcluded(i)} />
                    {formatDateWithWeekday(d, 'zh-TW')}
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={handleConfirmCreate}>
                  確認建立
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPreviewDates(null)}>
                  上一步
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={sessions}
          keyField={(s) => s.id}
          onRowClick={(s) => openRoster(s.id)}
          rowClassName={(s) => (s.id === highlightId && !highlightDismissed ? 'bg-pendingBg' : 'cursor-pointer hover:bg-gray-50')}
          onRowMouseLeave={(s) => {
            if (s.id === highlightId) setHighlightDismissed(true);
          }}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="場次名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {formatDateWithWeekday(viewing.date, 'zh-TW')} {viewing.startTime}-{viewing.endTime} · {viewing.teacher.user.name} ·{' '}
              {viewing.registrations.length}/{viewing.capacity}
            </p>
            {viewing.registrations.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生報名</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {viewing.registrations.map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-sm text-ink">
                    {r.student.user.name}
                    <button type="button" className="text-rejected hover:underline" onClick={() => handleRemoveRegistration(r.id)}>
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="mt-2 text-left text-sm text-rejected hover:underline" onClick={handleDeleteSession}>
              刪除此場次
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}

export default function AdminGoHallPage() {
  return (
    <Suspense fallback={null}>
      <AdminGoHallContent />
    </Suspense>
  );
}
