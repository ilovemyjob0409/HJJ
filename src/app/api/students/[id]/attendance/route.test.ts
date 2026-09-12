import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET, PATCH } from './route';
import { POST as BACKFILL } from './backfill/route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createClass, enrollStudent } from '@/lib/services/classService';
import { saveClassAttendance } from '@/lib/services/attendanceService';

beforeEach(async () => {
  sessionMock.mockReset();
  await prisma.user.create({ data: { id: 'admin-1', email: 'adm@example.com', password: 'x', name: '王行政', role: 'ADMIN' } });
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', name: '王行政' } });

async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: 'sa-chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'sa-ming@example.com', password: 'x' });
  const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
  await enrollStudent(cls.id, student.id);
  return { student, cls };
}

const req = (method: string, body?: unknown) =>
  new NextRequest('http://x/api/students/s/attendance', { method, body: body === undefined ? undefined : JSON.stringify(body) });

describe('GET /api/students/[id]/attendance', () => {
  it('403 for non-admin; admin gets rows + backfill groups', async () => {
    const { student, cls } = await setup();
    await saveClassAttendance(cls.id, new Date(Date.UTC(2026, 7, 4)), 'admin-1', [{ studentId: student.id, status: 'PRESENT' }]);

    sessionMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    expect((await GET(req('GET'), { params: { id: student.id } })).status).toBe(403);

    asAdmin();
    const res = await GET(req('GET'), { params: { id: student.id } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { type: string; classId?: string }[]; backfill: { classId: string; dates: string[] }[] };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].classId).toBe(cls.id);
    expect(body.backfill[0].classId).toBe(cls.id);
    expect(body.backfill[0].dates.length).toBeGreaterThan(0);
  });
});

describe('PATCH /api/students/[id]/attendance', () => {
  it('edits a class record and rejects bad time input', async () => {
    const { student, cls } = await setup();
    const date = new Date(Date.UTC(2026, 7, 4));
    await saveClassAttendance(cls.id, date, 'admin-1', [{ studentId: student.id, status: 'ABSENT' }]);

    asAdmin();
    const bad = await PATCH(req('PATCH', { type: 'CLASS', date: date.toISOString(), status: 'PRESENT', checkInTime: '25:99', classId: cls.id }), { params: { id: student.id } });
    expect(bad.status).toBe(400);

    const ok = await PATCH(req('PATCH', { type: 'CLASS', date: date.toISOString(), status: 'PRESENT', checkInTime: '14:05', checkOutTime: null, classId: cls.id }), { params: { id: student.id } });
    expect(ok.status).toBe(200);
    const rec = await prisma.classAttendance.findFirstOrThrow({ where: { studentId: student.id } });
    expect(rec.status).toBe('PRESENT');
    expect(rec.checkInTime).toBe('14:05');
  });
});

describe('POST /api/students/[id]/attendance/backfill', () => {
  it('backfills checked dates as PRESENT and reports counts', async () => {
    const { student, cls } = await setup();
    asAdmin();
    const res = await BACKFILL(req('POST', { items: [{ classId: cls.id, date: '2026-08-18' }] }), { params: { id: student.id } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 1, skipped: 0 });
    const rec = await prisma.classAttendance.findFirstOrThrow({ where: { studentId: student.id, date: new Date(Date.UTC(2026, 7, 18)) } });
    expect(rec.status).toBe('PRESENT');
  });
});
