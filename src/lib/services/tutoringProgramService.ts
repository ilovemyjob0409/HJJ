import { prisma } from '@/lib/db';
import { getMonthlyQuotaStatus } from './tutoringBookingService';

export interface CreateProgramInput {
  name: string;
  defaultMonthlyQuota?: number;
  defaultDurationMinutes?: number;
}

export function createProgram(input: CreateProgramInput) {
  return prisma.tutoringProgram.create({
    data: {
      name: input.name,
      defaultMonthlyQuota: input.defaultMonthlyQuota ?? 8,
      defaultDurationMinutes: input.defaultDurationMinutes ?? 120,
    },
  });
}

export function listPrograms() {
  return prisma.tutoringProgram.findMany({
    include: { windows: { include: { teacher: { select: { user: { select: { name: true } } } }, closures: true } } },
    orderBy: { name: 'asc' },
  });
}

export interface UpdateProgramInput {
  name?: string;
  defaultMonthlyQuota?: number;
  defaultDurationMinutes?: number;
  active?: boolean;
}

export function updateProgram(id: string, input: UpdateProgramInput) {
  return prisma.tutoringProgram.update({ where: { id }, data: input });
}

export function deleteProgram(id: string) {
  return prisma.tutoringProgram.delete({ where: { id } });
}

export interface CreateWindowInput {
  programId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  teacherId: string;
}

export function createWindow(input: CreateWindowInput) {
  return prisma.tutoringWindow.create({ data: input });
}

export interface UpdateWindowInput {
  weekday?: number;
  startTime?: string;
  endTime?: string;
  capacity?: number;
  teacherId?: string;
  active?: boolean;
}

export function updateWindow(id: string, input: UpdateWindowInput) {
  return prisma.tutoringWindow.update({ where: { id }, data: input });
}

export function deleteWindow(id: string) {
  return prisma.tutoringWindow.delete({ where: { id } });
}

export function addWindowClosure(windowId: string, date: Date) {
  return prisma.tutoringWindowClosure.create({ data: { windowId, date } });
}

export function deleteWindowClosure(id: string) {
  return prisma.tutoringWindowClosure.delete({ where: { id } });
}

export interface CreateEnrollmentInput {
  studentId: string;
  programId: string;
  monthlyQuota?: number;
}

export function createEnrollment(input: CreateEnrollmentInput) {
  return prisma.tutoringEnrollment.create({ data: input });
}

export interface EnrollmentSummary {
  id: string;
  studentId: string;
  studentName: string;
  programId: string;
  programName: string;
  defaultDurationMinutes: number;
  monthlyQuota: number;
  active: boolean;
  locked: number;
  upcoming: number;
}

export async function listEnrollments(studentId?: string): Promise<EnrollmentSummary[]> {
  const enrollments = await prisma.tutoringEnrollment.findMany({
    where: studentId ? { studentId } : {},
    include: {
      student: { select: { user: { select: { name: true } } } },
      program: { select: { name: true, defaultDurationMinutes: true } },
    },
    orderBy: { student: { user: { name: 'asc' } } },
  });
  const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);
  return Promise.all(
    enrollments.map(async (e) => {
      const { locked, upcoming, quota } = await getMonthlyQuotaStatus(e.id, monthKey);
      return {
        id: e.id,
        studentId: e.studentId,
        studentName: e.student.user.name,
        programId: e.programId,
        programName: e.program.name,
        defaultDurationMinutes: e.program.defaultDurationMinutes,
        monthlyQuota: quota,
        active: e.active,
        locked,
        upcoming,
      };
    })
  );
}

export interface UpdateEnrollmentInput {
  monthlyQuota?: number | null;
  active?: boolean;
}

export function updateEnrollment(id: string, input: UpdateEnrollmentInput) {
  return prisma.tutoringEnrollment.update({ where: { id }, data: input });
}

export function deleteEnrollment(id: string) {
  return prisma.tutoringEnrollment.delete({ where: { id } });
}
