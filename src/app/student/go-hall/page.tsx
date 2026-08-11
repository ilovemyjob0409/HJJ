'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import GoHallTicketHistoryModal from '@/components/GoHallTicketHistoryModal';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { useToast } from '@/components/ui/Toast';
import { withStopPropagation } from '@/components/ui/stopPropagation';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { isBeforeToday } from '@/lib/pastDate';

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
  attendance: { status: string; checkInTime: string | null; checkOutTime: string | null } | null;
}

interface MyTickets {
  balance: number;
  activePassEndDate: string | null;
}

function StudentGoHallContent() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');

  const [openSessions, setOpenSessions] = useState<SessionRow[]>([]);
  const [myRegistrations, setMyRegistrations] = useState<RegistrationRow[]>([]);
  const [tickets, setTickets] = useState<MyTickets | null>(null);
  const [viewing, setViewing] = useState<SessionDetail | null>(null);
  const [highlightDismissed, setHighlightDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [ticketHistoryOpen, setTicketHistoryOpen] = useState(false);

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
    if (!(await confirm('確定要報名這場嗎？'))) return;
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
    if (!(await confirm('確定要取消這場報名嗎？'))) return;
    const res = await fetch(`/api/go-hall-registrations/${registrationId}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      showToast(data?.error === 'SESSION_EXPIRED' ? '這筆報名已過期，無法取消' : `錯誤：${data?.error ?? res.status}`);
      load();
      return;
    }
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
          onClick={withStopPropagation(() => handleRegister(s.id))}
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
      header: '簽到',
      render: (r) => {
        if (!r.attendance) {
          return <span className="text-inkMuted">{isBeforeToday(r.session.date) ? '未點名' : '—'}</span>;
        }
        return (
          <div className="flex flex-col items-center gap-1">
            <StatusBadge status={r.attendance.status} />
            {r.attendance.checkInTime && <span className="text-xs text-inkMuted">{r.attendance.checkInTime} 到場</span>}
          </div>
        );
      },
    },
    {
      header: '操作',
      render: (r) =>
        isBeforeToday(r.session.date) ? (
          <span className="text-inkMuted">已結束</span>
        ) : (
          <button type="button" className="text-rejected hover:underline" onClick={withStopPropagation(() => handleCancel(r.id))}>
            取消
          </button>
        ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">弈廳</h1>

      <h2 className="mb-2 font-bold text-ink">弈廳資格</h2>
      <Card
        className="mb-6 cursor-pointer transition-shadow hover:shadow-md"
        role="button"
        tabIndex={0}
        onClick={() => setTicketHistoryOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setTicketHistoryOpen(true);
        }}
      >
        {tickets === null ? (
          <div className="flex flex-col gap-2">
            <div className="skeleton-shimmer h-4 w-40 rounded" />
            <div className="skeleton-shimmer h-4 w-56 rounded" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
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
            <p className="mt-1 text-xs text-brandDark">查看堂票紀錄 →</p>
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
          emptyText="目前沒有開放中的場次"
        />
      </Card>

      <h2 className="mb-2 font-bold text-ink">我的報名紀錄</h2>
      <Card>
        <CollapsibleDataTable
          columns={myColumns}
          rows={myRegistrations}
          keyField={(r) => r.id}
          onRowClick={(r) => openRoster(r.session.id)}
          rowClassName={(r) => (r.id === highlightId && !highlightDismissed ? 'bg-pendingBg' : 'cursor-pointer hover:bg-stripe')}
          onRowMouseLeave={(r) => {
            if (r.id === highlightId) setHighlightDismissed(true);
          }}
          loading={loading}
          maxRows={3}
          emptyText="目前沒有報名紀錄"
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

      <GoHallTicketHistoryModal open={ticketHistoryOpen} onClose={() => setTicketHistoryOpen(false)} />
      {ConfirmDialog}
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
