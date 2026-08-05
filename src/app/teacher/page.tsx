import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listAssignedSubstituteRequestsForTeacher } from '@/lib/services/substituteRequestService';
import { listLeaveRequestsForTeacherClasses } from '@/lib/services/leaveRequestService';
import { listInsertionsForTeacherClasses, listAssignedOneOnOneForTeacher } from '@/lib/services/makeupRequestService';
import { listSessionsForTeacher } from '@/lib/services/goHallService';
import { listClassesForTeacher } from '@/lib/services/classService';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import AttendanceHub from '@/components/AttendanceHub';
import TeacherClassList from '@/components/TeacherClassList';
import RevokeLeaveButton from '@/components/RevokeLeaveButton';
import AssignmentsTable, { AssignmentRow } from '@/components/AssignmentsTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every teacher until the next deploy.
export const dynamic = 'force-dynamic';

interface LeaveRow {
  id: string;
  date: Date;
  reason: string;
  student: { user: { name: string } };
  class: { name: string };
  makeupRequest: { id: string } | null;
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

  const [substitutes, oneOnOnes, leaves, insertions, goHallSessions, teacherClasses] = teacher
    ? await Promise.all([
        listAssignedSubstituteRequestsForTeacher(teacher.id),
        listAssignedOneOnOneForTeacher(teacher.id),
        listLeaveRequestsForTeacherClasses(teacher.id),
        listInsertionsForTeacherClasses(teacher.id),
        listSessionsForTeacher(teacher.id),
        listClassesForTeacher(teacher.id),
      ])
    : [[], [], [], [], [], []];

  const assignments: AssignmentRow[] = [
    ...substitutes.map((s) => ({
      id: s.id,
      kind: 'SUBSTITUTE' as const,
      date: s.date,
      startTime: s.class.startTime,
      endTime: s.class.endTime,
      className: s.class.name,
      counterpartName: s.originalTeacher.user.name,
      substituteReason: s.reason,
      status: s.status,
      students: s.class.students,
    })),
    ...oneOnOnes.map((m) => ({
      id: m.id,
      kind: 'ONE_ON_ONE' as const,
      date: m.slotDate as Date,
      startTime: m.slotStartTime as string,
      endTime: m.slotEndTime as string,
      className: m.leaveRequest.class.name,
      counterpartName: m.leaveRequest.student.user.name,
      substituteReason: null,
      status: m.status,
      students: [],
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.startTime.localeCompare(b.startTime));

  const goHallRows = goHallSessions.map((s) => ({
    id: s.id,
    date: s.date,
    capacity: s.capacity,
    registeredCount: s._count.registrations,
  }));

  const leaveColumns: Column<LeaveRow>[] = [
    { header: '學生', render: (r) => r.student.user.name },
    { header: '班級', render: (r) => r.class.name },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date) },
    {
      header: '操作',
      render: (r) => <RevokeLeaveButton leaveRequestId={r.id} hasMakeup={r.makeupRequest !== null} />,
    },
  ];

  const insertionColumns: Column<InsertionRow>[] = [
    { header: '學生', render: (r) => r.leaveRequest.student.user.name },
    { header: '插班班級', render: (r) => r.targetClass?.name ?? '-' },
    { header: '插班日期', render: (r) => (r.targetDate ? formatDateWithWeekday(r.targetDate) : '-') },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/teacher/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假/調課申請</Card>
        </Link>
        <Link href="/teacher/availability">
          <Card className="text-ink transition-shadow hover:shadow-md">設定可補課時段</Card>
        </Link>
        <Link href="/teacher/attendance">
          <Card className="text-ink transition-shadow hover:shadow-md">點名</Card>
        </Link>
      </div>

      <h2 className="mb-2 font-bold text-ink">我的帶班班級</h2>
      <TeacherClassList classes={teacherClasses} />

      <h2 className="mb-2 font-bold text-ink">被指派代課／一對一補課</h2>
      <AssignmentsTable rows={assignments} />

      <h2 className="mb-2 font-bold text-ink">今日點名</h2>
      <div className="mb-6">
        <AttendanceHub hideDatePicker />
      </div>

      <h2 className="mb-2 font-bold text-ink">學生請假紀錄</h2>
      <Card className="mb-6">
        <DataTable columns={leaveColumns} rows={leaves} keyField={(r) => r.id} />
      </Card>

      <h2 className="mb-2 font-bold text-ink">學生插班紀錄</h2>
      <Card>
        <DataTable columns={insertionColumns} rows={insertions} keyField={(r) => r.id} />
      </Card>

      <h2 className="mb-2 mt-6 font-bold text-ink">弈廳管理</h2>
      <GoHallSummaryTable rows={goHallRows} basePath="/teacher/go-hall" />
    </>
  );
}
