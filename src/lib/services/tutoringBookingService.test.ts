import { describe, it, expect } from 'vitest';
import { utcDateKey, daysRemainingInTaipeiMonth } from './tutoringBookingService';
import { prisma } from '@/lib/db';
import { subscribeStudentForTest } from '@/lib/testUtils/pushHelpers';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createProgram, createWindow } from './tutoringProgramService';
import { createBooking, cancelBooking, adminCancelBooking } from './tutoringBookingService';
import { getMonthlyQuotaStatus, listAvailability, listBookingsForStudent, listBookingsOverview, sendMonthlyQuotaReminders } from './tutoringBookingService';
import { sendMissedSessionReminders } from './tutoringBookingService';
import { getTutoringDeductionLedger, listWalkInCandidates } from './tutoringBookingService';
import { listMonthlyAttendanceSummary, listMonthlyBookingCounts } from './tutoringBookingService';
import { saveTutoringAttendance } from './attendanceService';

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

  it('allows exceeding capacity when allowOverCapacity is set (walk-in force add)', async () => {
    const { window, program, enrollment } = await setupProgramWithEnrollment(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    const other = await createStudent({ name: '硬開生', email: `force-${Date.now()}@example.com`, password: 'x' });
    const otherEnrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: other.id } });

    const booking = await createBooking({
      enrollmentId: otherEnrollment.id,
      windowId: window.id,
      date: FRIDAY,
      allowOverCapacity: true,
    });

    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('BOOKED');
  });

  it('allowOverCapacity does not bypass the other guards', async () => {
    const { window, program, enrollment } = await setupProgramWithEnrollment(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    // 同一報名同一天不能疊，即使強制加入
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, allowOverCapacity: true })
    ).rejects.toThrow('ALREADY_BOOKED_SAME_DAY');
    // 停開日照擋
    const other = await createStudent({ name: '停開生', email: `force-closed-${Date.now()}@example.com`, password: 'x' });
    const otherEnrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: other.id } });
    const nextFriday = new Date('2026-08-14');
    await prisma.tutoringWindowClosure.create({ data: { windowId: window.id, date: nextFriday } });
    await expect(
      createBooking({ enrollmentId: otherEnrollment.id, windowId: window.id, date: nextFriday, allowOverCapacity: true })
    ).rejects.toThrow('WINDOW_CLOSED');
  });
});

describe('listWalkInCandidates', () => {
  it('lists active enrollees of the window program that are not booked that day', async () => {
    const { window, program, enrollment, student } = await setupProgramWithEnrollment();
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });

    const walkIn = await createStudent({ name: '臨時生', email: `walkin-${Date.now()}@example.com`, password: 'x' });
    const walkInEnrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: walkIn.id } });
    const inactive = await createStudent({ name: '停用生', email: `walkin-inactive-${Date.now()}@example.com`, password: 'x' });
    await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: inactive.id, active: false } });

    const candidates = await listWalkInCandidates(window.id, FRIDAY);

    expect(candidates.map((c) => c.enrollmentId)).toEqual([walkInEnrollment.id]);
    expect(candidates[0].studentName).toBe('臨時生');
    // 已預約的學生（小明）與停用報名都不在名單裡
    expect(candidates.some((c) => c.studentName === '小明')).toBe(false);
    expect(candidates.some((c) => c.studentName === '停用生')).toBe(false);
    void student;
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

  it('also keeps the row as CANCELLED (not CANCELLED_LATE) when cancelled on/after the booking date — students never lose a session for self-cancelling', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07'); // a Friday well in the past
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past });
    await cancelBooking(booking.id, enrollment.studentId);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('CANCELLED');
  });

  it('a same-day self-cancellation does not count toward the monthly quota', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const today = new Date('2020-08-07'); // a Friday
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: today });
    await cancelBooking(booking.id, enrollment.studentId);
    const status = await getMonthlyQuotaStatus(enrollment.id, '2020-08');
    expect(status.locked).toBe(0);
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
  it('always marks CANCELLED — 收費規範沒有「計次取消」，扣堂只看有無到場', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await adminCancelBooking(booking.id);
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED');
  });

  it('rejects with BOOKING_NOT_FOUND for a nonexistent booking id', async () => {
    await expect(adminCancelBooking('nonexistent-booking-id')).rejects.toThrow('BOOKING_NOT_FOUND');
  });
});

async function createMarker() {
  return prisma.user.create({
    data: { name: '行政', email: `marker-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`, password: 'x', role: 'ADMIN' },
  });
}

describe('getMonthlyQuotaStatus', () => {
  it('counts only attended bookings: no attendance or ABSENT does not deduct', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const marker = await createMarker();
    const attended = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await prisma.tutoringAttendance.create({ data: { bookingId: attended.id, status: 'PRESENT', markedById: marker.id } });
    // 日期已過但沒點名：不扣堂
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14') });
    // 缺席：不扣堂
    const absent = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-21') });
    await prisma.tutoringAttendance.create({ data: { bookingId: absent.id, status: 'ABSENT', markedById: marker.id } });

    const status = await getMonthlyQuotaStatus(enrollment.id, '2020-08');
    expect(status.locked).toBe(1);
    expect(status.quota).toBe(8);
  });

  it('counts LATE and LEFT_EARLY as attended (到場即計一堂)', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const marker = await createMarker();
    const late = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await prisma.tutoringAttendance.create({ data: { bookingId: late.id, status: 'LATE', markedById: marker.id } });
    const leftEarly = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14') });
    await prisma.tutoringAttendance.create({ data: { bookingId: leftEarly.id, status: 'LEFT_EARLY', markedById: marker.id } });

    const status = await getMonthlyQuotaStatus(enrollment.id, '2020-08');
    expect(status.locked).toBe(2);
  });

  it('a legacy CANCELLED_LATE booking without attendance no longer deducts', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await prisma.tutoringBooking.update({ where: { id: booking.id }, data: { status: 'CANCELLED_LATE' } });

    const status = await getMonthlyQuotaStatus(enrollment.id, '2020-08');
    expect(status.locked).toBe(0);
    expect(status.upcoming).toBe(0);
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
  it('lists bookings newest first, including legacy CANCELLED_LATE rows for display', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future });
    const legacy = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await prisma.tutoringBooking.update({ where: { id: legacy.id }, data: { status: 'CANCELLED_LATE' } });

    const rows = await listBookingsForStudent(enrollment.studentId);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('BOOKED');
    expect(rows[1].status).toBe('CANCELLED_LATE');
  });

  it('keeps a self-cancelled booking visible in history', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future });
    await cancelBooking(booking.id, enrollment.studentId);

    const rows = await listBookingsForStudent(enrollment.studentId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('CANCELLED');
  });

  it('carries attendance status and check-in/out times; null when unmarked', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const marker = await createMarker();
    const marked = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await saveTutoringAttendance(marker.id, [{ bookingId: marked.id, status: 'PRESENT', checkInTime: '16:00', checkOutTime: '17:00' }]);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2099, 0, 2)) });

    const rows = await listBookingsForStudent(enrollment.studentId);
    expect(rows[0]).toMatchObject({ attendanceStatus: null, checkInTime: null, checkOutTime: null });
    expect(rows[1]).toMatchObject({ attendanceStatus: 'PRESENT', checkInTime: '16:00', checkOutTime: '17:00' });
  });
});

describe('getTutoringDeductionLedger', () => {
  it('adds a GRANT row per month and a DEDUCT per attended booking, resetting at month boundaries', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(); // quota 8 (program default)
    const marker = await createMarker();
    for (const date of ['2020-08-07', '2020-08-14', '2020-08-21', '2020-09-04']) {
      const b = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(date) });
      await prisma.tutoringAttendance.create({ data: { bookingId: b.id, status: 'PRESENT', markedById: marker.id } });
    }

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

  it('omits unattended, absent, cancelled, and legacy MAKEUP bookings — only attended ones deduct', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const marker = await createMarker();
    const attended = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await prisma.tutoringAttendance.create({ data: { bookingId: attended.id, status: 'PRESENT', markedById: marker.id } });
    // 日期已過但沒點名：不扣
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14') });
    // 缺席：不扣
    const absent = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-21') });
    await prisma.tutoringAttendance.create({ data: { bookingId: absent.id, status: 'ABSENT', markedById: marker.id } });
    // 提前取消：不扣
    const cancelled = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-28') });
    await prisma.tutoringBooking.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
    // 歷史補課（MAKEUP）即使有出席也不扣（補課本來就免扣）
    const legacyMakeup = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-09-04'), kind: 'MAKEUP' })
    await prisma.tutoringBooking.update({ where: { id: legacyMakeup.id }, data: { status: 'BOOKED' } });
    await prisma.tutoringAttendance.create({ data: { bookingId: legacyMakeup.id, status: 'PRESENT', markedById: marker.id } });

    const { history } = await getTutoringDeductionLedger(enrollment.id);
    expect(history.map((h) => [utcDateKey(h.date), h.kind, h.status, h.remainingAfter])).toEqual([
      ['2020-09-01', 'GRANT', null, 8],
      ['2020-08-07', 'DEDUCT', 'BOOKED', 7],
      ['2020-08-01', 'GRANT', null, 8],
    ]);
  });

  it('rejects with ENROLLMENT_NOT_FOUND for a nonexistent enrollment id', async () => {
    await expect(getTutoringDeductionLedger('nonexistent-enrollment-id')).rejects.toThrow('ENROLLMENT_NOT_FOUND');
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

    // 8/14：一筆行政取消（不該計入）＋一筆歷史遺留的待核准補課（pending）
    const late = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14') });
    await adminCancelBooking(late.id);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14'), kind: 'MAKEUP' });

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

describe('listBookingsOverview', () => {
  it('lists all bookings for a date with student and program names', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    const rows = await listBookingsOverview(FRIDAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].studentName).toBe('小明');
    expect(rows[0].programName).toBe('英文個別輔導');
  });
});

describe('sendMonthlyQuotaReminders', () => {
  it('notifies an under-quota enrollment with a push subscription once, then skips it on a second run', async () => {
    const { student } = await setupProgramWithEnrollment();
    await subscribeStudentForTest(student.id);

    const first = await sendMonthlyQuotaReminders();
    expect(first.notified).toBe(1);

    const second = await sendMonthlyQuotaReminders();
    expect(second.notified).toBe(0);
  });

  it('skips enrollments without a push subscription', async () => {
    await setupProgramWithEnrollment();
    const result = await sendMonthlyQuotaReminders();
    expect(result.notified).toBe(0);
  });
});

// FRIDAY (2026-08-07) 是既有 fixture window 的星期五；隔天 2026-08-08（六）
// 當作「今天」傳入，模擬 cron 每天早上檢查「昨天」未點名的預約。
const DAY_AFTER_FRIDAY = new Date('2026-08-08');

describe('sendMissedSessionReminders', () => {
  it('notifies a student whose yesterday booking has no attendance record and a push subscription', async () => {
    const { window, enrollment, student } = await setupProgramWithEnrollment();
    await subscribeStudentForTest(student.id);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });

    const result = await sendMissedSessionReminders(DAY_AFTER_FRIDAY);

    expect(result.notified).toBe(1);
  });

  it('does not notify without a push subscription', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });

    const result = await sendMissedSessionReminders(DAY_AFTER_FRIDAY);

    expect(result.notified).toBe(0);
  });

  it('does not notify a booking that already has an attendance record', async () => {
    const { window, enrollment, student } = await setupProgramWithEnrollment();
    await subscribeStudentForTest(student.id);
    const marker = await createMarker();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await saveTutoringAttendance(marker.id, [{ bookingId: booking.id, status: 'PRESENT', checkInTime: '16:00', checkOutTime: '17:00' }]);

    const result = await sendMissedSessionReminders(DAY_AFTER_FRIDAY);

    expect(result.notified).toBe(0);
  });

  it('does not notify a cancelled booking', async () => {
    const { window, enrollment, student } = await setupProgramWithEnrollment();
    await subscribeStudentForTest(student.id);
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await cancelBooking(booking.id, student.id);

    const result = await sendMissedSessionReminders(DAY_AFTER_FRIDAY);

    expect(result.notified).toBe(0);
  });

  it('ignores bookings that are not exactly yesterday', async () => {
    const { window, enrollment, student } = await setupProgramWithEnrollment();
    await subscribeStudentForTest(student.id);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });

    const result = await sendMissedSessionReminders(new Date('2026-08-10'));

    expect(result.notified).toBe(0);
  });
});

describe('booking staff notifications', () => {
  it('createBooking with notifyStaff does not throw', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, notifyStaff: true });
    expect(booking.id).toBeTruthy();
  });

  it('student cancelBooking does not throw and still cancels', async () => {
    const { window, enrollment, student } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await cancelBooking(booking.id, student.id);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('CANCELLED');
  });
});

describe('listMonthlyAttendanceSummary', () => {
  it('counts attended and absent from attendance records only; unmarked and cancelled bookings are ignored', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const marker = await createMarker();
    const attended = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await prisma.tutoringAttendance.create({ data: { bookingId: attended.id, status: 'PRESENT', markedById: marker.id } });

    const cancelled = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14') });
    await adminCancelBooking(cancelled.id);

    const absentBooking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-21') });
    await prisma.tutoringAttendance.create({ data: { bookingId: absentBooking.id, status: 'ABSENT', markedById: marker.id } });

    // 日期已過但沒點名：不列入統計
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-28') });

    const augustSummary = await listMonthlyAttendanceSummary('2020-08');
    expect(augustSummary).toHaveLength(1);
    expect(augustSummary[0]).toMatchObject({ studentName: '小明', attended: 1, absent: 1 });
  });
});
