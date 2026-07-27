'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import ActivityAlbum from '@/components/ActivityAlbum';

interface RosterEntry {
  id: string;
  studentId: string;
  student: { user: { name: string } };
}

interface ActivityRow {
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
  registrations: RosterEntry[];
  _count: { registrations: number };
}

export default function TeacherActivitiesPage() {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [viewing, setViewing] = useState<ActivityRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/activities')
      .then((res) => res.json())
      .then(setActivities)
      .finally(() => setLoading(false));
  }, []);

  const columns: Column<ActivityRow>[] = [
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
    { header: '老師', render: (a) => a.teachers.map((t) => t.teacher.user.name).join('、') },
    { header: '人數', render: (a) => `${a._count.registrations}/${a.capacity}` },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">帶領的活動</h1>
      <Card>
        <DataTable
          columns={columns}
          rows={activities}
          loading={loading}
          keyField={(a) => a.id}
          onRowClick={(a) => setViewing(a)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="活動名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {viewing.category.name} · {formatActivityDateRange(viewing.startDate, viewing.endDate, 'zh-TW')} ·{' '}
              {viewing.teachers.map((t) => t.teacher.user.name).join('、')} · {viewing.registrations.length}/{viewing.capacity}
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
