import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { classifyQuotaBookings, taipeiDateKey } from './tutoringBookingService';

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

// Blocks deletion when the program still has a window or a student
// enrollment referencing it — both are required references (a window and
// an enrollment must each belong to a program) and represent real
// configuration/history that would otherwise be silently orphaned.
export async function deleteProgram(id: string) {
  const [windowCount, enrollmentCount] = await Promise.all([
    prisma.tutoringWindow.count({ where: { programId: id } }),
    prisma.tutoringEnrollment.count({ where: { programId: id } }),
  ]);
  if (windowCount > 0 || enrollmentCount > 0) {
    throw new Error('PROGRAM_HAS_RECORDS');
  }
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

// Blocks deletion when the window still has bookings referencing it — a
// booking must belong to a window, and those bookings are the student's
// history/upcoming appointments and must survive.
export async function deleteWindow(id: string) {
  const bookingCount = await prisma.tutoringBooking.count({ where: { windowId: id } });
  if (bookingCount > 0) {
    throw new Error('WINDOW_HAS_BOOKINGS');
  }
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
  const window = await prisma.tutoringWindow.findUnique({ where: { id: windowId }, select: { weekday: true } });
  if (!window) throw new Error('WINDOW_NOT_FOUND');
  // 停課日必須落在時段的星期——其他日期本來就沒有這個時段，設了也擋不到任何預約。
  // 日期是 UTC 午夜（date-only 字串解析而來），星期也用 UTC 讀。
  if (date.getUTCDay() !== window.weekday) throw new Error('INVALID_WEEKDAY');
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
  pendingOverQuota: number;
}

export async function listEnrollments(studentId?: string): Promise<EnrollmentSummary[]> {
  const enrollments = await prisma.tutoringEnrollment.findMany({
    where: studentId ? { studentId } : {},
    include: {
      student: { select: { user: { select: { name: true } } } },
      program: { select: { name: true, defaultDurationMinutes: true, defaultMonthlyQuota: true } },
    },
    orderBy: { student: { user: { name: 'asc' } } },
  });
  const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);
  const [year, month] = monthKey.split('-').map(Number);
  // 一次撈齊所有報名的當月 REGULAR 預約、JS 端分組分類——查詢量從每筆報名
  // 2 個降為全部共 1 個（行政個輔頁列全部報名時差最多）。分類口徑共用
  // classifyQuotaBookings，與 getMonthlyQuotaStatus 永遠一致。
  const bookings = await prisma.tutoringBooking.findMany({
    where: {
      enrollmentId: { in: enrollments.map((e) => e.id) },
      kind: 'REGULAR',
      date: { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) },
    },
    select: { enrollmentId: true, date: true, status: true, attendance: { select: { status: true } } },
  });
  const byEnrollment = new Map<string, typeof bookings>();
  for (const b of bookings) {
    if (!byEnrollment.has(b.enrollmentId)) byEnrollment.set(b.enrollmentId, []);
    byEnrollment.get(b.enrollmentId)!.push(b);
  }
  const todayKey = taipeiDateKey(new Date());
  return enrollments.map((e) => {
    const { locked, upcoming, pendingOverQuota } = classifyQuotaBookings(byEnrollment.get(e.id) ?? [], todayKey);
    return {
      id: e.id,
      studentId: e.studentId,
      studentName: e.student.user.name,
      programId: e.programId,
      programName: e.program.name,
      defaultDurationMinutes: e.program.defaultDurationMinutes,
      monthlyQuota: e.monthlyQuota ?? e.program.defaultMonthlyQuota,
      active: e.active,
      locked,
      upcoming,
      pendingOverQuota,
    };
  });
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

// Blocks deletion when the enrollment still has bookings referencing it —
// a booking must belong to an enrollment, and those bookings are the
// student's history/upcoming appointments and must survive.
export async function deleteEnrollment(id: string) {
  const bookingCount = await prisma.tutoringBooking.count({ where: { enrollmentId: id } });
  if (bookingCount > 0) {
    throw new Error('ENROLLMENT_HAS_BOOKINGS');
  }
  try {
    return await prisma.tutoringEnrollment.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('ENROLLMENT_NOT_FOUND');
    }
    throw err;
  }
}

export interface TeacherTutoringWindowSummary {
  id: string;
  programName: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export async function listWindowsForTeacher(teacherId: string): Promise<TeacherTutoringWindowSummary[]> {
  const windows = await prisma.tutoringWindow.findMany({
    where: { active: true, OR: [{ teacherId }, { teacherId2: teacherId }] },
    select: { id: true, weekday: true, startTime: true, endTime: true, program: { select: { name: true } } },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
  return windows.map((w) => ({ id: w.id, programName: w.program.name, weekday: w.weekday, startTime: w.startTime, endTime: w.endTime }));
}
