import { prisma } from '@/lib/db';
import { getClassEnrollmentQuota } from './attendanceService';

export interface CreateClassInput {
  name: string;
  subject: string;
  level: string;
  teacherId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

const SAFE_USER_SELECT = { name: true, email: true } as const;
const CLASS_WITH_TEACHER_SELECT = {
  id: true,
  name: true,
  subject: true,
  level: true,
  weekday: true,
  startTime: true,
  endTime: true,
  teacher: { select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } } },
  enrollments: {
    select: { id: true, studentId: true, student: { select: { user: { select: { name: true } } } } },
    orderBy: { student: { user: { name: 'asc' } } },
  },
} as const;

// Narrower field set for students/teachers picking a class for a leave or
// makeup request (see src/app/student/leave-request/page.tsx,
// src/app/teacher/leave-request/page.tsx and
// src/app/student/makeup-request/page.tsx) — no teacher phone or email.
const CLASS_BOOKING_SELECT = {
  id: true,
  name: true,
  subject: true,
  level: true,
  weekday: true,
  startTime: true,
  endTime: true,
  teacher: { select: { id: true, subjects: true, user: { select: { name: true } } } },
  enrollments: true,
} as const;

export function createClass(input: CreateClassInput) {
  return prisma.class.create({ data: input });
}

export interface UpdateClassInput {
  name?: string;
  subject?: string;
  level?: string;
  teacherId?: string;
  weekday?: number;
  startTime?: string;
  endTime?: string;
}

export function updateClass(id: string, input: UpdateClassInput) {
  return prisma.class.update({
    where: { id },
    data: input,
    select: CLASS_WITH_TEACHER_SELECT,
  });
}

// Fixed block order for the admin class list — 圍棋 is the core offering
// and comes first, with any subject not in this list falling after the
// three known ones (still grouped together, in whatever order the DB
// query already produced).
const SUBJECT_ORDER = ['圍棋', '英文', '數學'];

export async function listClasses() {
  const classes = await prisma.class.findMany({
    select: CLASS_WITH_TEACHER_SELECT,
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
  const enriched = await Promise.all(
    classes.map(async (c) => ({
      ...c,
      enrollments: await Promise.all(
        c.enrollments.map(async (e) => ({ ...e, ...(await getClassEnrollmentQuota(c.id, e.studentId)) }))
      ),
    }))
  );
  return enriched.sort((a, b) => {
    const rank = (subject: string) => {
      const i = SUBJECT_ORDER.indexOf(subject);
      return i === -1 ? SUBJECT_ORDER.length : i;
    };
    return rank(a.subject) - rank(b.subject);
  });
}

const TEACHER_CLASS_SELECT = {
  id: true,
  name: true,
  weekday: true,
  startTime: true,
  endTime: true,
  enrollments: {
    select: { studentId: true, student: { select: { user: { select: { name: true } } } } },
    orderBy: { student: { user: { name: 'asc' } } },
  },
} as const;

export interface TeacherClassStudent {
  studentId: string;
  name: string;
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
}

export interface TeacherClassSummary {
  id: string;
  name: string;
  weekday: number;
  startTime: string;
  endTime: string;
  students: TeacherClassStudent[];
}

// 老師首頁「我的帶班班級」：自己的班＋每位學生的堂數進度。
// 不帶老師/家長聯絡資訊；quota 語意同 getClassEnrollmentQuota（請假、未報名不扣堂）。
export async function listClassesForTeacher(teacherId: string): Promise<TeacherClassSummary[]> {
  const classes = await prisma.class.findMany({
    where: { teacherId },
    select: TEACHER_CLASS_SELECT,
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
  return Promise.all(
    classes.map(async (c) => ({
      id: c.id,
      name: c.name,
      weekday: c.weekday,
      startTime: c.startTime,
      endTime: c.endTime,
      students: await Promise.all(
        c.enrollments.map(async (e) => ({
          studentId: e.studentId,
          name: e.student.user.name,
          ...(await getClassEnrollmentQuota(c.id, e.studentId)),
        }))
      ),
    }))
  );
}

// See CLASS_BOOKING_SELECT above — used by the STUDENT/TEACHER branch of
// GET /api/classes so the class-picker dropdowns never receive teacher
// phone/email. ADMIN keeps the full listClasses() projection.
export function listClassesForBooking() {
  return prisma.class.findMany({
    select: CLASS_BOOKING_SELECT,
    orderBy: { name: 'asc' },
  });
}

export function listClassesBySubjectAndLevel(subject: string, level: string, excludeClassId?: string) {
  return prisma.class.findMany({
    where: {
      subject,
      level,
      ...(excludeClassId ? { id: { not: excludeClassId } } : {}),
    },
    // Only ever called from the student-facing makeup-request eligible-class
    // lookup (src/app/api/makeup-requests/route.ts), so use the narrow,
    // phone/email-free projection.
    select: CLASS_BOOKING_SELECT,
    orderBy: { name: 'asc' },
  });
}

export function enrollStudent(classId: string, studentId: string) {
  return prisma.classEnrollment.create({ data: { classId, studentId } });
}

export interface EnrollmentInput {
  classId: string;
  totalSessions: number | null;
}

export async function setStudentEnrollments(studentId: string, enrollments: EnrollmentInput[]) {
  const current = await prisma.classEnrollment.findMany({ where: { studentId }, select: { classId: true, totalSessions: true } });
  const currentByClassId = new Map(current.map((e) => [e.classId, e.totalSessions]));
  const currentIds = new Set(current.map((e) => e.classId));
  const desiredIds = new Set(enrollments.map((e) => e.classId));

  const toAdd = enrollments.filter((e) => !currentIds.has(e.classId));
  const toRemove = Array.from(currentIds).filter((id) => !desiredIds.has(id));
  const toUpdate = enrollments.filter((e) => currentIds.has(e.classId));

  await prisma.$transaction([
    ...(toRemove.length > 0 ? [prisma.classEnrollment.deleteMany({ where: { studentId, classId: { in: toRemove } } })] : []),
    ...toAdd.map((e) =>
      prisma.classEnrollment.create({
        data: {
          studentId,
          classId: e.classId,
          totalSessions: e.totalSessions,
          // 首次報名且有堂數＝第一期。之後的期由「新增一期」
          // (addEnrollmentSessions) 建立；直接改 totalSessions 是校正，不建期。
          ...(e.totalSessions !== null ? { periods: { create: { sessions: e.totalSessions } } } : {}),
        },
      })
    ),
    ...toUpdate.map((e) =>
      prisma.classEnrollment.update({
        where: { studentId_classId: { studentId, classId: e.classId } },
        data: {
          totalSessions: e.totalSessions,
          // Only clear the "already notified" flag when totalSessions actually
          // changed (a real top-up). The admin edit form resubmits every
          // enrolled class's totalSessions verbatim on every save (even when
          // editing an unrelated field like phone number), so resetting this
          // unconditionally would let a parent who already got the low-quota
          // LINE warning get a spurious duplicate one on the next check-in.
          ...(e.totalSessions !== currentByClassId.get(e.classId) ? { lowQuotaNotifiedAt: null } : {}),
        },
      })
    ),
  ]);
}

// Uses a raw atomic UPDATE instead of read-then-write: two concurrent calls
// (two admins, or a double-click) must both land, not race on a stale read
// of totalSessions. Prisma's `{ increment }` can't be used here because the
// column is nullable and `NULL + n` stays `NULL` in SQL — COALESCE handles
// that in a single statement. Values are bound via Prisma's tagged-template
// parameterization, never string-concatenated.
// 「續報」：累加堂數並建立一筆期紀錄（同一交易）。期紀錄是
// 圍棋班一對一補課額度的重置點（見 makeupRequestService）。
// notRegisteredDates：續報時就聲明不出席的上課日，預先寫入
// NOT_REGISTERED 點名紀錄（不扣堂），行政不用再到未來的點名改狀態。
export async function addEnrollmentSessions(
  classId: string,
  studentId: string,
  amount: number,
  options?: { notRegisteredDates?: Date[]; markedById?: string }
) {
  const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } } });
  const dates = options?.notRegisteredDates ?? [];
  const markedById = options?.markedById;
  if (dates.length > 0) {
    if (!markedById) throw new Error('MARKER_REQUIRED');
    const cls = await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { weekday: true } });
    for (const date of dates) {
      // 日期由 date-only 字串解析為 UTC 午夜，取 UTC 星期幾（同點名慣例）。
      if (date.getUTCDay() !== cls.weekday) throw new Error('INVALID_DATE');
    }
  }
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE "ClassEnrollment" SET "totalSessions" = COALESCE("totalSessions", 0) + ${amount} WHERE "id" = ${enrollment.id}`,
    prisma.enrollmentPeriod.create({ data: { enrollmentId: enrollment.id, sessions: amount } }),
    ...dates.map((date) =>
      prisma.classAttendance.upsert({
        where: { classId_studentId_date: { classId, studentId, date } },
        update: { status: 'NOT_REGISTERED', markedById: markedById! },
        create: { classId, studentId, date, status: 'NOT_REGISTERED', markedById: markedById! },
      })
    ),
  ]);
  return prisma.classEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
}

export function unenrollStudent(classId: string, studentId: string) {
  return prisma.classEnrollment.delete({ where: { studentId_classId: { studentId, classId } } });
}

export async function listStudentEnrolledClasses(studentId: string) {
  const classes = await prisma.class.findMany({
    where: { enrollments: { some: { studentId } } },
    select: CLASS_BOOKING_SELECT,
    orderBy: { name: 'asc' },
  });
  return Promise.all(classes.map(async (c) => ({ ...c, quota: await getClassEnrollmentQuota(c.id, studentId) })));
}

// Blocks deletion when the class has leave-request or substitute-request
// history — those are records and must survive. Enrollments are current
// state, not history, so they're cleared as part of the delete. Any
// makeup request that targets this class (an optional reference) keeps
// its own row but loses the target-class link.
export async function deleteClass(id: string) {
  const [leaveRequestCount, substituteRequestCount] = await Promise.all([
    prisma.leaveRequest.count({ where: { classId: id } }),
    prisma.substituteRequest.count({ where: { classId: id } }),
  ]);
  if (leaveRequestCount > 0 || substituteRequestCount > 0) {
    throw new Error('CLASS_HAS_RECORDS');
  }

  await prisma.$transaction([
    prisma.classEnrollment.deleteMany({ where: { classId: id } }),
    prisma.makeupRequest.updateMany({ where: { targetClassId: id }, data: { targetClassId: null } }),
    prisma.class.delete({ where: { id } }),
  ]);
}
