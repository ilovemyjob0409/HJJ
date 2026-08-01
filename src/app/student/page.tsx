import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listLeaveRequestsForStudent } from '@/lib/services/leaveRequestService';
import { listRegistrationsForStudent } from '@/lib/services/goHallService';
import { listStudentEnrolledClasses } from '@/lib/services/classService';
import { listMakeupNoticeItems } from '@/lib/services/makeupNoticeService';
import { getPointBalances } from '@/lib/services/pointService';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import CancelMakeupButton from './CancelMakeupButton';
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
  quota: { totalSessions: number | null; usedSessions: number; remaining: number | null };
}

interface LeaveRow {
  id: string;
  date: Date;
  reason: string;
  class: { name: string };
  makeupRequest: {
    id: string;
    type: string;
    status: string;
    targetDate: Date | null;
    cancelRequestedAt: Date | null;
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
  const notices = await listMakeupNoticeItems();
  const balances = student ? await getPointBalances(student.id) : { regular: 0, redeemOnly: 0 };

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
    { header: '剩餘堂數', render: (c) => (c.quota.remaining !== null ? c.quota.remaining : '-') },
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
      render: (r) => {
        if (!r.makeupRequest) return <span className="text-inkMuted">尚未申請</span>;
        return (
          <div className="flex flex-col items-center gap-1">
            <StatusBadge status={r.makeupRequest.status} />
            {r.makeupRequest.status === 'APPROVED' &&
              (r.makeupRequest.cancelRequestedAt ? (
                <span className="text-xs text-pending">撤銷申請中</span>
              ) : (
                <CancelMakeupButton makeupRequestId={r.makeupRequest.id} />
              ))}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>

      <Link href="/student/points">
        <Card className="mb-6 transition-shadow hover:shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm text-inkMuted">我的集點卡</p>
              <p className="mt-1 text-2xl font-bold text-brandDark">{balances.regular + balances.redeemOnly} 點</p>
            </div>
            <p className="text-sm text-inkMuted">
              一般 {balances.regular} 點・兌換專用 {balances.redeemOnly} 點
            </p>
          </div>
        </Card>
      </Link>

      {notices.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-2 font-bold text-ink">補課須知</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-inkMuted">
            {notices.map((n) => (
              <li key={n.id} className="whitespace-pre-wrap">
                {n.content}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/student/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假申請與紀錄</Card>
        </Link>
        <Link href="/student/makeup-request">
          <Card className="text-ink transition-shadow hover:shadow-md">申請補課</Card>
        </Link>
        <Link href="/student/attendance">
          <Card className="text-ink transition-shadow hover:shadow-md">我的出席紀錄</Card>
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
