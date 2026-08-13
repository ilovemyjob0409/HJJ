import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createClass, enrollStudent } from '@/lib/services/classService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'STUDENT' } });

async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: `overview-route-chen-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const cls = await createClass({ name: '週三基礎2A', subject: '圍棋', level: '基礎2', teacherId: teacher.id, weekday: 3, startTime: '17:10', endTime: '18:40' });
  const student = await createStudent({ name: '小明', email: `overview-route-ming-${Date.now()}@example.com`, password: 'x' });
  await enrollStudent(cls.id, student.id);
  return { teacher, cls, student };
}

describe('GET /api/classes/[id]/attendance-overview', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('403 for a STUDENT', async () => {
    asStudent();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('404 when the class does not exist (admin)', async () => {
    asAdmin();
    const res = await GET({} as never, { params: { id: 'nonexistent-class-id' } });
    expect(res.status).toBe(404);
  });

  it('403 for a TEACHER who does not teach this class', async () => {
    const { cls } = await setup();
    const other = await createTeacher({ name: '林老師', email: `overview-route-lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: other.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'TEACHER' } });

    const res = await GET({} as never, { params: { id: cls.id } });
    expect(res.status).toBe(403);
  });

  it("200 with class info and students for the class's own TEACHER", async () => {
    const { teacher, cls, student } = await setup();
    const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'TEACHER' } });

    const res = await GET({} as never, { params: { id: cls.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.class).toMatchObject({ id: cls.id, name: '週三基礎2A', subject: '圍棋', level: '基礎2', weekday: 3, teacherName: '陳老師' });
    expect(body.students).toEqual([{ studentId: student.id, studentName: '小明', records: [] }]);
  });

  it('200 for ADMIN on any class', async () => {
    const { cls } = await setup();
    asAdmin();
    const res = await GET({} as never, { params: { id: cls.id } });
    expect(res.status).toBe(200);
  });
});
