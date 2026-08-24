import { prisma } from '@/lib/db';
import { pushToUsers } from './pushService';

export interface NotifyPayload {
  title: string;
  body: string;
  url: string;
}

export interface NotificationRow {
  id: string;
  title: string;
  body: string;
  url: string | null;
  readAt: Date | null;
  createdAt: Date;
}

// 統一發送入口：先寫收件夾（每人一筆）、再發推播。兩者皆 best-effort——
// DB 寫入或推播失敗都只記 log，不影響業務主流程；沒訂閱推播的人靠收件夾
// 也收得到通知。
export async function notifyUsers(userIds: string[], payload: NotifyPayload): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, title: payload.title, body: payload.body, url: payload.url })),
    });
  } catch (err) {
    console.error('notification insert failed', err);
  }
  await pushToUsers(userIds, payload);
}

export async function notifyUser(userId: string, payload: NotifyPayload): Promise<void> {
  await notifyUsers([userId], payload);
}

export async function notifyAdmins(payload: NotifyPayload): Promise<void> {
  try {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await notifyUsers(
      admins.map((a) => a.id),
      payload
    );
  } catch (err) {
    console.error('notifyAdmins failed', err);
  }
}

export async function listNotifications(userId: string, limit = 50): Promise<NotificationRow[]> {
  return prisma.notification.findMany({
    where: { userId },
    select: { id: true, title: true, body: true, url: true, readAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(notificationId: string, userId: string): Promise<void> {
  const row = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: { userId: true, readAt: true },
  });
  if (!row) throw new Error('NOTIFICATION_NOT_FOUND');
  if (row.userId !== userId) throw new Error('NOT_OWNER');
  if (row.readAt) return; // 已讀過再標＝冪等成功
  await prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
