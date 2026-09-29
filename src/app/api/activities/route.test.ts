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

import { POST } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';

async function fixture() {
  const teacher = await createTeacher({ name: '陳老師', email: 't1@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '王小明', email: 's1@example.com' });
  const category = await prisma.activityCategory.create({ data: { name: '營隊' } });
  const studentUser = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  return { teacher, category, studentUserId: studentUser.userId };
}

function body(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  return {
    title: '冬令營',
    description: 'd',
    categoryId: f.category.id,
    startDate: '2099-01-10',
    endDate: '2099-01-10',
    capacity: 20,
    teacherIds: [f.teacher.id],
    ...extra,
  };
}

function postReq(payload: unknown) {
  return new NextRequest('http://x/api/activities', { method: 'POST', body: JSON.stringify(payload) });
}

beforeEach(() => {
  sessionMock.mockReset();
  sessionMock.mockResolvedValue({ user: { id: 'u', role: 'ADMIN' } });
});

describe('POST /api/activities 發布通知旗標', () => {
  it('notifyStudents: true → 學生收到新活動通知', async () => {
    const f = await fixture();
    const res = await POST(postReq(body(f, { notifyStudents: true })));
    expect(res.status).toBe(201);
    expect(await prisma.notification.count({ where: { userId: f.studentUserId, title: '新活動開放報名' } })).toBe(1);
  });

  it('沒帶 notifyStudents → 視為 false，學生收不到', async () => {
    const f = await fixture();
    const res = await POST(postReq(body(f)));
    expect(res.status).toBe(201);
    expect(await prisma.notification.count({ where: { userId: f.studentUserId } })).toBe(0);
  });
});
