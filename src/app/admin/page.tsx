import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listPendingMakeupRequests } from '@/lib/services/makeupRequestService';
import { listPendingSubstituteRequests, listAllSubstituteRequests } from '@/lib/services/substituteRequestService';
import { listAllLeaveRequests } from '@/lib/services/leaveRequestService';
import { listAllSessions } from '@/lib/services/goHallService';
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import LeaveRecordsTable from './LeaveRecordsTable';
import SubstituteHistoryTable from './SubstituteHistoryTable';

// Without this, Next.js prerenders the pending counts once at build time
// (this page has no cookie/header access to auto-trigger dynamic rendering)
// and serves that frozen snapshot to every admin until the next deploy.
export const dynamic = 'force-dynamic';

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

  return (
    <>
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

      <LeaveRecordsTable title="學生請假與補課紀錄" rows={allLeaves} />

      <div className="mt-6">
        <SubstituteHistoryTable title="安排代課紀錄" rows={allSubstitutes} />
      </div>

      <div className="mt-6">
        <GoHallSummaryTable title="弈廳管理" rows={goHallRows} basePath="/admin/go-hall" searchable />
      </div>
    </>
  );
}
