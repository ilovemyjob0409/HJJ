import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST } from './route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';
import { setSiblings } from '@/lib/services/familyService';

function postReq(body: unknown) {
  return new Request('http://x/api/auth/family-switch-token', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function userIdOf(studentId: string): Promise<string> {
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  return student.userId;
}

beforeEach(() => {
  sessionMock.mockReset();
});

describe('POST /api/auth/family-switch-token', () => {
  it('403 when not logged in', async () => {
    sessionMock.mockResolvedValue(null);
    const res = await POST(postReq({ targetStudentId: 'whatever' }));
    expect(res.status).toBe(403);
  });

  it('403 for a non-student role', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u', role: 'ADMIN' } });
    const res = await POST(postReq({ targetStudentId: 'whatever' }));
    expect(res.status).toBe(403);
  });

  it('403 when the caller has no family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b@x.com', password: 'pw' });
    sessionMock.mockResolvedValue({ user: { id: await userIdOf(a.id), role: 'STUDENT' } });

    const res = await POST(postReq({ targetStudentId: b.id }));
    expect(res.status).toBe(403);
  });

  it('200 with a switchToken when the caller and target are siblings', async () => {
    const a = await createStudent({ name: 'A', email: 'a2@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b2@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);
    sessionMock.mockResolvedValue({ user: { id: await userIdOf(a.id), role: 'STUDENT' } });

    const res = await POST(postReq({ targetStudentId: b.id }));
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).switchToken).toBe('string');
  });

  it('403 when the target belongs to a different family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a3@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b3@x.com', password: 'pw' });
    const x = await createStudent({ name: 'X', email: 'x3@x.com', password: 'pw' });
    const y = await createStudent({ name: 'Y', email: 'y3@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);
    await setSiblings(x.id, [y.id]);
    sessionMock.mockResolvedValue({ user: { id: await userIdOf(a.id), role: 'STUDENT' } });

    const res = await POST(postReq({ targetStudentId: x.id }));
    expect(res.status).toBe(403);
  });
});
