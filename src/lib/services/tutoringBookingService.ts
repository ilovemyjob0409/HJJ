import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';

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
        const window = await tx.tutoringWindow.findUniqueOrThrow({ where: { id: input.windowId } });
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

// 老師／行政現場補加：教室現場人數由老師目視判斷，系統不做容量檢查。
export function createWalkInBooking(input: {
  enrollmentId: string;
  windowId: string;
  date: Date;
  startTime: string;
  endTime: string;
}): Promise<{ id: string }> {
  return prisma.tutoringBooking.create({
    data: { ...input, kind: 'REGULAR', status: 'BOOKED' },
    select: { id: true },
  });
}

export async function cancelBooking(bookingId: string, studentId: string): Promise<void> {
  const booking = await prisma.tutoringBooking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { enrollment: { select: { studentId: true } } },
  });
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
  if (!countsTowardQuota) {
    await prisma.tutoringBooking.delete({ where: { id: bookingId } });
    return;
  }
  await prisma.tutoringBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED_LATE' } });
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

  return createBooking({
    enrollmentId: original.enrollmentId,
    windowId: input.windowId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    kind: 'MAKEUP',
    makeupForId: original.id,
  });
}

// 容量在 PENDING_ADMIN 建立時已檢查並佔位（createBooking 把 PENDING_ADMIN 一併算進容量），
// 核准時不必再查一次容量。
export async function decideMakeup(bookingId: string, decision: 'APPROVED' | 'REJECTED'): Promise<void> {
  await prisma.tutoringBooking.update({
    where: { id: bookingId },
    data: { status: decision === 'APPROVED' ? 'BOOKED' : 'REJECTED' },
  });
}
