import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const sendNotificationMock = vi.fn();
vi.mock('web-push', () => ({
  default: { sendNotification: (...args: unknown[]) => sendNotificationMock(...args) },
}));

import { prisma } from '@/lib/db';
import {
  saveSubscription,
  removeSubscription,
  hasPushSubscription,
  pushToUser,
  pushToUsers,
  pushToAdmins,
} from './pushService';

function setVapidEnv() {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  process.env.VAPID_SUBJECT = 'mailto:test@example.com';
}

function createUser(role: 'ADMIN' | 'TEACHER' | 'STUDENT', email: string) {
  return prisma.user.create({ data: { email, password: 'x', name: '測試', role } });
}

const SUB = { endpoint: 'https://push.example/ep-1', p256dh: 'key-1', auth: 'auth-1' };
const PAYLOAD = { title: '測試', body: '內容', url: '/student' };

beforeEach(() => {
  sendNotificationMock.mockReset();
  sendNotificationMock.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

describe('saveSubscription / removeSubscription / hasPushSubscription', () => {
  it('upserts by (userId, endpoint): saving twice keeps one row with updated keys', async () => {
    const user = await createUser('STUDENT', 'push-a@example.com');
    await saveSubscription(user.id, SUB, 'ua-1');
    await saveSubscription(user.id, { ...SUB, p256dh: 'key-2' }, 'ua-2');

    const rows = await prisma.pushSubscription.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe('key-2');
    expect(rows[0].userAgent).toBe('ua-2');
  });

  it("allows the same endpoint under two users (sibling accounts on one phone)", async () => {
    const a = await createUser('STUDENT', 'push-b@example.com');
    const b = await createUser('STUDENT', 'push-c@example.com');
    await saveSubscription(a.id, SUB);
    await saveSubscription(b.id, SUB);

    expect(await prisma.pushSubscription.count({ where: { endpoint: SUB.endpoint } })).toBe(2);
  });

  it("removeSubscription only removes the given user's binding", async () => {
    const a = await createUser('STUDENT', 'push-d@example.com');
    const b = await createUser('STUDENT', 'push-e@example.com');
    await saveSubscription(a.id, SUB);
    await saveSubscription(b.id, SUB);

    await removeSubscription(a.id, SUB.endpoint);

    expect(await hasPushSubscription(a.id)).toBe(false);
    expect(await hasPushSubscription(b.id)).toBe(true);
  });
});

describe('pushToUser', () => {
  it("is a silent no-op when VAPID env vars are not set", async () => {
    const user = await createUser('STUDENT', 'push-f@example.com');
    await saveSubscription(user.id, SUB);

    await pushToUser(user.id, PAYLOAD);

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("sends the JSON payload to every subscription of the user", async () => {
    setVapidEnv();
    const user = await createUser('STUDENT', 'push-g@example.com');
    await saveSubscription(user.id, SUB);
    await saveSubscription(user.id, { endpoint: 'https://push.example/ep-2', p256dh: 'k2', auth: 'a2' });

    await pushToUser(user.id, PAYLOAD);

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const [subscription, body] = sendNotificationMock.mock.calls[0];
    expect(subscription).toEqual({ endpoint: SUB.endpoint, keys: { p256dh: SUB.p256dh, auth: SUB.auth } });
    expect(JSON.parse(body as string)).toEqual(PAYLOAD);
  });

  it("deletes all rows of an endpoint (across users) on a 410 response", async () => {
    setVapidEnv();
    const a = await createUser('STUDENT', 'push-h@example.com');
    const b = await createUser('STUDENT', 'push-i@example.com');
    await saveSubscription(a.id, SUB);
    await saveSubscription(b.id, SUB);
    sendNotificationMock.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));

    await pushToUser(a.id, PAYLOAD);

    expect(await prisma.pushSubscription.count({ where: { endpoint: SUB.endpoint } })).toBe(0);
  });

  it('keeps the subscription rows on a 403 response (server-side key misconfig must not wipe the table)', async () => {
    setVapidEnv();
    const user = await createUser('STUDENT', 'push-l@example.com');
    await saveSubscription(user.id, SUB);
    sendNotificationMock.mockRejectedValue(Object.assign(new Error('invalid signature'), { statusCode: 403 }));

    await expect(pushToUser(user.id, PAYLOAD)).resolves.toBeUndefined();

    expect(await prisma.pushSubscription.count({ where: { endpoint: SUB.endpoint } })).toBe(1);
  });

  it("keeps the subscription and does not throw on other send errors", async () => {
    setVapidEnv();
    const user = await createUser('STUDENT', 'push-j@example.com');
    await saveSubscription(user.id, SUB);
    sendNotificationMock.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));

    await expect(pushToUser(user.id, PAYLOAD)).resolves.toBeUndefined();
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(1);
  });

  it('does not throw when the subscription lookup itself fails', async () => {
    setVapidEnv();
    const spy = vi.spyOn(prisma.pushSubscription, 'findMany').mockRejectedValueOnce(new Error('db down'));

    await expect(pushToUser('any-user-id', PAYLOAD)).resolves.toBeUndefined();
    expect(sendNotificationMock).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe('pushToUsers / pushToAdmins', () => {
  it('pushToUsers with an empty list does nothing', async () => {
    setVapidEnv();
    await pushToUsers([], PAYLOAD);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("pushToAdmins only reaches ADMIN users", async () => {
    setVapidEnv();
    const admin = await createUser('ADMIN', 'push-admin@example.com');
    const student = await createUser('STUDENT', 'push-k@example.com');
    await saveSubscription(admin.id, SUB);
    await saveSubscription(student.id, { endpoint: 'https://push.example/ep-3', p256dh: 'k3', auth: 'a3' });

    await pushToAdmins(PAYLOAD);

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock.mock.calls[0][0]).toEqual({
      endpoint: SUB.endpoint,
      keys: { p256dh: SUB.p256dh, auth: SUB.auth },
    });
  });
});
