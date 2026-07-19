import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';

export default function StudentDashboard() {
  return (
    <AppShell role="STUDENT">
      <h1 className="mb-4 text-xl font-bold text-ink">學生首頁</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/student/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假申請與紀錄</Card>
        </Link>
        <Link href="/student/makeup-request">
          <Card className="text-ink transition-shadow hover:shadow-md">申請補課</Card>
        </Link>
      </div>
    </AppShell>
  );
}
