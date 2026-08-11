import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { pushLineMessage } from './lineService';

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const TAIPEI_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function taipeiDateKey(date: Date): string {
  return TAIPEI_DATE_FMT.format(date);
}

export function daysRemainingInTaipeiMonth(now: Date): number {
  const todayKey = taipeiDateKey(now);
  const [y, m, d] = todayKey.split('-').map(Number);
  const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDayOfMonth - d + 1;
}

export function daysRemainingThroughNextTaipeiMonth(now: Date): number {
  const remaining = daysRemainingInTaipeiMonth(now);
  const todayKey = taipeiDateKey(now);
  const [y, m] = todayKey.split('-').map(Number);
  const daysInNextMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return remaining + daysInNextMonth;
}

// 前一天 23:59（台北）為分界：今天（台北）已到達或超過預約日期＝當天取消或更晚，視為 late。
export function isCancellationLate(bookingDateUtcKey: string, nowTaipeiKey: string): boolean {
  return nowTaipeiKey >= bookingDateUtcKey;
}

export interface CreateBookingInput {
  enrollmentId: string;
  windowId: string;
  date: Date;
  kind?: 'REGULAR' | 'MAKEUP';
  makeupForId?: string;
}

// 預約不再選時段：一筆預約＝「這位學生這天會來」，booking 的 startTime/endTime
// 直接沿用窗口本身的時段（DB 欄位保留，kiosk 掃碼簽到等既有流程仍靠它排序
// 與顯示）。容量也因此簡化成當天人數上限：BOOKED＋PENDING_ADMIN 的既有預約
// 數達到 window.capacity 就滿了。
export function createBooking(input: CreateBookingInput): Promise<{ id: string }> {
  return runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const [window, enrollment] = await Promise.all([
          tx.tutoringWindow.findUnique({ where: { id: input.windowId } }),
          tx.tutoringEnrollment.findUnique({ where: { id: input.enrollmentId } }),
        ]);
        if (!window) throw new Error('WINDOW_NOT_FOUND');
        if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
        if (!enrollment.active) throw new Error('ENROLLMENT_INACTIVE');
        if (window.programId !== enrollment.programId) throw new Error('PROGRAM_MISMATCH');
        if (input.date.getUTCDay() !== window.weekday) throw new Error('INVALID_WEEKDAY');

        const closure = await tx.tutoringWindowClosure.findUnique({
          where: { windowId_date: { windowId: input.windowId, date: input.date } },
        });
        if (closure) throw new Error('WINDOW_CLOSED');

        const booked = await tx.tutoringBooking.count({
          where: { windowId: input.windowId, date: input.date, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
        });
        if (booked >= window.capacity) throw new Error('WINDOW_FULL');

        return tx.tutoringBooking.create({
          data: {
            enrollmentId: input.enrollmentId,
            windowId: input.windowId,
            date: input.date,
            startTime: window.startTime,
            endTime: window.endTime,
            kind: input.kind ?? 'REGULAR',
            status: input.kind === 'MAKEUP' ? 'PENDING_ADMIN' : 'BOOKED',
            makeupForId: input.makeupForId,
          },
          select: { id: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export async function cancelBooking(bookingId: string, studentId: string): Promise<void> {
  let booking;
  try {
    booking = await prisma.tutoringBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { enrollment: { select: { studentId: true } } },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('BOOKING_NOT_FOUND');
    }
    throw err;
  }
  if (booking.enrollment.studentId !== studentId) throw new Error('NOT_OWNER');

  const late = isCancellationLate(utcDateKey(booking.date), taipeiDateKey(new Date()));
  if (!late) {
    await prisma.tutoringBooking.delete({ where: { id: bookingId } });
    return;
  }
  await prisma.tutoringBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED_LATE' } });
}

// 行政取消：可選是否計次，處理特殊個案（例如場地臨時取消，不該算學生的堂數）。
export async function adminCancelBooking(bookingId: string, countsTowardQuota: boolean): Promise<void> {
  try {
    if (!countsTowardQuota) {
      await prisma.tutoringBooking.delete({ where: { id: bookingId } });
      return;
    }
    await prisma.tutoringBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED_LATE' } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('BOOKING_NOT_FOUND');
    }
    throw err;
  }
}

export async function requestMakeup(input: {
  originalBookingId: string;
  windowId: string;
  date: Date;
}): Promise<{ id: string }> {
  const original = await prisma.tutoringBooking.findUniqueOrThrow({
    where: { id: input.originalBookingId },
    include: { attendance: true, makeupChild: true },
  });
  if (original.kind !== 'REGULAR') throw new Error('NOT_ELIGIBLE');
  if (original.makeupChild) throw new Error('ALREADY_REQUESTED');
  const missed = original.status === 'CANCELLED_LATE' || original.attendance?.status === 'ABSENT';
  if (!missed) throw new Error('NOT_ELIGIBLE');

  try {
    return await createBooking({
      enrollmentId: original.enrollmentId,
      windowId: input.windowId,
      date: input.date,
      kind: 'MAKEUP',
      makeupForId: original.id,
    });
  } catch (err) {
    // TOCTOU: the makeupChild check above runs outside a transaction, so two
    // concurrent requestMakeup calls for the same original can both pass it
    // before either commits. The DB's unique constraint on makeupForId then
    // rejects the loser's insert with P2002 — translate that into the same
    // ALREADY_REQUESTED error the pre-check above throws, instead of leaking
    // the raw Prisma error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error('ALREADY_REQUESTED');
    }
    throw err;
  }
}

// 容量在 PENDING_ADMIN 建立時已檢查並佔位（createBooking 把 PENDING_ADMIN 一併算進容量），
// 核准時不必再查一次容量。
export async function decideMakeup(bookingId: string, decision: 'APPROVED' | 'REJECTED'): Promise<void> {
  let booking;
  try {
    booking = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: bookingId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new Error('BOOKING_NOT_FOUND');
    }
    throw err;
  }
  if (booking.kind !== 'MAKEUP' || booking.status !== 'PENDING_ADMIN') {
    throw new Error('ALREADY_DECIDED');
  }
  await prisma.tutoringBooking.update({
    where: { id: bookingId },
    data: { status: decision === 'APPROVED' ? 'BOOKED' : 'REJECTED' },
  });
}

export async function getMonthlyQuotaStatus(
  enrollmentId: string,
  monthKey: string // 'YYYY-MM'
): Promise<{ locked: number; upcoming: number; quota: number }> {
  const enrollment = await prisma.tutoringEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { program: { select: { defaultMonthlyQuota: true } } },
  });
  if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
  const quota = enrollment.monthlyQuota ?? enrollment.program.defaultMonthlyQuota;
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const todayKey = taipeiDateKey(new Date());

  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollmentId, kind: 'REGULAR', date: { gte: monthStart, lte: monthEnd } },
    select: { date: true, status: true },
  });

  let locked = 0;
  let upcoming = 0;
  for (const b of bookings) {
    const key = utcDateKey(b.date);
    if (key <= todayKey) locked++;
    else if (b.status === 'BOOKED') upcoming++;
  }
  return { locked, upcoming, quota };
}

export interface AvailabilityDay {
  date: string;
  windowId: string;
  capacity: number;
  remaining: number;
}

export async function listAvailability(enrollmentId: string, days = 14): Promise<AvailabilityDay[]> {
  const enrollment = await prisma.tutoringEnrollment.findUnique({ where: { id: enrollmentId } });
  if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
  const windows = await prisma.tutoringWindow.findMany({ where: { programId: enrollment.programId, active: true } });
  const todayKey = taipeiDateKey(new Date());
  const [ty, tm, td] = todayKey.split('-').map(Number);

  const result: AvailabilityDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(ty, tm - 1, td + i));
    const window = windows.find((w) => w.weekday === d.getUTCDay());
    if (!window) continue;

    const closure = await prisma.tutoringWindowClosure.findUnique({
      where: { windowId_date: { windowId: window.id, date: d } },
    });
    if (closure) continue;

    const booked = await prisma.tutoringBooking.count({
      where: { windowId: window.id, date: d, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
    });
    result.push({
      date: utcDateKey(d),
      windowId: window.id,
      capacity: window.capacity,
      remaining: Math.max(0, window.capacity - booked),
    });
  }
  return result;
}

export interface StudentBookingRow {
  id: string;
  programName: string;
  date: Date;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED_LATE' | 'REJECTED';
  canCancelFree: boolean;
  canRequestMakeup: boolean;
}

export async function listBookingsForStudent(studentId: string): Promise<StudentBookingRow[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollment: { studentId } },
    select: {
      id: true,
      date: true,
      kind: true,
      status: true,
      window: { select: { program: { select: { name: true } } } },
      attendance: { select: { status: true } },
      makeupChild: { select: { id: true } },
    },
    orderBy: { date: 'desc' },
  });
  const todayKey = taipeiDateKey(new Date());
  return bookings.map((b) => {
    const dateKey = utcDateKey(b.date);
    const missed = b.status === 'CANCELLED_LATE' || b.attendance?.status === 'ABSENT';
    return {
      id: b.id,
      programName: b.window.program.name,
      date: b.date,
      kind: b.kind as 'REGULAR' | 'MAKEUP',
      status: b.status as StudentBookingRow['status'],
      canCancelFree: b.status === 'BOOKED' && dateKey > todayKey,
      canRequestMakeup: b.kind === 'REGULAR' && missed && !b.makeupChild,
    };
  });
}

export interface TutoringLedgerRow {
  id: string;
  date: Date;
  kind: 'GRANT' | 'DEDUCT';
  amount: number; // GRANT: +monthlyQuota；DEDUCT: -1
  status: 'BOOKED' | 'CANCELLED_LATE' | null; // GRANT 沒有對應的預約，是 null
  checkInTime: string | null;
  remainingAfter: number;
}

// 學生自己看的個別輔導「扣堂紀錄」：跟班級／弈廳一樣是一份完整的堂數增減
// 帳本——每個月月初核發當月額度（GRANT，+monthlyQuota）算一筆「建立」，之後
// 每一堂真的扣掉名額的預約（一般預約且日期已過，不論後來狀態是 BOOKED 還是
// 被記為 CANCELLED_LATE，判斷邏輯跟 getMonthlyQuotaStatus 一致）算一筆
// DEDUCT（-1）。還沒發生的預約、補課本身（補課是把名額補回來，不會再扣一
// 次）都不算增減事件，不放進帳本——那些屬於「我的預約紀錄」。月額度按月重
// 置，跟班級／弈廳的終身堂數池不同，所以要照預約日期所在月份分組，各自從
// 當月額度倒推，不能跨月累加。
export async function getTutoringDeductionLedger(
  enrollmentId: string
): Promise<{ monthlyQuota: number; history: TutoringLedgerRow[] }> {
  const enrollment = await prisma.tutoringEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { program: { select: { defaultMonthlyQuota: true } } },
  });
  if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
  const quota = enrollment.monthlyQuota ?? enrollment.program.defaultMonthlyQuota;
  const todayKey = taipeiDateKey(new Date());

  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollmentId },
    select: {
      id: true,
      date: true,
      kind: true,
      status: true,
      attendance: { select: { checkInTime: true } },
    },
    orderBy: { date: 'desc' },
  });

  const monthGroups = new Map<string, typeof bookings>();
  for (const b of bookings) {
    const monthKey = utcDateKey(b.date).slice(0, 7);
    if (!monthGroups.has(monthKey)) monthGroups.set(monthKey, []);
    monthGroups.get(monthKey)!.push(b);
  }

  const history: TutoringLedgerRow[] = [];
  for (const [monthKey, rows] of Array.from(monthGroups.entries())) {
    const countedInMonth = rows.filter((b) => b.kind === 'REGULAR' && utcDateKey(b.date) <= todayKey).length;
    let runningAfter = quota - countedInMonth;
    for (const b of rows) {
      const counted = b.kind === 'REGULAR' && utcDateKey(b.date) <= todayKey;
      const remainingAfter = runningAfter;
      if (counted) runningAfter += 1;
      if (!counted) continue;
      history.push({
        id: b.id,
        date: b.date,
        kind: 'DEDUCT',
        amount: -1,
        status: b.status as TutoringLedgerRow['status'],
        checkInTime: b.attendance?.checkInTime ?? null,
        remainingAfter,
      });
    }
    // 處理完這個月所有扣堂後 runningAfter 會加回到 quota 本身——那就是這個月
    // 核發當下（尚未扣任何一堂）的剩餘堂數。
    history.push({
      id: `grant-${monthKey}`,
      date: new Date(`${monthKey}-01T00:00:00.000Z`),
      kind: 'GRANT',
      amount: quota,
      status: null,
      checkInTime: null,
      remainingAfter: runningAfter,
    });
  }

  return { monthlyQuota: quota, history };
}

export interface MissedBookingRow {
  id: string;
  date: Date;
}

export async function listMissedBookingsForEnrollment(enrollmentId: string): Promise<MissedBookingRow[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollmentId, kind: 'REGULAR' },
    select: {
      id: true,
      date: true,
      status: true,
      attendance: { select: { status: true } },
      makeupChild: { select: { id: true } },
    },
    orderBy: { date: 'desc' },
  });
  return bookings
    .filter((b) => (b.status === 'CANCELLED_LATE' || b.attendance?.status === 'ABSENT') && !b.makeupChild)
    .map((b) => ({ id: b.id, date: b.date }));
}

export interface OverviewBookingRow {
  id: string;
  studentName: string;
  programName: string;
  windowId: string;
  date: Date;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED_LATE' | 'REJECTED';
}

export async function listBookingsOverview(date: Date): Promise<OverviewBookingRow[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { date },
    select: {
      id: true,
      kind: true,
      status: true,
      date: true,
      windowId: true,
      enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
    },
  });
  return bookings
    .map((b) => ({
      id: b.id,
      studentName: b.enrollment.student.user.name,
      programName: b.window.program.name,
      windowId: b.windowId,
      date: b.date,
      kind: b.kind as 'REGULAR' | 'MAKEUP',
      status: b.status as OverviewBookingRow['status'],
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}

export interface PendingMakeupRow {
  id: string;
  studentName: string;
  programName: string;
  originalDate: Date;
  date: Date;
}

export async function listPendingTutoringMakeupRequests(): Promise<PendingMakeupRow[]> {
  const rows = await prisma.tutoringBooking.findMany({
    where: { kind: 'MAKEUP', status: 'PENDING_ADMIN' },
    select: {
      id: true,
      date: true,
      enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
      makeupFor: { select: { date: true } },
    },
    orderBy: { date: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    studentName: r.enrollment.student.user.name,
    programName: r.window.program.name,
    originalDate: r.makeupFor!.date,
    date: r.date,
  }));
}

// 每月 20 號由 Vercel Cron 觸發（見 Task 18）；本函式本身不檢查日期，
// 靠 lastQuotaReminderMonth 保證同一學生同一月只提醒一次，可安全重複呼叫。
export async function sendMonthlyQuotaReminders(): Promise<{ notified: number }> {
  const monthKey = taipeiDateKey(new Date()).slice(0, 7);
  const enrollments = await prisma.tutoringEnrollment.findMany({
    // `lastQuotaReminderMonth: { not: monthKey }` alone would silently drop
    // enrollments where the field is still null (SQL's NULL <> x is unknown,
    // so Prisma excludes it) — the common case for an enrollment that has
    // never been reminded. OR in the null case explicitly.
    where: {
      active: true,
      OR: [{ lastQuotaReminderMonth: null }, { lastQuotaReminderMonth: { not: monthKey } }],
    },
    include: {
      program: { select: { name: true } },
      student: { select: { id: true, lineUserId: true, user: { select: { name: true } } } },
    },
  });

  let notified = 0;
  for (const e of enrollments) {
    if (!e.student.lineUserId) continue;
    const { locked, upcoming, quota } = await getMonthlyQuotaStatus(e.id, monthKey);
    if (locked + upcoming >= quota) continue;
    await pushLineMessage(
      e.student.lineUserId,
      `【MUP】${e.student.user.name} 本月「${e.program.name}」還剩 ${quota - locked - upcoming} 堂未預約，記得安排上課時間`
    );
    await prisma.tutoringEnrollment.update({ where: { id: e.id }, data: { lastQuotaReminderMonth: monthKey } });
    notified++;
  }
  return { notified };
}

export interface MonthlySummaryRow {
  enrollmentId: string;
  studentName: string;
  programName: string;
  attended: number;
  cancelledLate: number;
  absent: number;
  makeup: number;
}

// 已上／當天取消／缺席／補課 統計，供行政對帳與 CSV 匯出。「已上」= 已鎖定且非取消非缺席的
// REGULAR 預約（含尚未點名的，視為已上——月結報表以「有沒有到場義務」為準，不是點名進度表）。
export async function listMonthlyAttendanceSummary(monthKey: string): Promise<MonthlySummaryRow[]> {
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const todayKey = taipeiDateKey(new Date());

  const bookings = await prisma.tutoringBooking.findMany({
    where: { date: { gte: monthStart, lte: monthEnd } },
    select: {
      date: true,
      kind: true,
      status: true,
      enrollment: { select: { id: true, student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
      attendance: { select: { status: true } },
    },
  });

  const byEnrollmentId = new Map<string, MonthlySummaryRow>();
  for (const b of bookings) {
    const key = b.enrollment.id;
    if (!byEnrollmentId.has(key)) {
      byEnrollmentId.set(key, {
        enrollmentId: key,
        studentName: b.enrollment.student.user.name,
        programName: b.window.program.name,
        attended: 0,
        cancelledLate: 0,
        absent: 0,
        makeup: 0,
      });
    }
    const row = byEnrollmentId.get(key)!;
    if (b.kind === 'MAKEUP') {
      if (b.status === 'BOOKED') row.makeup++;
      continue;
    }
    if (utcDateKey(b.date) > todayKey) continue;
    if (b.status === 'CANCELLED_LATE') row.cancelledLate++;
    else if (b.attendance?.status === 'ABSENT') row.absent++;
    else if (b.status === 'BOOKED') row.attended++;
  }
  return Array.from(byEnrollmentId.values()).sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}
