'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import ActivityAlbum from '@/components/ActivityAlbum';

interface ActivityStudentRow {
  id: string;
  coverUrl: string | null;
  title: string;
  description: string;
  category: { name: string };
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teachers: { teacher: { user: { name: string } } }[];
  _count: { registrations: number };
}

interface RegistrationRow {
  id: string;
  activity: ActivityStudentRow;
}

interface RosterEntry {
  id: string;
  studentId: string;
  student: { user: { name: string } };
}

interface ActivityDetail extends ActivityStudentRow {
  registrations: RosterEntry[];
}

export default function StudentActivitiesPage() {
  const { showToast } = useToast();
  const [openActivities, setOpenActivities] = useState<ActivityStudentRow[]>([]);
  const [myRegistrations, setMyRegistrations] = useState<RegistrationRow[]>([]);
  const [viewing, setViewing] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function load() {
    try {
      const [activitiesRes, myRes] = await Promise.all([fetch('/api/activities'), fetch('/api/activity-registrations')]);
      setOpenActivities(await activitiesRes.json());
      setMyRegistrations(await myRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRegister(activityId: string) {
    if (!confirm('確定要報名這個活動嗎？')) return;
    setPendingId(activityId);
    try {
      const res = await fetch('/api/activity-registrations', { method: 'POST', body: JSON.stringify({ activityId }) });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error === 'ACTIVITY_FULL' ? '這個活動已經額滿了' : `錯誤：${data.error}`);
        return;
      }
      showToast('已報名');
      load();
    } finally {
      setPendingId(null);
    }
  }

  async function handleCancel(registrationId: string) {
    if (!confirm('確定要取消這個活動的報名嗎？')) return;
    await fetch(`/api/activity-registrations/${registrationId}`, { method: 'DELETE' });
    showToast('已取消');
    load();
  }

  async function openRoster(activityId: string) {
    const res = await fetch(`/api/activities/${activityId}`);
    setViewing(await res.json());
  }

  const openColumns: Column<ActivityStudentRow>[] = [
    {
      header: '封面',
      render: (a) =>
        a.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
          <img src={a.coverUrl} alt="封面" className="mx-auto h-10 w-10 rounded object-cover" />
        ) : (
          <div className="bg-stripe mx-auto h-10 w-10 rounded" />
        ),
    },
    { header: '標題', render: (a) => a.title },
    { header: '分類', render: (a) => a.category.name },
    { header: '日期區間', render: (a) => formatActivityDateRange(a.startDate, a.endDate, 'zh-TW') },
    { header: '地點', render: (a) => a.location ?? '-' },
    { header: '老師', render: (a) => a.teachers.map((t) => t.teacher.user.name).join('、') },
    { header: '剩餘名額', render: (a) => Math.max(a.capacity - a._count.registrations, 0) },
    {
      header: '操作',
      render: (a) => (
        <Button
          className="px-3 py-1 text-xs"
          disabled={a._count.registrations >= a.capacity}
          onClick={() => handleRegister(a.id)}
          loading={pendingId === a.id}
        >
          {a._count.registrations >= a.capacity ? '已額滿' : '報名'}
        </Button>
      ),
    },
  ];

  const myColumns: Column<RegistrationRow>[] = [
    {
      header: '封面',
      render: (r) =>
        r.activity.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
          <img src={r.activity.coverUrl} alt="封面" className="mx-auto h-10 w-10 rounded object-cover" />
        ) : (
          <div className="bg-stripe mx-auto h-10 w-10 rounded" />
        ),
    },
    { header: '標題', render: (r) => r.activity.title },
    { header: '分類', render: (r) => r.activity.category.name },
    { header: '日期區間', render: (r) => formatActivityDateRange(r.activity.startDate, r.activity.endDate, 'zh-TW') },
    {
      header: '操作',
      render: (r) => (
        <button
          type="button"
          className="text-rejected hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            handleCancel(r.id);
          }}
        >
          取消
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">活動專區</h1>

      <h2 className="mb-2 font-bold text-ink">活動列表</h2>
      <Card className="mb-6">
        <DataTable columns={openColumns} rows={openActivities} keyField={(a) => a.id} loading={loading} />
      </Card>

      <h2 className="mb-2 font-bold text-ink">我的報名紀錄</h2>
      <Card>
        <DataTable
          columns={myColumns}
          rows={myRegistrations}
          keyField={(r) => r.id}
          onRowClick={(r) => openRoster(r.activity.id)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          loading={loading}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="活動名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {viewing.category.name} · {formatActivityDateRange(viewing.startDate, viewing.endDate, 'zh-TW')} ·{' '}
              {viewing.teachers.map((t) => t.teacher.user.name).join('、')}
            </p>
            {viewing.registrations.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生報名</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {viewing.registrations.map((r) => (
                  <li key={r.id} className="text-sm text-ink">
                    {r.student.user.name}
                  </li>
                ))}
              </ul>
            )}
            <ActivityAlbum activityId={viewing.id} canManage={false} />
          </div>
        )}
      </Modal>
    </>
  );
}
