import { prisma } from '@/lib/db';
import { getClassEnrollmentQuota } from './attendanceService';
import { taipeiDateKey, utcDateKey } from './tutoringBookingService';

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
    where: { active: true },
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
    select: { studentId: true, totalSessions: true, student: { select: { user: { select: { name: true } } } } },
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
// 不帶老師/家長聯絡資訊；quota 語意同 getClassEnrollmentQuota（請假、未報名不扣堂），
// 但改用一次 groupBy（同 listClassQuotaSummaries 的批次寫法）算完所有班級所有學生的
// usedSessions，避免每位學生各發一次查詢（N+1）。
export async function listClassesForTeacher(teacherId: string): Promise<TeacherClassSummary[]> {
  const classes = await prisma.class.findMany({
    where: { teacherId, active: true },
    select: TEACHER_CLASS_SELECT,
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
  const classIds = classes.map((c) => c.id);
  const counts = classIds.length === 0 ? [] : await prisma.classAttendance.groupBy({
    by: ['classId', 'studentId'],
    // 請假與未報名（報名時聲明不來、未繳該堂費用）都不扣堂。
    where: { classId: { in: classIds }, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } },
    _count: { _all: true },
  });
  const usedByKey = new Map(counts.map((c) => [`${c.classId}:${c.studentId}`, c._count._all]));

  return classes.map((c) => ({
    id: c.id,
    name: c.name,
    weekday: c.weekday,
    startTime: c.startTime,
    endTime: c.endTime,
    students: c.enrollments.map((e) => {
      const usedSessions = usedByKey.get(`${c.id}:${e.studentId}`) ?? 0;
      const { totalSessions } = e;
      return {
        studentId: e.studentId,
        name: e.student.user.name,
        totalSessions,
        usedSessions,
        remaining: totalSessions === null ? null : totalSessions - usedSessions,
      };
    }),
  }));
}

// See CLASS_BOOKING_SELECT above — used by the STUDENT/TEACHER branch of
// GET /api/classes so the class-picker dropdowns never receive teacher
// phone/email. ADMIN keeps the full listClasses() projection.
export function listClassesForBooking() {
  return prisma.class.findMany({
    where: { active: true },
    select: CLASS_BOOKING_SELECT,
    orderBy: { name: 'asc' },
  });
}

export function listClassesBySubjectAndLevel(subject: string, level: string, excludeClassId?: string) {
  return prisma.class.findMany({
    where: {
      subject,
      level,
      active: true,
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

export async function setStudentEnrollments(studentId: string, enrollments: EnrollmentInput[], now: Date = new Date()) {
  const current = await prisma.classEnrollment.findMany({ where: { studentId }, select: { classId: true, totalSessions: true } });
  const currentByClassId = new Map(current.map((e) => [e.classId, e.totalSessions]));
  const currentIds = new Set(current.map((e) => e.classId));
  const desiredIds = new Set(enrollments.map((e) => e.classId));

  const toAdd = enrollments.filter((e) => !currentIds.has(e.classId));
  const toRemove = Array.from(currentIds).filter((id) => !desiredIds.has(id));
  const toUpdate = enrollments.filter((e) => currentIds.has(e.classId));

  // 退班同時抽離該班「今天（含）以後」的點名紀錄：學生端不再看到未來
  // 場次、重新報名時也不會被舊點名灌堂數。過去的出席歷史保留備查。
  // "今天"以台北曆日為準（見 isBeforeToday 註解）：正式站伺服器是 UTC，
  // 若改用伺服器當地午夜，台北 00:00–07:59 這段會把邊界算早一天，連帶
  // 把台北昨天「已經記錄」的出席紀錄也一起刪掉。
  const [y, m, d] = taipeiDateKey(now).split('-').map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));

  await prisma.$transaction([
    ...(toRemove.length > 0
      ? [
          prisma.classAttendance.deleteMany({
            where: { studentId, classId: { in: toRemove }, date: { gte: today } },
          }),
          prisma.classEnrollment.deleteMany({ where: { studentId, classId: { in: toRemove } } }),
        ]
      : []),
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
          // push warning get a spurious duplicate one on the next check-in.
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

// 「未報名」日期的獨立調整（不綁續報）：只管「今天（台北）起」的未來日期，
// 過去的點名是歷史紀錄，這裡不碰。
export async function listNotRegisteredDates(classId: string, studentId: string): Promise<Date[]> {
  await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } } });
  const todayKey = taipeiDateKey(new Date());
  const rows = await prisma.classAttendance.findMany({
    where: { classId, studentId, status: 'NOT_REGISTERED' },
    select: { date: true },
    orderBy: { date: 'asc' },
  });
  return rows.map((r) => r.date).filter((d) => utcDateKey(d) >= todayKey);
}

// 把「今天（台北）起」的未報名標記同步成 dates 給的集合：新勾的日期 upsert 成
// NOT_REGISTERED（與續報流程同語意，既有其他狀態會被覆蓋——行政明確點了就是
// 要標）；原本標了但這次沒勾的，只刪 status 仍是 NOT_REGISTERED 的列，其他狀
// 態（例如後來真的到場被點名）不動。
export async function setNotRegisteredDates(classId: string, studentId: string, dates: Date[], markedById: string) {
  await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } } });
  const cls = await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { weekday: true } });
  const todayKey = taipeiDateKey(new Date());
  for (const date of dates) {
    // 日期由 date-only 字串解析為 UTC 午夜，取 UTC 星期幾（同點名慣例）。
    if (date.getUTCDay() !== cls.weekday) throw new Error('INVALID_DATE');
    if (utcDateKey(date) < todayKey) throw new Error('INVALID_DATE');
  }

  const targetKeys = new Set(dates.map((d) => utcDateKey(d)));
  const existing = await prisma.classAttendance.findMany({
    where: { classId, studentId, status: 'NOT_REGISTERED' },
    select: { id: true, date: true },
  });
  const toRemove = existing.filter((r) => utcDateKey(r.date) >= todayKey && !targetKeys.has(utcDateKey(r.date)));

  await prisma.$transaction([
    ...(toRemove.length > 0 ? [prisma.classAttendance.deleteMany({ where: { id: { in: toRemove.map((r) => r.id) } } })] : []),
    ...dates.map((date) =>
      prisma.classAttendance.upsert({
        where: { classId_studentId_date: { classId, studentId, date } },
        update: { status: 'NOT_REGISTERED', checkInTime: null, checkOutTime: null, markedById },
        create: { classId, studentId, date, status: 'NOT_REGISTERED', markedById },
      })
    ),
  ]);
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
  const classIds = classes.map((c) => c.id);
  // 一次撈齊報名列與扣堂數、JS 端組回——查詢量從每班 2 個降為共 2 個。
  // 扣堂語意同 getClassEnrollmentQuota：請假、未報名不扣。
  const [enrollments, usedCounts] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { studentId, classId: { in: classIds } },
      select: { classId: true, totalSessions: true },
    }),
    prisma.classAttendance.groupBy({
      by: ['classId'],
      where: { studentId, classId: { in: classIds }, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } },
      _count: { _all: true },
    }),
  ]);
  const totalByClass = new Map(enrollments.map((e) => [e.classId, e.totalSessions]));
  const usedByClass = new Map(usedCounts.map((g) => [g.classId, g._count._all]));
  return classes.map((c) => {
    const totalSessions = totalByClass.get(c.id) ?? null;
    const usedSessions = usedByClass.get(c.id) ?? 0;
    return {
      ...c,
      quota: { totalSessions, usedSessions, remaining: totalSessions === null ? null : totalSessions - usedSessions },
    };
  });
}

// Soft-deletes: leave-request, substitute-request, and attendance history
// must survive, so the Class row itself is never hard-deleted — it's just
// flagged inactive and drops out of every forward-looking list (timetable,
// class pickers, attendance-taking, teacher's "帶班班級"). Enrollments are
// current state, not history, so they're cleared. Any makeup request that
// targets this class (an optional reference) keeps its own row but loses
// the target-class link.
export async function deleteClass(id: string) {
  await prisma.$transaction([
    prisma.classEnrollment.deleteMany({ where: { classId: id } }),
    prisma.makeupRequest.updateMany({ where: { targetClassId: id }, data: { targetClassId: null } }),
    prisma.class.update({ where: { id }, data: { active: false } }),
  ]);
}
