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
  enrollments: true,
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

export function listClasses() {
  return prisma.class.findMany({
    select: CLASS_WITH_TEACHER_SELECT,
    orderBy: { name: 'asc' },
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
