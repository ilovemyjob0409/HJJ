import { listPendingMakeupRequests } from '@/lib/services/makeupRequestService';
import { listPendingSubstituteRequests } from '@/lib/services/substituteRequestService';
import { listAllLeaveRequests } from '@/lib/services/leaveRequestService';
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';

// Without this, Next.js prerenders the pending counts once at build time
// (this page has no cookie/header access to auto-trigger dynamic rendering)
// and serves that frozen snapshot to every admin until the next deploy.
export const dynamic = 'force-dynamic';

interface LeaveRow {
  id: string;
  date: Date;
  reason: string;
  student: { user: { name: string } };
  class: { name: string };
  makeupRequest: {
    type: string;
    status: string;
    targetDate: Date | null;
    targetClass: { name: string } | null;
  } | null;
}

export default async function AdminDashboard() {
  const [pendingMakeups, pendingSubstitutes, allLeaves] = await Promise.all([
    listPendingMakeupRequests(),
    listPendingSubstituteRequests(),
    listAllLeaveRequests(),
  ]);

  const leaveColumns: Column<LeaveRow>[] = [
    { header: '學生', render: (r) => r.student.user.name },
    { header: '請假班級', render: (r) => r.class.name },
    { header: '請假日期', render: (r) => new Date(r.date).toLocaleDateString() },
    {
      header: '插班班級',
      render: (r) => (r.makeupRequest?.type === 'INSERTION' ? (r.makeupRequest.targetClass?.name ?? '-') : '-'),
    },
    {
      header: '插班日期',
      render: (r) =>
        r.makeupRequest?.type === 'INSERTION' && r.makeupRequest.targetDate
          ? new Date(r.makeupRequest.targetDate).toLocaleDateString()
          : '-',
    },
    {
      header: '補課狀態',
      render: (r) => (r.makeupRequest ? <StatusBadge status={r.makeupRequest.status} /> : <span className="text-inkMuted">尚未申請</span>),
    },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">行政儀表板</h1>
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
      <Card>
        <DataTable columns={leaveColumns} rows={allLeaves} keyField={(r) => r.id} />
      </Card>
    </AppShell>
  );
}
