import { listPendingMakeupRequests } from '@/lib/services/makeupRequestService';
import { listPendingSubstituteRequests } from '@/lib/services/substituteRequestService';
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';

export default async function AdminDashboard() {
  const [pendingMakeups, pendingSubstitutes] = await Promise.all([
    listPendingMakeupRequests(),
    listPendingSubstituteRequests(),
  ]);

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">行政儀表板</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
    </AppShell>
  );
}
