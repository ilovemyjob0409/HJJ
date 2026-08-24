import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { PATCH } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow, createEnrollment } from '@/lib/services/tutoringProgramService';
import { createBooking } from '@/lib/services/tutoringBookingService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'stu-1', role: 'STUDENT' } });

// 額度 0 → 學生流程第一筆就是 PENDING_ADMIN
async function setupPendingBooking() {
  const teacher = await createTeacher({ name: '林老師', email: `patch-route-t-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const student = await createStudent({ name: '小明', email: `patch-route-s-${Date.now()}@example.com`, password: 'x' });
  const enrollment = await createEnrollment({ studentId: student.id, programId: program.id, monthlyQuota: 0 });
  // 2027-01-01 是星期五，未來日期
  const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2027-01-01'), quotaReview: true });
  return booking;
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
