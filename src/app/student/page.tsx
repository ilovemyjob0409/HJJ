import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listLeaveRequestsForStudent } from '@/lib/services/leaveRequestService';
import { listRegistrationsForStudent } from '@/lib/services/goHallService';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every student until the next deploy.
export const dynamic = 'force-dynamic';

interface LeaveRow {
  id: string;
  date: Date;
  reason: string;
  class: { name: string };
  makeupRequest: {
    type: string;
    status: string;
    targetDate: Date | null;
  } | null;
}

export default async function StudentDashboard() {
  const session = await getServerSession(authOptions);
  const student = session ? await prisma.student.findUnique({ where: { userId: session.user.id } }) : null;
  const [leaves, myRegistrations] = student
    ? await Promise.all([listLeaveRequestsForStudent(student.id), listRegistrationsForStudent(student.id)])
    : [[], []];

  const goHallRows = myRegistrations.map((r) => ({
    id: r.id,
    date: r.session.date,
    capacity: r.session.capacity,
    registeredCount: r.session._count.registrations,
  }));

  const leaveColumns: Column<LeaveRow>[] = [
    { header: '請假班級', render: (r) => r.class.name },
    { header: '請假日期', render: (r) => formatDateWithWeekday(r.date) },
    {
      header: '插班日期',
      render: (r) =>
        r.makeupRequest?.type === 'INSERTION' && r.makeupRequest.targetDate
          ? formatDateWithWeekday(r.makeupRequest.targetDate)
          : '-',
    },
    {
      header: '補課狀態',
      render: (r) => (r.makeupRequest ? <StatusBadge status={r.makeupRequest.status} /> : <span className="text-inkMuted">尚未申請</span>),
    },
  ];

  return (
    <AppShell role="STUDENT">
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/student/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假申請與紀錄</Card>
        </Link>
        <Link href="/student/makeup-request">
          <Card className="text-ink transition-shadow hover:shadow-md">申請補課</Card>
        </Link>
      </div>

      <h2 className="mb-2 font-bold text-ink">我的請假與插班紀錄</h2>
      <Card>
        <DataTable columns={leaveColumns} rows={leaves} keyField={(r) => r.id} />
      </Card>

      <h2 className="mb-2 mt-6 font-bold text-ink">弈廳報名紀錄</h2>
      <GoHallSummaryTable rows={goHallRows} basePath="/student/go-hall" />
    </AppShell>
  );
}
