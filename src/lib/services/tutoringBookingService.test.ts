import { describe, it, expect } from 'vitest';
import {
  toMinutes,
  minutesToHHMM,
  utcDateKey,
  countOverlapsInSlot,
  buildSlotRemaining,
  hasCapacityForRange,
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
import { listMonthlyAttendanceSummary, listMissedBookingsForEnrollment } from './tutoringBookingService';

describe('toMinutes / minutesToHHMM', () => {
  it('round-trips', () => {
    expect(toMinutes('16:00')).toBe(960);
    expect(toMinutes('21:30')).toBe(1290);
    expect(minutesToHHMM(960)).toBe('16:00');
    expect(minutesToHHMM(1290)).toBe('21:30');
  });
});

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

describe('countOverlapsInSlot', () => {
  it('counts ranges whose interval overlaps the slot, excluding head-to-tail touches', () => {
    const ranges = [
      { startTime: '16:00', endTime: '18:00' },
      { startTime: '18:00', endTime: '20:00' }, // touches the first range's end, not an overlap
    ];
    expect(countOverlapsInSlot(toMinutes('16:00'), toMinutes('16:30'), ranges)).toBe(1);
    expect(countOverlapsInSlot(toMinutes('17:30'), toMinutes('18:00'), ranges)).toBe(1);
    expect(countOverlapsInSlot(toMinutes('18:00'), toMinutes('18:30'), ranges)).toBe(1);
  });
});

describe('buildSlotRemaining', () => {
  it('returns one entry per 30-minute slot with remaining = capacity - overlap count', () => {
    const slots = buildSlotRemaining('16:00', '17:00', 8, [{ startTime: '16:00', endTime: '16:30' }]);
    expect(slots).toEqual([
      { startTime: '16:00', remaining: 7 },
      { startTime: '16:30', remaining: 8 },
    ]);
  });

  it('never goes below zero when already over capacity', () => {
    const existing = Array.from({ length: 9 }, () => ({ startTime: '16:00', endTime: '16:30' }));
    const slots = buildSlotRemaining('16:00', '16:30', 8, existing);
    expect(slots[0].remaining).toBe(0);
  });
});

describe('hasCapacityForRange', () => {
  it('allows a candidate when every covered slot is under capacity', () => {
    const existing = [{ startTime: '16:00', endTime: '18:00' }];
    expect(hasCapacityForRange('16:00', '21:00', 2, existing, { startTime: '16:00', endTime: '18:00' })).toBe(true);
  });

  it('rejects when any covered slot would reach capacity', () => {
    const existing = [{ startTime: '16:00', endTime: '18:00' }];
    expect(hasCapacityForRange('16:00', '21:00', 1, existing, { startTime: '17:00', endTime: '19:00' })).toBe(false);
  });

  it('allows a candidate that starts exactly when an existing one ends (no overlap at the boundary)', () => {
    const existing = [{ startTime: '16:00', endTime: '18:00' }];
    expect(hasCapacityForRange('16:00', '21:00', 1, existing, { startTime: '18:00', endTime: '20:00' })).toBe(true);
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
  it('creates a REGULAR booking as BOOKED', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('BOOKED');
    expect(row.kind).toBe('REGULAR');
  });

  it('rejects a time range outside the window', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '15:00', endTime: '17:00' })
    ).rejects.toThrow('OUT_OF_WINDOW');
  });

  it('rejects when the window is full for the requested time', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '17:00', endTime: '19:00' })
    ).rejects.toThrow('WINDOW_FULL');
  });

  it('rejects a booking on a closed date', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await prisma.tutoringWindowClosure.create({ data: { windowId: window.id, date: FRIDAY } });
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' })
    ).rejects.toThrow('WINDOW_CLOSED');
  });

  it('rejects a nonexistent window id', async () => {
    const { enrollment } = await setupProgramWithEnrollment();
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: 'nonexistent-window-id', date: FRIDAY, startTime: '16:00', endTime: '18:00' })
    ).rejects.toThrow('WINDOW_NOT_FOUND');
  });

  it('rejects a window that belongs to a different program than the enrollment', async () => {
    const { enrollment } = await setupProgramWithEnrollment();
    const otherTeacher = await createTeacher({ name: '別的老師', email: `other-${Date.now()}@example.com`, password: 'x', subjects: '數學' });
    const otherProgram = await createProgram({ name: '數學個別輔導' });
    const otherWindow = await createWindow({ programId: otherProgram.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 4, teacherId: otherTeacher.id });
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: otherWindow.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' })
    ).rejects.toThrow('PROGRAM_MISMATCH');
  });

  it('rejects booking into an inactive enrollment', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await prisma.tutoringEnrollment.update({ where: { id: enrollment.id }, data: { active: false } });
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' })
    ).rejects.toThrow('ENROLLMENT_INACTIVE');
  });
});

describe('cancelBooking', () => {
  it('deletes the booking outright when cancelled before the day-before cutoff', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2)); // Friday, far in the future
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future, startTime: '16:00', endTime: '18:00' });
    await cancelBooking(booking.id, enrollment.studentId);
    expect(await prisma.tutoringBooking.findUnique({ where: { id: booking.id } })).toBeNull();
  });

  it('marks the booking CANCELLED_LATE when the date has already arrived', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07'); // a Friday well in the past
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await cancelBooking(booking.id, enrollment.studentId);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('CANCELLED_LATE');
  });

  it('rejects cancellation by a student who does not own the booking', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future, startTime: '16:00', endTime: '18:00' });
    await expect(cancelBooking(booking.id, 'someone-else')).rejects.toThrow('NOT_OWNER');
  });

  it('rejects with BOOKING_NOT_FOUND for a nonexistent booking id', async () => {
    await expect(cancelBooking('nonexistent-booking-id', 'someone')).rejects.toThrow('BOOKING_NOT_FOUND');
  });
});

describe('adminCancelBooking', () => {
  it('deletes the booking when countsTowardQuota is false', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(booking.id, false);
    expect(await prisma.tutoringBooking.findUnique({ where: { id: booking.id } })).toBeNull();
  });

  it('marks CANCELLED_LATE when countsTowardQuota is true', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(booking.id, true);
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED_LATE');
  });
});

describe('requestMakeup / decideMakeup', () => {
  it('rejects a makeup request for a booking that was not missed', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    await expect(
      requestMakeup({ originalBookingId: booking.id, windowId: window.id, date: FRIDAY, startTime: '18:00', endTime: '20:00' })
    ).rejects.toThrow('NOT_ELIGIBLE');
  });

  it('creates a PENDING_ADMIN MAKEUP booking for a late-cancelled original, and approving it flips status without re-checking capacity', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(1);
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(original.id, true); // CANCELLED_LATE

    const makeup = await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    let row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: makeup.id } });
    expect(row.kind).toBe('MAKEUP');
    expect(row.status).toBe('PENDING_ADMIN');
    expect(row.makeupForId).toBe(original.id);

    // capacity is 1 and already reserved by the PENDING_ADMIN makeup — a second regular booking for the same slot must fail
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' })
    ).rejects.toThrow('WINDOW_FULL');

    await decideMakeup(makeup.id, 'APPROVED');
    row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: makeup.id } });
    expect(row.status).toBe('BOOKED');
  });

  it('rejects a second makeup request for the same original booking', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(original.id, true);
    await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });

    await expect(
      requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '18:00', endTime: '20:00' })
    ).rejects.toThrow('ALREADY_REQUESTED');
  });

  it('sets status to REJECTED when the admin rejects', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(original.id, true);
    const makeup = await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });

    await decideMakeup(makeup.id, 'REJECTED');
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: makeup.id } })).status).toBe('REJECTED');
  });

  it('allows only one of two concurrent makeup requests for the same original booking to succeed', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(original.id, true);

    const results = await Promise.allSettled([
      requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' }),
      requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' }),
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
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(original.id, true);
    const makeup = await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });

    await decideMakeup(makeup.id, 'APPROVED');
    await expect(decideMakeup(makeup.id, 'APPROVED')).rejects.toThrow('ALREADY_DECIDED');
  });

  it('rejects deciding a REGULAR booking', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
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
    const attended = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14'), startTime: '16:00', endTime: '18:00' });
    // requestMakeup requires the original to be missed (CANCELLED_LATE or ABSENT); mark it so
    // it's eligible, while its status still counts toward `locked` regardless of status.
    await adminCancelBooking(attended.id, true);
    await requestMakeup({ originalBookingId: attended.id, windowId: window.id, date: new Date('2020-08-21'), startTime: '16:00', endTime: '18:00' });

    const status = await getMonthlyQuotaStatus(enrollment.id, '2020-08');
    expect(status.locked).toBe(2); // the two REGULAR bookings, MAKEUP excluded
    expect(status.quota).toBe(8);
  });

  it('counts a future BOOKED REGULAR booking as upcoming, not locked', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future, startTime: '16:00', endTime: '18:00' });

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
});

describe('listAvailability', () => {
  it('lists remaining capacity for the matching weekday within the horizon, skipping closed dates', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(8);
    const days = await listAvailability(enrollment.id, 14);
    const fridays = days.filter((d) => d.windowId === window.id);
    expect(fridays.length).toBeGreaterThan(0);
    expect(fridays[0].slots[0]).toEqual({ startTime: '16:00', remaining: 8 });

    await prisma.tutoringWindowClosure.create({ data: { windowId: window.id, date: new Date(fridays[0].date) } });
    const daysAfterClosure = await listAvailability(enrollment.id, 14);
    expect(daysAfterClosure.filter((d) => d.windowId === window.id).length).toBe(fridays.length - 1);
  });

  it('rejects with ENROLLMENT_NOT_FOUND for a nonexistent enrollment id', async () => {
    await expect(listAvailability('nonexistent-enrollment-id', 14)).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });
});

describe('listBookingsForStudent', () => {
  it('flags canCancelFree for a future booking and canRequestMakeup for a late-cancelled one', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future, startTime: '16:00', endTime: '18:00' });
    const past = new Date('2020-08-07');
    const missed = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(missed.id, true);

    const rows = await listBookingsForStudent(enrollment.studentId);
    expect(rows).toHaveLength(2);
    const futureRow = rows.find((r) => r.status === 'BOOKED')!;
    expect(futureRow.canCancelFree).toBe(true);
    const missedRow = rows.find((r) => r.status === 'CANCELLED_LATE')!;
    expect(missedRow.canRequestMakeup).toBe(true);
  });
});

describe('listMissedBookingsForEnrollment', () => {
  it('returns only missed REGULAR bookings without an existing makeup child, scoped to the given enrollment', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();

    const missed = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07'), startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(missed.id, true); // CANCELLED_LATE, eligible

    const alreadyRequested = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14'), startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(alreadyRequested.id, true);
    await requestMakeup({ originalBookingId: alreadyRequested.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });

    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-21'), startTime: '16:00', endTime: '18:00' }); // BOOKED, not missed

    const otherStudent = await createStudent({ name: '小華', email: `hua-${Date.now()}@example.com`, password: 'x' });
    const otherEnrollment = await prisma.tutoringEnrollment.create({ data: { programId: enrollment.programId, studentId: otherStudent.id } });
    const otherMissed = await createBooking({ enrollmentId: otherEnrollment.id, windowId: window.id, date: new Date('2020-08-28'), startTime: '16:00', endTime: '18:00' });
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
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    const rows = await listBookingsOverview(FRIDAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].studentName).toBe('小明');
    expect(rows[0].programName).toBe('英文個別輔導');
  });

  it('lists pending makeup requests with the original booking date', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(original.id, true);
    await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });

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
    const attended = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '07'), startTime: '16:00', endTime: '18:00' });
    await prisma.tutoringAttendance.create({ data: { bookingId: attended.id, status: 'PRESENT', markedById: 'marker-1' } });

    const lateCancelled = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '14'), startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(lateCancelled.id, true);

    const absentBooking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '21'), startTime: '16:00', endTime: '18:00' });
    await prisma.tutoringAttendance.create({ data: { bookingId: absentBooking.id, status: 'ABSENT', markedById: 'marker-1' } });

    const makeupOriginal = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '28'), startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(makeupOriginal.id, true);
    const makeup = await requestMakeup({ originalBookingId: makeupOriginal.id, windowId: window.id, date: new Date('2020-09-04'), startTime: '16:00', endTime: '18:00' });
    await decideMakeup(makeup.id, 'APPROVED');

    const augustSummary = await listMonthlyAttendanceSummary('2020-08');
    expect(augustSummary).toHaveLength(1);
    expect(augustSummary[0]).toMatchObject({ studentName: '小明', attended: 1, cancelledLate: 2, absent: 1 });

    const septemberSummary = await listMonthlyAttendanceSummary('2020-09');
    expect(septemberSummary[0].makeup).toBe(1);
  });
});
