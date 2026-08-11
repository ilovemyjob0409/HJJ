import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { createTeacher } from '@/lib/services/teacherService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asTeacher = () => sessionMock.mockResolvedValue({ user: { id: 'teacher-1', role: 'TEACHER' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/teachers/[id]/one-on-one-slots', () => {
  it('403 when not admin', async () => {
    asTeacher();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('200 with an empty list for a teacher with no one-on-one slots', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'oo-slots-route-chen@example.com', password: 'x', subjects: '圍棋' });
    asAdmin();
    const res = await GET({} as never, { params: { id: teacher.id } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
