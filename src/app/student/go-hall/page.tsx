'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
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

interface RegistrationRow {
  id: string;
  session: SessionRow;
}

interface ClassQuotaRow {
  classId: string;
  className: string;
  usedSessions: number;
  totalSessions: number | null;
}

interface MyTickets {
  balance: number;
  activePassEndDate: string | null;
  classQuotas: ClassQuotaRow[];
}

function StudentGoHallContent() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const [openSessions, setOpenSessions] = useState<SessionRow[]>([]);
  const [myRegistrations, setMyRegistrations] = useState<RegistrationRow[]>([]);
  const [tickets, setTickets] = useState<MyTickets | null>(null);
  const [viewing, setViewing] = useState<SessionDetail | null>(null);
  const [highlightDismissed, setHighlightDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function load() {
    try {
      const [sessionsRes, myRes, ticketsRes] = await Promise.all([
        fetch('/api/go-hall-sessions'),
        fetch('/api/go-hall-registrations'),
        fetch('/api/go-hall-tickets/me'),
      ]);
      setOpenSessions(await sessionsRes.json());
      setMyRegistrations(await myRes.json());
      setTickets(await ticketsRes.json());
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
    if (!highlightId || myRegistrations.length === 0) return;
    document.getElementById(highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const registration = myRegistrations.find((r) => r.id === highlightId);
    if (registration) openRoster(registration.session.id);
  }, [highlightId, myRegistrations]);

  async function handleRegister(sessionId: string) {
    if (!confirm('確定要報名這場嗎？')) return;
    setPendingId(sessionId);
    try {
      const res = await fetch('/api/go-hall-registrations', { method: 'POST', body: JSON.stringify({ sessionId }) });
      if (!res.ok) {
        const data = await res.json();
        showToast(data.error === 'SESSION_FULL' ? '這場已經額滿了' : `錯誤：${data.error}`);
        return;
      }
      showToast('已報名');
      load();
    } finally {
      setPendingId(null);
    }
  }

  async function handleCancel(registrationId: string) {
    if (!confirm('確定要取消這場報名嗎？')) return;
    await fetch(`/api/go-hall-registrations/${registrationId}`, { method: 'DELETE' });
    showToast('已取消');
    load();
  }

  async function openRoster(sessionId: string) {
    const res = await fetch(`/api/go-hall-sessions/${sessionId}`);
    setViewing(await res.json());
  }

  const openColumns: Column<SessionRow>[] = [
    { header: '日期', render: (s) => formatDateWithWeekday(s.date, 'zh-TW') },
    { header: '時間', render: (s) => `${s.startTime}-${s.endTime}` },
    { header: '老師', render: (s) => s.teacher.user.name },
    { header: '剩餘名額', render: (s) => Math.max(s.capacity - s._count.registrations, 0) },
    {
      header: '操作',
      render: (s) => (
        <Button
          className="px-3 py-1 text-xs"
          disabled={s._count.registrations >= s.capacity}
          onClick={() => handleRegister(s.id)}
          loading={pendingId === s.id}
        >
          {s._count.registrations >= s.capacity ? '已額滿' : '報名'}
        </Button>
      ),
    },
  ];

  const myColumns: Column<RegistrationRow>[] = [
    { header: '日期', render: (r) => formatDateWithWeekday(r.session.date, 'zh-TW') },
    { header: '時間', render: (r) => `${r.session.startTime}-${r.session.endTime}` },
    { header: '老師', render: (r) => r.session.teacher.user.name },
    {
      header: '操作',
      render: (r) => (
        <button type="button" className="text-rejected hover:underline" onClick={() => handleCancel(r.id)}>
          取消
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">弈廳</h1>

      <h2 className="mb-2 font-bold text-ink">票券管理</h2>
      <Card className="mb-6">
        {tickets === null ? (
          <div className="flex flex-col gap-2">
            <div className="skeleton-shimmer h-4 w-40 rounded" />
            <div className="skeleton-shimmer h-4 w-56 rounded" />
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-[1fr_1px_240px]">
            <div>
              <p className="mb-1 text-xs font-semibold text-inkMuted">課堂堂數</p>
              {tickets.classQuotas.length === 0 ? (
                <p className="py-2 text-sm text-inkMuted">尚未報名任何課堂</p>
              ) : (
                tickets.classQuotas.map((q, i) => (
                  <div key={q.classId} className={`flex flex-col gap-1.5 py-2 ${i > 0 ? 'border-t border-borderSubtle' : ''}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm text-ink">{q.className}</span>
                      <span className="text-xs tabular-nums text-inkMuted">
                        <span className="font-semibold text-ink">{q.usedSessions}</span>
                        {q.totalSessions !== null ? `／${q.totalSessions} 堂` : ' 堂・未設定'}
                      </span>
                    </div>
                    {q.totalSessions !== null && q.totalSessions > 0 && (
                      <div className="h-1 overflow-hidden rounded-full bg-stripe">
                        <div
                          className="h-full rounded-full bg-brand"
                          style={{ width: `${Math.min(100, (q.usedSessions / q.totalSessions) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="hidden bg-borderSubtle sm:block" />
            <div className="flex flex-col gap-2 border-t border-borderSubtle pt-4 sm:border-t-0 sm:pt-0">
              <p className="text-xs font-semibold text-inkMuted">弈廳資格</p>
              {tickets.activePassEndDate ? (
                <>
                  <span className="self-start rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">季票使用中</span>
                  <p className="text-xs text-inkMuted">有效期至 {formatDateWithWeekday(tickets.activePassEndDate, 'zh-TW')}</p>
                  {tickets.balance > 0 && <p className="text-xs text-inkMuted">另有堂票 {tickets.balance} 堂（季票期間不扣）</p>}
                </>
              ) : tickets.balance > 0 ? (
                <>
                  <p className="text-sm text-ink">
                    <span className="text-2xl font-bold tabular-nums">{tickets.balance}</span> 堂票剩餘
                  </p>
                  <p className="text-xs text-inkMuted">點名到場自動扣 1 堂・缺席不扣</p>
                </>
              ) : (
                <>
                  <span className="self-start rounded-full bg-pendingBg px-3 py-1 text-xs font-semibold text-pending">單堂計費</span>
                  <p className="text-xs text-inkMuted">現場收費</p>
                </>
              )}
            </div>
          </div>
        )}
      </Card>

      <h2 className="mb-2 font-bold text-ink">開放中的場次</h2>
      <Card className="mb-6">
        <DataTable
          columns={openColumns}
          rows={openSessions}
          keyField={(s) => s.id}
          onRowClick={(s) => openRoster(s.id)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          loading={loading}
        />
      </Card>

      <h2 className="mb-2 font-bold text-ink">我的報名紀錄</h2>
      <Card>
        <DataTable
          columns={myColumns}
          rows={myRegistrations}
          keyField={(r) => r.id}
          onRowClick={(r) => openRoster(r.session.id)}
          rowClassName={(r) => (r.id === highlightId && !highlightDismissed ? 'bg-pendingBg' : 'cursor-pointer hover:bg-stripe')}
          onRowMouseLeave={(r) => {
            if (r.id === highlightId) setHighlightDismissed(true);
          }}
          loading={loading}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="場次名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {formatDateWithWeekday(viewing.date, 'zh-TW')} {viewing.startTime}-{viewing.endTime} · {viewing.teacher.user.name}
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

export default function StudentGoHallPage() {
  return (
    <Suspense fallback={null}>
      <StudentGoHallContent />
    </Suspense>
  );
}
