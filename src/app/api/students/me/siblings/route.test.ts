import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';
import { setSiblings } from '@/lib/services/familyService';

async function userIdOf(studentId: string): Promise<string> {
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  return student.userId;
}

beforeEach(() => {
  sessionMock.mockReset();
});

describe('GET /api/students/me/siblings', () => {
  it('403 when not logged in', async () => {
    sessionMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
  });

  it('returns an empty siblings array when the caller has no family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a@x.com', password: 'pw' });
    sessionMock.mockResolvedValue({ user: { id: await userIdOf(a.id), role: 'STUDENT', name: 'A' } });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ self: { name: 'A' }, siblings: [] });
  });

  it('lists the sibling when the caller has a family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a2@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b2@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);
    sessionMock.mockResolvedValue({ user: { id: await userIdOf(a.id), role: 'STUDENT', name: 'A' } });

    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ self: { name: 'A' }, siblings: [{ id: b.id, name: 'B' }] });
  });
});
