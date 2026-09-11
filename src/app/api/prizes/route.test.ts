import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET, POST } from './route';
import { PATCH, DELETE } from './[id]/route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';

beforeEach(() => sessionMock.mockReset());

async function makeStudent(email: string) {
  const student = await createStudent({ name: '學生甲', email, password: 'x' });
  await prisma.pointTransaction.create({
    data: { studentId: student.id, bucket: 'REGULAR', amount: 100, kind: 'TEACHER_AWARD', reason: 'x' },
  });
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  return { student, user: { id: userId } };
}

const asUser = (id: string, role: string, name = '王行政') => sessionMock.mockResolvedValue({ user: { id, role, name } });

function postReq(body: unknown) {
  return new NextRequest('http://x/api/prizes', { method: 'POST', body: JSON.stringify(body) });
}

describe('GET /api/prizes', () => {
  it('403 for anonymous user', async () => {
    sessionMock.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('student sees listPrizesForStudent with alreadyRedeemed field', async () => {
    const { user } = await makeStudent('prizes-get-student@example.com');
    const prize = await prisma.prize.create({ data: { name: '貼紙', points: 10, stock: 5, sortOrder: 0, active: true } });
    asUser(user.id, 'STUDENT');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    const item = body.find((p) => (p as Record<string, unknown>).id === prize.id);
    expect(item).toBeDefined();
    expect(item!.name).toBe('貼紙');
    expect(item!.points).toBe(10);
    expect(item!.stock).toBe(5);
    expect(item!.alreadyRedeemed).toBe(false);
    expect(item!.active).toBeUndefined(); // student should not see active field
  });

  it('admin sees listPrizesForAdmin with active field', async () => {
    const prize = await prisma.prize.create({ data: { name: '獎牌', points: 20, stock: 3, sortOrder: 1, active: false } });
    asUser('admin-1', 'ADMIN');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>[];
    expect(Array.isArray(body)).toBe(true);
    const item = body.find((p) => (p as Record<string, unknown>).id === prize.id);
    expect(item).toBeDefined();
    expect(item!.active).toBe(false);
    expect(item!.sortOrder).toBe(1);
  });
});

describe('POST /api/prizes', () => {
  it('403 for student', async () => {
    const { user } = await makeStudent('prizes-post-student@example.com');
    asUser(user.id, 'STUDENT');
    const res = await POST(postReq({ name: 'test', points: 10, stock: 1, sortOrder: 0 }));
    expect(res.status).toBe(403);
  });

  it('201 for admin creating prize', async () => {
    asUser('admin-1', 'ADMIN');
    const res = await POST(postReq({ name: '貼紙', points: 15, stock: 10, sortOrder: 5 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('貼紙');
    expect(body.points).toBe(15);
    expect(body.stock).toBe(10);
  });

  it('422 with INVALID_POINTS when admin sends points:0', async () => {
    asUser('admin-1', 'ADMIN');
    const res = await POST(postReq({ name: '獎牌', points: 0, stock: 5, sortOrder: 0 }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('INVALID_POINTS');
  });

  it('400 with INVALID_INPUT when admin sends an empty body', async () => {
    asUser('admin-1', 'ADMIN');
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_INPUT');
  });
});

describe('PATCH /api/prizes/[id]', () => {
  it('403 for student', async () => {
    const { user } = await makeStudent('prizes-patch-student@example.com');
    const prize = await prisma.prize.create({ data: { name: '獎牌', points: 10, stock: 1, sortOrder: 0 } });
    asUser(user.id, 'STUDENT');
    const req = new NextRequest('http://x/api/prizes/' + prize.id, { method: 'PATCH', body: JSON.stringify({ name: 'new' }) });
    const res = await PATCH(req, { params: { id: prize.id } });
    expect(res.status).toBe(403);
  });

  it('404 for admin trying to update non-existent prize', async () => {
    asUser('admin-1', 'ADMIN');
    const req = new NextRequest('http://x/api/prizes/nonexistent', { method: 'PATCH', body: JSON.stringify({ name: 'test' }) });
    const res = await PATCH(req, { params: { id: 'nonexistent' } });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/prizes/[id]/image', () => {
  it('403 for student', async () => {
    const { user } = await makeStudent('prizes-image-student@example.com');
    const prize = await prisma.prize.create({ data: { name: '獎牌', points: 10, stock: 1, sortOrder: 0 } });
    asUser(user.id, 'STUDENT');
    // We can't easily test formData with NextRequest, so we'll just test the auth check
    const formData = new FormData();
    const req = new NextRequest('http://x/api/prizes/' + prize.id + '/image', { method: 'POST', body: formData });
    const { POST } = await import('./[id]/image/route');
    const res = await POST(req, { params: { id: prize.id } });
    expect(res.status).toBe(403);
  });

  it('400 INVALID_FILE for admin not providing file', async () => {
    const prize = await prisma.prize.create({ data: { name: '獎牌', points: 10, stock: 1, sortOrder: 0 } });
    asUser('admin-1', 'ADMIN');
    const formData = new FormData();
    // Don't add any file
    const req = new NextRequest('http://x/api/prizes/' + prize.id + '/image', { method: 'POST', body: formData });
    const { POST: postImage } = await import('./[id]/image/route');
    const res = await postImage(req, { params: { id: prize.id } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('INVALID_FILE');
  });
});

describe('DELETE /api/prizes/[id]', () => {
  const delReq = () => new NextRequest('http://x/api/prizes/x', { method: 'DELETE' });

  it('403 for student; admin deletes never-redeemed prize; 422 with records; 404 unknown', async () => {
    const { student, user } = await makeStudent('prizes-del@example.com');
    const clean = await prisma.prize.create({ data: { name: '無紀錄品', points: 5, stock: 1, sortOrder: 0 } });
    const used = await prisma.prize.create({ data: { name: '有紀錄品', points: 5, stock: 1, sortOrder: 1 } });
    await prisma.prizeRedemption.create({
      data: { studentId: student.id, prizeId: used.id, prizeName: '有紀錄品', redeemOnlyUsed: 0, regularUsed: 5 },
    });

    asUser(user.id, 'STUDENT');
    expect((await DELETE(delReq(), { params: { id: clean.id } })).status).toBe(403);

    asUser('admin-1', 'ADMIN');
    expect((await DELETE(delReq(), { params: { id: clean.id } })).status).toBe(200);
    expect(await prisma.prize.findUnique({ where: { id: clean.id } })).toBeNull();

    const res = await DELETE(delReq(), { params: { id: used.id } });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('HAS_REDEMPTIONS');

    expect((await DELETE(delReq(), { params: { id: 'nope' } })).status).toBe(404);
  });
});
