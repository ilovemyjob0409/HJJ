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

export function createClass(input: CreateClassInput) {
  return prisma.class.create({ data: input });
}

export function listClasses() {
  return prisma.class.findMany({
    select: CLASS_WITH_TEACHER_SELECT,
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
    select: CLASS_WITH_TEACHER_SELECT,
    orderBy: { name: 'asc' },
  });
}

export function enrollStudent(classId: string, studentId: string) {
  return prisma.classEnrollment.create({ data: { classId, studentId } });
}
