import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(),
  createSignedUrls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`]))),
  deleteActivityImages: vi.fn(async () => {}),
}));

import { PUT } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createActivity } from '@/lib/services/activityService';

async function makeFixture() {
  const teacher = await createTeacher({ name: '師', email: `t${Date.now()}@x.com`, password: 'pw', subjects: '棋' });
  const otherTeacher = await createTeacher({ name: '師二', email: `t2${Date.now()}@x.com`, password: 'pw', subjects: '棋' });
  const category = await prisma.activityCategory.create({ data: { name: `c${Date.now()}` } });
  const otherCategory = await prisma.activityCategory.create({ data: { name: `c2${Date.now()}` } });
  const activity = await createActivity({
    title: 'a',
    description: 'd',
    categoryId: category.id,
    startDate: new Date('2026-08-01'),
    endDate: new Date('2026-08-02'),
    capacity: 5,
    teacherIds: [teacher.id],
  });
  return { teacher, otherTeacher, category, otherCategory, activity };
}

function putReq(id: string, body: unknown) {
  return new NextRequest(`http://x/api/activities/${id}`, { method: 'PUT', body: JSON.stringify(body) });
}

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'ADMIN' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'STUDENT' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('PUT /api/activities/:id', () => {
  it('403 when not logged in or not admin', async () => {
    const { activity } = await makeFixture();
    asAnon();
    expect((await PUT(putReq(activity.id, {}), { params: { id: activity.id } })).status).toBe(403);
    asStudent();
    expect((await PUT(putReq(activity.id, {}), { params: { id: activity.id } })).status).toBe(403);
  });

  it('400 when no teacher is selected', async () => {
    const { activity, category } = await makeFixture();
    asAdmin();
    const res = await PUT(
      putReq(activity.id, {
        title: 'b',
        description: 'd',
        categoryId: category.id,
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        capacity: 5,
        teacherIds: [],
      }),
      { params: { id: activity.id } }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('TEACHER_REQUIRED');
  });

  it('200 updates fields and replaces the teacher list', async () => {
    const { activity, otherTeacher, otherCategory } = await makeFixture();
    asAdmin();
    const res = await PUT(
      putReq(activity.id, {
        title: '新標題',
        description: '新描述',
        categoryId: otherCategory.id,
        location: '新地點',
        startDate: '2026-08-10',
        endDate: '2026-08-12',
        capacity: 30,
        teacherIds: [otherTeacher.id],
      }),
      { params: { id: activity.id } }
    );
    expect(res.status).toBe(200);

    const updated = await prisma.activity.findUniqueOrThrow({ where: { id: activity.id }, include: { teachers: true } });
    expect(updated.title).toBe('新標題');
    expect(updated.categoryId).toBe(otherCategory.id);
    expect(updated.location).toBe('新地點');
    expect(updated.startDate).toEqual(new Date('2026-08-10'));
    expect(updated.endDate).toEqual(new Date('2026-08-12'));
    expect(updated.capacity).toBe(30);
    expect(updated.teachers.map((t) => t.teacherId)).toEqual([otherTeacher.id]);
  });
});
