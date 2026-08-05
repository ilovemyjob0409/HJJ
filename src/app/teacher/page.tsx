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
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import AttendanceHub from '@/components/AttendanceHub';
import TeacherClassList from '@/components/TeacherClassList';
import AssignmentsTable, { AssignmentRow } from '@/components/AssignmentsTable';
import TeacherLeaveTable from './TeacherLeaveTable';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every teacher until the next deploy.
export const dynamic = 'force-dynamic';

// 合併「我的學生請假」與「別班插班進我班」兩種方向，用 direction 欄位區分：
// MY_STUDENT 的原班級是我自己的班（學生從這裡請假）；INCOMING 的原班級是
// 學生的本班（別班，插班進我班補課）。操作（撤銷請假）只對我自己的學生開放。
interface TeacherLeaveRow {
  id: string;
  direction: 'MY_STUDENT' | 'INCOMING';
  studentName: string;
  originClassName: string;
  date: Date;
  makeupDate: Date | null;
  makeupType: 'INSERTION' | 'ONE_ON_ONE' | null;
  destinationClassName: string | null;
  teacherName: string | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
  status: string | null;
  makeupRequestId: string | null;
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

  const teacherLeaveRows: TeacherLeaveRow[] = [
    ...leaves.map((r) => {
      const m = r.makeupRequest;
      return {
        id: r.id,
        direction: 'MY_STUDENT' as const,
        studentName: r.student.user.name,
        originClassName: r.class.name,
        date: r.date,
        makeupDate: m ? (m.type === 'INSERTION' ? m.targetDate : m.slotDate) : null,
        makeupType: m?.type ?? null,
        destinationClassName: m?.type === 'INSERTION' ? (m.targetClass?.name ?? null) : null,
        teacherName: m?.type === 'ONE_ON_ONE' ? (m.teacher?.user.name ?? null) : null,
        slotStartTime: m?.type === 'ONE_ON_ONE' ? m.slotStartTime : null,
        slotEndTime: m?.type === 'ONE_ON_ONE' ? m.slotEndTime : null,
        status: m?.status ?? null,
        makeupRequestId: m?.id ?? null,
      };
    }),
    ...insertions.map((r) => ({
      id: r.id,
      direction: 'INCOMING' as const,
      studentName: r.leaveRequest.student.user.name,
      originClassName: r.leaveRequest.class.name,
      date: r.leaveRequest.date,
      makeupDate: r.targetDate,
      makeupType: 'INSERTION' as const,
      destinationClassName: r.targetClass?.name ?? null,
      teacherName: null,
      slotStartTime: null,
      slotEndTime: null,
      status: r.status,
      makeupRequestId: null,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

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

      <h2 className="mb-2 font-bold text-ink">學生請假與補課紀錄</h2>
      <Card>
        <TeacherLeaveTable rows={teacherLeaveRows} />
      </Card>

      <h2 className="mb-2 mt-6 font-bold text-ink">弈廳管理</h2>
      <GoHallSummaryTable rows={goHallRows} basePath="/teacher/go-hall" />
    </>
  );
}
