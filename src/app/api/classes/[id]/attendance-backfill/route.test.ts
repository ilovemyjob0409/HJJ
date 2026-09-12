import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createClass, enrollStudent } from '@/lib/services/classService';

beforeEach(async () => {
  sessionMock.mockReset();
  await prisma.user.create({
    data: { id: 'admin-1', email: 'backfill-admin@example.com', password: 'x', name: '行政', role: 'ADMIN' },
  });
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asTeacher = () => sessionMock.mockResolvedValue({ user: { id: 'u-t', role: 'TEACHER' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: `cellfill-route-chen-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const cls = await createClass({ name: '週三基礎2A', subject: '圍棋', level: '基礎2', teacherId: teacher.id, weekday: 3, startTime: '17:10', endTime: '18:40' });
  const student = await createStudent({ name: '小明', email: `cellfill-route-ming-${Date.now()}@example.com`, password: 'x' });
  await enrollStudent(cls.id, student.id);
  return { cls, student };
}

function post(id: string, body: unknown) {
  return POST(new Request(`http://x/api/classes/${id}/attendance-backfill`, { method: 'POST', body: JSON.stringify(body) }) as never, {
    params: { id },
  });
}

describe('POST /api/classes/[id]/attendance-backfill', () => {
  it('403 when not logged in', async () => {
    asAnon();
    expect((await post('x', { items: [] })).status).toBe(403);
  });

  it('403 for a TEACHER (admin-only, even for their own class)', async () => {
    asTeacher();
    expect((await post('x', { items: [{ studentId: 's', date: '2026-07-08' }] })).status).toBe(403);
  });

  it('400 for a malformed body', async () => {
    asAdmin();
    expect((await post('x', {})).status).toBe(400);
    expect((await post('x', { items: [] })).status).toBe(400);
    expect((await post('x', { items: [{ studentId: 's', date: '7/8' }] })).status).toBe(400);
    expect((await post('x', { items: [{ date: '2026-07-08' }] })).status).toBe(400);
  });

  it('404 for a missing class', async () => {
    asAdmin();
    expect((await post('nonexistent', { items: [{ studentId: 's', date: '2026-07-08' }] })).status).toBe(404);
  });

  it('422 for an invalid date (wrong weekday)', async () => {
    const { cls, student } = await setup();
    asAdmin();
    expect((await post(cls.id, { items: [{ studentId: student.id, date: '2026-07-07' }] })).status).toBe(422);
  });

  it('200 backfills the cell as PRESENT and reports counts', async () => {
    const { cls, student } = await setup();
    asAdmin();

    const res = await post(cls.id, { items: [{ studentId: student.id, date: '2026-07-08' }] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 1, skipped: 0 });
    const row = await prisma.classAttendance.findFirstOrThrow({
      where: { classId: cls.id, studentId: student.id, date: new Date('2026-07-08') },
    });
    expect(row.status).toBe('PRESENT');
    expect(row.markedById).toBe('admin-1');
  });
});
