import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';
import { createTeacher } from '@/lib/services/teacherService';
import { createClass, enrollStudent } from '@/lib/services/classService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/classes/[id]/attendance-ledger', () => {
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

  it("404 when the logged-in student isn't enrolled in the class", async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'ledger-route-chen@example.com', password: 'x', subjects: '圍棋' });
    const cls = await createClass({ name: '圍棋A班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const student = await createStudent({ name: '小明', email: 'ledger-route-ming@example.com', password: 'x' });
    const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });

    const res = await GET({} as never, { params: { id: cls.id } });
    expect(res.status).toBe(404);
  });

  it("200 with the logged-in student's own ledger for that class", async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'ledger-route-chen2@example.com', password: 'x', subjects: '圍棋' });
    const cls = await createClass({ name: '圍棋B班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const student = await createStudent({ name: '小華', email: 'ledger-route-hua@example.com', password: 'x' });
    await enrollStudent(cls.id, student.id);
    const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });

    const res = await GET({} as never, { params: { id: cls.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.history).toEqual([]);
  });
});
