import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { pushLineMessage } from './lineService';

export const SLOT_MINUTES = 30;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60).toString().padStart(2, '0');
  const m = (total % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

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

export function countOverlapsInSlot(slotStart: number, slotEnd: number, ranges: { startTime: string; endTime: string }[]): number {
  return ranges.filter((r) => toMinutes(r.startTime) < slotEnd && toMinutes(r.endTime) > slotStart).length;
}

export function buildSlotRemaining(
  windowStartTime: string,
  windowEndTime: string,
  capacity: number,
  existingRanges: { startTime: string; endTime: string }[]
): { startTime: string; remaining: number }[] {
  const start = toMinutes(windowStartTime);
  const end = toMinutes(windowEndTime);
  const slots: { startTime: string; remaining: number }[] = [];
  for (let t = start; t < end; t += SLOT_MINUTES) {
    const used = countOverlapsInSlot(t, t + SLOT_MINUTES, existingRanges);
    slots.push({ startTime: minutesToHHMM(t), remaining: Math.max(0, capacity - used) });
  }
  return slots;
}

export function hasCapacityForRange(
  windowStartTime: string,
  windowEndTime: string,
  capacity: number,
  existingRanges: { startTime: string; endTime: string }[],
  candidate: { startTime: string; endTime: string }
): boolean {
  const windowStart = toMinutes(windowStartTime);
  const windowEnd = toMinutes(windowEndTime);
  const candStart = toMinutes(candidate.startTime);
  const candEnd = toMinutes(candidate.endTime);
  for (let t = Math.max(windowStart, candStart); t < Math.min(windowEnd, candEnd); t += SLOT_MINUTES) {
    const used = countOverlapsInSlot(t, t + SLOT_MINUTES, existingRanges);
    if (used + 1 > capacity) return false;
  }
  return true;
}

// 前一天 23:59（台北）為分界：今天（台北）已到達或超過預約日期＝當天取消或更晚，視為 late。
export function isCancellationLate(bookingDateUtcKey: string, nowTaipeiKey: string): boolean {
  return nowTaipeiKey >= bookingDateUtcKey;
}

export interface CreateBookingInput {
  enrollmentId: string;
  windowId: string;
  date: Date;
  startTime: string;
  endTime: string;
  kind?: 'REGULAR' | 'MAKEUP';
  makeupForId?: string;
}

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
        if (toMinutes(input.endTime) <= toMinutes(input.startTime)) throw new Error('INVALID_RANGE');
        if (toMinutes(input.startTime) < toMinutes(window.startTime) || toMinutes(input.endTime) > toMinutes(window.endTime)) {
          throw new Error('OUT_OF_WINDOW');
        }
        if (input.date.getUTCDay() !== window.weekday) throw new Error('INVALID_WEEKDAY');

        const closure = await tx.tutoringWindowClosure.findUnique({
          where: { windowId_date: { windowId: input.windowId, date: input.date } },
        });
        if (closure) throw new Error('WINDOW_CLOSED');

        const existing = await tx.tutoringBooking.findMany({
          where: { windowId: input.windowId, date: input.date, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
          select: { startTime: true, endTime: true },
        });
        if (!hasCapacityForRange(window.startTime, window.endTime, window.capacity, existing, input)) {
          throw new Error('WINDOW_FULL');
        }

        return tx.tutoringBooking.create({
          data: {
            enrollmentId: input.enrollmentId,
            windowId: input.windowId,
            date: input.date,
            startTime: input.startTime,
            endTime: input.endTime,
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
  startTime: string;
  endTime: string;
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
      startTime: input.startTime,
      endTime: input.endTime,
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
  windowStartTime: string;
  windowEndTime: string;
  capacity: number;
  slots: { startTime: string; remaining: number }[];
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

    const existing = await prisma.tutoringBooking.findMany({
      where: { windowId: window.id, date: d, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
      select: { startTime: true, endTime: true },
    });
    result.push({
      date: utcDateKey(d),
      windowId: window.id,
      windowStartTime: window.startTime,
      windowEndTime: window.endTime,
      capacity: window.capacity,
      slots: buildSlotRemaining(window.startTime, window.endTime, window.capacity, existing),
    });
  }
  return result;
}

export interface StudentBookingRow {
  id: string;
  programName: string;
  date: Date;
  startTime: string;
  endTime: string;
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
      startTime: true,
      endTime: true,
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
      startTime: b.startTime,
      endTime: b.endTime,
      kind: b.kind as 'REGULAR' | 'MAKEUP',
      status: b.status as StudentBookingRow['status'],
      canCancelFree: b.status === 'BOOKED' && dateKey > todayKey,
      canRequestMakeup: b.kind === 'REGULAR' && missed && !b.makeupChild,
    };
  });
}

export interface MissedBookingRow {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
}

export async function listMissedBookingsForEnrollment(enrollmentId: string): Promise<MissedBookingRow[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollmentId, kind: 'REGULAR' },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      attendance: { select: { status: true } },
      makeupChild: { select: { id: true } },
    },
    orderBy: { date: 'desc' },
  });
  return bookings
    .filter((b) => (b.status === 'CANCELLED_LATE' || b.attendance?.status === 'ABSENT') && !b.makeupChild)
    .map((b) => ({ id: b.id, date: b.date, startTime: b.startTime, endTime: b.endTime }));
}

export interface OverviewBookingRow {
  id: string;
  studentName: string;
  programName: string;
  windowId: string;
  date: Date;
  startTime: string;
  endTime: string;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED_LATE' | 'REJECTED';
}

export async function listBookingsOverview(date: Date): Promise<OverviewBookingRow[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { date },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      kind: true,
      status: true,
      date: true,
      windowId: true,
      enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
    },
    orderBy: { startTime: 'asc' },
  });
  return bookings.map((b) => ({
    id: b.id,
    studentName: b.enrollment.student.user.name,
    programName: b.window.program.name,
    windowId: b.windowId,
    date: b.date,
    startTime: b.startTime,
    endTime: b.endTime,
    kind: b.kind as 'REGULAR' | 'MAKEUP',
    status: b.status as OverviewBookingRow['status'],
  }));
}

export interface PendingMakeupRow {
  id: string;
  studentName: string;
  programName: string;
  originalDate: Date;
  date: Date;
  startTime: string;
  endTime: string;
}

export async function listPendingTutoringMakeupRequests(): Promise<PendingMakeupRow[]> {
  const rows = await prisma.tutoringBooking.findMany({
    where: { kind: 'MAKEUP', status: 'PENDING_ADMIN' },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
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
    startTime: r.startTime,
    endTime: r.endTime,
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
