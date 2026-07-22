import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listPendingMakeupRequests } from '@/lib/services/makeupRequestService';
import { listPendingSubstituteRequests, listAllSubstituteRequests } from '@/lib/services/substituteRequestService';
import { listAllLeaveRequests } from '@/lib/services/leaveRequestService';
import { listAllSessions } from '@/lib/services/goHallService';
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import LeaveRecordsTable from './LeaveRecordsTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';

// Without this, Next.js prerenders the pending counts once at build time
// (this page has no cookie/header access to auto-trigger dynamic rendering)
// and serves that frozen snapshot to every admin until the next deploy.
export const dynamic = 'force-dynamic';

interface SubstituteRow {
  id: string;
  date: Date;
  reason: string;
  status: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
  substituteTeacher: { user: { name: string } } | null;
}

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions);
  const [pendingMakeups, pendingSubstitutes, allLeaves, allSubstitutes, goHallSessions] = await Promise.all([
    listPendingMakeupRequests(),
    listPendingSubstituteRequests(),
    listAllLeaveRequests(),
    listAllSubstituteRequests(),
    listAllSessions(),
  ]);

  const goHallRows = goHallSessions.map((s) => ({
    id: s.id,
    date: s.date,
    capacity: s.capacity,
    registeredCount: s._count.registrations,
  }));

  const substituteColumns: Column<SubstituteRow>[] = [
    { header: '班級', render: (r) => r.class.name },
    { header: '原老師', render: (r) => r.originalTeacher.user.name },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW') },
    { header: '原因', render: (r) => r.reason },
    { header: '代課老師', render: (r) => r.substituteTeacher?.user.name ?? '-' },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/admin/makeup-requests">
          <Card className="transition-shadow hover:shadow-md">
            <p className="text-sm text-inkMuted">待確認補課申請</p>
            <p className="text-2xl font-bold text-ink">{pendingMakeups.length} 筆</p>
          </Card>
        </Link>
        <Link href="/admin/substitute-requests">
          <Card className="transition-shadow hover:shadow-md">
            <p className="text-sm text-inkMuted">待安排代課</p>
            <p className="text-2xl font-bold text-ink">{pendingSubstitutes.length} 筆</p>
          </Card>
        </Link>
      </div>

      <h2 className="mb-2 font-bold text-ink">學生請假與插班紀錄</h2>
      <LeaveRecordsTable rows={allLeaves} />

      <h2 className="mb-2 mt-6 font-bold text-ink">安排代課紀錄</h2>
      <Card>
        <DataTable columns={substituteColumns} rows={allSubstitutes} keyField={(r) => r.id} />
      </Card>

      <h2 className="mb-2 mt-6 font-bold text-ink">弈廳管理</h2>
      <GoHallSummaryTable rows={goHallRows} basePath="/admin/go-hall" />
    </AppShell>
  );
}
