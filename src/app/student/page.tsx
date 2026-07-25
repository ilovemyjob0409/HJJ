import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listLeaveRequestsForStudent } from '@/lib/services/leaveRequestService';
import { listRegistrationsForStudent } from '@/lib/services/goHallService';
import { listStudentEnrolledClasses } from '@/lib/services/classService';
import { TOTAL_QUARTER_LIMIT, ONE_ON_ONE_QUARTER_LIMIT } from '@/lib/services/makeupRequestService';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every student until the next deploy.
export const dynamic = 'force-dynamic';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface ClassRow {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
}

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
  const [leaves, myRegistrations, myClasses] = student
    ? await Promise.all([
        listLeaveRequestsForStudent(student.id),
        listRegistrationsForStudent(student.id),
        listStudentEnrolledClasses(student.id),
      ])
    : [[], [], []];

  const goHallRows = myRegistrations.map((r) => ({
    id: r.id,
    date: r.session.date,
    capacity: r.session.capacity,
    registeredCount: r.session._count.registrations,
  }));

  const classColumns: Column<ClassRow>[] = [
    { header: '班級名稱', render: (c) => c.name },
    { header: '科目', render: (c) => c.subject },
    { header: '程度', render: (c) => c.level },
    { header: '上課時間', render: (c) => `每週${WEEKDAYS[c.weekday]} ${c.startTime}-${c.endTime}` },
    { header: '授課老師', render: (c) => c.teacher.user.name },
  ];

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
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>

      <Card className="mb-6">
        <h2 className="mb-2 font-bold text-ink">補課須知</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-inkMuted">
          <li>每位學生在每個班級，每一季最多可申請 {TOTAL_QUARTER_LIMIT} 次補課機會（插班、一對一合計計算）。</li>
          <li>一對一補課每季最多使用 {ONE_ON_ONE_QUARTER_LIMIT} 次，包含在上述總額度內。</li>
          <li>補課額度依「班級」各自獨立計算，不同班級的名額互不影響。</li>
          <li>若申請被行政人員拒絕，該次不會計入額度，仍可以再次申請。</li>
          <li>額度用完後將無法再送出補課申請，剩餘次數請至「申請補課」頁面查看。</li>
        </ul>
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/student/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假申請與紀錄</Card>
        </Link>
        <Link href="/student/makeup-request">
          <Card className="text-ink transition-shadow hover:shadow-md">申請補課</Card>
        </Link>
      </div>

      <h2 className="mb-2 font-bold text-ink">我的班級</h2>
      <Card className="mb-6">
        <DataTable columns={classColumns} rows={myClasses} keyField={(c) => c.id} />
      </Card>

      <h2 className="mb-2 font-bold text-ink">我的請假與插班紀錄</h2>
      <Card>
        <DataTable columns={leaveColumns} rows={leaves} keyField={(r) => r.id} />
      </Card>

      <h2 className="mb-2 mt-6 font-bold text-ink">弈廳報名紀錄</h2>
      <GoHallSummaryTable rows={goHallRows} basePath="/student/go-hall" />
    </>
  );
}
