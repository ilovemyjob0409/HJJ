import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listAssignedSubstituteRequestsForTeacher } from '@/lib/services/substituteRequestService';
import { listLeaveRequestsForTeacherClasses } from '@/lib/services/leaveRequestService';
import { listInsertionsForTeacherClasses } from '@/lib/services/makeupRequestService';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every teacher until the next deploy.
export const dynamic = 'force-dynamic';

interface SubstituteRow {
  id: string;
  date: Date;
  reason: string;
  status: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
}

interface LeaveRow {
  id: string;
  date: Date;
  reason: string;
  student: { user: { name: string } };
  class: { name: string };
}

interface InsertionRow {
  id: string;
  status: string;
  targetDate: Date | null;
  targetClass: { name: string } | null;
  leaveRequest: { student: { user: { name: string } } };
}

export default async function TeacherDashboard() {
  const session = await getServerSession(authOptions);
  const teacher = session ? await prisma.teacher.findUnique({ where: { userId: session.user.id } }) : null;

  const [substitutes, leaves, insertions] = teacher
    ? await Promise.all([
        listAssignedSubstituteRequestsForTeacher(teacher.id),
        listLeaveRequestsForTeacherClasses(teacher.id),
        listInsertionsForTeacherClasses(teacher.id),
      ])
    : [[], [], []];

  const substituteColumns: Column<SubstituteRow>[] = [
    { header: '班級', render: (r) => r.class.name },
    { header: '日期', render: (r) => new Date(r.date).toLocaleDateString() },
    { header: '原老師', render: (r) => r.originalTeacher.user.name },
    { header: '原因', render: (r) => r.reason },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
  ];

  const leaveColumns: Column<LeaveRow>[] = [
    { header: '學生', render: (r) => r.student.user.name },
    { header: '班級', render: (r) => r.class.name },
    { header: '日期', render: (r) => new Date(r.date).toLocaleDateString() },
  ];

  const insertionColumns: Column<InsertionRow>[] = [
    { header: '學生', render: (r) => r.leaveRequest.student.user.name },
    { header: '插班班級', render: (r) => r.targetClass?.name ?? '-' },
    { header: '插班日期', render: (r) => (r.targetDate ? new Date(r.targetDate).toLocaleDateString() : '-') },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <AppShell role="TEACHER">
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/teacher/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假/調課申請</Card>
        </Link>
        <Link href="/teacher/availability">
          <Card className="text-ink transition-shadow hover:shadow-md">設定可補課時段</Card>
        </Link>
      </div>

      <h2 className="mb-2 font-bold text-ink">被指派代課</h2>
      <Card className="mb-6">
        <DataTable columns={substituteColumns} rows={substitutes} keyField={(r) => r.id} />
      </Card>

      <h2 className="mb-2 font-bold text-ink">學生請假紀錄</h2>
      <Card className="mb-6">
        <DataTable columns={leaveColumns} rows={leaves} keyField={(r) => r.id} />
      </Card>

      <h2 className="mb-2 font-bold text-ink">學生插班紀錄</h2>
      <Card>
        <DataTable columns={insertionColumns} rows={insertions} keyField={(r) => r.id} />
      </Card>
    </AppShell>
  );
}
