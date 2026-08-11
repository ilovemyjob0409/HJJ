import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow } from '@/lib/services/tutoringProgramService';
import { createBooking, adminCancelBooking } from '@/lib/services/tutoringBookingService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asStudent = (userId: string) => sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });

// 2026-08-07 is a Friday (weekday 5), matching the fixture window below.
const FRIDAY = new Date('2026-08-07');

async function setupMissedBooking(capacity = 8) {
  const teacher = await createTeacher({ name: '林老師', email: `lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: `ming-${Date.now()}@example.com`, password: 'x' });
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
  await adminCancelBooking(original.id, true); // CANCELLED_LATE, eligible for makeup
  return { studentUserId: userId, window, enrollment, original };
}

function postBody(windowId: string) {
  return new NextRequest('http://x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ windowId, date: '2026-08-07' }),
  });
}

describe('POST /api/tutoring-bookings/[id]/makeup', () => {
  it('ADMIN: creates the makeup booking already BOOKED, skipping the approval queue', async () => {
    const { window, original } = await setupMissedBooking();
    asAdmin();
    const res = await POST(postBody(window.id), { params: { id: original.id } });
    expect(res.status).toBe(201);
    const body = await res.json();
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.status).toBe('BOOKED');
    expect(row.kind).toBe('MAKEUP');
  });

  it('STUDENT owner: still lands PENDING_ADMIN awaiting approval', async () => {
    const { studentUserId, window, original } = await setupMissedBooking();
    asStudent(studentUserId);
    const res = await POST(postBody(window.id), { params: { id: original.id } });
    expect(res.status).toBe(201);
    const body = await res.json();
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.status).toBe('PENDING_ADMIN');
  });

  it('STUDENT non-owner: 403', async () => {
    const { window, original } = await setupMissedBooking();
    const otherStudent = await createStudent({ name: '小華', email: `hua-${Date.now()}@example.com`, password: 'x' });
    const { userId: otherUserId } = await prisma.student.findUniqueOrThrow({ where: { id: otherStudent.id }, select: { userId: true } });
    asStudent(otherUserId);
    const res = await POST(postBody(window.id), { params: { id: original.id } });
    expect(res.status).toBe(403);
  });

  it('ADMIN: WINDOW_FULL surfaces as 409 without auto-approving', async () => {
    const { window, enrollment, original } = await setupMissedBooking(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });

    asAdmin();
    const res = await POST(postBody(window.id), { params: { id: original.id } });
    expect(res.status).toBe(409);
  });
});
