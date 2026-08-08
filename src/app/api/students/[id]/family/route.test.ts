import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { PATCH } from './route';
import { createStudent } from '@/lib/services/studentService';
import { listSiblings } from '@/lib/services/familyService';
import { prisma } from '@/lib/db';

function patchReq(body: unknown) {
  return new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) });
}

async function userIdOf(studentId: string): Promise<string> {
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  return student.userId;
}

beforeEach(() => {
  sessionMock.mockReset();
});

describe('PATCH /api/students/:id/family', () => {
  it('403 for non-admin', async () => {
    sessionMock.mockResolvedValue({ user: { role: 'STUDENT' } });
    const a = await createStudent({ name: 'A', email: 'a@x.com', password: 'pw' });
    const res = await PATCH(patchReq({ siblingIds: [] }), { params: { id: a.id } });
    expect(res.status).toBe(403);
  });

  it('404 for a nonexistent sibling id', async () => {
    sessionMock.mockResolvedValue({ user: { role: 'ADMIN' } });
    const a = await createStudent({ name: 'A', email: 'a2@x.com', password: 'pw' });
    const res = await PATCH(patchReq({ siblingIds: ['nope'] }), { params: { id: a.id } });
    expect(res.status).toBe(404);
  });

  it('200 and groups the students together', async () => {
    sessionMock.mockResolvedValue({ user: { role: 'ADMIN' } });
    const a = await createStudent({ name: 'A', email: 'a3@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b3@x.com', password: 'pw' });

    const res = await PATCH(patchReq({ siblingIds: [b.id] }), { params: { id: a.id } });
    expect(res.status).toBe(200);
    expect(await listSiblings(await userIdOf(a.id))).toEqual([{ id: b.id, name: 'B' }]);
  });
});
