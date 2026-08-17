'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface RosterEntry {
  id: string;
  student: { user: { name: string } };
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

interface SessionDetail extends SessionRow {
  registrations: RosterEntry[];
}

function TeacherGoHallContent() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [viewing, setViewing] = useState<SessionDetail | null>(null);
  const [highlightDismissed, setHighlightDismissed] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch('/api/go-hall-sessions');
      setSessions(await res.json());
    } finally {
      setLoading(false);
    }
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

  async function openRoster(id: string) {
    const res = await fetch(`/api/go-hall-sessions/${id}`);
    setViewing(await res.json());
  }

  const columns: Column<SessionRow>[] = [
    { header: '日期', render: (s) => formatDateWithWeekday(s.date, 'zh-TW'), sortValue: (s) => s.date },
    { header: '時間', render: (s) => `${s.startTime}-${s.endTime}` },
    { header: '人數', render: (s) => `${s._count.registrations}/${s.capacity}` },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">被指派的弈廳場次</h1>
      <Card>
        <DataTable
          columns={columns}
          rows={sessions}
          loading={loading}
          keyField={(s) => s.id}
          emptyText="目前沒有被指派的弈廳場次"
          onRowClick={(s) => openRoster(s.id)}
          rowClassName={(s) => (s.id === highlightId && !highlightDismissed ? 'bg-pendingBg' : 'cursor-pointer hover:bg-stripe')}
          onRowMouseLeave={(s) => {
            if (s.id === highlightId) setHighlightDismissed(true);
          }}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="場次名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {formatDateWithWeekday(viewing.date, 'zh-TW')} {viewing.startTime}-{viewing.endTime} · {viewing.registrations.length}/
              {viewing.capacity}
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
          </div>
        )}
      </Modal>
    </>
  );
}

export default function TeacherGoHallPage() {
  return (
    <Suspense fallback={null}>
      <TeacherGoHallContent />
    </Suspense>
  );
}
