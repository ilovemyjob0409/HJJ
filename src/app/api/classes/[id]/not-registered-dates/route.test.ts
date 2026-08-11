import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET, PUT } from './route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';
import { createTeacher } from '@/lib/services/teacherService';
import { createClass, setStudentEnrollments } from '@/lib/services/classService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

async function setup(emailPrefix: string) {
  const admin = await prisma.user.create({
    data: { email: `${emailPrefix}-admin@example.com`, password: 'x', name: '行政', role: 'ADMIN' },
  });
  const teacher = await createTeacher({ name: '陳老師', email: `${emailPrefix}-chen@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `${emailPrefix}-ming@example.com`, password: 'x' });
  const cls = await createClass({ name: '週五班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 5, startTime: '14:00', endTime: '16:00' });
  await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 10 }]);
  sessionMock.mockResolvedValue({ user: { id: admin.id, role: 'ADMIN' } });
  return { student, cls };
}

const getReq = (studentId?: string) =>
  new NextRequest(`http://x/api/classes/whatever/not-registered-dates${studentId ? `?studentId=${studentId}` : ''}`);
const putReq = (body: unknown) =>
  new NextRequest('http://x/api/classes/whatever/not-registered-dates', { method: 'PUT', body: JSON.stringify(body) });

describe('GET/PUT /api/classes/[id]/not-registered-dates', () => {
  it('403 when not an admin', async () => {
    asStudent();
    expect((await GET(getReq('s'), { params: { id: 'c' } })).status).toBe(403);
    expect((await PUT(putReq({ studentId: 's', dates: [] }), { params: { id: 'c' } })).status).toBe(403);
    asAnon();
    expect((await GET(getReq('s'), { params: { id: 'c' } })).status).toBe(403);
  });

  it('400 when studentId or dates is missing', async () => {
    await setup('nr-route-a');
    expect((await GET(getReq(), { params: { id: 'c' } })).status).toBe(400);
    expect((await PUT(putReq({ studentId: 's' }), { params: { id: 'c' } })).status).toBe(400);
  });

  it('404 when the student is not enrolled in the class', async () => {
    const { cls } = await setup('nr-route-b');
    const outsider = await createStudent({ name: '小華', email: 'nr-route-b-hua@example.com', password: 'x' });
    expect((await GET(getReq(outsider.id), { params: { id: cls.id } })).status).toBe(404);
    expect((await PUT(putReq({ studentId: outsider.id, dates: [] }), { params: { id: cls.id } })).status).toBe(404);
  });

  it('PUT syncs the dates and GET reads them back', async () => {
    const { student, cls } = await setup('nr-route-c');

    const putRes = await PUT(putReq({ studentId: student.id, dates: ['2099-01-02', '2099-01-09'] }), { params: { id: cls.id } });
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).dates).toEqual(['2099-01-02', '2099-01-09']);

    const getRes = await GET(getReq(student.id), { params: { id: cls.id } });
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).dates).toEqual(['2099-01-02', '2099-01-09']);
  });

  it('422 INVALID_DATE for a wrong-weekday date', async () => {
    const { student, cls } = await setup('nr-route-d');
    const res = await PUT(putReq({ studentId: student.id, dates: ['2099-01-03'] }), { params: { id: cls.id } }); // Saturday
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('INVALID_DATE');
  });
});
