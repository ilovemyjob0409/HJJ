import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listLeaveRequestsForStudent } from '@/lib/services/leaveRequestService';
import { listRegistrationsForStudent } from '@/lib/services/goHallService';
import { hasActiveClassEnrollment, listStudentEnrolledClasses } from '@/lib/services/classService';
import { getMyTickets } from '@/lib/services/goHallTicketService';
import { getPointBalances } from '@/lib/services/pointService';
import { listEnrollments } from '@/lib/services/tutoringProgramService';
import Card from '@/components/ui/Card';
import NotificationSetupCard from '@/components/NotificationSetupCard';
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import LeaveHistoryTable from './LeaveHistoryTable';
import GoHallQualificationCard from './GoHallQualificationCard';
import ClassesAndTutoringList from './ClassesAndTutoringList';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every student until the next deploy.
export const dynamic = 'force-dynamic';

export default async function StudentDashboard() {
  const session = await getServerSession(authOptions);
  const student = session ? await prisma.student.findUnique({ where: { userId: session.user.id } }) : null;
  const [leaves, myRegistrations, myClasses, tickets, tutoringEnrollments, showLeave] = student
    ? await Promise.all([
        listLeaveRequestsForStudent(student.id),
        listRegistrationsForStudent(student.id),
        listStudentEnrolledClasses(student.id),
        getMyTickets(student.id),
        listEnrollments(student.id),
        hasActiveClassEnrollment(student.id),
      ])
    : [[], [], [], { balance: 0, activePassEndDate: null }, [], false];
  const balances = student ? await getPointBalances(student.id) : { regular: 0, redeemOnly: 0 };

  const goHallRows = myRegistrations.map((r) => ({
    id: r.id,
    date: r.session.date,
    capacity: r.session.capacity,
    registeredCount: r.session._count.registrations,
  }));

  const activeTutoring = tutoringEnrollments.filter((e) => e.active);

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>
      <NotificationSetupCard />

      <h2 className="mb-2 font-bold text-ink">票券管理</h2>
      <Card className="mb-6">
        <div className="grid gap-5 sm:grid-cols-[1fr_1px_230px]">
          <div>
            <p className="mb-1 text-xs font-semibold text-inkMuted">課堂</p>
            <ClassesAndTutoringList myClasses={myClasses} activeTutoring={activeTutoring} />
          </div>
          <div className="hidden bg-borderSubtle sm:block" />
          <GoHallQualificationCard tickets={tickets} />
        </div>
      </Card>

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

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {showLeave && (
          <>
            <Link href="/student/leave-request">
              <Card className="text-ink transition-shadow hover:shadow-md">請假申請與紀錄</Card>
            </Link>
            <Link href="/student/makeup-request">
              <Card className="text-ink transition-shadow hover:shadow-md">申請補課</Card>
            </Link>
          </>
        )}
        <Link href="/student/attendance">
          <Card className="text-ink transition-shadow hover:shadow-md">我的出席紀錄</Card>
        </Link>
      </div>

      {showLeave && (
        <>
          <h2 className="mb-2 font-bold text-ink">我的請假與插班紀錄</h2>
          <Card>
            <LeaveHistoryTable rows={leaves} />
          </Card>
        </>
      )}

      {showLeave && (
        <>
          <h2 className="mb-2 mt-6 font-bold text-ink">弈廳報名紀錄</h2>
          <GoHallSummaryTable rows={goHallRows} basePath="/student/go-hall" />
        </>
      )}
    </>
  );
}
