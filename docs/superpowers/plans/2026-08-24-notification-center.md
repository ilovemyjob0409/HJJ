# 通知中心（小鈴鐺收件夾）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三端頁首新增小鈴鐺收件夾（未讀徽章＋下拉面板＋逐則已讀＋一鍵全讀），並建立「寫收件夾＋發推播」的統一發送入口，全站現有推播點全部遷移過去。

**Architecture:** 新增 `Notification` 資料表與 `notificationService`（`notifyUser`／`notifyUsers`／`notifyAdmins`＝先寫 DB 再推播，皆 best-effort）；`pushService` 降級為純傳輸層。鈴鐺是獨立 client component `NotificationBell` 掛進 `AppShell` 右側按鈕群。

**Tech Stack:** Next.js App Router + Prisma（schema 變更：加一張表）+ Vitest（真實測試 DB）+ 既有 Web Push。

**Spec:** `docs/superpowers/specs/2026-08-24-notification-center-design.md`

## Global Constraints

- 日期顯示慣例：日期＋（星期）；通知時間格式 `M/D（週N） HH:mm`，時區固定台北。
- UI 重用共用元件與既有配色 token／`animate-*` class（面板 pattern 比照 AppShell 手足切換選單），不另創動畫。
- 通知是 best-effort：DB 寫入或推播失敗都只記 log（`console.error`），不影響業務主流程。
- 使用者明確要求：**「全部標為已讀」一鍵按鈕**；已讀採**逐則點擊**。
- 測試 DB 是共用的：在隔離 worktree＋專用測試 DB 執行（`npm test` 的 `test:dbpush` 會用 worktree 的 schema 建好新表）；**不要**在主 checkout 對共用 DB 跑 `test:dbpush`。
- **schema 有變更**：worktree 內對 dev DB 跑 `npx prisma db push`（不加 `--accept-data-loss`；若 Prisma 提示要刪任何東西，停下回報，不要硬推）＋ 改完 schema 要重啟 dev server 才吃得到新 Prisma Client。
- commit 時只 stage 自己改的檔案，不要 `git add -A`。
- 正式站部署順序（最終任務內詳列）：先對正式 DB 跑 CREATE TABLE SQL，再 push 觸發 Vercel。

---

### Task 1: Notification schema＋notificationService 核心

**Files:**
- Modify: `prisma/schema.prisma`（新增 `Notification` model；`User` 加 relation）
- Create: `src/lib/services/notificationService.ts`
- Test: `src/lib/services/notificationService.test.ts`（新檔）

**Interfaces:**
- Consumes: `pushService` 的 `pushToUsers`（既有，永不 throw）。
- Produces（後續任務依賴，簽名照抄）:

```ts
export interface NotifyPayload { title: string; body: string; url: string; }
export interface NotificationRow { id: string; title: string; body: string; url: string | null; readAt: Date | null; createdAt: Date; }
export async function notifyUser(userId: string, payload: NotifyPayload): Promise<void>
export async function notifyUsers(userIds: string[], payload: NotifyPayload): Promise<void>
export async function notifyAdmins(payload: NotifyPayload): Promise<void>
export async function listNotifications(userId: string, limit = 50): Promise<NotificationRow[]>
export function countUnread(userId: string): Promise<number>
export async function markRead(notificationId: string, userId: string): Promise<void>  // throws 'NOTIFICATION_NOT_FOUND' | 'NOT_OWNER'
export async function markAllRead(userId: string): Promise<void>
```

- [ ] **Step 1: schema 變更**

`prisma/schema.prisma`——`User` model 的 `pushSubscriptions PushSubscription[]` 之後加一行：

```prisma
  notifications             Notification[]
```

檔尾（`PushSubscription` model 附近）新增：

```prisma
model Notification {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  title     String
  body      String
  url       String?
  readAt    DateTime? // null = 未讀
  createdAt DateTime  @default(now())

  @@index([userId, createdAt])
  @@index([userId, readAt])
}
```

執行 `npx prisma generate`（worktree 內）。dev DB 的 db push 留到 Task 5（瀏覽器驗證前）再做；測試 DB 由 `npm test` 的 `test:dbpush` 自動建。

- [ ] **Step 2: 寫失敗測試**

Create `src/lib/services/notificationService.test.ts`：

```ts
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
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/notificationService.test.ts`
Expected: FAIL（`notificationService` 模組不存在）。

- [ ] **Step 4: 實作**

Create `src/lib/services/notificationService.ts`：

```ts
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
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/lib/services/notificationService.test.ts`
Expected: 全數 PASS。再跑一次全量 `npm test` 確認 schema 變更沒弄壞既有測試。

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/lib/services/notificationService.ts src/lib/services/notificationService.test.ts
git commit -m "feat(notifications): Notification model + unified notify service (inbox + push)"
```

---

### Task 2: 通知 API（列表／單則已讀／全部已讀）

**Files:**
- Create: `src/app/api/notifications/route.ts`
- Create: `src/app/api/notifications/[id]/route.ts`
- Create: `src/app/api/notifications/read-all/route.ts`
- Test: `src/app/api/notifications/route.test.ts`（涵蓋三條 route，集中一檔即可）

**Interfaces:**
- Consumes: Task 1 的 `listNotifications`／`countUnread`／`markRead`／`markAllRead`／`notifyUser`。
- Produces: `GET /api/notifications` → `{ unread: number, rows: NotificationRow[] }`；`PATCH /api/notifications/[id]` → `{ success: true }`（403 非本人、404 不存在）；`POST /api/notifications/read-all` → `{ success: true }`。三者皆任何已登入角色可用、僅操作自己的資料，未登入 403。

- [ ] **Step 1: 寫失敗測試**

Create `src/app/api/notifications/route.test.ts`（session mock pattern 同其他 route 測試）：

```ts
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
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/notifications', () => {
  it('403：未登入', async () => {
    asAnon();
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('只回自己的通知與未讀數', async () => {
    const me = await createUser();
    const other = await createUser();
    await notifyUser(me.id, { title: '我的', body: 'b', url: '/student' });
    await notifyUser(other.id, { title: '別人的', body: 'b', url: '/student' });
    asUser(me.id);
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.unread).toBe(1);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].title).toBe('我的');
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/app/api/notifications/route.test.ts`
Expected: FAIL（route 檔不存在）。

- [ ] **Step 3: 實作三條 route**

Create `src/app/api/notifications/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listNotifications, countUnread } from '@/lib/services/notificationService';

// 小鈴鐺收件夾：本人的最近通知＋未讀數（三端任何已登入角色）
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const [unread, rows] = await Promise.all([countUnread(session.user.id), listNotifications(session.user.id)]);
  return NextResponse.json({ unread, rows });
}
```

Create `src/app/api/notifications/[id]/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { markRead } from '@/lib/services/notificationService';

// 單則標已讀（僅本人；已讀過再標＝冪等成功）
export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    await markRead(params.id, session.user.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'NOTIFICATION_NOT_FOUND' ? 404 : message === 'NOT_OWNER' ? 403 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
```

Create `src/app/api/notifications/read-all/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { markAllRead } from '@/lib/services/notificationService';

// 一鍵已讀（使用者明確要求的按鈕）
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  await markAllRead(session.user.id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/app/api/notifications/route.test.ts src/lib/services/notificationService.test.ts`
Expected: 全數 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/notifications
git commit -m "feat(notifications): list/mark-read/read-all API routes"
```

---

### Task 3: 全站推播點遷移到統一入口＋移除 hasPushSubscription 前置檢查

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts`
- Modify: `src/lib/services/substituteRequestService.ts`
- Modify: `src/lib/services/leaveRequestService.ts`
- Modify: `src/lib/services/tutoringBookingService.ts`
- Modify: `src/lib/services/pointService.ts`
- Modify: `src/lib/services/attendanceService.ts`
- Test: `src/lib/services/notificationService.test.ts`（加整合抽查測試）
- Test (modify): `src/lib/services/tutoringBookingService.test.ts`、`src/lib/services/attendanceService.test.ts`（4 個「沒訂閱就不通知／不燒旗標」的既有測試語意反轉，改寫见 Step 2）

**Interfaces:**
- Consumes: Task 1 的 `notifyUser`／`notifyUsers`／`notifyAdmins`（與 `pushToUser`／`pushToUsers`／`pushToAdmins` 同形 payload，直接替換）。
- Produces: 業務程式碼不再 import `pushService` 的發送函式；`pushService` 只剩 `notificationService` 與推播訂閱端點使用。

- [ ] **Step 1: 逐檔替換（payload 逐字不變，只換函式名與 import）**

每一檔的具體修改（行號以當下為準，用函式名定位）：

1. `makeupRequestService.ts`
   - import 行 `import { pushToUser, pushToAdmins } from './pushService';` → `import { notifyUser, notifyAdmins } from './notificationService';`
   - `notifyAdminsNewMakeupRequest` 內 `pushToAdmins(` → `notifyAdmins(`
   - `notifyMakeup` 內兩處 `pushToUser(` → `notifyUser(`
2. `substituteRequestService.ts`
   - `import { pushToUser } from './pushService';` → `import { notifyUser } from './notificationService';`
   - `assignSubstituteTeacher` 內 `pushToUser(` → `notifyUser(`；上一行註解「（pushToUser 永不 throw，不影響指派）」改為「（notifyUser 永不 throw，不影響指派）」
3. `leaveRequestService.ts`
   - `import { pushToAdmins } from './pushService';` → `import { notifyAdmins } from './notificationService';`
   - `notifyAdminsNewLeave` 內 `pushToAdmins(` → `notifyAdmins(`
4. `tutoringBookingService.ts`
   - import 行 `import { pushToUser, pushToUsers, pushToAdmins, hasPushSubscription } from './pushService';` → `import { notifyUser, notifyUsers, notifyAdmins } from './notificationService';`
   - `notifyStudentReviewResult` 內 `pushToUser(` → `notifyUser(`
   - `notifyStaffBookingChange` 內 `pushToUsers(` → `notifyUsers(`
   - `notifyAdminsReviewNeeded` 內 `pushToAdmins(` → `notifyAdmins(`
   - `sendMonthlyQuotaReminders` 內：**刪掉** `if (!(await hasPushSubscription(e.student.user.id))) continue;` 一行；`pushToUser(` → `notifyUser(`。函式上方或該行加註解：「收件夾讓沒訂閱推播的人也收得到，不再以訂閱與否決定要不要發（旗標照燒）」
   - `sendMissedSessionReminders` 內：**刪掉** `if (!(await hasPushSubscription(userId))) continue;` 一行；`pushToUser(` → `notifyUser(`
5. `pointService.ts`
   - `import { pushToUser } from './pushService';` → `import { notifyUser } from './notificationService';`
   - `pushToUser(` → `notifyUser(`
6. `attendanceService.ts`
   - `import { pushToUser, hasPushSubscription } from './pushService';` → `import { notifyUser } from './notificationService';`
   - `maybeNotifyLowQuota` 內：**刪掉** `if (!(await hasPushSubscription(student.user.id))) return;` 一行；`pushToUser(` → `notifyUser(`
   - `maybeNotifyLowGoHallTickets` 內：**刪掉** `if (!(await hasPushSubscription(student.user.id))) return;` 一行；`pushToUser(` → `notifyUser(`
   - `notifyAttendanceResult` 內 `pushToUser(` → `notifyUser(`
   - `maybeNotifyLowQuota`／`maybeNotifyLowGoHallTickets` 上方註解中「有訂閱才燒旗標」相關句子改寫為「收件夾上線後人人收得到，旗標照燒」（保留其餘說明）

- [ ] **Step 2: 改寫語意反轉的既有測試（gate 移除後「沒訂閱」不再是不通知的理由）**

2a. `src/lib/services/tutoringBookingService.test.ts` —— `describe('sendMonthlyQuotaReminders')` 內的 `it('skips enrollments without a push subscription', ...)` 整段換成：

```ts
  it('也通知沒有推播訂閱的報名（收件夾保底），旗標照燒', async () => {
    await setupProgramWithEnrollment();
    const first = await sendMonthlyQuotaReminders();
    expect(first.notified).toBe(1);
    const second = await sendMonthlyQuotaReminders();
    expect(second.notified).toBe(0);
  });
```

2b. 同檔 `describe('sendMissedSessionReminders')` 內的 `it('does not notify without a push subscription', ...)` 整段換成：

```ts
  it('也通知沒有推播訂閱的學生（收件夾保底）', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });

    const result = await sendMissedSessionReminders(DAY_AFTER_FRIDAY);

    expect(result.notified).toBe(1);
  });
```

2c. `src/lib/services/attendanceService.test.ts` —— `it('does not burn the low-quota flag for a student with no push subscription', ...)` 整段換成（setup 不變，斷言反轉）：

```ts
  it('沒有推播訂閱也燒低堂數旗標（收件夾保底，人人收得到）', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-lowquota-unbound@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S015', 'checkin-lowquota-unbound-student@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 4 } });

    await checkInByStudentNumber('S015', '2026-08-04', '19:00', 'marker-1');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: cls.id } } });
    expect(enrollment.lowQuotaNotifiedAt).not.toBeNull();
  });
```

2d. 同檔 `it('does not set the flag when balance stays above the threshold or student has no push subscription', ...)` ——測試體不變（餘額 9 高於門檻本來就不燒旗標），只把名稱與註解裡的訂閱字樣拿掉：

```ts
  it('does not set the flag when balance stays above the threshold', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 }); // 剩 9，未達門檻

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).toBeNull();
  });
```

（`makeupRequestService.test.ts` 的 `does not throw when the student has no push subscription` 不用改——「不拋錯」在新語意下仍然成立。）

- [ ] **Step 2.5: 加整合抽查測試（確認遷移後真的寫進收件夾）**

在 `src/lib/services/notificationService.test.ts` 檔尾加：

```ts
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createProgram, createWindow } from './tutoringProgramService';
import { createBooking, approveBooking } from './tutoringBookingService';

describe('遷移抽查：業務流程寫進收件夾', () => {
  it('超額預約核准後，學生收件夾出現「超額預約已核准」', async () => {
    const teacher = await createTeacher({ name: '林老師', email: `notif-mig-t-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
    const student = await createStudent({ name: '小明', email: `notif-mig-s-${Date.now()}@example.com`, password: 'x' });
    const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id, monthlyQuota: 0 } });
    // 下個月第一個星期五（未來日期、weekday 5）
    const { taipeiDateKey } = await import('./tutoringBookingService');
    const [y, m] = taipeiDateKey(new Date()).split('-').map(Number);
    const first = new Date(Date.UTC(y, m, 1));
    const friday = new Date(Date.UTC(y, m, 1 + ((5 - first.getUTCDay() + 7) % 7)));

    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: friday, quotaReview: true });
    await approveBooking(booking.id);

    const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
    const rows = await prisma.notification.findMany({ where: { userId } });
    expect(rows.some((r) => r.title === '超額預約已核准')).toBe(true);
  });
});
```

- [ ] **Step 3: 驗證沒有漏網之魚**

```bash
grep -rn "pushToUser\|pushToUsers\|pushToAdmins" src --include="*.ts" --include="*.tsx" | grep -v test | grep -v "pushService.ts" | grep -v "notificationService.ts"
```

Expected: 無輸出（業務程式碼不再直接用 pushService 發送）。`hasPushSubscription` 同樣 grep 一次，業務層應只剩 pushService 內部與訂閱相關 API 在用：

```bash
grep -rn "hasPushSubscription" src --include="*.ts" | grep -v test | grep -v "pushService.ts"
```

Expected: 只剩推播訂閱 API route（若有）；service 層無。

- [ ] **Step 4: 跑測試**

Run: `npm test`
Expected: 全數 PASS（Step 2 已把 4 個語意反轉的測試改寫成新語意；其餘既有測試斷言「不拋錯」與業務結果，改名不影響；新抽查測試通過）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/makeupRequestService.ts src/lib/services/substituteRequestService.ts src/lib/services/leaveRequestService.ts src/lib/services/tutoringBookingService.ts src/lib/services/pointService.ts src/lib/services/attendanceService.ts src/lib/services/notificationService.test.ts src/lib/services/tutoringBookingService.test.ts src/lib/services/attendanceService.test.ts
git commit -m "refactor(notifications): migrate all push call sites to unified notify service, drop hasPushSubscription gates"
```

---

### Task 4: NotificationBell 元件＋掛進 AppShell

**Files:**
- Create: `src/components/ui/NotificationBell.tsx`
- Modify: `src/components/ui/AppShell.tsx`

**Interfaces:**
- Consumes: Task 2 的三條 API。
- Produces: `<NotificationBell />`（無 props），AppShell 右側按鈕群渲染（手足切換之後、`<ThemeToggle />` 之前）。

前端無單元測試（沿用本專案慣例）；驗證＝tsc＋eslint＋Task 5 瀏覽器實測。

- [ ] **Step 1: 建立元件**

Create `src/components/ui/NotificationBell.tsx`：

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  url: string | null;
  readAt: string | null;
  createdAt: string;
}

const TAIPEI_TIME_FMT = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const TAIPEI_WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', weekday: 'short' });
const WEEKDAY_MAP: Record<string, string> = { Sun: '日', Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' };

// 通知時間顯示：M/D（週N） HH:mm，固定台北時區（DB 存 UTC timestamp）
function formatNotificationTime(createdAt: string): string {
  const d = new Date(createdAt);
  const formatted = TAIPEI_TIME_FMT.format(d); // 例：8/24 14:30
  const spaceIndex = formatted.indexOf(' ');
  const datePart = spaceIndex === -1 ? formatted : formatted.slice(0, spaceIndex);
  const timePart = spaceIndex === -1 ? '' : formatted.slice(spaceIndex + 1);
  const weekday = WEEKDAY_MAP[TAIPEI_WEEKDAY_FMT.format(d)] ?? '';
  return `${datePart}（${weekday}）${timePart}`.trim();
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [marking, setMarking] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await fetch('/api/notifications');
    if (!res.ok) return;
    const data = await res.json();
    setUnread(data.unread);
    setRows(data.rows);
  }

  // 掛載時抓一次；回到分頁時重抓（不輪詢）
  useEffect(() => {
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // 點面板外或按 Esc 關閉
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggle() {
    setOpen((v) => {
      if (!v) load();
      return !v;
    });
  }

  // 逐則點擊已讀；有 url 就整頁導航（跨區塊導頁要吃到最新資料）
  async function clickRow(row: NotificationRow) {
    if (!row.readAt) {
      await fetch(`/api/notifications/${row.id}`, { method: 'PATCH' });
    }
    if (row.url) {
      window.location.href = row.url;
      return;
    }
    load();
  }

  // 使用者明確要求的「一鍵已讀」
  async function markAll() {
    if (unread === 0 || marking) return;
    setMarking(true);
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' });
      await load();
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={toggle}
        aria-label="通知"
        className="relative flex cursor-pointer items-center p-1 text-inkMuted hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rejected px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="animate-fade-in absolute right-0 top-full z-20 mt-2 w-80 max-w-[90vw] rounded-lg border border-borderStrong bg-card shadow-md">
          <div className="flex items-center justify-between border-b border-borderSubtle px-3 py-2">
            <p className="text-sm font-semibold text-ink">通知</p>
            <button
              onClick={markAll}
              disabled={unread === 0 || marking}
              className="cursor-pointer text-xs text-inkMuted hover:text-ink disabled:cursor-default disabled:opacity-50"
            >
              全部標為已讀
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-inkMuted">目前沒有通知</p>
            ) : (
              rows.map((row) => (
                <button
                  key={row.id}
                  onClick={() => clickRow(row)}
                  className={`block w-full border-b border-borderSubtle px-3 py-2 text-left last:border-b-0 hover:bg-stripe ${
                    row.readAt ? '' : 'bg-stripe/60'
                  }`}
                >
                  <span className="flex items-start gap-2">
                    {!row.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-pending" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{row.title}</span>
                      <span className="block text-xs text-inkMuted">{row.body}</span>
                      <span className="mt-0.5 block text-[10px] text-inkMuted">{formatNotificationTime(row.createdAt)}</span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 掛進 AppShell**

`src/components/ui/AppShell.tsx`：

import 區加：

```ts
import NotificationBell from './NotificationBell';
```

右側按鈕群（手足切換選單區塊之後、`<ThemeToggle />` 之前）插入：

```tsx
          <NotificationBell />
          <ThemeToggle />
```

- [ ] **Step 3: 型別與 lint 檢查**

```bash
npx tsc --noEmit && npx eslint src/components/ui/NotificationBell.tsx src/components/ui/AppShell.tsx
```

Expected: 無錯誤。

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/NotificationBell.tsx src/components/ui/AppShell.tsx
git commit -m "feat(notifications): bell inbox in app header (badge, panel, per-item + mark-all read)"
```

---

### Task 5: 全量驗證＋瀏覽器煙霧測試＋部署說明

**Files:** 無新增（驗證與必要修正）。

- [ ] **Step 1: 全量測試**

```bash
npm test
```

Expected: 全數 PASS。

- [ ] **Step 2: dev DB 加表**

worktree 內：

```bash
npx prisma db push
```

（吃 `.env` 的 dev DB。不加 `--accept-data-loss`；若 Prisma 提示要刪任何欄位/表——代表別的 session 的 schema 狀態有出入——停下回報，不要硬推。）

- [ ] **Step 3: 瀏覽器煙霧測試**

用 preview 工具從 worktree 啟 dev server（沿用專案根 `launch.json` 加 worktree 條目的做法；別的 session 可能佔著 :3000，用自己的 port）。NextAuth 測試登入用 `/api/auth/csrf`＋`/api/auth/callback/credentials` 端點切換帳號（seed：`student@example.com`／`admin@example.com`，密碼 `password123`）。

1. 學生登入 → 頁首出現鈴鐺（未讀 0 無徽章）。
2. 觸發一筆通知（例：學生送出請假 → 行政收到「新請假申請」；或直接用學生身分做一筆會通知學生的操作）。切到對應帳號 → 鈴鐺出現未讀徽章 → 點開面板看到該則（title/body/時間格式 `M/D（週N） HH:mm`）。
3. 點該則 → 跳到對應頁、徽章歸零（或減一）。
4. 再觸發兩筆 → 點「全部標為已讀」→ 未讀歸零、每則變已讀樣式。
5. 面板開著點外面／按 Esc → 關閉。
6. 深夜模式切換看一次配色（表單控件慣例不涉及，但確認面板底色與文字對比正常）。
7. 手機寬度（resize 375px）確認面板 `max-w-[90vw]` 不破版。
8. 測試產生的通知與請假資料清乾淨（Prisma/SQL 還原），dev server 停掉。

- [ ] **Step 4: 部署說明（寫給合併後要上線的人，直接照跑）**

正式站部署順序（比照 web-push 慣例：先 SQL 後 push）：

```sql
CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "url" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
```

1. 對正式 DB 跑上面 SQL（加表，相容變更，先跑不影響舊版程式）。
2. 合併 push 後 Vercel 自動部署。
3. 部署完成後抽查：登入正式站任一帳號，鈴鐺出現、GET /api/notifications 回 200。
