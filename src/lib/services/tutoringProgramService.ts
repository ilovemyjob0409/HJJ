import { Prisma } from '@prisma/client';
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

export async function updateProgram(id: string, input: UpdateProgramInput) {
  try {
    return await prisma.tutoringProgram.update({ where: { id }, data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('PROGRAM_NOT_FOUND');
    }
    throw err;
  }
}

export async function deleteProgram(id: string) {
  try {
    return await prisma.tutoringProgram.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('PROGRAM_NOT_FOUND');
    }
    throw err;
  }
}

export interface CreateWindowInput {
  programId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  teacherId: string;
}

export async function createWindow(input: CreateWindowInput) {
  try {
    return await prisma.tutoringWindow.create({ data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      if (err.message.includes('programId')) throw new Error('PROGRAM_NOT_FOUND');
      if (err.message.includes('teacherId')) throw new Error('TEACHER_NOT_FOUND');
    }
    throw err;
  }
}

export interface UpdateWindowInput {
  weekday?: number;
  startTime?: string;
  endTime?: string;
  capacity?: number;
  teacherId?: string;
  active?: boolean;
}

export async function updateWindow(id: string, input: UpdateWindowInput) {
  try {
    return await prisma.tutoringWindow.update({ where: { id }, data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('WINDOW_NOT_FOUND');
    }
    throw err;
  }
}

export async function deleteWindow(id: string) {
  try {
    return await prisma.tutoringWindow.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('WINDOW_NOT_FOUND');
    }
    throw err;
  }
}

export async function addWindowClosure(windowId: string, date: Date) {
  try {
    return await prisma.tutoringWindowClosure.create({ data: { windowId, date } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error('CLOSURE_ALREADY_EXISTS');
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new Error('WINDOW_NOT_FOUND');
    }
    throw err;
  }
}

export async function deleteWindowClosure(id: string) {
  try {
    return await prisma.tutoringWindowClosure.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('CLOSURE_NOT_FOUND');
    }
    throw err;
  }
}

export interface CreateEnrollmentInput {
  studentId: string;
  programId: string;
  monthlyQuota?: number;
}

export async function createEnrollment(input: CreateEnrollmentInput) {
  try {
    return await prisma.tutoringEnrollment.create({ data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error('ALREADY_ENROLLED');
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      if (err.message.includes('programId')) throw new Error('PROGRAM_NOT_FOUND');
      if (err.message.includes('studentId')) throw new Error('STUDENT_NOT_FOUND');
    }
    throw err;
  }
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

export async function updateEnrollment(id: string, input: UpdateEnrollmentInput) {
  try {
    return await prisma.tutoringEnrollment.update({ where: { id }, data: input });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('ENROLLMENT_NOT_FOUND');
    }
    throw err;
  }
}

export async function deleteEnrollment(id: string) {
  try {
    return await prisma.tutoringEnrollment.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('ENROLLMENT_NOT_FOUND');
    }
    throw err;
  }
}
