import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createSessions } from '@/lib/services/goHallService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asTeacher = () => sessionMock.mockResolvedValue({ user: { id: 'teacher-1', role: 'TEACHER' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

function postReq(body: unknown) {
  return new NextRequest('http://x/api/go-hall-registrations', { method: 'POST', body: JSON.stringify(body) });
}

async function makeSession(date: Date, capacity = 8) {
  const teacher = await createTeacher({ name: '陳老師', email: 'gh-reg-route-chen@example.com', password: 'x', subjects: '圍棋' });
  await createSessions({ dates: [date], startTime: '14:00', endTime: '16:00', capacity, teacherId: teacher.id });
  return prisma.goHallSession.findFirstOrThrow();
}

describe('POST /api/go-hall-registrations (admin on behalf of a student)', () => {
  it('201 registers the given student, even beyond capacity', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const session = await makeSession(tomorrow, 1);
    const studentA = await createStudent({ name: '小明', email: 'gh-reg-route-ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'gh-reg-route-hua@example.com', password: 'x' });
    await prisma.goHallRegistration.create({ data: { sessionId: session.id, studentId: studentA.id } });

    asAdmin();
    const res = await POST(postReq({ sessionId: session.id, studentId: studentB.id }));
    expect(res.status).toBe(201);
    const count = await prisma.goHallRegistration.count({ where: { sessionId: session.id } });
    expect(count).toBe(2);
  });

  it('400 SESSION_EXPIRED for a past session', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const session = await makeSession(yesterday);
    const student = await createStudent({ name: '小明', email: 'gh-reg-route-ming@example.com', password: 'x' });

    asAdmin();
    const res = await POST(postReq({ sessionId: session.id, studentId: student.id }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('SESSION_EXPIRED');
  });

  it('409 ALREADY_REGISTERED when the student already has a registration', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const session = await makeSession(tomorrow);
    const student = await createStudent({ name: '小明', email: 'gh-reg-route-ming@example.com', password: 'x' });
    await prisma.goHallRegistration.create({ data: { sessionId: session.id, studentId: student.id } });

    asAdmin();
    const res = await POST(postReq({ sessionId: session.id, studentId: student.id }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('ALREADY_REGISTERED');
  });

  it('400 when studentId is missing', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const session = await makeSession(tomorrow);

    asAdmin();
    const res = await POST(postReq({ sessionId: session.id }));
    expect(res.status).toBe(400);
  });

  it('403 for TEACHER and anonymous', async () => {
    asTeacher();
    expect((await POST(postReq({ sessionId: 'x', studentId: 'y' }))).status).toBe(403);
    asAnon();
    expect((await POST(postReq({ sessionId: 'x', studentId: 'y' }))).status).toBe(403);
  });
});

describe('POST /api/go-hall-registrations (student self-registration)', () => {
  it('registers the logged-in student and ignores any studentId in the body', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const session = await makeSession(tomorrow);
    const self = await createStudent({ name: '小明', email: 'gh-reg-route-ming@example.com', password: 'x' });
    const other = await createStudent({ name: '小華', email: 'gh-reg-route-hua@example.com', password: 'x' });
    const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: self.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });

    const res = await POST(postReq({ sessionId: session.id, studentId: other.id }));
    expect(res.status).toBe(201);
    const registration = await prisma.goHallRegistration.findFirstOrThrow({ where: { sessionId: session.id } });
    expect(registration.studentId).toBe(self.id);
  });
});
