import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST, DELETE } from './route';
import { prisma } from '@/lib/db';

function req(method: string, body: unknown) {
  return new Request('http://x/api/push/subscribe', { method, body: JSON.stringify(body) });
}

const GOOD_BODY = { endpoint: 'https://push.example/ep-1', keys: { p256dh: 'k', auth: 'a' }, userAgent: 'ua' };

async function createUser(email: string) {
  return prisma.user.create({ data: { email, password: 'x', name: '測試', role: 'STUDENT' } });
}

beforeEach(() => {
  sessionMock.mockReset();
});

describe('POST /api/push/subscribe', () => {
  it('403 when not logged in', async () => {
    sessionMock.mockResolvedValue(null);
    const res = await POST(req('POST', GOOD_BODY) as never);
    expect(res.status).toBe(403);
  });

  it('400 when the subscription payload is malformed', async () => {
    const user = await createUser('sub-a@example.com');
    sessionMock.mockResolvedValue({ user: { id: user.id, role: 'STUDENT' } });
    const res = await POST(req('POST', { endpoint: 'https://x' }) as never);
    expect(res.status).toBe(400);
  });

  it('201 and stores the subscription for the session user', async () => {
    const user = await createUser('sub-b@example.com');
    sessionMock.mockResolvedValue({ user: { id: user.id, role: 'STUDENT' } });

    const res = await POST(req('POST', GOOD_BODY) as never);

    expect(res.status).toBe(201);
    const rows = await prisma.pushSubscription.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].endpoint).toBe(GOOD_BODY.endpoint);
    expect(rows[0].userAgent).toBe('ua');
  });

  it('rebinding the same endpoint from a second account keeps both rows', async () => {
    const a = await createUser('sub-c@example.com');
    const b = await createUser('sub-d@example.com');
    sessionMock.mockResolvedValue({ user: { id: a.id, role: 'STUDENT' } });
    await POST(req('POST', GOOD_BODY) as never);
    sessionMock.mockResolvedValue({ user: { id: b.id, role: 'STUDENT' } });
    await POST(req('POST', GOOD_BODY) as never);

    expect(await prisma.pushSubscription.count({ where: { endpoint: GOOD_BODY.endpoint } })).toBe(2);
  });
});

describe('DELETE /api/push/subscribe', () => {
  it('403 when not logged in', async () => {
    sessionMock.mockResolvedValue(null);
    const res = await DELETE(req('DELETE', { endpoint: 'https://x' }) as never);
    expect(res.status).toBe(403);
  });

  it("removes only the session user's binding of the endpoint", async () => {
    const a = await createUser('sub-e@example.com');
    const b = await createUser('sub-f@example.com');
    sessionMock.mockResolvedValue({ user: { id: a.id, role: 'STUDENT' } });
    await POST(req('POST', GOOD_BODY) as never);
    sessionMock.mockResolvedValue({ user: { id: b.id, role: 'STUDENT' } });
    await POST(req('POST', GOOD_BODY) as never);

    const res = await DELETE(req('DELETE', { endpoint: GOOD_BODY.endpoint }) as never);

    expect(res.status).toBe(200);
    expect(await prisma.pushSubscription.count({ where: { userId: b.id } })).toBe(0);
    expect(await prisma.pushSubscription.count({ where: { userId: a.id } })).toBe(1);
  });
});
