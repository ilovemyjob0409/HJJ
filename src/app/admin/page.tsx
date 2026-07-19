import { listPendingMakeupRequests } from '@/lib/services/makeupRequestService';
import { listPendingSubstituteRequests } from '@/lib/services/substituteRequestService';
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';

// Without this, Next.js prerenders the pending counts once at build time
// (this page has no cookie/header access to auto-trigger dynamic rendering)
// and serves that frozen snapshot to every admin until the next deploy.
export const dynamic = 'force-dynamic';

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
