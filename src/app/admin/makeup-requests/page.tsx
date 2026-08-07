'use client';

import { ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import ArrangeMakeupForm from './ArrangeMakeupForm';
import LeaveRequestList, { LeaveRequestListHandle } from './LeaveRequestList';

interface PendingRow {
  id: string;
  type: 'INSERTION' | 'ONE_ON_ONE';
  leaveRequest: { student: { user: { name: string } }; class: { name: string } };
  targetClass: { name: string } | null;
  targetDate: string | null;
  teacher: { user: { name: string } } | null;
  slotDate: string | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
}

interface TutoringPendingRow {
  id: string;
  studentName: string;
  programName: string;
  originalDate: string;
  date: string;
  startTime: string;
  endTime: string;
}

interface MergedRow {
  key: string;
  source: 'CLASS' | 'TUTORING';
  studentName: string;
  origin: string;
  typeBadge: ReactNode;
  dateLabel: string;
  target: ReactNode;
}

function AdminMakeupRequestsContent() {
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const [classRows, setClassRows] = useState<PendingRow[]>([]);
  const [tutoringRows, setTutoringRows] = useState<TutoringPendingRow[]>([]);
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'CLASS' | 'TUTORING'>('ALL');
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const leaveListRef = useRef<LeaveRequestListHandle>(null);

  async function load() {
    try {
      const [classRes, tutoringRes] = await Promise.all([
        fetch('/api/makeup-requests/pending'),
        fetch('/api/tutoring-makeup-requests'),
      ]);
      setClassRows(await classRes.json());
      setTutoringRows(await tutoringRes.json());
    } finally {
      setLoading(false);
    }
  }

  const mergedRows: MergedRow[] = [
    ...classRows.map((r) => ({
      key: r.id,
      source: 'CLASS' as const,
      studentName: r.leaveRequest.student.user.name,
      origin: r.leaveRequest.class.name,
      typeBadge:
        r.type === 'INSERTION' ? (
          <span className="whitespace-nowrap rounded-full bg-approvedBg px-2.5 py-0.5 text-xs font-bold text-approved">插班</span>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">一對一</span>
        ),
      dateLabel: (() => {
        const d = r.type === 'INSERTION' ? r.targetDate : r.slotDate;
        return d ? formatDateWithWeekday(d) : '-';
      })(),
      target:
        r.type === 'INSERTION' ? (
          <span className="whitespace-nowrap">{r.targetClass?.name}</span>
        ) : (
          <div className="flex flex-col items-center">
            <span className="whitespace-nowrap">{r.teacher?.user.name}</span>
            <span className="whitespace-nowrap">{r.slotStartTime}-{r.slotEndTime}</span>
          </div>
        ),
    })),
    ...tutoringRows.map((r) => ({
      key: r.id,
      source: 'TUTORING' as const,
      studentName: r.studentName,
      origin: `${r.programName}・原 ${formatDateWithWeekday(r.originalDate)}`,
      typeBadge: (
        <span className="whitespace-nowrap rounded-full bg-pendingBg px-2.5 py-0.5 text-xs font-bold text-pending">個別輔導補課</span>
      ),
      dateLabel: formatDateWithWeekday(r.date),
      target: <span className="whitespace-nowrap">{r.startTime}-{r.endTime}</span>,
    })),
  ];
  const visibleRows = sourceFilter === 'ALL' ? mergedRows : mergedRows.filter((r) => r.source === sourceFilter);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!highlightId || mergedRows.length === 0) return;
    // mergedRows' DOM ids are `${source}-${key}` (see keyField below) to stay unique
    // across the two merged sources, but links into this page (e.g. LeaveRecordsTable)
    // still pass the raw, unprefixed record id — resolve it to the prefixed DOM id here
    // so the existing scroll-to-row behavior keeps working unchanged.
    const match = mergedRows.find((r) => r.key === highlightId);
    if (!match) return;
    document.getElementById(`${match.source}-${match.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, mergedRows.length]);

  async function decide(row: MergedRow, decision: 'APPROVED' | 'REJECTED') {
    setPendingId(row.key);
    try {
      const path = row.source === 'CLASS' ? `/api/makeup-requests/${row.key}` : `/api/tutoring-makeup-requests/${row.key}`;
      await fetch(path, { method: 'PATCH', body: JSON.stringify({ decision }) });
      showToast(decision === 'APPROVED' ? '已核准' : '已拒絕');
      load();
      leaveListRef.current?.reload();
    } finally {
      setPendingId(null);
    }
  }

  const columns: Column<MergedRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '來源／原班級', render: (r) => <span className="whitespace-nowrap">{r.origin}</span> },
    { header: '類型', render: (r) => r.typeBadge },
    { header: '補課日期', render: (r) => <span className="whitespace-nowrap">{r.dateLabel}</span> },
    { header: '目標', render: (r) => r.target },
    { header: '狀態', render: () => <StatusBadge status="PENDING_ADMIN" /> },
    {
      header: '操作',
      render: (r) => (
        <div className="flex gap-2">
          <Button className="px-3 py-1 text-xs" onClick={() => decide(r, 'APPROVED')} loading={pendingId === r.key}>
            核准
          </Button>
          <Button
            variant="secondary"
            className="px-3 py-1 text-xs"
            onClick={() => decide(r, 'REJECTED')}
            loading={pendingId === r.key}
          >
            拒絕
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">請假管理</h1>
      <ArrangeMakeupForm onArranged={() => leaveListRef.current?.reload()} />

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-ink">待確認補課申請</h2>
        <div className="flex gap-2">
          {(['ALL', 'CLASS', 'TUTORING'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setSourceFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                sourceFilter === f ? 'bg-brand text-brandInk' : 'border border-borderStrong text-inkMuted'
              }`}
            >
              {f === 'ALL' ? '全部' : f === 'CLASS' ? '班級補課' : '輔導補課'}
            </button>
          ))}
        </div>
      </div>
      <Card>
        <DataTable
          columns={columns}
          rows={visibleRows}
          keyField={(r) => `${r.source}-${r.key}`}
          rowClassName={(r) => (r.key === highlightId ? 'bg-pendingBg' : '')}
          loading={loading}
          emptyText="目前沒有待確認的補課申請"
        />
      </Card>

      <LeaveRequestList ref={leaveListRef} />
    </>
  );
}

export default function AdminMakeupRequestsPage() {
  return (
    <Suspense fallback={null}>
      <AdminMakeupRequestsContent />
    </Suspense>
  );
}
