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
  const current = await prisma.classEnrollment.findMany({ where: { studentId }, select: { classId: true } });
  const currentIds = new Set(current.map((e) => e.classId));
  const desiredIds = new Set(enrollments.map((e) => e.classId));

  const toAdd = enrollments.filter((e) => !currentIds.has(e.classId));
  const toRemove = Array.from(currentIds).filter((id) => !desiredIds.has(id));
  const toUpdate = enrollments.filter((e) => currentIds.has(e.classId));

  await prisma.$transaction([
    ...(toRemove.length > 0 ? [prisma.classEnrollment.deleteMany({ where: { studentId, classId: { in: toRemove } } })] : []),
    ...toAdd.map((e) => prisma.classEnrollment.create({ data: { studentId, classId: e.classId, totalSessions: e.totalSessions } })),
    ...toUpdate.map((e) =>
      prisma.classEnrollment.update({
        where: { studentId_classId: { studentId, classId: e.classId } },
        data: { totalSessions: e.totalSessions },
      })
    ),
  ]);
}

export async function addEnrollmentSessions(classId: string, studentId: string, amount: number) {
  const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } } });
  return prisma.classEnrollment.update({
    where: { studentId_classId: { studentId, classId } },
    data: { totalSessions: (enrollment.totalSessions ?? 0) + amount },
  });
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
