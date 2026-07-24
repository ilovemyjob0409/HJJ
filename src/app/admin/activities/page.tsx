'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_LABELS, ActivityCategoryValue } from '@/lib/activityCategory';

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface RosterEntry {
  id: string;
  studentId: string;
  student: { user: { name: string } };
}

interface ActivityRow {
  id: string;
  title: string;
  description: string;
  category: ActivityCategoryValue;
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teacher: { user: { name: string } } | null;
  registrations: RosterEntry[];
  _count: { registrations: number };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function AdminActivitiesPage() {
  const { showToast } = useToast();
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: ACTIVITY_CATEGORIES[0] as ActivityCategoryValue,
    location: '',
    startDate: '',
    endDate: '',
    capacity: '20',
    teacherId: '',
  });
  const [viewing, setViewing] = useState<ActivityRow | null>(null);

  async function load() {
    const [activitiesRes, teachersRes] = await Promise.all([fetch('/api/activities'), fetch('/api/teachers')]);
    setActivities(await activitiesRes.json());
    setTeachers(await teachersRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/activities', {
      method: 'POST',
      body: JSON.stringify({ ...form, capacity: Number(form.capacity), teacherId: form.teacherId || undefined }),
    });
    setForm({ title: '', description: '', category: ACTIVITY_CATEGORIES[0], location: '', startDate: '', endDate: '', capacity: '20', teacherId: '' });
    setShowAddForm(false);
    showToast('已新增活動');
    load();
  }

  async function handleDeleteActivity() {
    if (!viewing) return;
    const confirmMessage =
      viewing.registrations.length > 0
        ? `已有 ${viewing.registrations.length} 人報名，刪除將一併取消他們的報名，確定嗎？`
        : '確定要刪除此活動嗎？';
    if (!confirm(confirmMessage)) return;
    await fetch(`/api/activities/${viewing.id}`, { method: 'DELETE' });
    setViewing(null);
    showToast('已刪除');
    load();
  }

  async function handleRemoveRegistration(registrationId: string) {
    await fetch(`/api/activity-registrations/${registrationId}`, { method: 'DELETE' });
    showToast('已移除');
    const res = await fetch('/api/activities');
    const updated: ActivityRow[] = await res.json();
    setActivities(updated);
    setViewing((prev) => (prev ? (updated.find((a) => a.id === prev.id) ?? null) : null));
  }

  const columns: Column<ActivityRow>[] = [
    { header: '標題', render: (a) => a.title },
    { header: '分類', render: (a) => ACTIVITY_CATEGORY_LABELS[a.category] },
    { header: '日期區間', render: (a) => formatActivityDateRange(a.startDate, a.endDate, 'zh-TW') },
    { header: '老師', render: (a) => a.teacher?.user.name ?? '-' },
    { header: '人數', render: (a) => `${a._count.registrations}/${a.capacity}` },
    { header: '狀態', render: (a) => (new Date(a.endDate) < startOfToday() ? '已結束' : '進行中') },
    {
      header: '操作',
      render: (a) => (
        <button className="text-brandDark hover:underline" onClick={() => setViewing(a)}>
          查看名單
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">活動專區管理</h1>

      {!showAddForm ? (
        <Button className="mb-6" onClick={() => setShowAddForm(true)}>
          ＋ 新增活動
        </Button>
      ) : (
        <Card className="mb-6 max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增活動</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input placeholder="標題" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <textarea
              placeholder="描述"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25"
              rows={3}
              required
            />
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ActivityCategoryValue })}>
              {ACTIVITY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {ACTIVITY_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
            <Input placeholder="地點（選填）" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            <Input
              type="number"
              min="1"
              placeholder="人數上限"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              required
            />
            <Select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}>
              <option value="">不指派帶領老師</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.user.name}
                </option>
              ))}
            </Select>
            <Button type="submit">新增</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={activities}
          keyField={(a) => a.id}
          onRowClick={(a) => setViewing(a)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="活動名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {ACTIVITY_CATEGORY_LABELS[viewing.category]} · {formatActivityDateRange(viewing.startDate, viewing.endDate, 'zh-TW')} ·{' '}
              {viewing.teacher?.user.name ?? '無指派老師'} · {viewing.registrations.length}/{viewing.capacity}
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
            <button type="button" className="mt-2 text-left text-sm text-rejected hover:underline" onClick={handleDeleteActivity}>
              刪除此活動
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
