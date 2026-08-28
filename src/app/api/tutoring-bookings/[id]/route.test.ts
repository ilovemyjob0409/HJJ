import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { PATCH, DELETE } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow, createEnrollment } from '@/lib/services/tutoringProgramService';
import { createBooking, taipeiDateKey } from '@/lib/services/tutoringBookingService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'stu-1', role: 'STUDENT' } });

// 下個月的第一個星期五（永遠在未來，配合 weekday 5 的測試窗口；不寫死日期避免過期）
function nextMonthFirstFriday(): Date {
  const [y, m] = taipeiDateKey(new Date()).split('-').map(Number);
  const first = new Date(Date.UTC(y, m, 1));
  return new Date(Date.UTC(y, m, 1 + ((5 - first.getUTCDay() + 7) % 7)));
}

// 額度 0 → 學生流程第一筆就是 PENDING_ADMIN
async function setupPendingBooking() {
  const teacher = await createTeacher({ name: '林老師', email: `patch-route-t-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const student = await createStudent({ name: '小明', email: `patch-route-s-${Date.now()}@example.com`, password: 'x' });
  const enrollment = await createEnrollment({ studentId: student.id, programId: program.id, monthlyQuota: 0 });
  const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: nextMonthFirstFriday(), quotaReview: true });
  return booking;
}

// 一筆普通 BOOKED 預約，附帶該學生的 userId（DELETE 的學生分支用 session.user.id 找
// Student）。createTeacher/createStudent 回傳的 user 只挑 SAFE_USER_SELECT（沒有
// id），userId 另外查表拿。
async function setupBookedBooking() {
  const teacher = await createTeacher({ name: '林老師', email: `delete-route-t-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const student = await createStudent({ name: '小明', email: `delete-route-s-${Date.now()}@example.com`, password: 'x' });
  const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });
  const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: nextMonthFirstFriday() });
  const { userId: teacherUserId } = await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } });
  const { userId: studentUserId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  return { booking, teacherUserId, studentUserId };
}

function patchReq(body: unknown) {
  return { json: async () => body } as never;
}

describe('PATCH /api/tutoring-bookings/[id]', () => {
  it('403：非 ADMIN', async () => {
    asStudent();
    const res = await PATCH(patchReq({ action: 'approve' }), { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('400：action 不合法', async () => {
    asAdmin();
    const res = await PATCH(patchReq({ action: 'oops' }), { params: { id: 'x' } });
    expect(res.status).toBe(400);
  });

  it('核准成功，DB 狀態轉 BOOKED', async () => {
    asAdmin();
    const booking = await setupPendingBooking();
    const res = await PATCH(patchReq({ action: 'approve' }), { params: { id: booking.id } });
    expect(res.status).toBe(200);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('BOOKED');
  });

  it('駁回成功，DB 狀態轉 REJECTED', async () => {
    asAdmin();
    const booking = await setupPendingBooking();
    const res = await PATCH(patchReq({ action: 'reject' }), { params: { id: booking.id } });
    expect(res.status).toBe(200);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('REJECTED');
  });

  it('409：重複審核', async () => {
    asAdmin();
    const booking = await setupPendingBooking();
    await PATCH(patchReq({ action: 'approve' }), { params: { id: booking.id } });
    const res = await PATCH(patchReq({ action: 'reject' }), { params: { id: booking.id } });
    expect(res.status).toBe(409);
  });

  it('404：不存在的 id', async () => {
    asAdmin();
    const res = await PATCH(patchReq({ action: 'approve' }), { params: { id: 'no-such-id' } });
    expect(res.status).toBe(404);
  });
});

function deleteReq() {
  return {} as never;
}

describe('DELETE /api/tutoring-bookings/[id]', () => {
  it('行政取消成功，DB 狀態轉 CANCELLED', async () => {
    asAdmin();
    const { booking } = await setupBookedBooking();
    const res = await DELETE(deleteReq(), { params: { id: booking.id } });
    expect(res.status).toBe(200);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('CANCELLED');
  });

  it('行政取消：404 不存在的 id', async () => {
    asAdmin();
    const res = await DELETE(deleteReq(), { params: { id: 'no-such-id' } });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('BOOKING_NOT_FOUND');
  });

  it('行政取消：已點名的預約回 422 BOOKING_HAS_ATTENDANCE，DB 狀態維持 BOOKED', async () => {
    asAdmin();
    const { booking, teacherUserId } = await setupBookedBooking();
    await prisma.tutoringAttendance.create({ data: { bookingId: booking.id, status: 'PRESENT', markedById: teacherUserId } });
    const res = await DELETE(deleteReq(), { params: { id: booking.id } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('BOOKING_HAS_ATTENDANCE');
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('BOOKED');
  });

  it('學生取消：已點名的預約回 422 BOOKING_HAS_ATTENDANCE', async () => {
    const { booking, teacherUserId, studentUserId } = await setupBookedBooking();
    await prisma.tutoringAttendance.create({ data: { bookingId: booking.id, status: 'PRESENT', markedById: teacherUserId } });
    sessionMock.mockResolvedValue({ user: { id: studentUserId, role: 'STUDENT' } });
    const res = await DELETE(deleteReq(), { params: { id: booking.id } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('BOOKING_HAS_ATTENDANCE');
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('BOOKED');
  });
});
