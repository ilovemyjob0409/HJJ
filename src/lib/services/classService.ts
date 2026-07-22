import { prisma } from '@/lib/db';

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

export function listClasses() {
  return prisma.class.findMany({
    select: CLASS_WITH_TEACHER_SELECT,
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
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

export async function setStudentEnrollments(studentId: string, classIds: string[]) {
  const current = await prisma.classEnrollment.findMany({ where: { studentId }, select: { classId: true } });
  const currentIds = new Set(current.map((e) => e.classId));
  const desiredIds = new Set(classIds);

  const toAdd = Array.from(desiredIds).filter((id) => !currentIds.has(id));
  const toRemove = Array.from(currentIds).filter((id) => !desiredIds.has(id));

  await prisma.$transaction([
    ...(toRemove.length > 0 ? [prisma.classEnrollment.deleteMany({ where: { studentId, classId: { in: toRemove } } })] : []),
    ...toAdd.map((classId) => prisma.classEnrollment.create({ data: { studentId, classId } })),
  ]);
}

export function unenrollStudent(classId: string, studentId: string) {
  return prisma.classEnrollment.delete({ where: { studentId_classId: { studentId, classId } } });
}

export function listStudentEnrolledClasses(studentId: string) {
  return prisma.class.findMany({
    where: { enrollments: { some: { studentId } } },
    select: CLASS_BOOKING_SELECT,
    orderBy: { name: 'asc' },
  });
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
