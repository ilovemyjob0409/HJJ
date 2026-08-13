import { describe, it, expect } from 'vitest';
import {
  utcDateKey,
  isCancellationLate,
  daysRemainingInTaipeiMonth,
  daysRemainingThroughNextTaipeiMonth,
} from './tutoringBookingService';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createProgram, createWindow } from './tutoringProgramService';
import { createBooking, cancelBooking, adminCancelBooking, requestMakeup, decideMakeup } from './tutoringBookingService';
import { getMonthlyQuotaStatus, listAvailability, listBookingsForStudent, listBookingsOverview, listPendingTutoringMakeupRequests, sendMonthlyQuotaReminders } from './tutoringBookingService';
import { getTutoringDeductionLedger } from './tutoringBookingService';
import { listMonthlyAttendanceSummary, listMissedBookingsForEnrollment, listMonthlyBookingCounts } from './tutoringBookingService';

describe('utcDateKey / taipeiDateKey', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(utcDateKey(new Date('2026-08-07T00:00:00.000Z'))).toBe('2026-08-07');
  });
});

describe('daysRemainingInTaipeiMonth', () => {
  it('returns the full month length on the 1st', () => {
    expect(daysRemainingInTaipeiMonth(new Date('2026-08-01T00:00:00.000Z'))).toBe(31);
  });

  it('returns the correct count mid-month', () => {
    expect(daysRemainingInTaipeiMonth(new Date('2026-08-15T00:00:00.000Z'))).toBe(17);
  });

  it('returns 1 on the last day of the month', () => {
    expect(daysRemainingInTaipeiMonth(new Date('2026-08-31T00:00:00.000Z'))).toBe(1);
  });
});

describe('daysRemainingThroughNextTaipeiMonth', () => {
  it('adds the full next month to the days remaining in the current one', () => {
    expect(daysRemainingThroughNextTaipeiMonth(new Date('2026-08-15T00:00:00.000Z'))).toBe(17 + 30);
  });

  it('handles a December-to-January year rollover', () => {
    expect(daysRemainingThroughNextTaipeiMonth(new Date('2026-12-20T00:00:00.000Z'))).toBe(12 + 31);
  });
});

describe('isCancellationLate', () => {
  it('is not late when today is before the booking date', () => {
    expect(isCancellationLate('2026-08-15', '2026-08-14')).toBe(false);
  });

  it('is late on the booking date itself', () => {
    expect(isCancellationLate('2026-08-15', '2026-08-15')).toBe(true);
  });

  it('is late after the booking date has passed', () => {
    expect(isCancellationLate('2026-08-15', '2026-08-20')).toBe(true);
  });
});

async function setupProgramWithEnrollment(capacity = 8) {
  const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  return { teacher, student, program, window, enrollment };
}

// 2026-08-07 is a Friday (weekday 5), matching the fixture window above.
const FRIDAY = new Date('2026-08-07');

describe('createBooking', () => {
  it('creates a REGULAR booking as BOOKED, carrying the window times', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('BOOKED');
    expect(row.kind).toBe('REGULAR');
    // 不再由學生選時段：booking 直接沿用窗口本身的時段
    expect(row.startTime).toBe('16:00');
    expect(row.endTime).toBe('21:00');
  });

  it('rejects a date that falls on a different weekday than the window', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const thursday = new Date('2026-08-06');
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: thursday })
    ).rejects.toThrow('INVALID_WEEKDAY');
  });

  it('rejects when the day already has capacity-many people booked', async () => {
    const { window, program, enrollment } = await setupProgramWithEnrollment(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    const other = await createStudent({ name: '滿位生', email: `full-${Date.now()}@example.com`, password: 'x' });
    const otherEnrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: other.id } });
    await expect(
      createBooking({ enrollmentId: otherEnrollment.id, windowId: window.id, date: FRIDAY })
    ).rejects.toThrow('WINDOW_FULL');
  });

  it('rejects a booking on a closed date', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await prisma.tutoringWindowClosure.create({ data: { windowId: window.id, date: FRIDAY } });
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY })
    ).rejects.toThrow('WINDOW_CLOSED');
  });

  it('rejects a nonexistent window id', async () => {
    const { enrollment } = await setupProgramWithEnrollment();
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: 'nonexistent-window-id', date: FRIDAY })
    ).rejects.toThrow('WINDOW_NOT_FOUND');
  });

  it('rejects a window that belongs to a different program than the enrollment', async () => {
    const { enrollment } = await setupProgramWithEnrollment();
    const otherTeacher = await createTeacher({ name: '別的老師', email: `other-${Date.now()}@example.com`, password: 'x', subjects: '數學' });
    const otherProgram = await createProgram({ name: '數學個別輔導' });
    const otherWindow = await createWindow({ programId: otherProgram.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 4, teacherId: otherTeacher.id });
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: otherWindow.id, date: FRIDAY })
    ).rejects.toThrow('PROGRAM_MISMATCH');
  });

  it('rejects a second active booking on the same day for the same enrollment', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY })
    ).rejects.toThrow('ALREADY_BOOKED_SAME_DAY');
  });

  it('allows rebooking a day whose earlier booking was cancelled', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const first = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await prisma.tutoringBooking.update({ where: { id: first.id }, data: { status: 'CANCELLED' } });
    await expect(createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY })).resolves.toBeTruthy();
  });

  it('rejects booking into an inactive enrollment', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await prisma.tutoringEnrollment.update({ where: { id: enrollment.id }, data: { active: false } });
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY })
    ).rejects.toThrow('ENROLLMENT_INACTIVE');
  });
});

describe('cancelBooking', () => {
  it('keeps the row as CANCELLED (no quota hit, visible in history) when cancelled before the cutoff', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2)); // Friday, far in the future
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future });
    await cancelBooking(booking.id, enrollment.studentId);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('CANCELLED');
  });

  it('frees up the day capacity again after an early cancellation', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(1);
    const future = new Date(Date.UTC(2099, 0, 2));
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future });
    await cancelBooking(booking.id, enrollment.studentId);
    // capacity 1: rebooking the same day only succeeds if CANCELLED no longer occupies the slot
    await expect(createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future })).resolves.toBeTruthy();
  });

  it('marks the booking CANCELLED_LATE when the date has already arrived', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07'); // a Friday well in the past
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await cancelBooking(booking.id, enrollment.studentId);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('CANCELLED_LATE');
  });

  it('rejects cancellation by a student who does not own the booking', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future });
    await expect(cancelBooking(booking.id, 'someone-else')).rejects.toThrow('NOT_OWNER');
  });

  it('rejects with BOOKING_NOT_FOUND for a nonexistent booking id', async () => {
    await expect(cancelBooking('nonexistent-booking-id', 'someone')).rejects.toThrow('BOOKING_NOT_FOUND');
  });
});

describe('adminCancelBooking', () => {
  it('keeps the row as CANCELLED when countsTowardQuota is false', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await adminCancelBooking(booking.id, false);
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED');
  });

  it('marks CANCELLED_LATE when countsTowardQuota is true', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await adminCancelBooking(booking.id, true);
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED_LATE');
  });
});

describe('requestMakeup / decideMakeup', () => {
  it('rejects a makeup request for a booking that was not missed', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await expect(
      requestMakeup({ originalBookingId: booking.id, windowId: window.id, date: FRIDAY })
    ).rejects.toThrow('NOT_ELIGIBLE');
  });

  it('creates a PENDING_ADMIN MAKEUP booking for a late-cancelled original, and approving it flips status without re-checking capacity', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(1);
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await adminCancelBooking(original.id, true); // CANCELLED_LATE

    const makeup = await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY });
    let row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: makeup.id } });
    expect(row.kind).toBe('MAKEUP');
    expect(row.status).toBe('PENDING_ADMIN');
    expect(row.makeupForId).toBe(original.id);

    // capacity is 1 and already reserved by the PENDING_ADMIN makeup — another student's regular booking for the same slot must fail
    const other = await createStudent({ name: '擠不進來', email: `nofit-${Date.now()}@example.com`, password: 'x' });
    const otherEnrollment = await prisma.tutoringEnrollment.create({
      data: { programId: (await prisma.tutoringWindow.findUniqueOrThrow({ where: { id: window.id } })).programId, studentId: other.id },
    });
    await expect(
      createBooking({ enrollmentId: otherEnrollment.id, windowId: window.id, date: FRIDAY })
    ).rejects.toThrow('WINDOW_FULL');

    await decideMakeup(makeup.id, 'APPROVED');
    row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: makeup.id } });
    expect(row.status).toBe('BOOKED');
  });

  it('rejects a second makeup request for the same original booking', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await adminCancelBooking(original.id, true);
    await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY });

    await expect(
      requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY })
    ).rejects.toThrow('ALREADY_REQUESTED');
  });

  it('sets status to REJECTED when the admin rejects', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await adminCancelBooking(original.id, true);
    const makeup = await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY });

    await decideMakeup(makeup.id, 'REJECTED');
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: makeup.id } })).status).toBe('REJECTED');
  });

  it('allows only one of two concurrent makeup requests for the same original booking to succeed', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await adminCancelBooking(original.id, true);

    const results = await Promise.allSettled([
      requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY }),
      requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toBe('ALREADY_REQUESTED');

    const created = await prisma.tutoringBooking.count({ where: { makeupForId: original.id } });
    expect(created).toBe(1);
  });

  it('rejects deciding the same makeup booking twice', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await adminCancelBooking(original.id, true);
    const makeup = await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY });

    await decideMakeup(makeup.id, 'APPROVED');
    await expect(decideMakeup(makeup.id, 'APPROVED')).rejects.toThrow('ALREADY_DECIDED');
  });

  it('rejects deciding a REGULAR booking', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await expect(decideMakeup(booking.id, 'APPROVED')).rejects.toThrow('ALREADY_DECIDED');
  });

  it('rejects with BOOKING_NOT_FOUND for a nonexistent booking id', async () => {
    await expect(decideMakeup('nonexistent-booking-id', 'APPROVED')).rejects.toThrow('BOOKING_NOT_FOUND');
  });
});

describe('getMonthlyQuotaStatus', () => {
  it('counts a past-dated REGULAR booking as locked regardless of status, and excludes MAKEUP bookings', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07'); // locked (date has passed)
    const attended = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14') });
    // requestMakeup requires the original to be missed (CANCELLED_LATE or ABSENT); mark it so
    // it's eligible, while its status still counts toward `locked` regardless of status.
    await adminCancelBooking(attended.id, true);
    await requestMakeup({ originalBookingId: attended.id, windowId: window.id, date: new Date('2020-08-21') });

    const status = await getMonthlyQuotaStatus(enrollment.id, '2020-08');
    expect(status.locked).toBe(2); // the two REGULAR bookings, MAKEUP excluded
    expect(status.quota).toBe(8);
  });

  it('counts a future BOOKED REGULAR booking as upcoming, not locked', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future });

    const status = await getMonthlyQuotaStatus(enrollment.id, '2099-01');
    expect(status.locked).toBe(0);
    expect(status.upcoming).toBe(1);
  });

  it('uses the enrollment override when set, otherwise the program default', async () => {
    const { enrollment } = await setupProgramWithEnrollment();
    await prisma.tutoringEnrollment.update({ where: { id: enrollment.id }, data: { monthlyQuota: 11 } });
    const status = await getMonthlyQuotaStatus(enrollment.id, '2026-08');
    expect(status.quota).toBe(11);
  });

  it('rejects with ENROLLMENT_NOT_FOUND for a nonexistent enrollment id', async () => {
    await expect(getMonthlyQuotaStatus('nonexistent-enrollment-id', '2026-08')).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });

  it('never counts an early-cancelled (CANCELLED) booking, even after its date passes', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await prisma.tutoringBooking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });

    const status = await getMonthlyQuotaStatus(enrollment.id, '2020-08');
    expect(status.locked).toBe(0);
    expect(status.upcoming).toBe(0);
  });
});

describe('listAvailability', () => {
  it('lists remaining headcount for the matching weekday within the horizon, skipping closed dates', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(8);
    const days = await listAvailability(enrollment.id, 14);
    const fridays = days.filter((d) => d.windowId === window.id);
    expect(fridays.length).toBeGreaterThan(0);
    expect(fridays[0]).toMatchObject({ capacity: 8, remaining: 8 });

    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(fridays[0].date) });
    const daysAfterBooking = await listAvailability(enrollment.id, 14);
    expect(daysAfterBooking.find((d) => d.date === fridays[0].date)).toMatchObject({ capacity: 8, remaining: 7 });

    await prisma.tutoringWindowClosure.create({ data: { windowId: window.id, date: new Date(fridays[0].date) } });
    const daysAfterClosure = await listAvailability(enrollment.id, 14);
    expect(daysAfterClosure.filter((d) => d.windowId === window.id).length).toBe(fridays.length - 1);
  });

  it('rejects with ENROLLMENT_NOT_FOUND for a nonexistent enrollment id', async () => {
    await expect(listAvailability('nonexistent-enrollment-id', 14)).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });

  it('marks days already booked by this enrollment, but not days booked by others', async () => {
    const { window, enrollment, program } = await setupProgramWithEnrollment(8);
    const days = await listAvailability(enrollment.id, 14);
    const target = days.filter((d) => d.windowId === window.id)[0];
    expect(target.myBookingId).toBeNull();

    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(target.date) });
    const after = await listAvailability(enrollment.id, 14);
    expect(after.find((d) => d.date === target.date)).toMatchObject({
      myBookingId: booking.id,
      myBookingStatus: 'BOOKED',
    });

    // another student's booking must not mark the day for this enrollment
    const other = await createStudent({ name: '別人', email: `someone-${Date.now()}@example.com`, password: 'x' });
    const otherEnrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: other.id } });
    const otherView = await listAvailability(otherEnrollment.id, 14);
    expect(otherView.find((d) => d.date === target.date)).toMatchObject({ myBookingId: null, myBookingStatus: null });
  });

  it('reports myBookingCount for legacy duplicate bookings on the same day', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(8);
    const days = await listAvailability(enrollment.id, 14);
    const target = days.filter((d) => d.windowId === window.id)[0];
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(target.date) });
    // 防呆上線前的舊資料可能同一天疊兩筆：直接塞資料模擬
    await prisma.tutoringBooking.create({
      data: {
        enrollmentId: enrollment.id,
        windowId: window.id,
        date: new Date(target.date),
        startTime: '16:00',
        endTime: '21:00',
        kind: 'REGULAR',
        status: 'BOOKED',
      },
    });

    const after = await listAvailability(enrollment.id, 14);
    expect(after.find((d) => d.date === target.date)).toMatchObject({ myBookingId: booking.id, myBookingCount: 2 });
  });

  it('does not mark a day whose booking was early-cancelled, and restores its remaining count', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(8);
    const days = await listAvailability(enrollment.id, 14);
    // 取最後一個窗口日：一定晚於今天，取消才會走「提前取消」而不是當天取消
    const target = days.filter((d) => d.windowId === window.id).at(-1)!;
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(target.date) });
    await cancelBooking(booking.id, enrollment.studentId);

    const after = await listAvailability(enrollment.id, 14);
    expect(after.find((d) => d.date === target.date)).toMatchObject({
      remaining: 8,
      myBookingId: null,
      myBookingStatus: null,
    });
  });
});

describe('listBookingsForStudent', () => {
  it('flags canCancelFree for a future booking and canRequestMakeup for a late-cancelled one', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future });
    const past = new Date('2020-08-07');
    const missed = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await adminCancelBooking(missed.id, true);

    const rows = await listBookingsForStudent(enrollment.studentId);
    expect(rows).toHaveLength(2);
    const futureRow = rows.find((r) => r.status === 'BOOKED')!;
    expect(futureRow.canCancelFree).toBe(true);
    const missedRow = rows.find((r) => r.status === 'CANCELLED_LATE')!;
    expect(missedRow.canRequestMakeup).toBe(true);
  });

  it('keeps an early-cancelled booking visible in history, with no cancel/makeup affordances', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future });
    await cancelBooking(booking.id, enrollment.studentId);

    const rows = await listBookingsForStudent(enrollment.studentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'CANCELLED', canCancelFree: false, canRequestMakeup: false });
  });
});

describe('getTutoringDeductionLedger', () => {
  it('adds a GRANT row for each month and counts past REGULAR bookings as DEDUCT within their own month, resetting at each month boundary', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(); // quota 8 (program default)
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14') });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-21') });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-09-04') });

    const { monthlyQuota, history } = await getTutoringDeductionLedger(enrollment.id);
    expect(monthlyQuota).toBe(8);
    expect(history.map((h) => [utcDateKey(h.date), h.kind, h.amount, h.remainingAfter])).toEqual([
      ['2020-09-04', 'DEDUCT', -1, 7],
      ['2020-09-01', 'GRANT', 8, 8], // September starts its own fresh quota of 8, not continuing from August
      ['2020-08-21', 'DEDUCT', -1, 5],
      ['2020-08-14', 'DEDUCT', -1, 6],
      ['2020-08-07', 'DEDUCT', -1, 7],
      ['2020-08-01', 'GRANT', 8, 8],
    ]);
  });

  it('excludes a MAKEUP booking and a REGULAR booking whose date has not passed yet, keeping only the GRANT and the actual deduction', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future });
    const missed = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await adminCancelBooking(missed.id, true);
    await requestMakeup({ originalBookingId: missed.id, windowId: window.id, date: new Date('2020-08-14') });

    const { history } = await getTutoringDeductionLedger(enrollment.id);
    // the future REGULAR booking and the MAKEUP booking are both omitted — only
    // each month's GRANT and the missed original booking's DEDUCT remain
    expect(history.map((h) => [utcDateKey(h.date), h.kind, h.status, h.remainingAfter])).toEqual([
      ['2099-01-01', 'GRANT', null, 8],
      ['2020-08-07', 'DEDUCT', 'CANCELLED_LATE', 7],
      ['2020-08-01', 'GRANT', null, 8],
    ]);
  });

  it('rejects with ENROLLMENT_NOT_FOUND for a nonexistent enrollment id', async () => {
    await expect(getTutoringDeductionLedger('nonexistent-enrollment-id')).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });

  it('does not deduct for an early-cancelled (CANCELLED) booking even after its date passes', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    const cancelled = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14') });
    await prisma.tutoringBooking.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });

    const { history } = await getTutoringDeductionLedger(enrollment.id);
    expect(history.map((h) => [utcDateKey(h.date), h.kind, h.remainingAfter])).toEqual([
      ['2020-08-07', 'DEDUCT', 7],
      ['2020-08-01', 'GRANT', 8],
    ]);
  });
});

describe('listMonthlyBookingCounts', () => {
  it('counts BOOKED and PENDING_ADMIN per day, excluding cancelled/rejected rows', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const other = await createStudent({ name: '同學', email: `peer-${Date.now()}@example.com`, password: 'x' });
    const otherEnrollment = await prisma.tutoringEnrollment.create({
      data: { programId: (await prisma.tutoringWindow.findUniqueOrThrow({ where: { id: window.id } })).programId, studentId: other.id },
    });

    // 8/7：兩筆 BOOKED＋一筆提前取消（不該計入）——先建先取消，才不會撞同日防呆
    const cancelled = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await prisma.tutoringBooking.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await createBooking({ enrollmentId: otherEnrollment.id, windowId: window.id, date: new Date('2020-08-07') });

    // 8/14：一筆當天取消（不該計入）＋一筆補課申請待核准（pending）
    const late = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14') });
    await adminCancelBooking(late.id, true);
    await requestMakeup({ originalBookingId: late.id, windowId: window.id, date: new Date('2020-08-14') });

    const counts = await listMonthlyBookingCounts('2020-08');
    expect(counts).toEqual([
      { date: '2020-08-07', booked: 2, pending: 0 },
      { date: '2020-08-14', booked: 0, pending: 1 },
    ]);
  });

  it('returns an empty array for a month with no bookings', async () => {
    await setupProgramWithEnrollment();
    expect(await listMonthlyBookingCounts('2019-01')).toEqual([]);
  });
});

describe('listMissedBookingsForEnrollment', () => {
  it('returns only missed REGULAR bookings without an existing makeup child, scoped to the given enrollment', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();

    const missed = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await adminCancelBooking(missed.id, true); // CANCELLED_LATE, eligible

    const alreadyRequested = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14') });
    await adminCancelBooking(alreadyRequested.id, true);
    await requestMakeup({ originalBookingId: alreadyRequested.id, windowId: window.id, date: FRIDAY });

    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-21') }); // BOOKED, not missed

    const otherStudent = await createStudent({ name: '小華', email: `hua-${Date.now()}@example.com`, password: 'x' });
    const otherEnrollment = await prisma.tutoringEnrollment.create({ data: { programId: enrollment.programId, studentId: otherStudent.id } });
    const otherMissed = await createBooking({ enrollmentId: otherEnrollment.id, windowId: window.id, date: new Date('2020-08-28') });
    await adminCancelBooking(otherMissed.id, true);

    const rows = await listMissedBookingsForEnrollment(enrollment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(missed.id);
  });

  it('returns an empty array when there are no missed bookings', async () => {
    const { enrollment } = await setupProgramWithEnrollment();
    expect(await listMissedBookingsForEnrollment(enrollment.id)).toEqual([]);
  });
});

describe('listBookingsOverview and listPendingTutoringMakeupRequests', () => {
  it('lists all bookings for a date with student and program names', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    const rows = await listBookingsOverview(FRIDAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].studentName).toBe('小明');
    expect(rows[0].programName).toBe('英文個別輔導');
  });

  it('lists pending makeup requests with the original booking date', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await adminCancelBooking(original.id, true);
    await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY });

    const rows = await listPendingTutoringMakeupRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0].originalDate.toISOString().slice(0, 10)).toBe('2020-08-07');
  });
});

describe('sendMonthlyQuotaReminders', () => {
  it('notifies an under-quota enrollment with a lineUserId once, then skips it on a second run', async () => {
    const { student } = await setupProgramWithEnrollment();
    await prisma.student.update({ where: { id: student.id }, data: { lineUserId: 'line-1' } });

    const first = await sendMonthlyQuotaReminders();
    expect(first.notified).toBe(1);

    const second = await sendMonthlyQuotaReminders();
    expect(second.notified).toBe(0);
  });

  it('skips enrollments without a lineUserId', async () => {
    await setupProgramWithEnrollment();
    const result = await sendMonthlyQuotaReminders();
    expect(result.notified).toBe(0);
  });
});

describe('listMonthlyAttendanceSummary', () => {
  it('buckets locked REGULAR bookings into attended/cancelledLate/absent and counts approved MAKEUP separately', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    // Fixture gap in the brief: TutoringAttendance.markedById has an FK to User,
    // and this file (unlike attendanceService.test.ts) has no marker-user
    // beforeEach, so the literal 'marker-1' id must be created here first.
    await prisma.user.create({ data: { id: 'marker-1', email: 'tutoring-summary-marker@example.com', password: 'x', name: 'Marker', role: 'ADMIN' } });
    const past = '2020-08-';
    const attended = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '07') });
    await prisma.tutoringAttendance.create({ data: { bookingId: attended.id, status: 'PRESENT', markedById: 'marker-1' } });

    const lateCancelled = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '14') });
    await adminCancelBooking(lateCancelled.id, true);

    const absentBooking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '21') });
    await prisma.tutoringAttendance.create({ data: { bookingId: absentBooking.id, status: 'ABSENT', markedById: 'marker-1' } });

    const makeupOriginal = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '28') });
    await adminCancelBooking(makeupOriginal.id, true);
    const makeup = await requestMakeup({ originalBookingId: makeupOriginal.id, windowId: window.id, date: new Date('2020-09-04') });
    await decideMakeup(makeup.id, 'APPROVED');

    const augustSummary = await listMonthlyAttendanceSummary('2020-08');
    expect(augustSummary).toHaveLength(1);
    expect(augustSummary[0]).toMatchObject({ studentName: '小明', attended: 1, cancelledLate: 2, absent: 1 });

    const septemberSummary = await listMonthlyAttendanceSummary('2020-09');
    expect(septemberSummary[0].makeup).toBe(1);
  });
});
