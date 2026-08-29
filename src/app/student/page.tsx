import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listLeaveRequestsForStudent } from '@/lib/services/leaveRequestService';
import { listRegistrationsForStudent } from '@/lib/services/goHallService';
import { hasActiveClassEnrollment, listStudentEnrolledClasses } from '@/lib/services/classService';
import { getMyTickets } from '@/lib/services/goHallTicketService';
import { getPendingBillSummaryForStudent } from '@/lib/services/billPaymentService';
import { getPointBalances } from '@/lib/services/pointService';
import { listEnrollments } from '@/lib/services/tutoringProgramService';
import Card from '@/components/ui/Card';
import NotificationSetupCard from '@/components/NotificationSetupCard';
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import LeaveHistoryTable from './LeaveHistoryTable';
import GoHallQualificationCard from './GoHallQualificationCard';
import ClassesAndTutoringList from './ClassesAndTutoringList';
import { LeaveIcon, MakeupIcon, AttendanceIcon, ChevronRightIcon } from './NavIcons';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every student until the next deploy.
export const dynamic = 'force-dynamic';

export default async function StudentDashboard() {
  const session = await getServerSession(authOptions);
  const student = session ? await prisma.student.findUnique({ where: { userId: session.user.id } }) : null;
  const [leaves, myRegistrations, myClasses, tickets, tutoringEnrollments, showLeave, billSummary] = student
    ? await Promise.all([
        listLeaveRequestsForStudent(student.id),
        listRegistrationsForStudent(student.id),
        listStudentEnrolledClasses(student.id),
        getMyTickets(student.id),
        listEnrollments(student.id),
        hasActiveClassEnrollment(student.id),
        getPendingBillSummaryForStudent(student.id),
      ])
    : [[], [], [], { balance: 0, activePassEndDate: null }, [], false, { outstanding: 0, count: 0 }];
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
        <div className={showLeave ? 'grid gap-5 sm:grid-cols-[1fr_1px_230px]' : undefined}>
          <div>
            <p className="mb-1 text-xs font-semibold text-inkMuted">課堂</p>
            <ClassesAndTutoringList myClasses={myClasses} activeTutoring={activeTutoring} />
          </div>
          {showLeave && (
            <>
              <div className="hidden bg-borderSubtle sm:block" />
              <GoHallQualificationCard tickets={tickets} />
            </>
          )}
        </div>
      </Card>

      {/* 待繳帳單摘要：手足合併金額（跟繳費頁同一套邏輯），繳清也保留卡片讓家長安心 */}
      <Link href="/student/billing">
        <Card className="mb-6 transition-shadow hover:shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm text-inkMuted">待繳帳單</p>
              {billSummary.count > 0 ? (
                <p className="mt-1 text-2xl font-bold text-rejected">{billSummary.outstanding.toLocaleString('en-US')} 元</p>
              ) : (
                <p className="mt-1 text-sm text-ink">目前沒有待繳帳單</p>
              )}
            </div>
            {billSummary.count > 0 ? (
              <p className="text-sm text-inkMuted">共 {billSummary.count} 筆</p>
            ) : (
              <span className="inline-block whitespace-nowrap rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">
                繳清
              </span>
            )}
          </div>
        </Card>
      </Link>

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

      <div className="mb-6 divide-y divide-borderSubtle overflow-hidden rounded-xl bg-card shadow-sm">
        {showLeave && (
          <>
            <Link href="/student/leave-request" className="flex items-center gap-3 px-5 py-4 text-ink hover:bg-stripe">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brandDark">
                <LeaveIcon className="h-5 w-5" />
              </span>
              <span className="flex-1 text-sm font-semibold">請假申請與紀錄</span>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-inkMuted" />
            </Link>
            <Link href="/student/makeup-request" className="flex items-center gap-3 px-5 py-4 text-ink hover:bg-stripe">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brandDark">
                <MakeupIcon className="h-5 w-5" />
              </span>
              <span className="flex-1 text-sm font-semibold">申請補課</span>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-inkMuted" />
            </Link>
          </>
        )}
        <Link href="/student/attendance" className="flex items-center gap-3 px-5 py-4 text-ink hover:bg-stripe">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brandDark">
            <AttendanceIcon className="h-5 w-5" />
          </span>
          <span className="flex-1 text-sm font-semibold">我的出席紀錄</span>
          <ChevronRightIcon className="h-4 w-4 shrink-0 text-inkMuted" />
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
