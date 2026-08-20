import webpush from 'web-push';
import { prisma } from '@/lib/db';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface SubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

function getVapidDetails(): { subject: string; publicKey: string; privateKey: string } | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return null;
  return { subject, publicKey, privateKey };
}

export async function saveSubscription(userId: string, sub: SubscriptionKeys, userAgent?: string): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { userId_endpoint: { userId, endpoint: sub.endpoint } },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent },
    update: { p256dh: sub.p256dh, auth: sub.auth, userAgent },
  });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

// 「有沒有開通知」的判斷：低堂數提醒等一次性旗標只在有訂閱時才燒掉，
// 之後才開通知的人不會錯過提醒。
export async function hasPushSubscription(userId: string): Promise<boolean> {
  return (await prisma.pushSubscription.count({ where: { userId } })) > 0;
}

// 這台裝置（endpoint）是否已綁定此帳號——前端掛載時以伺服器為準決定顯示狀態，
// 「關閉」後不會被自動重綁蓋掉。
export async function hasSubscriptionForEndpoint(userId: string, endpoint: string): Promise<boolean> {
  return (await prisma.pushSubscription.count({ where: { userId, endpoint } })) > 0;
}

export async function pushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return;
  const vapidDetails = getVapidDetails();
  if (!vapidDetails) {
    console.error('VAPID env vars not set, skipping web push');
    return;
  }
  let subs;
  try {
    subs = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  } catch (err) {
    console.error('push subscription lookup failed', err);
    return;
  }
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { vapidDetails }
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // 訂閱已失效（使用者清了網站資料等）：這個 endpoint 的所有帳號綁定一併清掉。
        // 403 刻意「不」清——它分不清「這筆訂閱的金鑰舊了」和「伺服器端金鑰貼錯」，
        // 後者會把整張表清光；金鑰輪換交給客戶端 matchesCurrentKey 自癒
        // （退掉舊訂閱後，這個 endpoint 之後自然回 404/410 走這裡清掉）。
        await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } }).catch(() => {});
      } else {
        console.error(`web push to ${sub.endpoint} failed`, err);
      }
    }
  }
}

export async function pushToUser(userId: string, payload: PushPayload): Promise<void> {
  await pushToUsers([userId], payload);
}

export async function pushToAdmins(payload: PushPayload): Promise<void> {
  try {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { id: true } });
    await pushToUsers(
      admins.map((a) => a.id),
      payload
    );
  } catch (err) {
    console.error('pushToAdmins failed', err);
  }
}
