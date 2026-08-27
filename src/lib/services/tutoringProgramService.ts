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
    if (input.defaultMonthlyQuota === undefined) {
      return await prisma.tutoringProgram.update({ where: { id }, data: input });
    }
    // 異動 defaultMonthlyQuota：getMonthlyQuotaStatus／getTutoringDeductionLedger
    // 都是用 enrollment.monthlyQuota ?? program.defaultMonthlyQuota 當生效額度，
    // 多數報名的 monthlyQuota 是 null（吃課程預設），改這個值等同改了那些報名
    // 的生效額度——要比照 updateEnrollment 幫「真的受影響」的每一筆報名補寫
    // TutoringQuotaChange 歷史列，不然一樣會讓帳本回頭改寫過去月份，正是
    // TutoringQuotaChange 原本要修的問題，只是這次的入口是課程預設值而不是
    // 報名個別覆寫值。已經有自己 monthlyQuota 覆寫值的報名不吃預設，不受這次
    // 異動影響，不補列（沿用同一支 recordQuotaChange，一筆一筆呼叫，不重複
    // 實作判斷邏輯）。程式更新與所有受影響報名的歷史列寫入包在同一個交易，
    // 理由同 updateEnrollment：中途掛掉會讓靜態值變了但部分/全部歷史列沒寫。
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.tutoringProgram.findUniqueOrThrow({ where: { id } });
      const oldDefault = existing.defaultMonthlyQuota;
      const newDefault = input.defaultMonthlyQuota!;
      const updated = await tx.tutoringProgram.update({ where: { id }, data: input });
      if (newDefault !== oldDefault) {
        const affected = await tx.tutoringEnrollment.findMany({
          where: { programId: id, monthlyQuota: null },
          select: { id: true },
        });
        for (const enrollment of affected) {
          await recordQuotaChange(tx, enrollment.id, oldDefault, newDefault);
        }
      }
      return updated;
    });
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
    if (input.monthlyQuota === undefined) {
      return await prisma.tutoringEnrollment.update({ where: { id }, data: input });
    }
    // 有異動 monthlyQuota：讀舊的生效額度、更新靜態值、視情況補寫
    // TutoringQuotaChange 歷史列（見 getTutoringDeductionLedger 的用法）全部包
    // 在同一個交易裡——這幾步一定要同進退，不然中途掛掉會讓靜態值變了但
    // 歷史列沒寫，帳本誤判「沒有歷史」而回頭用新值改寫過去月份，正是這個
    // 功能原本要修的問題。這裡不是跟「其他併發請求」搶讀寫的 check-then-act
    // 賽跑（不像訂位/額度審核那類），單一交易的原子性就夠，不需要
    // runSerializableWithRetry 那層。
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.tutoringEnrollment.findUniqueOrThrow({
        where: { id },
        include: { program: { select: { defaultMonthlyQuota: true } } },
      });
      const oldEffective = existing.monthlyQuota ?? existing.program.defaultMonthlyQuota;
      const newEffective = input.monthlyQuota ?? existing.program.defaultMonthlyQuota;
      const updated = await tx.tutoringEnrollment.update({ where: { id }, data: input });
      if (newEffective !== oldEffective) {
        await recordQuotaChange(tx, id, oldEffective, newEffective);
      }
      return updated;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('ENROLLMENT_NOT_FOUND');
    }
    throw err;
  }
}

// 每次真的異動生效額度都補一筆歷史列。第一次異動要先補一筆「舊值」基準列
// （effectiveFrom 用極早日期蓋住所有既有歷史月份）——不然變更前的月份重新
// 打開帳本時，找不到任何 <= 該月的紀錄，會誤用新值回填過去。
// 呼叫方一律傳交易內的 tx，確保 count 讀取與後續 create 都在同一個交易裡跟
// 外層的更新綁在一起——兩個呼叫點：updateEnrollment（單一報名改自己的
// monthlyQuota 覆寫值）與 updateProgram（改課程 defaultMonthlyQuota 時，對
// 每一筆 monthlyQuota 是 null、實際吃預設值的報名各呼叫一次）。
async function recordQuotaChange(
  tx: Prisma.TransactionClient,
  enrollmentId: string,
  oldEffective: number,
  newEffective: number
) {
  const priorChangeCount = await tx.tutoringQuotaChange.count({ where: { enrollmentId } });
  if (priorChangeCount === 0) {
    await tx.tutoringQuotaChange.create({
      data: { enrollmentId, monthlyQuota: oldEffective, effectiveFrom: new Date(0) },
    });
  }
  const [ty, tm, td] = taipeiDateKey(new Date()).split('-').map(Number);
  await tx.tutoringQuotaChange.create({
    data: { enrollmentId, monthlyQuota: newEffective, effectiveFrom: new Date(Date.UTC(ty, tm - 1, td)) },
  });
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
