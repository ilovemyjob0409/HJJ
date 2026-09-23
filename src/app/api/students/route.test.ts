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

beforeEach(async () => {
  sessionMock.mockReset();
  await prisma.user.create({ data: { id: 'admin-1', email: 'adm@example.com', password: 'x', name: '王行政', role: 'ADMIN' } });
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', name: '王行政' } });

const req = (url: string) => new NextRequest(url);

describe('GET /api/students', () => {
  it('403 for non-admin', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    const res = await GET(req('http://x/api/students'));
    expect(res.status).toBe(403);
  });

  it('沒帶 withBacklog 時 makeupBacklog 一律為空值', async () => {
    asAdmin();
    const teacher = await createTeacher({ name: '陳老師', email: 'route-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'route-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await enrollStudent(cls.id, student.id);
    await prisma.leaveRequest.create({ data: { studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 0, 3)), reason: 'x' } });

    const res = await GET(req('http://x/api/students'));
    const rows = await res.json();
    const me = rows.find((r: { id: string }) => r.id === student.id);
    expect(me.enrollments[0].makeupBacklog).toEqual({ count: 0, items: [] });
  });

  it('withBacklog=1 時附上未補堂數', async () => {
    asAdmin();
    const teacher = await createTeacher({ name: '陳老師', email: 'route-chen2@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'route-ming2@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await enrollStudent(cls.id, student.id);
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    await prisma.enrollmentPeriod.deleteMany({ where: { enrollmentId: enrollment.id } });
    await prisma.leaveRequest.create({ data: { studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 0, 3)), reason: 'x' } });

    const res = await GET(req('http://x/api/students?withBacklog=1'));
    const rows = await res.json();
    const me = rows.find((r: { id: string }) => r.id === student.id);
    expect(me.enrollments[0].makeupBacklog.count).toBe(1);
  });
});
