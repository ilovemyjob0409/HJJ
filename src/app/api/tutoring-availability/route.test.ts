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

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asStudent = (userId: string) => sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

async function setup() {
  const teacher = await createTeacher({ name: '林老師', email: `lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: `ming-${Date.now()}@example.com`, password: 'x' });
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  const program = await createProgram({ name: '英文個別輔導' });
  await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  return { studentUserId: userId, enrollment };
}

describe('GET /api/tutoring-availability', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET(new NextRequest('http://x/api/tutoring-availability?enrollmentId=whatever'));
    expect(res.status).toBe(403);
  });

  it('400 when enrollmentId is missing', async () => {
    asAdmin();
    const res = await GET(new NextRequest('http://x/api/tutoring-availability'));
    expect(res.status).toBe(400);
  });

  it('200 for ADMIN querying any enrollment, no ownership check', async () => {
    asAdmin();
    const { enrollment } = await setup();
    const res = await GET(new NextRequest(`http://x/api/tutoring-availability?enrollmentId=${enrollment.id}`));
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('404 for ADMIN querying a nonexistent enrollment', async () => {
    asAdmin();
    const res = await GET(new NextRequest('http://x/api/tutoring-availability?enrollmentId=nonexistent'));
    expect(res.status).toBe(404);
  });

  it('403 when a STUDENT queries an enrollment that is not their own', async () => {
    const { enrollment } = await setup();
    const otherStudent = await createStudent({ name: '小華', email: `hua-${Date.now()}@example.com`, password: 'x' });
    const { userId: otherUserId } = await prisma.student.findUniqueOrThrow({ where: { id: otherStudent.id }, select: { userId: true } });
    asStudent(otherUserId);
    const res = await GET(new NextRequest(`http://x/api/tutoring-availability?enrollmentId=${enrollment.id}`));
    expect(res.status).toBe(403);
  });

  it('200 when a STUDENT queries their own enrollment', async () => {
    const { studentUserId, enrollment } = await setup();
    asStudent(studentUserId);
    const res = await GET(new NextRequest(`http://x/api/tutoring-availability?enrollmentId=${enrollment.id}`));
    expect(res.status).toBe(200);
  });
});
