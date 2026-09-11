import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET, POST } from './route';
import { POST as PICKUP } from './[id]/pickup/route';
import { POST as CANCEL } from './[id]/cancel/route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';

beforeEach(() => sessionMock.mockReset());

async function makeStudent(email: string) {
  const student = await createStudent({ name: '小明', email, password: 'x' });
  await prisma.pointTransaction.create({
    data: { studentId: student.id, bucket: 'REGULAR', amount: 100, kind: 'TEACHER_AWARD', reason: 'x' },
  });
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  return { student, user: { id: userId } };
}

const asUser = (id: string, role: string, name = '王行政') => sessionMock.mockResolvedValue({ user: { id, role, name } });

function postReq(body: unknown) {
  return new NextRequest('http://x/api/prize-redemptions', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/prize-redemptions (student redeem)', () => {
  it('201 redeems for the logged-in student and returns the code', async () => {
    const { student, user } = await makeStudent('pzr-a@example.com');
    const prize = await prisma.prize.create({ data: { name: '貼紙', points: 10, stock: 1, sortOrder: 0 } });
    asUser(user.id, 'STUDENT');
    const res = await POST(postReq({ prizeId: prize.id }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.deadlineKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('403 for admin/anon; 422 with error code on business failure', async () => {
    const { user } = await makeStudent('pzr-b@example.com');
    asUser('admin-1', 'ADMIN');
    expect((await POST(postReq({ prizeId: 'x' }))).status).toBe(403);
    sessionMock.mockResolvedValue(null);
    expect((await POST(postReq({ prizeId: 'x' }))).status).toBe(403);
    asUser(user.id, 'STUDENT');
    const res = await POST(postReq({ prizeId: 'nope' }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('PRIZE_UNAVAILABLE');
  });
});

describe('GET /api/prize-redemptions', () => {
  it('student sees own rows; admin ?code= finds one; admin default lists pending', async () => {
    const { student, user } = await makeStudent('pzr-c@example.com');
    const prize = await prisma.prize.create({ data: { name: '貼紙', points: 10, stock: 2, sortOrder: 0 } });
    asUser(user.id, 'STUDENT');
    const created = await (await POST(postReq({ prizeId: prize.id }))).json();

    const mineRes = await GET(new NextRequest('http://x/api/prize-redemptions'));
    expect((await mineRes.json())).toHaveLength(1);

    asUser('admin-1', 'ADMIN');
    const byCode = await GET(new NextRequest(`http://x/api/prize-redemptions?code=${created.code}`));
    expect((await byCode.json()).studentName).toBe('小明');
    expect((await GET(new NextRequest('http://x/api/prize-redemptions?code=000000'))).status).toBe(404);
    const pending = await GET(new NextRequest('http://x/api/prize-redemptions'));
    expect(await pending.json()).toHaveLength(1);
  });
});

describe('pickup / cancel routes', () => {
  it('admin pickup succeeds; student cannot pickup; student cancels own PENDING', async () => {
    const { student, user } = await makeStudent('pzr-d@example.com');
    const prize = await prisma.prize.create({ data: { name: '貼紙', points: 10, stock: 2, sortOrder: 0 } });
    asUser(user.id, 'STUDENT');
    const created = await (await POST(postReq({ prizeId: prize.id }))).json();

    expect((await PICKUP(postReq({}), { params: { id: created.id } })).status).toBe(403); // 學生不能核銷

    const cancelRes = await CANCEL(postReq({}), { params: { id: created.id } });
    expect(cancelRes.status).toBe(200);
    expect((await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: created.id } })).operator).toBe('學生本人');

    // 再兌一次讓 admin 核銷
    const again = await (await POST(postReq({ prizeId: prize.id }))).json();
    asUser('admin-1', 'ADMIN', '王行政');
    expect((await PICKUP(postReq({}), { params: { id: again.id } })).status).toBe(200);
    expect((await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: again.id } })).operator).toBe('王行政');
  });
});
