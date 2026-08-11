import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow } from '@/lib/services/tutoringProgramService';
import { createBooking, adminCancelBooking } from '@/lib/services/tutoringBookingService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'STUDENT' } });

async function setup() {
  const teacher = await createTeacher({ name: '林老師', email: `lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: `ming-${Date.now()}@example.com`, password: 'x' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  const missed = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
  await adminCancelBooking(missed.id, true);
  return { enrollment, missed };
}

describe('GET /api/tutoring-bookings/makeup-eligible', () => {
  it('403 for non-admin', async () => {
    asStudent();
    const res = await GET(new NextRequest('http://x/api/tutoring-bookings/makeup-eligible?enrollmentId=whatever'));
    expect(res.status).toBe(403);
  });

  it('400 when enrollmentId is missing', async () => {
    asAdmin();
    const res = await GET(new NextRequest('http://x/api/tutoring-bookings/makeup-eligible'));
    expect(res.status).toBe(400);
  });

  it('200 with the missed bookings for the given enrollment', async () => {
    asAdmin();
    const { enrollment, missed } = await setup();
    const res = await GET(new NextRequest(`http://x/api/tutoring-bookings/makeup-eligible?enrollmentId=${enrollment.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(missed.id);
  });
});
