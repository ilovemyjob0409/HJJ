import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getMonthlyQuotaStatus, taipeiDateKey } from './tutoringBookingService';

// 週課表點個別輔導時段卡的資訊小卡用
export interface TutoringWindowInfo {
  id: string;
  programName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  teacherNames: string[];
  upcomingBookedCount: number; // 今天（台北）起的有效預約人次（BOOKED＋待核准）
}

export async function getWindowInfo(id: string): Promise<TutoringWindowInfo> {
  const w = await prisma.tutoringWindow.findUnique({
    where: { id },
    include: {
      program: { select: { name: true } },
      teacher: { select: { user: { select: { name: true } } } },
      teacher2: { select: { user: { select: { name: true } } } },
    },
  });
  if (!w) throw new Error('WINDOW_NOT_FOUND');
  const [ty, tm, td] = taipeiDateKey(new Date()).split('-').map(Number);
  const upcomingBookedCount = await prisma.tutoringBooking.count({
    where: { windowId: id, status: { in: ['BOOKED', 'PENDING_ADMIN'] }, date: { gte: new Date(Date.UTC(ty, tm - 1, td)) } },
  });
  return {
    id: w.id,
    programName: w.program.name,
    weekday: w.weekday,
    startTime: w.startTime,
    endTime: w.endTime,
    capacity: w.capacity,
    teacherNames: [w.teacher.user.name, w.teacher2?.user.name].filter((n): n is string => !!n),
    upcomingBookedCount,
  };
}

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
    include: {
      windows: {
        include: {
          teacher: { select: { user: { select: { name: true } } } },
          teacher2: { select: { user: { select: { name: true } } } },
          closures: true,
        },
      },
    },
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
  teacherId2?: string | null; // 選填的第二位老師（長時段換班）
}

export async function createWindow(input: CreateWindowInput) {
  if (input.teacherId2 && input.teacherId2 === input.teacherId) throw new Error('DUPLICATE_TEACHER');
  try {
    return await prisma.tutoringWindow.create({ data: { ...input, teacherId2: input.teacherId2 || null } });
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
  teacherId2?: string | null;
  active?: boolean;
}

export async function updateWindow(id: string, input: UpdateWindowInput) {
  if (input.teacherId2) {
    const mainTeacherId = input.teacherId ?? (await prisma.tutoringWindow.findUnique({ where: { id }, select: { teacherId: true } }))?.teacherId;
    if (input.teacherId2 === mainTeacherId) throw new Error('DUPLICATE_TEACHER');
  }
  try {
    return await prisma.tutoringWindow.update({ where: { id }, data: { ...input, ...(input.teacherId2 !== undefined ? { teacherId2: input.teacherId2 || null } : {}) } });
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
