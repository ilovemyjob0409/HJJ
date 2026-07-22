'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

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

  async function load() {
    const res = await fetch('/api/go-hall-sessions');
    setSessions(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

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
    { header: '日期', render: (s) => new Date(s.date).toLocaleDateString('zh-TW') },
    { header: '時間', render: (s) => `${s.startTime}-${s.endTime}` },
    { header: '人數', render: (s) => `${s._count.registrations}/${s.capacity}` },
  ];

  return (
    <AppShell role="TEACHER">
      <h1 className="mb-4 text-xl font-bold text-ink">被指派的弈廳場次</h1>
      <Card>
        <DataTable
          columns={columns}
          rows={sessions}
          keyField={(s) => s.id}
          onRowClick={(s) => openRoster(s.id)}
          rowClassName={(s) => (s.id === highlightId ? 'bg-pendingBg' : 'cursor-pointer hover:bg-gray-50')}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="場次名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {new Date(viewing.date).toLocaleDateString('zh-TW')} {viewing.startTime}-{viewing.endTime} · {viewing.registrations.length}/
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
    </AppShell>
  );
}

export default function TeacherGoHallPage() {
  return (
    <Suspense fallback={null}>
      <TeacherGoHallContent />
    </Suspense>
  );
}
