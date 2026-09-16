import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createClass } from '@/lib/services/classService';

beforeEach(() => sessionMock.mockReset());

const asUser = (id: string, role: string) => sessionMock.mockResolvedValue({ user: { id, role } });

function postReq(body: unknown) {
  return new NextRequest('http://x/api/substitute-requests', { method: 'POST', body: JSON.stringify(body) });
}

async function makeClassWithTeacher(emailTag: string) {
  const teacher = await createTeacher({ name: '陳老師', email: `${emailTag}@example.com`, password: 'x', subjects: '數學' });
  const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
  const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } });
  return { teacher, cls, teacherUserId: userId };
}

describe('POST /api/substitute-requests (admin 幫老師請假)', () => {
  it('201 creates a PENDING_ASSIGNMENT request with the original teacher derived from the class', async () => {
    const { teacher, cls } = await makeClassWithTeacher('subrt-a');
    asUser('admin-1', 'ADMIN');

    // 2026-07-20 是週一
    const res = await POST(postReq({ classId: cls.id, date: '2026-07-20', reason: '家中有事' }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('PENDING_ASSIGNMENT');
    expect(body.originalTeacherId).toBe(teacher.id);
  });

  it('201 assigns directly when substituteTeacherId is provided', async () => {
    const { cls } = await makeClassWithTeacher('subrt-b');
    const substitute = await createTeacher({ name: '林老師', email: 'subrt-c@example.com', password: 'x', subjects: '數學' });
    asUser('admin-1', 'ADMIN');

    const res = await POST(postReq({ classId: cls.id, date: '2026-07-20', reason: '出差', substituteTeacherId: substitute.id }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('ASSIGNED');
    expect(body.substituteTeacherId).toBe(substitute.id);
  });

  it('422 INVALID_WEEKDAY when the date does not fall on the class weekday', async () => {
    const { cls } = await makeClassWithTeacher('subrt-d');
    asUser('admin-1', 'ADMIN');

    // 2026-07-21 是週二，班級週一上課
    const res = await POST(postReq({ classId: cls.id, date: '2026-07-21', reason: '出差' }));

    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('INVALID_WEEKDAY');
  });
});

describe('POST /api/substitute-requests (existing teacher flow + auth)', () => {
  it('201 keeps the teacher self-request flow working', async () => {
    const { teacher, cls, teacherUserId } = await makeClassWithTeacher('subrt-e');
    asUser(teacherUserId, 'TEACHER');

    const res = await POST(postReq({ classId: cls.id, date: '2026-07-20', reason: '進修' }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('PENDING_ASSIGNMENT');
    expect(body.originalTeacherId).toBe(teacher.id);
  });

  it('500 INTERNAL without leaking the raw error for an unknown classId', async () => {
    asUser('admin-1', 'ADMIN');
    const res = await POST(postReq({ classId: 'nope', date: '2026-07-20', reason: '出差' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('INTERNAL');
  });

  it('403 for students and anonymous users', async () => {
    asUser('student-1', 'STUDENT');
    expect((await POST(postReq({}))).status).toBe(403);
    sessionMock.mockResolvedValue(null);
    expect((await POST(postReq({}))).status).toBe(403);
  });
});
