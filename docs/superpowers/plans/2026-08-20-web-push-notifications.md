# MUP 網頁推播通知（取代 LINE）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 網站升級為 PWA，用自架 Web Push（VAPID）直接推播到手機，全面取代並移除 LINE 通知。

**Architecture:** 新增 `pushService.ts` 作為唯一通知出口（訂閱存 `PushSubscription` 表，唯一鍵 `(userId, endpoint)` 讓一支手機可綁多個手足帳號）；所有 `pushLineMessage` 呼叫點改接 pushService，另新增行政／老師事件；前端以 `NotificationSetupCard`（三端首頁）處理訂閱，`public/sw.js` 收推播。最後整批移除 LINE 程式碼與 schema 欄位。

**Tech Stack:** Next.js 14 App Router、Prisma 7 + Supabase Postgres、next-auth v4、`web-push@3.6.7`、vitest（真 DB、`fileParallelism: false`）。

**Spec:** `docs/superpowers/specs/2026-08-20-web-push-notifications-design.md`

## Global Constraints

- 所有 UI 與通知文案為繁體中文；日期顯示一律 `formatDateWithWeekday(date, 'zh-TW')`（`@/lib/dateFormat`）。
- API 未授權一律回 **403 `{ error: 'Forbidden' }`**（本專案慣例，不用 401）。
- 通知發送失敗只 `console.error`，**絕不影響主流程**；VAPID 環境變數未設定時靜默略過。
- 測試策略：service 整合測試**不 mock pushService**——測試環境沒有 VAPID env，pushService 自然 no-op（沿用 LINE 的策略）。唯一 `vi.mock('web-push')` 出現在 `pushService.test.ts`。
- 跑單一測試檔：`npm run test:dbpush && npx vitest run <path>`；跑全部：`npm test`。**不要與其他 session 同時跑測試**（共用測試 DB 會互咬）。
- 改了 `prisma/schema.prisma` 之後：`npx prisma db push`（會順便 regenerate client），**dev server 要重啟**才吃得到新 client。
- 環境變數：`NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`。
- commit 時**只 stage 自己這個任務的檔案**（repo 裡可能有其他 session 的未追蹤檔，例如 `.impeccable/`）。
- 通知標題不加【MUP】前綴（推播本身顯示來源）；body 沿用原 LINE 文案去掉前綴。

## 前置（Task 1 的 Step 0，一次性）

本地開發金鑰：`npx web-push generate-vapid-keys` 產生一對金鑰，寫進 `.env`（gitignored）：

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY="<公鑰>"
VAPID_PRIVATE_KEY="<私鑰>"
VAPID_SUBJECT="mailto:admin@example.com"
```

---

### Task 1: PushSubscription schema ＋ pushService ＋ 單元測試

**Files:**
- Modify: `prisma/schema.prisma`（User model 約 :88-102，檔尾加新 model）
- Modify: `package.json`（加依賴）
- Modify: `.env.example`
- Create: `src/lib/services/pushService.ts`
- Create: `src/lib/testUtils/pushHelpers.ts`
- Test: `src/lib/services/pushService.test.ts`

**Interfaces:**
- Consumes: `prisma`（`@/lib/db`）
- Produces（後續所有任務依賴的簽名）:
  - `interface PushPayload { title: string; body: string; url: string }`
  - `saveSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }, userAgent?: string): Promise<void>`
  - `removeSubscription(userId: string, endpoint: string): Promise<void>`
  - `hasPushSubscription(userId: string): Promise<boolean>`
  - `pushToUser(userId: string, payload: PushPayload): Promise<void>`（永不 throw）
  - `pushToUsers(userIds: string[], payload: PushPayload): Promise<void>`（永不 throw）
  - `pushToAdmins(payload: PushPayload): Promise<void>`（永不 throw）
  - 測試用 helper：`subscribeStudentForTest(studentId: string): Promise<void>`（以 Student.id 建訂閱）

- [ ] **Step 1: 安裝依賴**

```bash
npm install web-push && npm install -D @types/web-push
```

- [ ] **Step 2: schema 加 PushSubscription**

在 `prisma/schema.prisma` 的 `User` model 內（`markedTutoringAttendances TutoringAttendance[]` 那行之後）加一行 relation：

```prisma
  pushSubscriptions         PushSubscription[]
```

檔案末尾加新 model：

```prisma
// Web Push 訂閱：一個 User 可有多裝置；同一裝置（endpoint）也可綁多個
// 帳號——家長一支手機切換手足帳號時，各帳號都收得到自己的通知。
model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  endpoint  String
  p256dh    String
  auth      String
  userAgent String?
  createdAt DateTime @default(now())

  @@unique([userId, endpoint])
}
```

執行：`npx prisma db push`（dev DB）。Expected: `Your database is now in sync`。

- [ ] **Step 3: 更新 .env.example**

在 `.env.example` 的 LINE 三行**之後**（LINE 行先留著，Task 10 才刪）加：

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
VAPID_SUBJECT="mailto:admin@example.com"
```

- [ ] **Step 4: 寫失敗測試 `src/lib/services/pushService.test.ts`**

```ts
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

  it('allows the same endpoint under two users (sibling accounts on one phone)', async () => {
    const a = await createUser('STUDENT', 'push-b@example.com');
    const b = await createUser('STUDENT', 'push-c@example.com');
    await saveSubscription(a.id, SUB);
    await saveSubscription(b.id, SUB);

    expect(await prisma.pushSubscription.count({ where: { endpoint: SUB.endpoint } })).toBe(2);
  });

  it('removeSubscription only removes the given user’s binding', async () => {
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
  it('is a silent no-op when VAPID env vars are not set', async () => {
    const user = await createUser('STUDENT', 'push-f@example.com');
    await saveSubscription(user.id, SUB);

    await pushToUser(user.id, PAYLOAD);

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('sends the JSON payload to every subscription of the user', async () => {
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

  it('deletes all rows of an endpoint (across users) on a 410 response', async () => {
    setVapidEnv();
    const a = await createUser('STUDENT', 'push-h@example.com');
    const b = await createUser('STUDENT', 'push-i@example.com');
    await saveSubscription(a.id, SUB);
    await saveSubscription(b.id, SUB);
    sendNotificationMock.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));

    await pushToUser(a.id, PAYLOAD);

    expect(await prisma.pushSubscription.count({ where: { endpoint: SUB.endpoint } })).toBe(0);
  });

  it('keeps the subscription and does not throw on other send errors', async () => {
    setVapidEnv();
    const user = await createUser('STUDENT', 'push-j@example.com');
    await saveSubscription(user.id, SUB);
    sendNotificationMock.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));

    await expect(pushToUser(user.id, PAYLOAD)).resolves.toBeUndefined();
    expect(await prisma.pushSubscription.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe('pushToUsers / pushToAdmins', () => {
  it('pushToUsers with an empty list does nothing', async () => {
    setVapidEnv();
    await pushToUsers([], PAYLOAD);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('pushToAdmins only reaches ADMIN users', async () => {
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
```

- [ ] **Step 5: 跑測試確認失敗**

Run: `npm run test:dbpush && npx vitest run src/lib/services/pushService.test.ts`
Expected: FAIL（`Cannot find module './pushService'`）

- [ ] **Step 6: 實作 `src/lib/services/pushService.ts`**

```ts
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
// 之後才開通知的人不會錯過提醒（沿用原本 lineUserId gate 的語意）。
export async function hasPushSubscription(userId: string): Promise<boolean> {
  return (await prisma.pushSubscription.count({ where: { userId } })) > 0;
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
        // 訂閱已失效（使用者清了網站資料等）：這個 endpoint 的所有帳號綁定一併清掉
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
```

- [ ] **Step 7: 建測試 helper `src/lib/testUtils/pushHelpers.ts`**

```ts
import { prisma } from '@/lib/db';

let counter = 0;

// 測試用：給學生（以 Student.id）建立一筆推播訂閱，模擬「已開啟通知」。
export async function subscribeStudentForTest(studentId: string): Promise<void> {
  const { userId } = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { userId: true },
  });
  counter += 1;
  await prisma.pushSubscription.create({
    data: { userId, endpoint: `https://push.example/test-${counter}`, p256dh: 'test-p256dh', auth: 'test-auth' },
  });
}
```

- [ ] **Step 8: 跑測試確認通過**

Run: `npx vitest run src/lib/services/pushService.test.ts`
Expected: PASS（9 tests）

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma package.json package-lock.json .env.example src/lib/services/pushService.ts src/lib/services/pushService.test.ts src/lib/testUtils/pushHelpers.ts
git commit -m "feat: PushSubscription model and web push service"
```

---

### Task 2: 訂閱 API `/api/push/subscribe`

**Files:**
- Create: `src/app/api/push/subscribe/route.ts`
- Test: `src/app/api/push/subscribe/route.test.ts`

**Interfaces:**
- Consumes: `saveSubscription` / `removeSubscription`（Task 1）
- Produces: `POST /api/push/subscribe`（body＝瀏覽器 `subscription.toJSON()` 加 `userAgent`，即 `{ endpoint, keys: { p256dh, auth }, userAgent? }`）→ 201 `{ success: true }`；`DELETE`（body `{ endpoint }`）→ 200 `{ success: true }`。任何已登入角色可用；未登入 403。

- [ ] **Step 1: 寫失敗測試 `src/app/api/push/subscribe/route.test.ts`**

```ts
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

  it('removes only the session user’s binding of the endpoint', async () => {
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:dbpush && npx vitest run src/app/api/push/subscribe/route.test.ts`
Expected: FAIL（`Cannot find module './route'`）

- [ ] **Step 3: 實作 `src/app/api/push/subscribe/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { saveSubscription, removeSubscription } from '@/lib/services/pushService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  await saveSubscription(
    session.user.id,
    { endpoint, p256dh, auth },
    typeof body.userAgent === 'string' ? body.userAgent : undefined
  );
  return NextResponse.json({ success: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  if (typeof body?.endpoint !== 'string') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  await removeSubscription(session.user.id, body.endpoint);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/app/api/push/subscribe/route.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/app/api/push/subscribe
git commit -m "feat: push subscription API routes"
```

---

### Task 3: PWA 外殼——manifest、icons、service worker、layout metadata

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/sw.js`
- Create: `public/icon-192.png`、`public/icon-512.png`、`public/apple-touch-icon.png`（由 `public/logo.png` 產生）
- Modify: `src/app/layout.tsx:5`（metadata）

**Interfaces:**
- Consumes: 無
- Produces: `/sw.js` 的 push payload 約定為 `{ title, body, url }` JSON（與 Task 1 的 `PushPayload` 一致）；`NotificationSetupCard`（Task 4）會 `navigator.serviceWorker.register('/sw.js')`。

- [ ] **Step 1: 產生方形 icon（logo 置中鋪白底）**

logo.png 是 882×364 橫式；用 PIL 裁掉透明邊、置中貼到方形白底：

```bash
python3 -c "
from PIL import Image
logo = Image.open('public/logo.png').convert('RGBA')
logo = logo.crop(logo.getbbox())
for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'apple-touch-icon.png')]:
    canvas = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    target = int(size * 0.78)
    ratio = min(target / logo.width, target / logo.height)
    resized = logo.resize((max(1, int(logo.width * ratio)), max(1, int(logo.height * ratio))), Image.LANCZOS)
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2), resized)
    canvas.convert('RGB').save(f'public/{name}')
print('done')
"
```

Expected: `done`，`public/` 多三個 PNG。用 Read 工具打開 `public/icon-512.png` 目視確認 logo 置中、不變形、留白合理。

- [ ] **Step 2: 建 `public/manifest.webmanifest`**

```json
{
  "name": "MUP",
  "short_name": "MUP",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#FFBD5A",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

（`theme_color` 用品牌色 `#FFBD5A`，來自 `tailwind.config.ts` 的 `brand`。）

- [ ] **Step 3: 建 `public/sw.js`**

```js
// MUP Web Push service worker：只負責收推播與點擊導向，不做離線快取。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'MUP', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
```

- [ ] **Step 4: layout.tsx metadata**

把 `src/app/layout.tsx:5` 的

```ts
export const metadata = { title: 'MUP' };
```

改成

```ts
export const metadata = {
  title: 'MUP',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'MUP', statusBarStyle: 'default' as const },
  icons: { apple: '/apple-touch-icon.png' },
};
```

- [ ] **Step 5: 驗證**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

用 preview 工具開 dev server，確認：
1. `http://localhost:3000/manifest.webmanifest` 回 200 且是上面的 JSON。
2. `http://localhost:3000/sw.js` 回 200。
3. 頁面 `<head>` 有 `<link rel="manifest">` 與 apple-touch-icon（read_page 或 view-source 確認）。

- [ ] **Step 6: Commit**

```bash
git add public/manifest.webmanifest public/sw.js public/icon-192.png public/icon-512.png public/apple-touch-icon.png src/app/layout.tsx
git commit -m "feat: PWA shell (manifest, icons, service worker)"
```

---

### Task 4: NotificationSetupCard ＋ 三端首頁掛載

**Files:**
- Create: `src/components/NotificationSetupCard.tsx`（跨三端共用，放 `src/components/`）
- Modify: `src/app/student/page.tsx`（h1 在 :46，下一行插入；import 區加一行）
- Modify: `src/app/teacher/page.tsx`（h1 在 :130，下一行插入）
- Modify: `src/app/admin/page.tsx`（h1 在 :37，下一行插入）

**Interfaces:**
- Consumes: `POST/DELETE /api/push/subscribe`（Task 2）、`/sw.js`（Task 3）、`NEXT_PUBLIC_VAPID_PUBLIC_KEY`、共用 `Card`／`Button`（`@/components/ui/`）
- Produces: `<NotificationSetupCard />`（無 props 的 client component）

- [ ] **Step 1: 建 `src/components/NotificationSetupCard.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

// Web Push 公鑰要轉成 PushManager.subscribe 接受的 Uint8Array。
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
}

async function bindSubscriptionToCurrentUser(subscription: PushSubscription): Promise<Response> {
  return fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...subscription.toJSON(), userAgent: navigator.userAgent }),
  });
}

type SetupState = 'loading' | 'hidden' | 'ios-install' | 'prompt' | 'subscribed' | 'denied';

export default function NotificationSetupCard() {
  const [state, setState] = useState<SetupState>('loading');
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
        setState('hidden');
        return;
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        // iOS Safari（未加入主畫面）沒有 PushManager——引導安裝；其他舊瀏覽器直接隱藏。
        const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
        const standalone = 'standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true;
        setState(isIos && !standalone ? 'ios-install' : 'hidden');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      if (cancelled) return;
      if (Notification.permission === 'denied') {
        setState('denied');
        return;
      }
      const subscription = await registration.pushManager.getSubscription();
      if (cancelled) return;
      if (Notification.permission === 'granted' && subscription) {
        // 已訂閱：把訂閱綁到目前登入的帳號——手足切換帳號後各自都收得到通知。
        await bindSubscriptionToCurrentUser(subscription);
        if (!cancelled) setState('subscribed');
        return;
      }
      setState('prompt');
    }
    init().catch(() => setState('hidden'));
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setEnabling(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'prompt');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
        }));
      const res = await bindSubscriptionToCurrentUser(subscription);
      if (res.ok) setState('subscribed');
    } finally {
      setEnabling(false);
    }
  }, []);

  const disable = useCallback(async () => {
    // 只解除「這個帳號」的綁定，瀏覽器訂閱保留——同裝置其他手足帳號不受影響。
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    }
    setState('prompt');
  }, []);

  if (state === 'loading' || state === 'hidden') return null;

  if (state === 'subscribed') {
    return (
      <p className="mb-4 text-xs text-inkMuted">
        ✓ 通知已開啟（此裝置）
        <button type="button" onClick={disable} className="ml-2 underline hover:text-ink">
          關閉
        </button>
      </p>
    );
  }

  return (
    <Card className="mb-6 animate-rise-in">
      <h2 className="mb-1 font-bold text-ink">開啟通知</h2>
      {state === 'ios-install' && (
        <p className="text-sm text-inkMuted">
          iPhone 請先用 Safari 開啟本網站，點「分享」→「加入主畫面」，之後從主畫面開啟 MUP，再回到這裡開啟通知。
        </p>
      )}
      {state === 'denied' && (
        <p className="text-sm text-inkMuted">通知權限已被封鎖：請到瀏覽器設定允許本網站的通知，再重新整理此頁。</p>
      )}
      {state === 'prompt' && (
        <>
          <p className="mb-3 text-sm text-inkMuted">
            開啟後，簽到簽退、補課結果、堂數提醒等重要訊息會直接推播到這支裝置。
          </p>
          <Button onClick={enable} loading={enabling}>
            開啟通知
          </Button>
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: 掛載到三端首頁**

三個檔案改法相同——import 區加：

```ts
import NotificationSetupCard from '@/components/NotificationSetupCard';
```

`src/app/student/page.tsx`（:46 的 h1 之後）：

```tsx
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>
      <NotificationSetupCard />
```

`src/app/teacher/page.tsx`（:130 的 h1 之後）與 `src/app/admin/page.tsx`（:37 的 h1 之後）同樣在 h1 下一行插入 `<NotificationSetupCard />`。

- [ ] **Step 3: 驗證**

Run: `npx tsc --noEmit && npx next lint`
Expected: 無錯誤。

dev server（`.env` 已有 VAPID 金鑰）＋瀏覽器驗證：
1. 以測試學生登入 `http://localhost:3000/student`，應看到「開啟通知」卡片。
2. 點「開啟通知」→ 瀏覽器權限彈窗（headless 環境可能自動允許/拒絕，至少確認無 console error、卡片轉為「✓ 通知已開啟（此裝置）」或 denied 狀態文案）。
3. `read_console_messages` 無紅字錯誤。
4. 老師、行政帳號首頁也看得到卡片。

- [ ] **Step 4: Commit**

```bash
git add src/components/NotificationSetupCard.tsx src/app/student/page.tsx src/app/teacher/page.tsx src/app/admin/page.tsx
git commit -m "feat: notification setup card on all three dashboards"
```

---

### Task 5: attendanceService 遷移（簽到簽退＋低堂數＋弈廳堂票）

**Files:**
- Modify: `src/lib/services/attendanceService.ts`（import :4；`maybeNotifyLowQuota` :1115-1129；`maybeNotifyLowGoHallTickets` :1133-1147；`notifyAttendanceResult` :1149-1169；student 查詢 :1177-1180 與 :1214-1217）
- Test: `src/lib/services/attendanceService.test.ts`（:784-800、:854-865、:866-878、:975-1000 一帶）

**Interfaces:**
- Consumes: `pushToUser`、`hasPushSubscription`（Task 1）、`subscribeStudentForTest`（Task 1）
- Produces: 無新對外介面；`notifyAttendanceResult` 等 private 函式的 student 參數型別改為 `{ id: string; user: { id: string; name: string } }`

- [ ] **Step 1: 改寫測試（先讓它們反映新行為）**

`src/lib/services/attendanceService.test.ts` 頂部 import 區加：

```ts
import { subscribeStudentForTest } from '@/lib/testUtils/pushHelpers';
```

用 `grep -n "lineUserId" src/lib/services/attendanceService.test.ts` 找出全部 5 處，每一處做同一種機械替換——

setup 行（:787、:857、:981 的形狀都是）：

```ts
await prisma.student.update({ where: { id: student.id }, data: { lineUserId: 'Uparent011' } });
```

一律改為：

```ts
await subscribeStudentForTest(student.id);
```

測試名稱同步改語意（不改斷言）：
- :784 `'…when the student is LINE-bound'` → `'…when the student has a push subscription'`
- :854 `'does not throw when the student has a LINE binding but no access token is configured'` → `'does not throw when the student has a push subscription but VAPID keys are not configured'`
- :866 `'does not burn the low-quota flag for a student who is not yet LINE-bound'` → `'does not burn the low-quota flag for a student with no push subscription'`
- :990 `'…or student has no LINE'` → `'…or student has no push subscription'`；該測試內註解「未綁 LINE」→「未訂閱推播」

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:dbpush && npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL——有訂閱但沒有 lineUserId 的測試，flag 類斷言會不成立（實作還在看 lineUserId）。

- [ ] **Step 3: 改實作**

`src/lib/services/attendanceService.ts`：

(a) :4 的 `import { pushLineMessage } from './lineService';` 改為：

```ts
import { pushToUser, hasPushSubscription } from './pushService';
```

(b) `maybeNotifyLowQuota`（:1115-1129）整段改為：

```ts
async function maybeNotifyLowQuota(
  student: { id: string; user: { id: string; name: string } },
  classId: string
): Promise<void> {
  if (!(await hasPushSubscription(student.user.id))) return;

  const enrollment = await prisma.classEnrollment.findUnique({ where: { studentId_classId: { studentId: student.id, classId } } });
  if (!enrollment || enrollment.lowQuotaNotifiedAt !== null) return;

  const { remaining } = await getClassEnrollmentQuota(classId, student.id);
  if (remaining === null || remaining > LOW_CLASS_QUOTA_THRESHOLD) return;

  await prisma.classEnrollment.update({ where: { id: enrollment.id }, data: { lowQuotaNotifiedAt: new Date() } });
  await pushToUser(student.user.id, {
    title: '堂數提醒',
    body: `${student.user.name} 目前剩餘堂數：${remaining} 堂，請盡快與行政人員聯繫續費`,
    url: '/student',
  });
}
```

(c) `maybeNotifyLowGoHallTickets`（:1133-1147）改為（:1131-1132 的註解裡「未提醒過才發」語意不變，把行尾「失敗不影響點名」保留）：

```ts
async function maybeNotifyLowGoHallTickets(studentId: string): Promise<void> {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, goHallLowQuotaNotifiedAt: true, user: { select: { id: true, name: true } } },
    });
    if (!student || student.goHallLowQuotaNotifiedAt !== null) return;
    if (!(await hasPushSubscription(student.user.id))) return;
    const remaining = await getTicketBalance(studentId);
    if (remaining > LOW_TICKET_THRESHOLD) return;
    await prisma.student.update({ where: { id: studentId }, data: { goHallLowQuotaNotifiedAt: new Date() } });
    await pushToUser(student.user.id, {
      title: '弈廳堂票提醒',
      body: `${student.user.name} 弈廳堂票剩餘：${remaining} 堂，請盡快與行政人員聯繫續購`,
      url: '/student',
    });
  } catch (err) {
    console.error('maybeNotifyLowGoHallTickets failed', err);
  }
}
```

(d) `notifyAttendanceResult`（:1149-1169）改為（簽到簽退訊息不再看綁定與否，pushToUser 沒訂閱時自然 no-op）：

```ts
async function notifyAttendanceResult(
  student: { id: string; user: { id: string; name: string } },
  match: CheckInCandidate,
  action: 'CHECKED_IN' | 'CHECKED_OUT',
  timeStr: string
): Promise<void> {
  try {
    const verb = action === 'CHECKED_IN' ? '簽到' : '簽退';
    await pushToUser(student.user.id, {
      title: `${verb}完成`,
      body: `${student.user.name} 已於 ${timeStr} 完成${verb}（${match.title}）`,
      url: '/student',
    });
    if (action === 'CHECKED_IN' && match.classId) {
      await maybeNotifyLowQuota(student, match.classId);
    }
    if (action === 'CHECKED_IN' && match.goHallSessionId) {
      await maybeNotifyLowGoHallTickets(student.id);
    }
  } catch (err) {
    console.error('notifyAttendanceResult failed', err);
  }
}
```

(e) `checkInByStudentNumber`（:1177-1180）與 `resolveCheckIn`（:1214-1217）的兩個相同查詢：

```ts
  const student = await prisma.student.findUnique({
    where: { studentNumber: code },
    select: { id: true, user: { select: { id: true, name: true } } },
  });
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: PASS（全檔）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "feat: attendance notifications over web push"
```

---

### Task 6: makeupRequestService——notifyMakeup 遷移＋一對一老師通知

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts`（import :8；`MAKEUP_NOTIFY_INCLUDE` :214-217；`notifyMakeup` :221-236）
- Test: `src/lib/services/makeupRequestService.test.ts`（:467-485）

**Interfaces:**
- Consumes: `pushToUser`（Task 1）、`subscribeStudentForTest`（Task 1）
- Produces: `notifyMakeup` 行為擴充——一對一（`makeup.teacher` 存在）且 kind 為 `APPROVED`/`REVOKED` 時同時通知老師。`MAKEUP_NOTIFY_INCLUDE` 新形狀含 `teacher: { select: { userId: true } }`（Task 7 也吃這個 include）。

- [ ] **Step 1: 改寫測試**

`src/lib/services/makeupRequestService.test.ts` import 區加：

```ts
import { subscribeStudentForTest } from '@/lib/testUtils/pushHelpers';
```

- :467 測試名 `'does not throw when the student has no LINE binding'` → `'does not throw when the student has no push subscription'`（內容不動）。
- :476-484 改為：

```ts
  it('does not throw when the student has a push subscription but VAPID keys are not configured', async () => {
    const { student, classB, leave } = await setup();
    await subscribeStudentForTest(student.id);
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(Date.UTC(2026, 6, 22)) });

    const decided = await decideMakeupRequest(makeup.id, 'REJECTED');

    expect(decided.status).toBe('REJECTED');
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:dbpush && npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: FAIL（`subscribeStudentForTest` 造出的訂閱沒問題，但實作仍 import `pushLineMessage` 並查 `lineUserId`——此步失敗訊息可能是型別／欄位相關；若整檔先 PASS 也可，重點是 Step 3 改完要 PASS）。

- [ ] **Step 3: 改實作**

`src/lib/services/makeupRequestService.ts`：

(a) :8 `import { pushLineMessage } from './lineService';` → `import { pushToUser } from './pushService';`

(b) `MAKEUP_NOTIFY_INCLUDE`（:214-217）改為：

```ts
const MAKEUP_NOTIFY_INCLUDE = {
  leaveRequest: { select: { student: { select: { id: true, user: { select: { id: true, name: true } } } } } },
  targetClass: { select: { name: true, startTime: true, endTime: true } },
  teacher: { select: { userId: true } },
} as const;
```

(c) `notifyMakeup`（:221-236，含上方註解）整段改為：

```ts
// 推播通知家長；一對一另通知被指派老師。失敗只記 log，不影響主流程
// （核准／代排／撤銷共用）。
async function notifyMakeup(makeup: MakeupWithNotifyInfo, kind: 'APPROVED' | 'REJECTED' | 'REVOKED') {
  try {
    const student = makeup.leaveRequest.student;
    const slot = formatMakeupSlot(makeup);
    const studentMessage =
      kind === 'APPROVED'
        ? { title: '補課已核准', body: `${student.user.name}的補課申請已核准：${slot}` }
        : kind === 'REVOKED'
          ? { title: '補課已取消', body: `${student.user.name}的補課已取消：${slot}，如需重新安排請洽行政人員` }
          : { title: '補課申請未通過', body: `${student.user.name}的補課申請未通過，請洽行政人員` };
    await pushToUser(student.user.id, { ...studentMessage, url: '/student' });

    // 一對一補課有指定老師：核准＝確定指派、撤銷＝行程取消，都要讓老師知道。
    if (makeup.teacher && kind !== 'REJECTED') {
      const teacherMessage =
        kind === 'APPROVED'
          ? { title: '一對一補課指派', body: `您被指派 ${student.user.name} 的一對一補課：${slot}` }
          : { title: '一對一補課取消', body: `${student.user.name} 的一對一補課已取消：${slot}` };
      await pushToUser(makeup.teacher.userId, { ...teacherMessage, url: '/teacher' });
    }
  } catch (err) {
    console.error('makeup push notification failed', err);
  }
}
```

（注意：spec 只列「被指派時通知老師」；REVOKED 也通知是為了老師不會白跑一趟，設計上的刻意補充。）

(d) `leaveRequestService.ts:24-25` 的註解「刪補課＋LINE 通知」改為「刪補課＋推播通知」。

- [ ] **Step 4: 加一個老師收到指派通知的整合測試**

在 `makeupRequestService.test.ts` 的 `decideMakeupRequest` describe 區塊（:465 附近）加：

```ts
  it('approving a one-on-one makeup does not throw when the assigned teacher exists', async () => {
    const { student, teacher, leave } = await setup();
    await subscribeStudentForTest(student.id);
    await prisma.teacherAvailability.create({
      data: { teacherId: teacher.id, weekday: new Date(Date.UTC(2026, 6, 22)).getUTCDay(), startTime: '10:00', endTime: '18:00' },
    });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date(Date.UTC(2026, 6, 22)),
      slotStartTime: '10:00',
    });

    const decided = await decideMakeupRequest(makeup.id, 'APPROVED');

    expect(decided.status).toBe('APPROVED');
  });
```

注意：`setup()` 的 teacher/leave 形狀以該測試檔既有 helper 為準——若 `setup()` 的班級科目不是圍棋（一對一限圍棋，`NOT_AVAILABLE`），改用該檔中既有的一對一測試（搜 `createOneOnOneMakeupRequest`）的 setup helper 照抄其建置步驟。若既有一對一測試已覆蓋 APPROVED 路徑，本步驟可只在其 setup 加 `subscribeStudentForTest` 而不新增測試。

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: PASS（全檔）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/makeupRequestService.ts src/lib/services/makeupRequestService.test.ts src/lib/services/leaveRequestService.ts
git commit -m "feat: makeup notifications over web push, notify assigned one-on-one teacher"
```

---

### Task 7: 學生送出請假／補課申請 → 通知行政

**Files:**
- Modify: `src/lib/services/leaveRequestService.ts`（`createLeaveRequest` :11-22）
- Modify: `src/lib/services/makeupRequestService.ts`（`createInsertionMakeupRequest` :65-76、`createOneOnOneMakeupRequest` :94-96，新增 private helper）
- Test: `src/lib/services/leaveRequestService.test.ts`（若不存在則新建）、`src/lib/services/makeupRequestService.test.ts`

**Interfaces:**
- Consumes: `pushToAdmins`（Task 1）、`formatDateWithWeekday`（`@/lib/dateFormat`）
- Produces: 無新對外介面（行為擴充：學生自行建立時 pushToAdmins；行政代排路徑 `arrangeLeaveOnly`/`arrange*Makeup` **不**觸發）

- [ ] **Step 1: 寫失敗測試**

先確認 `src/lib/services/leaveRequestService.test.ts` 是否存在（`ls src/lib/services/ | grep leave`）。存在則在其中加 describe；不存在則新建，頂部至少要有（helper 的實際來源路徑照 `makeupRequestService.test.ts` 頂部 import 抄）：

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createLeaveRequest } from './leaveRequestService';
// createTeacher / createStudent / createClass / enrollStudent 照 makeupRequestService.test.ts 的 import 來源
```

測試本體：

```ts
  it('creating a student leave request does not throw when an admin has a push subscription', async () => {
    const admin = await prisma.user.create({ data: { email: 'leave-admin@example.com', password: 'x', name: '行政', role: 'ADMIN' } });
    await prisma.pushSubscription.create({
      data: { userId: admin.id, endpoint: 'https://push.example/admin-1', p256dh: 'k', auth: 'a' },
    });
    const teacher = await createTeacher({ name: '陳老師', email: 'leave-t@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'leave-s@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const leave = await createLeaveRequest({
      studentId: student.id,
      classId: cls.id,
      date: new Date(Date.UTC(2026, 6, 22)),
      reason: '事假',
    });

    expect(leave.status).toBe('APPROVED');
  });
```

（2026-07-22 是週三，`weekday: 3` 對得上；若沿用既有測試檔的班級 fixture，日期改成符合該班 weekday 的 UTC 日期。）

- [ ] **Step 2: 跑測試確認狀態**

Run: `npm run test:dbpush && npx vitest run src/lib/services/leaveRequestService.test.ts`
Expected: 此測試本來就會 PASS（通知是靜默附加行為）——TDD 在這裡保護的是「加了通知不把主流程弄炸」。先確認 PASS 再改實作，改完必須仍 PASS。

- [ ] **Step 3: 改 `leaveRequestService.ts`**

import 區加：

```ts
import { pushToAdmins } from './pushService';
import { formatDateWithWeekday } from '@/lib/dateFormat';
```

`createLeaveRequest`（:11-22）改為：

```ts
export async function createLeaveRequest(input: CreateLeaveRequestInput) {
  const enrolled = await prisma.classEnrollment.findUnique({
    where: { studentId_classId: { studentId: input.studentId, classId: input.classId } },
    include: { class: { select: { weekday: true, name: true } } },
  });
  if (!enrolled) throw new Error('NOT_ENROLLED');
  if (input.date.getUTCDay() !== enrolled.class.weekday) throw new Error('INVALID_WEEKDAY');

  const leave = await prisma.leaveRequest.create({
    data: { ...input, status: 'APPROVED', origin: 'STUDENT' },
  });
  await notifyAdminsNewLeave(input.studentId, enrolled.class.name, input.date);
  return leave;
}

// 學生自行請假時提醒行政（行政代辦 arrangeLeaveOnly 不經過這裡）。失敗只記 log。
async function notifyAdminsNewLeave(studentId: string, className: string, date: Date) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { user: { select: { name: true } } },
    });
    if (!student) return;
    await pushToAdmins({
      title: '新請假申請',
      body: `${student.user.name} 已請假：${formatDateWithWeekday(date, 'zh-TW')}「${className}」`,
      url: '/admin',
    });
  } catch (err) {
    console.error('new leave request push notification failed', err);
  }
}
```

- [ ] **Step 4: 改 `makeupRequestService.ts`**

import 區的 pushService import 改為：

```ts
import { pushToUser, pushToAdmins } from './pushService';
```

`createInsertionMakeupRequest`（:65-76）改為：

```ts
export async function createInsertionMakeupRequest(input: CreateInsertionInput) {
  await assertTargetClassWeekday(input.targetClassId, input.targetDate);
  const makeup = await prisma.makeupRequest.create({
    data: {
      leaveRequestId: input.leaveRequestId,
      type: 'INSERTION',
      status: 'PENDING_ADMIN',
      targetClassId: input.targetClassId,
      targetDate: input.targetDate,
    },
  });
  await notifyAdminsNewMakeupRequest(input.leaveRequestId);
  return makeup;
}
```

`createOneOnOneMakeupRequest`（:94-96）改為：

```ts
export async function createOneOnOneMakeupRequest(input: CreateOneOnOneInput) {
  const makeup = await runSerializableWithRetry(() => createOneOnOneMakeupRequestTx(input));
  await notifyAdminsNewMakeupRequest(input.leaveRequestId);
  return makeup;
}
```

在 `createOneOnOneMakeupRequest` 之後加 private helper：

```ts
// 學生送出補課申請（PENDING_ADMIN）時提醒行政審核；行政代排直接 APPROVED，
// 不經過這兩個入口。失敗只記 log。
async function notifyAdminsNewMakeupRequest(leaveRequestId: string) {
  try {
    const leave = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequestId },
      select: { student: { select: { user: { select: { name: true } } } } },
    });
    if (!leave) return;
    await pushToAdmins({
      title: '新補課申請',
      body: `${leave.student.user.name} 送出補課申請，請至系統審核`,
      url: '/admin/makeup-requests',
    });
  } catch (err) {
    console.error('new makeup request push notification failed', err);
  }
}
```

- [ ] **Step 5: 跑兩檔測試確認通過**

Run: `npx vitest run src/lib/services/leaveRequestService.test.ts src/lib/services/makeupRequestService.test.ts`
Expected: PASS（全部）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/leaveRequestService.ts src/lib/services/leaveRequestService.test.ts src/lib/services/makeupRequestService.ts src/lib/services/makeupRequestService.test.ts
git commit -m "feat: notify admins when a student submits a leave or makeup request"
```

---

### Task 8: tutoringBookingService——額度提醒遷移＋預約/取消通知行政與老師

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`（import :4；`CreateBookingInput` :29-38；`createBooking` :44-94；`cancelBooking` :127-145；`sendMonthlyQuotaReminders` :456-486；新增 private helper）
- Modify: `src/app/api/tutoring-bookings/route.ts`（POST 的 `createBooking` 呼叫）
- Test: `src/lib/services/tutoringBookingService.test.ts`（:533-549）

**Interfaces:**
- Consumes: `pushToUser`、`pushToUsers`、`pushToAdmins`、`hasPushSubscription`（Task 1）、`formatDateWithWeekday`
- Produces: `CreateBookingInput` 新增選填 `notifyStaff?: boolean`（僅 route 的 STUDENT 分支傳 true；walk-in 與行政代排不傳）

- [ ] **Step 1: 改寫測試**

`src/lib/services/tutoringBookingService.test.ts` import 區加：

```ts
import { subscribeStudentForTest } from '@/lib/testUtils/pushHelpers';
```

:533-549 的兩個 reminder 測試改為：

```ts
  it('notifies an under-quota enrollment with a push subscription once, then skips it on a second run', async () => {
    const { student } = await setupProgramWithEnrollment();
    await subscribeStudentForTest(student.id);

    const first = await sendMonthlyQuotaReminders();
    expect(first.notified).toBe(1);

    const second = await sendMonthlyQuotaReminders();
    expect(second.notified).toBe(0);
  });

  it('skips enrollments without a push subscription', async () => {
    await setupProgramWithEnrollment();
    const result = await sendMonthlyQuotaReminders();
    expect(result.notified).toBe(0);
  });
```

同 describe 附近加預約／取消不炸的測試（`FRIDAY`、`setupProgramWithEnrollment`、`createBooking`、`cancelBooking` 都是該檔既有符號）：

```ts
describe('booking staff notifications', () => {
  it('createBooking with notifyStaff does not throw', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, notifyStaff: true });
    expect(booking.id).toBeTruthy();
  });

  it('student cancelBooking does not throw and still cancels', async () => {
    const { window, enrollment, student } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await cancelBooking(booking.id, student.id);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('CANCELLED');
  });
});
```

（若 `setupProgramWithEnrollment` 不回傳 `student`，看該 helper 定義取得 studentId 的方式照用。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm run test:dbpush && npx vitest run src/lib/services/tutoringBookingService.test.ts`
Expected: FAIL——`notifyStaff` 不在 `CreateBookingInput`（型別錯誤），reminder 測試在有訂閱、無 lineUserId 下 `notified` 為 0。

- [ ] **Step 3: 改實作**

`src/lib/services/tutoringBookingService.ts`：

(a) :4 `import { pushLineMessage } from './lineService';` → 

```ts
import { pushToUser, pushToUsers, pushToAdmins, hasPushSubscription } from './pushService';
import { formatDateWithWeekday } from '@/lib/dateFormat';
```

（若檔內已 import `formatDateWithWeekday` 就不要重複。）

(b) `CreateBookingInput`（:29-38）在 `allowOverCapacity?: boolean;` 之後加：

```ts
  // 學生自行預約時通知行政與時段老師；行政代排、點名現場加入不通知。
  notifyStaff?: boolean;
```

(c) `createBooking`（:44-94）——交易內容**完全不動**，只把回傳包起來：

```ts
export async function createBooking(input: CreateBookingInput): Promise<{ id: string }> {
  const booking = await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        // ……原 :47-89 的交易內容一字不改……
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  if (input.notifyStaff) await notifyStaffBookingChange(booking.id, 'BOOKED');
  return booking;
}
```

(d) `cancelBooking`（:127-145）最後一行 update 之後加：

```ts
  await notifyStaffBookingChange(bookingId, 'CANCELLED');
```

（`adminCancelBooking` 不動。）

(e) 在 `adminCancelBooking` 後面加 private helper：

```ts
// 學生自行預約／取消時通知行政與該時段老師（含第二老師）。
// 失敗只記 log，不影響主流程。
async function notifyStaffBookingChange(bookingId: string, change: 'BOOKED' | 'CANCELLED') {
  try {
    const booking = await prisma.tutoringBooking.findUnique({
      where: { id: bookingId },
      select: {
        date: true,
        window: {
          select: {
            teacher: { select: { userId: true } },
            teacher2: { select: { userId: true } },
            program: { select: { name: true } },
          },
        },
        enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      },
    });
    if (!booking) return;
    const studentName = booking.enrollment.student.user.name;
    const dateLabel = formatDateWithWeekday(booking.date, 'zh-TW');
    const payload =
      change === 'BOOKED'
        ? { title: '個別輔導預約', body: `${studentName} 已預約 ${dateLabel}「${booking.window.program.name}」` }
        : { title: '個別輔導取消', body: `${studentName} 已取消 ${dateLabel}「${booking.window.program.name}」` };
    const teacherUserIds = [booking.window.teacher.userId, booking.window.teacher2?.userId].filter(
      (id): id is string => Boolean(id)
    );
    await pushToUsers(teacherUserIds, { ...payload, url: '/teacher' });
    await pushToAdmins({ ...payload, url: '/admin/tutoring/bookings' });
  } catch (err) {
    console.error('tutoring booking push notification failed', err);
  }
}
```

（`TutoringWindow` 的 relation 名以 schema :434-449 為準：`teacher`／`teacher2`／`program`；若名稱不同以 schema 為準改 select。）

(f) `sendMonthlyQuotaReminders`（:456-486）：include 的 student 改為

```ts
      student: { select: { id: true, user: { select: { id: true, name: true } } } },
```

迴圈內 `if (!e.student.lineUserId) continue;` 改為

```ts
    if (!(await hasPushSubscription(e.student.user.id))) continue;
```

`pushLineMessage(...)` 改為

```ts
    await pushToUser(e.student.user.id, {
      title: '個別輔導額度提醒',
      body: `${e.student.user.name} 本月「${e.program.name}」還剩 ${quota - locked - upcoming} 堂未預約，記得安排上課時間`,
      url: '/student/tutoring',
    });
```

(g) `src/app/api/tutoring-bookings/route.ts` POST 的 `createBooking` 呼叫改為：

```ts
    const booking = await createBooking({
      enrollmentId,
      windowId: body.windowId,
      date: new Date(body.date),
      notifyStaff: session.user.role === 'STUDENT',
    });
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/tutoringBookingService.test.ts`
Expected: PASS（全檔）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts src/app/api/tutoring-bookings/route.ts
git commit -m "feat: tutoring booking and quota notifications over web push"
```

---

### Task 9: 代課指派 → 通知代課老師

**Files:**
- Modify: `src/lib/services/substituteRequestService.ts`（`assignSubstituteTeacher` :62-67）
- Test: `src/lib/services/substituteRequestService.test.ts`（不存在則新建，helper import 照 `attendanceService.test.ts` 頂部抄）

**Interfaces:**
- Consumes: `pushToUser`（Task 1）、`formatDateWithWeekday`
- Produces: `assignSubstituteTeacher` 改為 `async`，回傳值多了 include 的 `substituteTeacher`／`class` 欄位（呼叫者只有 `src/app/api/substitute-requests/[id]/route.ts:13`，直接 `NextResponse.json(updated)`，相容）

- [ ] **Step 1: 寫失敗測試**

確認測試檔是否存在：`ls src/lib/services/substituteRequestService.test.ts`。新建檔時頂部至少要有（helper 來源照其他測試檔抄）：

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createSubstituteRequest, assignSubstituteTeacher } from './substituteRequestService';
// createTeacher / createClass 照 attendanceService.test.ts 的 import 來源
```

測試本體：

```ts
describe('assignSubstituteTeacher', () => {
  it('assigns and does not throw when the substitute teacher has a push subscription', async () => {
    const original = await createTeacher({ name: '原老師', email: 'sub-orig@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '代課老師', email: 'sub-sub@example.com', password: 'x', subjects: '數學' });
    const subUser = await prisma.teacher.findUniqueOrThrow({ where: { id: substitute.id }, select: { userId: true } });
    await prisma.pushSubscription.create({
      data: { userId: subUser.userId, endpoint: 'https://push.example/sub-t', p256dh: 'k', auth: 'a' },
    });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: original.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    const request = await createSubstituteRequest({
      classId: cls.id,
      originalTeacherId: original.id,
      date: new Date(Date.UTC(2026, 6, 22)),
      reason: '出差',
    });

    const updated = await assignSubstituteTeacher(request.id, substitute.id);

    expect(updated.status).toBe('ASSIGNED');
    expect(updated.substituteTeacherId).toBe(substitute.id);
  });
});
```

（2026-07-22 UTC 是週三；`createTeacher`/`createClass` 的 import 來源照其他測試檔抄。新建檔時記得 `import { describe, it, expect } from 'vitest';` 與 `import { prisma } from '@/lib/db';`。）

- [ ] **Step 2: 跑測試確認狀態**

Run: `npm run test:dbpush && npx vitest run src/lib/services/substituteRequestService.test.ts`
Expected: 新測試 PASS（現有實作也能過）——本任務的 TDD 保護點同 Task 7：加通知不能弄炸指派。

- [ ] **Step 3: 改實作**

`src/lib/services/substituteRequestService.ts` import 區加：

```ts
import { pushToUser } from './pushService';
import { formatDateWithWeekday } from '@/lib/dateFormat';
```

`assignSubstituteTeacher`（:62-67）改為：

```ts
export async function assignSubstituteTeacher(id: string, substituteTeacherId: string) {
  const updated = await prisma.substituteRequest.update({
    where: { id },
    data: { substituteTeacherId, status: 'ASSIGNED' },
    include: {
      substituteTeacher: { select: { userId: true } },
      class: { select: { name: true, startTime: true, endTime: true } },
    },
  });
  // 通知被指派的代課老師（pushToUser 永不 throw，不影響指派）。
  if (updated.substituteTeacher) {
    await pushToUser(updated.substituteTeacher.userId, {
      title: '代課指派',
      body: `您被指派 ${formatDateWithWeekday(updated.date, 'zh-TW')}「${updated.class.name}」的代課（${updated.class.startTime}-${updated.class.endTime}）`,
      url: '/teacher',
    });
  }
  return updated;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/substituteRequestService.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/substituteRequestService.ts src/lib/services/substituteRequestService.test.ts
git commit -m "feat: notify substitute teacher on assignment"
```

---

### Task 10: LINE 全面移除

**前提：** Task 5-9 已完成（`pushLineMessage` 已無 service 呼叫者）。先跑 `grep -rn "pushLineMessage" src/ | grep -v lineService` 確認**只剩 lineService 自己**，有殘留就先回頭修。

**Files:**
- Delete: `src/lib/services/lineService.ts`、`src/lib/services/lineService.test.ts`
- Delete: `src/app/api/line/`（整目錄）、`src/app/api/students/[id]/line-bind-code/`、`src/app/api/students/[id]/line-unbind/`
- Delete: `src/app/admin/line-setup/`（整目錄）
- Modify: `src/app/admin/students/page.tsx`（多處，見 Step 2）
- Modify: `src/lib/services/studentService.ts:45`（移除 `lineUserId: true,`）
- Modify: `prisma/schema.prisma:128-129`（移除兩欄位）
- Modify: `.env.example`（移除 LINE 三行）
- Modify: `package.json`（移除 `qrcode`、`@types/qrcode`）

- [ ] **Step 1: 刪檔**

```bash
git rm src/lib/services/lineService.ts src/lib/services/lineService.test.ts
git rm -r src/app/api/line "src/app/api/students/[id]/line-bind-code" "src/app/api/students/[id]/line-unbind" src/app/admin/line-setup
```

- [ ] **Step 2: 清 `src/app/admin/students/page.tsx` 的 LINE UI**

依行號由後往前刪（行號是改動前的）：
1. :851-891——整個「LINE 通知」JSX 區塊（含 :882-889 連到 `/admin/line-setup` 的 `查看設定教學` Link）。
2. :459-469——`handleLineUnbind`。
3. :438-457——`handleGenerateLineBindCode`。
4. :427-436——`refreshEditingFromServer`（只有 LINE 區塊在用，一併刪；刪前 grep 確認無其他呼叫者）。
5. :242-243——`openEdit()` 內的 `setLineBindInfo(null); setLineBinding(false);`。
6. :162-166——QRCode 的 `useEffect`。
7. :153-155——`lineBindInfo`／`lineBinding` state 與 `qrCanvasRef`。
8. :30——`StudentRow` 的 `lineUserId: string | null;`。
9. :14——`import QRCode from 'qrcode';`。

保留：`Link` import（:776 還在用）、`useConfirm`（:414 還在用）、進階設定容器（:840-903，刪掉 LINE div 後剩手足帳號區塊）。

- [ ] **Step 3: 清 `studentService.ts` 與 schema**

- `src/lib/services/studentService.ts:45`：刪 `lineUserId: true,` 一行。
- `prisma/schema.prisma:128-129`：刪 `lineUserId String? @unique` 與 `lineBindCode String? @unique` 兩行。
- 執行 `npx prisma db push`（dev DB 會 DROP 這兩欄）。Expected: sync 成功。**重啟 dev server。**

- [ ] **Step 4: 清 env 與依賴**

- `.env.example`：刪 `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_CHANNEL_SECRET`、`LINE_OA_BASIC_ID` 三行。
- `npm uninstall qrcode @types/qrcode`

- [ ] **Step 5: 全面驗證**

```bash
grep -rn "lineUserId\|lineBindCode\|pushLineMessage\|LINE_CHANNEL\|LINE_OA\|line-setup\|line-bind\|line-unbind" src/ prisma/schema.prisma .env.example
```
Expected: 無任何輸出（docs/ 的歷史文件不用清）。

Run: `npx tsc --noEmit && npx next lint`
Expected: 無錯誤。

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add -A src/app/admin/students/page.tsx src/lib/services/studentService.ts prisma/schema.prisma .env.example package.json package-lock.json
git commit -m "feat!: remove LINE notification integration"
```

---

### Task 11: /guide 使用教學更新

**Files:**
- Modify: `src/app/guide/page.tsx`（:309-312 的一句話；:333 的「還有問題？」Tip 之前插入新章節）

**Interfaces:**
- Consumes: 該檔內既有的 `Chapter`／`Step`／`Tip` 元件（:28-78）
- Produces: 無

- [ ] **Step 1: 改第 9 章的 LINE 句子**

:309-312 的 Tip 內容，把結尾「系統會透過 LINE 提醒您。」（實際字串以檔內為準，grep `LINE` 找到那一句）改為「系統會推播通知提醒您（見第 11 章）。」

- [ ] **Step 2: 插入第 11 章**

在 :333「還有問題？」Tip **之前**插入（縮排與前後章節一致）：

```tsx
      <Chapter no="11" title="開啟手機通知">
        <p className="mb-3 text-sm text-inkMuted">
          開啟通知後，簽到簽退、補課申請結果、堂數提醒等重要訊息會直接推播到您的手機，不需要安裝任何
          App。
        </p>
        <Step no="1" title="iPhone：先加入主畫面">
          用 Safari 開啟本網站，點下方「分享」按鈕，選「加入主畫面」。之後請一律從主畫面的 MUP
          圖示開啟系統（直接用 Safari 開啟收不到通知）。
        </Step>
        <Step no="2" title="Android：直接開啟即可">
          用 Chrome 開啟本網站即可，不需要加入主畫面（加入主畫面使用起來更方便）。
        </Step>
        <Step no="3" title="按「開啟通知」">
          登入後，首頁上方會出現「開啟通知」卡片，按下按鈕並在跳出的視窗選「允許」就完成了。之後手足帳號切換時，各帳號的通知都會送到這支手機。
        </Step>
        <Tip title="沒看到「開啟通知」卡片？">
          iPhone 需要 iOS 16.4 以上，且必須從主畫面開啟；如果先前按過「封鎖」，請到瀏覽器設定把本網站的通知改為允許，再重新整理頁面。
        </Tip>
      </Chapter>
```

（`Step` 的文字內容直接作 children；若該檔 `Step` 需要 JSX children 包 `<p>`，照第 1-10 章既有寫法對齊。`Tip` 是否能放在 `Chapter` 內也照既有章節的用法——第 9 章 :309 已有先例。）

- [ ] **Step 3: 驗證**

Run: `npx tsc --noEmit && npx next lint`
Expected: 無錯誤。

dev server 開 `/guide`：新章節展開正常、編號 11 接在 10 之後、Tip 樣式正確。

- [ ] **Step 4: Commit**

```bash
git add src/app/guide/page.tsx
git commit -m "docs: guide chapter for enabling push notifications"
```

（PDF 版使用手冊重製列為上線後的後續工作，方法記在 memory `project_student_guide`，本計畫不含。）

---

### Task 12: 最終驗證＋部署準備

**Files:**
- Create: `docs/superpowers/specs/2026-08-20-web-push-deployment.md`（上線步驟清單）

- [ ] **Step 1: 全套測試與 build**

```bash
npm test
```
Expected: 全部 PASS。

```bash
npm run build
```
Expected: build 成功（注意不要同時跑著 dev server，`.next` 會互咬——先停 dev server 再 build，build 完再起）。

- [ ] **Step 2: 瀏覽器端對端驗證**

dev server＋瀏覽器（`.env` 有 VAPID 金鑰）：
1. 學生帳號登入 → 首頁按「開啟通知」→ 卡片轉為已開啟；DB `PushSubscription` 有一列（`npx prisma studio` 或 psql 查）。
2. 行政 kiosk 掃碼簽到該學生（或直接呼叫 checkin API）→ 瀏覽器收到「簽到完成」通知，點擊開到 `/student`。
   - headless 環境看不到系統通知時，改以間接驗證：pushService 不報錯＋`read_network_requests` 確認 push 閘道呼叫發出（本地假 endpoint 會 404/410，驗證訂閱被自動清掉也算通過）。
3. 學生送請假 → 行政帳號裝置收到「新請假申請」。
4. 「關閉」通知 → DB 該 user 的列消失，瀏覽器訂閱仍在。

- [ ] **Step 3: 寫部署文件 `docs/superpowers/specs/2026-08-20-web-push-deployment.md`**

```markdown
# Web Push 上線步驟（2026-08-20 計畫的部署清單）

依序執行；1-2 在 push 部署之前做完。

## 1. Vercel 環境變數

`npx web-push generate-vapid-keys` 產生正式金鑰（跟本地開發用的分開），在 Vercel 設定：

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = 公鑰
- `VAPID_PRIVATE_KEY` = 私鑰
- `VAPID_SUBJECT` = `mailto:<管理者 email>`

## 2. 正式站 SQL（Supabase SQL editor）

```sql
CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_userId_endpoint_key"
  ON "PushSubscription"("userId", "endpoint");

ALTER TABLE "Student" DROP COLUMN "lineUserId", DROP COLUMN "lineBindCode";
```

## 3. push 觸發 Vercel 部署

## 4. 上線後

- 正式站用一支真手機走一次：開啟通知 → 掃碼簽到 → 收到推播。
- LINE Developers 後台的 Messaging API channel 自行停用（程式碼已全移除，留著也不會被呼叫）。
- 使用手冊 PDF 重製（`/guide` 已更新，PDF 另行處理）。
```

- [ ] **Step 4: Commit＋回報**

```bash
git add docs/superpowers/specs/2026-08-20-web-push-deployment.md
git commit -m "docs: web push deployment checklist"
```

回報使用者：功能完成、測試與 build 結果、部署清單位置。**不要自行 push**——正式站 SQL 與 Vercel env 要先設好，push 順序由使用者決定。
