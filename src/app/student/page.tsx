import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listLeaveRequestsForStudent } from '@/lib/services/leaveRequestService';
import { listRegistrationsForStudent } from '@/lib/services/goHallService';
import { listStudentEnrolledClasses } from '@/lib/services/classService';
import { getMyTickets } from '@/lib/services/goHallTicketService';
import { getPointBalances } from '@/lib/services/pointService';
import { listEnrollments } from '@/lib/services/tutoringProgramService';
import Card from '@/components/ui/Card';
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import LeaveHistoryTable from './LeaveHistoryTable';
import { formatDateWithWeekday, WEEKDAY_LABELS } from '@/lib/dateFormat';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every student until the next deploy.
export const dynamic = 'force-dynamic';

export default async function StudentDashboard() {
  const session = await getServerSession(authOptions);
  const student = session ? await prisma.student.findUnique({ where: { userId: session.user.id } }) : null;
  const [leaves, myRegistrations, myClasses, tickets, tutoringEnrollments] = student
    ? await Promise.all([
        listLeaveRequestsForStudent(student.id),
        listRegistrationsForStudent(student.id),
        listStudentEnrolledClasses(student.id),
        getMyTickets(student.id),
        listEnrollments(student.id),
      ])
    : [[], [], [], { balance: 0, activePassEndDate: null }, []];
  const balances = student ? await getPointBalances(student.id) : { regular: 0, redeemOnly: 0 };

  const goHallRows = myRegistrations.map((r) => ({
    id: r.id,
    date: r.session.date,
    capacity: r.session.capacity,
    registeredCount: r.session._count.registrations,
  }));

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>

      <h2 className="mb-2 font-bold text-ink">票券管理</h2>
      <Card className="mb-6">
        <div className="grid gap-5 sm:grid-cols-[1fr_1px_230px]">
          <div>
            <p className="mb-1 text-xs font-semibold text-inkMuted">課堂</p>
            {myClasses.length === 0 ? (
              <p className="py-2 text-sm text-inkMuted">尚未報名任何課堂</p>
            ) : (
              myClasses.map((c, i) => (
                <div key={c.id} className={`flex flex-col gap-1.5 py-2.5 ${i > 0 ? 'border-t border-borderSubtle' : ''}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-semibold text-ink">{c.name}</span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-inkMuted">
                      {c.quota.remaining !== null ? (
                        <>
                          <span className="font-semibold text-ink">{c.quota.usedSessions}</span>／{c.quota.totalSessions} 堂
                        </>
                      ) : (
                        <>
                          <span className="font-semibold text-ink">{c.quota.usedSessions}</span> 堂・未設定
                        </>
                      )}
                    </span>
                  </div>
                  <p className="text-xs text-inkMuted">
                    每週{WEEKDAY_LABELS[c.weekday]} {c.startTime}-{c.endTime}・{c.teacher.user.name}
                  </p>
                  {c.quota.totalSessions !== null && c.quota.totalSessions > 0 && (
                    <div className="h-1 overflow-hidden rounded-full bg-stripe">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${Math.min(100, (c.quota.usedSessions / c.quota.totalSessions) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="hidden bg-borderSubtle sm:block" />
          <div className="flex flex-col gap-2 border-t border-borderSubtle pt-4 sm:border-t-0 sm:pt-0">
            <p className="text-xs font-semibold text-inkMuted">弈廳資格</p>
            {tickets.activePassEndDate ? (
              <>
                <span className="self-start rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">季票使用中</span>
                <p className="text-xs text-inkMuted">有效期至 {formatDateWithWeekday(tickets.activePassEndDate, 'zh-TW')}</p>
                {tickets.balance > 0 && <p className="text-xs text-inkMuted">另有堂票 {tickets.balance} 堂（季票期間不扣）</p>}
              </>
            ) : tickets.balance > 0 ? (
              <>
                <p className="text-sm text-ink">
                  <span className="text-2xl font-bold tabular-nums">{tickets.balance}</span> 堂票剩餘
                </p>
                <p className="text-xs text-inkMuted">點名到場自動扣 1 堂・缺席不扣</p>
              </>
            ) : (
              <>
                <span className="self-start rounded-full bg-pendingBg px-3 py-1 text-xs font-semibold text-pending">單堂計費</span>
                <p className="text-xs text-inkMuted">現場收費</p>
              </>
            )}
          </div>
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

      {tutoringEnrollments.filter((e) => e.active).length > 0 && (
        <Link href="/student/tutoring">
          <Card className="mb-6 transition-shadow hover:shadow-md">
            <p className="mb-2 text-sm text-inkMuted">個別輔導</p>
            {tutoringEnrollments
              .filter((e) => e.active)
              .map((e, i) => (
                <div key={e.id} className={`flex items-center justify-between gap-3 py-1.5 ${i > 0 ? 'border-t border-borderSubtle' : ''}`}>
                  <span className="text-sm font-semibold text-ink">{e.programName}</span>
                  <span className="text-xs tabular-nums text-inkMuted">
                    本月 <span className="font-semibold text-ink">{e.locked}</span>／{e.monthlyQuota} 堂
                  </span>
                </div>
              ))}
          </Card>
        </Link>
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

      <h2 className="mb-2 font-bold text-ink">我的請假與插班紀錄</h2>
      <Card>
        <LeaveHistoryTable rows={leaves} />
      </Card>

      <h2 className="mb-2 mt-6 font-bold text-ink">弈廳報名紀錄</h2>
      <GoHallSummaryTable rows={goHallRows} basePath="/student/go-hall" />
    </>
  );
}
