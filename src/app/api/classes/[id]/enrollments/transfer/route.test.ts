import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createClass, setStudentEnrollments } from '@/lib/services/classService';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST } from './route';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });

async function setupFixtures() {
  const teacher = await createTeacher({ name: '陳老師', email: 'transfer-api-chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小轉', email: 'transfer-api-ming@example.com', password: 'x' });
  const classA = await createClass({ name: '圍棋原班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
  const classB = await createClass({ name: '圍棋新班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
  return { student, classA, classB };
}

function makeReq(fromClassId: string, body: unknown) {
  return new NextRequest(`http://x/api/classes/${fromClassId}/enrollments/transfer`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/classes/[id]/enrollments/transfer', () => {
  it('403 for non-ADMIN', async () => {
    asStudent();
    const res = await POST(makeReq('cls-1', { studentId: 's1', toClassId: 'cls-2' }), { params: { id: 'cls-1' } });
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN, moves the enrollment and returns the new one', async () => {
    asAdmin();
    const { student, classA, classB } = await setupFixtures();
    await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: 12 }]);

    const res = await POST(makeReq(classA.id, { studentId: student.id, toClassId: classB.id }), { params: { id: classA.id } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.classId).toBe(classB.id);
    expect(body.totalSessions).toBe(12);
    expect(await prisma.classEnrollment.count({ where: { studentId: student.id, classId: classA.id } })).toBe(0);
    expect(await prisma.classEnrollment.count({ where: { studentId: student.id, classId: classB.id } })).toBe(1);
  });

  it('422 with the service error message when already enrolled in the target', async () => {
    asAdmin();
    const { student, classA, classB } = await setupFixtures();
    await setStudentEnrollments(student.id, [
      { classId: classA.id, totalSessions: 12 },
      { classId: classB.id, totalSessions: 5 },
    ]);

    const res = await POST(makeReq(classA.id, { studentId: student.id, toClassId: classB.id }), { params: { id: classA.id } });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('ALREADY_ENROLLED');
  });
});
