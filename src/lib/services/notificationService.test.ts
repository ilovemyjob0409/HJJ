import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import {
  notifyUser,
  notifyUsers,
  notifyAdmins,
  listNotifications,
  countUnread,
  markRead,
  markAllRead,
} from './notificationService';

async function createUser(role: 'ADMIN' | 'STUDENT' = 'STUDENT') {
  return prisma.user.create({
    data: { email: `notif-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`, password: 'x', name: '測試用戶', role },
  });
}

const PAYLOAD = { title: '測試通知', body: '內容', url: '/student' };

describe('notifyUser / notifyUsers / notifyAdmins', () => {
  it('notifyUser 寫入一筆未讀通知（推播 best-effort 不拋錯）', async () => {
    const user = await createUser();
    await notifyUser(user.id, PAYLOAD);
    const rows = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: '測試通知', body: '內容', url: '/student', readAt: null });
  });

  it('notifyUsers 每人各寫一筆', async () => {
    const a = await createUser();
    const b = await createUser();
    await notifyUsers([a.id, b.id], PAYLOAD);
    expect(await prisma.notification.count({ where: { userId: { in: [a.id, b.id] } } })).toBe(2);
  });

  it('notifyAdmins 對每個 ADMIN 各寫一筆', async () => {
    const admin1 = await createUser('ADMIN');
    const admin2 = await createUser('ADMIN');
    const student = await createUser();
    await notifyAdmins(PAYLOAD);
    expect(await prisma.notification.count({ where: { userId: admin1.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: admin2.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: student.id } })).toBe(0);
  });
});

describe('listNotifications / countUnread', () => {
  it('依 createdAt 新到舊排序並吃 limit', async () => {
    const user = await createUser();
    // createdAt 由 DB default 產生會同秒；直接指定時間確保排序可斷言
    await prisma.notification.createMany({
      data: [
        { userId: user.id, title: '舊', body: 'b', createdAt: new Date('2026-01-01T00:00:00Z') },
        { userId: user.id, title: '新', body: 'b', createdAt: new Date('2026-01-03T00:00:00Z') },
        { userId: user.id, title: '中', body: 'b', createdAt: new Date('2026-01-02T00:00:00Z') },
      ],
    });
    const rows = await listNotifications(user.id);
    expect(rows.map((r) => r.title)).toEqual(['新', '中', '舊']);
    const limited = await listNotifications(user.id, 2);
    expect(limited).toHaveLength(2);
  });

  it('countUnread 只算 readAt 為 null 的', async () => {
    const user = await createUser();
    await prisma.notification.createMany({
      data: [
        { userId: user.id, title: 'a', body: 'b' },
        { userId: user.id, title: 'c', body: 'd', readAt: new Date() },
      ],
    });
    expect(await countUnread(user.id)).toBe(1);
  });
});

describe('markRead / markAllRead', () => {
  it('本人標已讀；重複標冪等', async () => {
    const user = await createUser();
    await notifyUser(user.id, PAYLOAD);
    const row = (await listNotifications(user.id))[0];
    await markRead(row.id, user.id);
    await markRead(row.id, user.id); // 冪等，不拋錯
    expect(await countUnread(user.id)).toBe(0);
  });

  it('別人的通知丟 NOT_OWNER，不存在丟 NOTIFICATION_NOT_FOUND', async () => {
    const owner = await createUser();
    const other = await createUser();
    await notifyUser(owner.id, PAYLOAD);
    const row = (await listNotifications(owner.id))[0];
    await expect(markRead(row.id, other.id)).rejects.toThrow('NOT_OWNER');
    await expect(markRead('no-such-id', owner.id)).rejects.toThrow('NOTIFICATION_NOT_FOUND');
  });

  it('markAllRead 清空未讀', async () => {
    const user = await createUser();
    await notifyUsers([user.id], PAYLOAD);
    await notifyUsers([user.id], PAYLOAD);
    await markAllRead(user.id);
    expect(await countUnread(user.id)).toBe(0);
    expect((await listNotifications(user.id)).every((r) => r.readAt !== null)).toBe(true);
  });
});
