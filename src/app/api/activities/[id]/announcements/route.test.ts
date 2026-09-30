import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(),
  createSignedUrls: vi.fn(async () => new Map()),
  createSignedThumbUrls: vi.fn(async () => new Map()),
  deleteActivityImages: vi.fn(async () => {}),
}));

import { GET, POST } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createActivity, registerForActivity } from '@/lib/services/activityService';

async function fixture() {
  const admin = await prisma.user.create({ data: { name: '王行政', email: 'admin@example.com', password: 'x', role: 'ADMIN' } });
  const teacher = await createTeacher({ name: '陳老師', email: 't1@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '王小明', email: 's1@example.com' });
  const category = await prisma.activityCategory.create({ data: { name: '營隊' } });
  const activity = await createActivity({
    title: '冬令營',
    description: 'd',
    categoryId: category.id,
    startDate: new Date('2099-01-10'),
    endDate: new Date('2099-01-10'),
    capacity: 20,
    teacherIds: [teacher.id],
  });
  return { admin, student, activity };
}

function postReq(id: string, payload: unknown) {
  return new NextRequest(`http://x/api/activities/${id}/announcements`, {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}
const getReq = (id: string) => new NextRequest(`http://x/api/activities/${id}/announcements`);
const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  sessionMock.mockReset();
});

describe('/api/activities/:id/announcements', () => {
  it('403：未登入或非行政（GET 與 POST）', async () => {
    const { activity } = await fixture();
    sessionMock.mockResolvedValue(null);
    expect((await GET(getReq(activity.id), ctx(activity.id))).status).toBe(403);
    sessionMock.mockResolvedValue({ user: { id: 'u', role: 'TEACHER' } });
    expect((await POST(postReq(activity.id, {}), ctx(activity.id))).status).toBe(403);
  });

  it('400：JSON 壞掉、對象不合法、內容空白、超過 200 字', async () => {
    const { admin, activity } = await fixture();
    sessionMock.mockResolvedValue({ user: { id: admin.id, role: 'ADMIN' } });
    const cases: [unknown, string][] = [
      ['{not json', 'INVALID_INPUT'],
      [{ audience: 'EVERYONE', includeTeachers: false, message: 'x' }, 'INVALID_AUDIENCE'],
      [{ audience: 'REGISTERED', includeTeachers: false, message: '   ' }, 'MESSAGE_REQUIRED'],
      [{ audience: 'REGISTERED', includeTeachers: false, message: '字'.repeat(201) }, 'MESSAGE_TOO_LONG'],
    ];
    for (const [payload, error] of cases) {
      const res = await POST(postReq(activity.id, payload), ctx(activity.id));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
  });

  it('404：活動不存在；409：收件人 0 人', async () => {
    const { admin, activity } = await fixture();
    sessionMock.mockResolvedValue({ user: { id: admin.id, role: 'ADMIN' } });
    const payload = { audience: 'REGISTERED', includeTeachers: false, message: 'x' };
    const notFound = await POST(postReq('nope', payload), ctx('nope'));
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: 'NOT_FOUND' });
    const empty = await POST(postReq(activity.id, payload), ctx(activity.id));
    expect(empty.status).toBe(409);
    expect(await empty.json()).toEqual({ error: 'NO_RECIPIENTS' });
  });

  it('201：去頭尾空白後送出，GET 看得到紀錄', async () => {
    const { admin, student, activity } = await fixture();
    await registerForActivity(activity.id, student.id);
    sessionMock.mockResolvedValue({ user: { id: admin.id, role: 'ADMIN' } });
    const res = await POST(
      postReq(activity.id, { audience: 'REGISTERED', includeTeachers: false, message: '  明天記得帶水壺  ' }),
      ctx(activity.id)
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ recipientCount: 1 });
    const list = await (await GET(getReq(activity.id), ctx(activity.id))).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ message: '明天記得帶水壺', recipientCount: 1, sender: { name: '王行政' } });
  });
});
