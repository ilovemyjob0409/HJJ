import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';

export default function TeacherDashboard() {
  return (
    <AppShell role="TEACHER">
      <h1 className="mb-4 text-xl font-bold text-ink">老師首頁</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/teacher/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假/調課申請</Card>
        </Link>
        <Link href="/teacher/availability">
          <Card className="text-ink transition-shadow hover:shadow-md">設定我的可補課時段</Card>
        </Link>
      </div>
    </AppShell>
  );
}
