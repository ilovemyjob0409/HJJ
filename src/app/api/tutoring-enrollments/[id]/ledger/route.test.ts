import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';
import { createTeacher } from '@/lib/services/teacherService';
import { createProgram, createWindow } from '@/lib/services/tutoringProgramService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

async function setupEnrollment(emailPrefix: string) {
  const teacher = await createTeacher({ name: '林老師', email: `${emailPrefix}-lin@example.com`, password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: `${emailPrefix}-ming@example.com`, password: 'x' });
  const program = await createProgram({ name: '英文個別輔導' });
  await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  return { enrollment, userId };
}

describe('GET /api/tutoring-enrollments/[id]/ledger', () => {
  it('403 when not a student', async () => {
    asAdmin();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it("404 when the enrollment belongs to a different student", async () => {
    const { enrollment } = await setupEnrollment('ledger-route-a');
    const { userId: otherUserId } = await setupEnrollment('ledger-route-b');
    sessionMock.mockResolvedValue({ user: { id: otherUserId, role: 'STUDENT' } });

    const res = await GET({} as never, { params: { id: enrollment.id } });
    expect(res.status).toBe(404);
  });

  it("200 with the logged-in student's own ledger for that enrollment", async () => {
    const { enrollment, userId } = await setupEnrollment('ledger-route-c');
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });

    const res = await GET({} as never, { params: { id: enrollment.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ monthlyQuota: 8, history: [] });
  });
});
