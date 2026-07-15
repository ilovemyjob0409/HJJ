import { listPendingMakeupRequests } from '@/lib/services/makeupRequestService';
import { listPendingSubstituteRequests } from '@/lib/services/substituteRequestService';
import Link from 'next/link';

export default async function AdminDashboard() {
  const [pendingMakeups, pendingSubstitutes] = await Promise.all([
    listPendingMakeupRequests(),
    listPendingSubstituteRequests(),
  ]);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">行政儀表板</h1>
      <ul className="mb-6 flex flex-col gap-2">
        <li><Link className="underline" href="/admin/makeup-requests">待確認補課申請：{pendingMakeups.length} 筆</Link></li>
        <li><Link className="underline" href="/admin/substitute-requests">待安排代課：{pendingSubstitutes.length} 筆</Link></li>
      </ul>
      <nav className="flex gap-4">
        <Link className="underline" href="/admin/teachers">老師名單</Link>
        <Link className="underline" href="/admin/students">學生名單</Link>
        <Link className="underline" href="/admin/classes">班級名單</Link>
      </nav>
    </div>
  );
}
