import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { PATCH } from './[id]/route';
import { POST as READ_ALL } from './read-all/route';
import { prisma } from '@/lib/db';
import { notifyUser, listNotifications } from '@/lib/services/notificationService';

beforeEach(() => {
  sessionMock.mockReset();
});

async function createUser() {
  return prisma.user.create({
    data: { email: `notif-route-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, password: 'x', name: '路由測試', role: 'STUDENT' },
  });
}

const asUser = (id: string) => sessionMock.mockResolvedValue({ user: { id, role: 'STUDENT' } });

function getReq(params: Record<string, string> = {}) {
  return { nextUrl: { searchParams: new URLSearchParams(params) } } as never;
}
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/notifications', () => {
  it('403：未登入', async () => {
    asAnon();
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });

  it('只回自己的通知與未讀數', async () => {
    const me = await createUser();
    const other = await createUser();
    await notifyUser(me.id, { title: '我的', body: 'b', url: '/student' });
    await notifyUser(other.id, { title: '別人的', body: 'b', url: '/student' });
    asUser(me.id);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.unread).toBe(1);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].title).toBe('我的');
  });

  it('countOnly=1 只回未讀數、不含清單（鈴鐺常態載入用）', async () => {
    const me = await createUser();
    await notifyUser(me.id, { title: 't', body: 'b', url: '/student' });
    asUser(me.id);
    const res = await GET(getReq({ countOnly: '1' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.unread).toBe(1);
    expect(data.rows).toBeUndefined();
  });
});

describe('PATCH /api/notifications/[id]', () => {
  it('本人標已讀成功', async () => {
    const me = await createUser();
    await notifyUser(me.id, { title: 't', body: 'b', url: '/student' });
    const row = (await listNotifications(me.id))[0];
    asUser(me.id);
    const res = await PATCH({} as never, { params: { id: row.id } });
    expect(res.status).toBe(200);
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.readAt).not.toBeNull();
  });

  it('403：別人的通知', async () => {
    const owner = await createUser();
    const other = await createUser();
    await notifyUser(owner.id, { title: 't', body: 'b', url: '/student' });
    const row = (await listNotifications(owner.id))[0];
    asUser(other.id);
    const res = await PATCH({} as never, { params: { id: row.id } });
    expect(res.status).toBe(403);
  });

  it('404：不存在', async () => {
    const me = await createUser();
    asUser(me.id);
    const res = await PATCH({} as never, { params: { id: 'no-such-id' } });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/notifications/read-all', () => {
  it('清空自己的未讀', async () => {
    const me = await createUser();
    await notifyUser(me.id, { title: 'a', body: 'b', url: '/student' });
    await notifyUser(me.id, { title: 'c', body: 'd', url: '/student' });
    asUser(me.id);
    const res = await READ_ALL();
    expect(res.status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: me.id, readAt: null } })).toBe(0);
  });
});
