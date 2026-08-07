import { describe, it, expect } from 'vitest';
import {
  toMinutes,
  minutesToHHMM,
  utcDateKey,
  taipeiDateKey,
  countOverlapsInSlot,
  buildSlotRemaining,
  hasCapacityForRange,
  isCancellationLate,
} from './tutoringBookingService';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createProgram, createWindow } from './tutoringProgramService';
import { createBooking, createWalkInBooking, cancelBooking, adminCancelBooking } from './tutoringBookingService';

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
});

describe('createWalkInBooking', () => {
  it('creates a BOOKED booking without checking capacity', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    const walkIn = await createWalkInBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    expect(await prisma.tutoringBooking.count({ where: { windowId: window.id, date: FRIDAY } })).toBe(2);
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: walkIn.id } })).status).toBe('BOOKED');
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
