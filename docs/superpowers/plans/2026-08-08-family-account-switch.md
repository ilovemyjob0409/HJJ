# 手足帳號快速切換 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓一個帳號已登入的學生（家長操作用）能直接切換成手足學生的身份，不用重新輸入密碼。

**Architecture:** `Student` 新增 `familyGroupId` 欄位表示手足分組；新增一支短效單次權杖 API，前端拿權杖走 NextAuth 既有 `signIn('credentials', ...)` 流程換身份，`authorize()` 多一個「用權杖登入」分支。其餘所有頁面讀 `session.user.id` 的邏輯完全不變。

**Tech Stack:** Next.js 14 App Router、NextAuth (JWT strategy, Credentials provider)、Prisma + PostgreSQL、Vitest。

## Global Constraints

- 手足關聯只用 `Student.familyGroupId`（可為空字串以外的字串或 null）表示，不建額外的 join table。
- 換身份權杖：核發後 30 秒內有效、只能使用一次。
- 切換操作送出的請假／補課等紀錄**不**額外標記操作來源，維持現狀正常送出。
- 學生端切換按鈕位置：頁首右上角，跟「登出」並排（不做獨立橫幅）。
- 後台「設定手足」合併邏輯：優先沿用目前學生自己的 `familyGroupId`；否則沿用被勾選學生裡第一個有值的；否則新建一個。全部併入同一個 group id，不處理拆分邏輯。
- 對應設計文件：`docs/superpowers/specs/2026-08-08-family-account-switch-design.md`。

---

## Task 1: Schema — familyGroupId 欄位與 FamilySwitchToken 資料表

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Student.familyGroupId: string | null`；`FamilySwitchToken { id, token, targetUserId, expiresAt, usedAt }`。後續所有任務都依賴這兩個 schema 異動。

- [ ] **Step 1: 在 `Student` model 加上 `familyGroupId` 欄位**

在 `prisma/schema.prisma` 找到 `model Student { ... }`（約在第 120 行），在 `lineBindCode` 那行下面加一行：

```prisma
model Student {
  id                    String                 @id @default(cuid())
  userId                String                 @unique
  user                  User                   @relation(fields: [userId], references: [id])
  parentPhone           String?
  studentNumber         String?                @unique
  lineUserId            String?                @unique
  lineBindCode          String?                @unique
  familyGroupId         String?
  enrollments           ClassEnrollment[]
  leaveRequests         LeaveRequest[]
  goHallRegistrations   GoHallRegistration[]
  activityRegistrations ActivityRegistration[]
  classAttendances    ClassAttendance[]
  pointTransactions   PointTransaction[]
  goHallAttendances   GoHallAttendance[]
  goHallLowQuotaNotifiedAt DateTime?                 // 弈廳堂票低堂數提醒防重複
  goHallTicketTransactions GoHallTicketTransaction[]
  goHallSeasonPasses       GoHallSeasonPass[]
  activityAttendances ActivityAttendance[]
  tutoringEnrollments TutoringEnrollment[]
}
```

- [ ] **Step 2: 在檔案最後新增 `FamilySwitchToken` model**

在 `prisma/schema.prisma` 檔案最尾端（`model PointReason { ... }` 之後）加上：

```prisma

// 手足快速切換用的短效單次權杖：由 family-switch-token API 核發，
// authorize() 驗證後立刻標記 usedAt，過期或用過的一律視為無效。
model FamilySwitchToken {
  id           String    @id @default(cuid())
  token        String    @unique
  targetUserId String
  expiresAt    DateTime
  usedAt       DateTime?
}
```

- [ ] **Step 3: 套用 schema 到本機開發資料庫與測試資料庫**

```bash
npx prisma db push
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tutoring_makeup_system_test" npx prisma db push --accept-data-loss
```

Expected: 兩個指令都顯示 `Your database is now in sync with your Prisma schema.`（或等效成功訊息），且 `node_modules/.prisma/client` 重新產生（`prisma db push` 預設會自動跑 `prisma generate`）。

- [ ] **Step 4: 確認型別產生成功**

```bash
npx tsc --noEmit
```

Expected: 沒有錯誤輸出（`Student` 型別現在應該帶有 `familyGroupId`，`FamilySwitchToken` 型別存在於 `@prisma/client`）。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: 新增手足分組欄位與換身份權杖資料表"
```

---

## Task 2: familyService — 手足分組查詢與設定

**Files:**
- Create: `src/lib/services/familyService.ts`
- Test: `src/lib/services/familyService.test.ts`

**Interfaces:**
- Consumes: `prisma`（`@/lib/db`）、`createStudent`（`@/lib/services/studentService`，測試用）。
- Produces: `listSiblings(userId: string): Promise<{id: string; name: string}[]>`；`setSiblings(studentId: string, siblingIds: string[]): Promise<void>`（拋出 `Error('SIBLING_NOT_FOUND')`）。Task 5/6/7/8/9 都會呼叫這兩個函式。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/lib/services/familyService.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { createStudent } from './studentService';
import { listSiblings, setSiblings } from './familyService';

describe('listSiblings', () => {
  it('returns an empty array when the student has no family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a@x.com', password: 'pw' });
    expect(await listSiblings(await userIdOf(a.id))).toEqual([]);
  });
});

describe('setSiblings', () => {
  it('groups two students together and lists each other as siblings', async () => {
    const a = await createStudent({ name: 'A', email: 'a2@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b2@x.com', password: 'pw' });

    await setSiblings(a.id, [b.id]);

    expect(await listSiblings(await userIdOf(a.id))).toEqual([{ id: b.id, name: 'B' }]);
    expect(await listSiblings(await userIdOf(b.id))).toEqual([{ id: a.id, name: 'A' }]);
  });

  it('merges a third student into an existing pair instead of creating a new group', async () => {
    const a = await createStudent({ name: 'A', email: 'a3@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b3@x.com', password: 'pw' });
    const c = await createStudent({ name: 'C', email: 'c3@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);

    await setSiblings(c.id, [a.id]);

    const siblingsOfB = await listSiblings(await userIdOf(b.id));
    expect(siblingsOfB.map((s) => s.name).sort()).toEqual(['A', 'C']);
  });

  it('clears the family group when siblingIds is empty', async () => {
    const a = await createStudent({ name: 'A', email: 'a4@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b4@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);

    await setSiblings(a.id, []);

    expect(await listSiblings(await userIdOf(a.id))).toEqual([]);
    // b 不受影響，仍然沒有手足（因為只剩它自己在原本的群組裡）
    expect(await listSiblings(await userIdOf(b.id))).toEqual([]);
  });

  it('rejects a nonexistent sibling id with SIBLING_NOT_FOUND', async () => {
    const a = await createStudent({ name: 'A', email: 'a5@x.com', password: 'pw' });
    await expect(setSiblings(a.id, ['nonexistent-id'])).rejects.toThrow('SIBLING_NOT_FOUND');
  });
});

// createStudent() 的回傳型別（STUDENT_SELECT）不含 userId，測試需要直接查表拿。
async function userIdOf(studentId: string): Promise<string> {
  const { prisma } = await import('@/lib/db');
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  return student.userId;
}
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
npx vitest run src/lib/services/familyService.test.ts
```

Expected: FAIL，錯誤訊息類似 `Cannot find module './familyService'`（檔案還不存在）。

- [ ] **Step 3: 寫最小實作**

建立 `src/lib/services/familyService.ts`：

```ts
import crypto from 'crypto';
import { prisma } from '@/lib/db';

export interface SiblingOption {
  id: string;
  name: string;
}

export async function listSiblings(userId: string): Promise<SiblingOption[]> {
  const student = await prisma.student.findUnique({ where: { userId }, select: { id: true, familyGroupId: true } });
  if (!student?.familyGroupId) return [];
  const siblings = await prisma.student.findMany({
    where: { familyGroupId: student.familyGroupId, id: { not: student.id } },
    select: { id: true, user: { select: { name: true } } },
    orderBy: { user: { name: 'asc' } },
  });
  return siblings.map((s) => ({ id: s.id, name: s.user.name }));
}

export async function setSiblings(studentId: string, siblingIds: string[]): Promise<void> {
  const uniqueSiblingIds = [...new Set(siblingIds)].filter((id) => id !== studentId);
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { familyGroupId: true } });

  if (uniqueSiblingIds.length === 0) {
    await prisma.student.update({ where: { id: studentId }, data: { familyGroupId: null } });
    return;
  }

  const siblings = await prisma.student.findMany({
    where: { id: { in: uniqueSiblingIds } },
    select: { id: true, familyGroupId: true },
  });
  if (siblings.length !== uniqueSiblingIds.length) throw new Error('SIBLING_NOT_FOUND');

  const groupId = student.familyGroupId ?? siblings.find((s) => s.familyGroupId)?.familyGroupId ?? crypto.randomUUID();

  await prisma.student.updateMany({
    where: { id: { in: [studentId, ...uniqueSiblingIds] } },
    data: { familyGroupId: groupId },
  });
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
npx vitest run src/lib/services/familyService.test.ts
```

Expected: 5 個測試全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/familyService.ts src/lib/services/familyService.test.ts
git commit -m "feat: 新增手足分組查詢與設定服務"
```

---

## Task 3: familyService — 換身份權杖核發與兌換

**Files:**
- Modify: `src/lib/services/familyService.ts`
- Modify: `src/lib/services/familyService.test.ts`

**Interfaces:**
- Consumes: `prisma`（`@/lib/db`）、Task 2 的 `setSiblings`。
- Produces: `createSwitchToken(currentUserId: string, targetStudentId: string): Promise<string>`（拋出 `Error('NOT_IN_FAMILY_GROUP')` 或 `Error('NOT_A_SIBLING')`）；`redeemSwitchToken(token: string): Promise<{id: string; name: string; email: string; role: string} | null>`。Task 4/5 會呼叫這兩個函式。

- [ ] **Step 1: 寫失敗的測試**

在 `src/lib/services/familyService.test.ts` 頂部的 import 加上 `createSwitchToken, redeemSwitchToken`：

```ts
import { listSiblings, setSiblings, createSwitchToken, redeemSwitchToken } from './familyService';
```

在檔案最後加上：

```ts
describe('createSwitchToken', () => {
  it('issues a token when the caller and target share a family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a6@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b6@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);

    const token = await createSwitchToken(await userIdOf(a.id), b.id);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
  });

  it('rejects when the caller has no family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a7@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b7@x.com', password: 'pw' });
    await expect(createSwitchToken(await userIdOf(a.id), b.id)).rejects.toThrow('NOT_IN_FAMILY_GROUP');
  });

  it('rejects when the target is not in the same family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a8@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b8@x.com', password: 'pw' });
    const outsider = await createStudent({ name: 'X', email: 'x8@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);

    await expect(createSwitchToken(await userIdOf(a.id), outsider.id)).rejects.toThrow('NOT_A_SIBLING');
  });
});

describe('redeemSwitchToken', () => {
  it('returns the target user once, then rejects on second use', async () => {
    const a = await createStudent({ name: 'A', email: 'a9@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b9@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);
    const token = await createSwitchToken(await userIdOf(a.id), b.id);

    const user = await redeemSwitchToken(token);
    expect(user?.name).toBe('B');

    expect(await redeemSwitchToken(token)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { prisma } = await import('@/lib/db');
    const b = await createStudent({ name: 'B', email: 'b10@x.com', password: 'pw' });
    await prisma.familySwitchToken.create({
      data: { token: 'expired-token', targetUserId: await userIdOf(b.id), expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await redeemSwitchToken('expired-token')).toBeNull();
  });

  it('rejects an unknown token', async () => {
    expect(await redeemSwitchToken('never-issued')).toBeNull();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
npx vitest run src/lib/services/familyService.test.ts
```

Expected: FAIL，`createSwitchToken`/`redeemSwitchToken` 不存在。

- [ ] **Step 3: 寫最小實作**

在 `src/lib/services/familyService.ts` 檔案最後加上：

```ts
const SWITCH_TOKEN_TTL_MS = 30_000;

export async function createSwitchToken(currentUserId: string, targetStudentId: string): Promise<string> {
  const current = await prisma.student.findUnique({ where: { userId: currentUserId }, select: { familyGroupId: true } });
  if (!current?.familyGroupId) throw new Error('NOT_IN_FAMILY_GROUP');

  const target = await prisma.student.findUnique({ where: { id: targetStudentId }, select: { familyGroupId: true, userId: true } });
  if (!target || target.familyGroupId !== current.familyGroupId) throw new Error('NOT_A_SIBLING');

  const token = crypto.randomBytes(32).toString('hex');
  await prisma.familySwitchToken.create({
    data: { token, targetUserId: target.userId, expiresAt: new Date(Date.now() + SWITCH_TOKEN_TTL_MS) },
  });
  return token;
}

export async function redeemSwitchToken(token: string) {
  const record = await prisma.familySwitchToken.findUnique({ where: { token } });
  if (!record || record.usedAt || record.expiresAt < new Date()) return null;
  await prisma.familySwitchToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return prisma.user.findUniqueOrThrow({ where: { id: record.targetUserId } });
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
npx vitest run src/lib/services/familyService.test.ts
```

Expected: 全部測試（含 Task 2 的 5 個）PASS，共 11 個。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/familyService.ts src/lib/services/familyService.test.ts
git commit -m "feat: 新增手足換身份權杖核發與兌換"
```

---

## Task 4: NextAuth authorize() 支援權杖登入

**Files:**
- Modify: `src/lib/auth.ts`
- Test: `src/lib/auth.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `createSwitchToken`、`redeemSwitchToken`；Task 2 的 `setSiblings`。
- Produces: `authOptions`（`authorize()` 多一個 `credentials.switchToken` 分支，其餘行為不變）。Task 9（前端切換 UI）依賴這個分支存在才能運作。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/lib/auth.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { authOptions } from './auth';
import { createStudent } from './services/studentService';
import { setSiblings, createSwitchToken } from './services/familyService';

// authOptions.providers[0] 是 CredentialsProvider(options) 回傳的設定物件，
// next-auth 的 provider 工廠會原封不動保留我們傳入的 authorize 函式，
// 所以可以直接呼叫它做單元測試，不用跑完整 NextAuth 請求流程。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authorize = (authOptions.providers[0] as any).authorize as (
  credentials: Record<string, string> | undefined
) => Promise<{ id: string; name: string; email: string; role: string } | null>;

async function userIdOf(studentId: string): Promise<string> {
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  return student.userId;
}

describe('authorize()', () => {
  it('logs in with a valid switch token and consumes it', async () => {
    const a = await createStudent({ name: 'A', email: 'a@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);
    const token = await createSwitchToken(await userIdOf(a.id), b.id);

    const user = await authorize({ switchToken: token });
    expect(user?.name).toBe('B');

    expect(await authorize({ switchToken: token })).toBeNull();
  });

  it('rejects an expired switch token', async () => {
    const b = await createStudent({ name: 'B', email: 'b2@x.com', password: 'pw' });
    await prisma.familySwitchToken.create({
      data: { token: 'expired-token', targetUserId: await userIdOf(b.id), expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await authorize({ switchToken: 'expired-token' })).toBeNull();
  });

  it('still logs in with the existing email/password path when no switch token is given', async () => {
    await createStudent({ name: 'C', email: 'c@x.com', password: 'secret123' });
    const user = await authorize({ email: 'c@x.com', password: 'secret123' });
    expect(user?.name).toBe('C');
  });

  it('rejects a wrong password on the existing email/password path', async () => {
    await createStudent({ name: 'D', email: 'd@x.com', password: 'secret123' });
    expect(await authorize({ email: 'd@x.com', password: 'wrong' })).toBeNull();
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
npx vitest run src/lib/auth.test.ts
```

Expected: FAIL——第一個測試會失敗，因為 `authorize({ switchToken: token })` 目前會直接因為沒有 `email`/`password` 而回傳 `null`（`user?.name` 是 `undefined`，不等於 `'B'`）。

- [ ] **Step 3: 修改 `authorize()` 加上權杖分支**

打開 `src/lib/auth.ts`，改成：

```ts
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { findUserByEmailInsensitive } from './services/userService';
import { redeemSwitchToken } from './services/familyService';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
        switchToken: { label: 'Switch Token', type: 'text' },
      },
      async authorize(credentials) {
        if (credentials?.switchToken) {
          const user = await redeemSwitchToken(credentials.switchToken);
          if (!user) return null;
          return { id: user.id, name: user.name, email: user.email, role: user.role };
        }
        if (!credentials?.email || !credentials?.password) return null;
        const user = await findUserByEmailInsensitive(credentials.email);
        if (!user) return null;
        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
};
```

- [ ] **Step 4: 執行測試確認通過**

```bash
npx vitest run src/lib/auth.test.ts
```

Expected: 4 個測試全部 PASS。

- [ ] **Step 5: 執行完整測試套件確認沒有連帶破壞**

```bash
npm test
```

Expected: 全部測試（含既有 498 個 + 這次新增的）PASS。

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat: authorize() 支援手足換身份權杖登入"
```

---

## Task 5: API — POST /api/auth/family-switch-token

**Files:**
- Create: `src/app/api/auth/family-switch-token/route.ts`
- Test: `src/app/api/auth/family-switch-token/route.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `createSwitchToken`。
- Produces: `POST /api/auth/family-switch-token`，body `{ targetStudentId: string }`，成功回傳 `{ switchToken: string }`。Task 9（前端切換 UI）呼叫這支 API。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/app/api/auth/family-switch-token/route.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST } from './route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';
import { setSiblings } from '@/lib/services/familyService';

function postReq(body: unknown) {
  return new Request('http://x/api/auth/family-switch-token', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function userIdOf(studentId: string): Promise<string> {
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  return student.userId;
}

beforeEach(() => {
  sessionMock.mockReset();
});

describe('POST /api/auth/family-switch-token', () => {
  it('403 when not logged in', async () => {
    sessionMock.mockResolvedValue(null);
    const res = await POST(postReq({ targetStudentId: 'whatever' }));
    expect(res.status).toBe(403);
  });

  it('403 for a non-student role', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u', role: 'ADMIN' } });
    const res = await POST(postReq({ targetStudentId: 'whatever' }));
    expect(res.status).toBe(403);
  });

  it('403 when the caller has no family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b@x.com', password: 'pw' });
    sessionMock.mockResolvedValue({ user: { id: await userIdOf(a.id), role: 'STUDENT' } });

    const res = await POST(postReq({ targetStudentId: b.id }));
    expect(res.status).toBe(403);
  });

  it('200 with a switchToken when the caller and target are siblings', async () => {
    const a = await createStudent({ name: 'A', email: 'a2@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b2@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);
    sessionMock.mockResolvedValue({ user: { id: await userIdOf(a.id), role: 'STUDENT' } });

    const res = await POST(postReq({ targetStudentId: b.id }));
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).switchToken).toBe('string');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
npx vitest run src/app/api/auth/family-switch-token/route.test.ts
```

Expected: FAIL，找不到 `./route` 模組。

- [ ] **Step 3: 寫最小實作**

建立 `src/app/api/auth/family-switch-token/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createSwitchToken } from '@/lib/services/familyService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { targetStudentId } = await req.json();
  if (!targetStudentId) {
    return NextResponse.json({ error: 'targetStudentId required' }, { status: 400 });
  }
  try {
    const switchToken = await createSwitchToken(session.user.id, targetStudentId);
    return NextResponse.json({ switchToken });
  } catch (err) {
    if (err instanceof Error && (err.message === 'NOT_IN_FAMILY_GROUP' || err.message === 'NOT_A_SIBLING')) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
npx vitest run src/app/api/auth/family-switch-token/route.test.ts
```

Expected: 4 個測試全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/family-switch-token/
git commit -m "feat: 新增手足換身份權杖核發 API"
```

---

## Task 6: API — GET /api/students/me/siblings

**Files:**
- Create: `src/app/api/students/me/siblings/route.ts`
- Test: `src/app/api/students/me/siblings/route.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `listSiblings`。
- Produces: `GET /api/students/me/siblings` 回傳 `{ self: { name: string }, siblings: { id: string; name: string }[] }`。Task 9（`AppShell`）呼叫這支 API。

- [ ] **Step 1: 寫失敗的測試**

建立 `src/app/api/students/me/siblings/route.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';
import { setSiblings } from '@/lib/services/familyService';

async function userIdOf(studentId: string): Promise<string> {
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
  return student.userId;
}

beforeEach(() => {
  sessionMock.mockReset();
});

describe('GET /api/students/me/siblings', () => {
  it('403 when not logged in', async () => {
    sessionMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
  });

  it('returns an empty siblings array when the caller has no family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a@x.com', password: 'pw' });
    sessionMock.mockResolvedValue({ user: { id: await userIdOf(a.id), role: 'STUDENT', name: 'A' } });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ self: { name: 'A' }, siblings: [] });
  });

  it('lists the sibling when the caller has a family group', async () => {
    const a = await createStudent({ name: 'A', email: 'a2@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'b2@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);
    sessionMock.mockResolvedValue({ user: { id: await userIdOf(a.id), role: 'STUDENT', name: 'A' } });

    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ self: { name: 'A' }, siblings: [{ id: b.id, name: 'B' }] });
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
npx vitest run src/app/api/students/me/siblings/route.test.ts
```

Expected: FAIL，找不到 `./route` 模組。

- [ ] **Step 3: 寫最小實作**

建立 `src/app/api/students/me/siblings/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listSiblings } from '@/lib/services/familyService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const siblings = await listSiblings(session.user.id);
  return NextResponse.json({ self: { name: session.user.name }, siblings });
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
npx vitest run src/app/api/students/me/siblings/route.test.ts
```

Expected: 3 個測試全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/students/me/siblings/
git commit -m "feat: 新增查詢目前學生手足清單 API"
```

---

## Task 7: API — PATCH /api/students/[id]/family（後台設定手足）

**Files:**
- Create: `src/app/api/students/[id]/family/route.ts`
- Test: `src/app/api/students/[id]/family/route.test.ts`
- Modify: `src/lib/services/studentService.ts:41-52`（`listStudents()` 的 `select`）
- Modify: `src/lib/services/studentService.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `setSiblings`。
- Produces: `PATCH /api/students/[id]/family`，body `{ siblingIds: string[] }`；`listStudents()` 回傳的每筆學生資料多一個 `familyGroupId: string | null` 欄位。Task 8（後台 UI）依賴這兩者。

- [ ] **Step 1: 寫 `listStudents()` 的失敗測試**

打開 `src/lib/services/studentService.test.ts`，在既有的 `listStudents` 相關測試旁邊（或新增一個 `describe` 區塊）加上：

```ts
import { setSiblings } from './familyService';
```

```ts
describe('listStudents familyGroupId', () => {
  it('includes familyGroupId, null by default', async () => {
    const a = await createStudent({ name: 'A', email: 'fam-a@x.com', password: 'pw' });
    const list = await listStudents();
    const row = list.find((s) => s.id === a.id);
    expect(row?.familyGroupId).toBeNull();
  });

  it('reflects the assigned family group after setSiblings', async () => {
    const a = await createStudent({ name: 'A', email: 'fam-a2@x.com', password: 'pw' });
    const b = await createStudent({ name: 'B', email: 'fam-b2@x.com', password: 'pw' });
    await setSiblings(a.id, [b.id]);

    const list = await listStudents();
    const rowA = list.find((s) => s.id === a.id);
    const rowB = list.find((s) => s.id === b.id);
    expect(rowA?.familyGroupId).not.toBeNull();
    expect(rowA?.familyGroupId).toBe(rowB?.familyGroupId);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
npx vitest run src/lib/services/studentService.test.ts -t familyGroupId
```

Expected: FAIL，`row?.familyGroupId` 是 `undefined`（因為 select 裡還沒有這個欄位）。

- [ ] **Step 3: 在 `listStudents()` 加上 `familyGroupId`**

打開 `src/lib/services/studentService.ts`，找到 `listStudents` 函式裡的 `select`：

```ts
export async function listStudents() {
  const students = await prisma.student.findMany({
    select: {
      id: true,
      parentPhone: true,
      studentNumber: true,
      lineUserId: true,
      familyGroupId: true,
      user: { select: SAFE_USER_SELECT },
      enrollments: { select: { classId: true } },
    },
    orderBy: { user: { name: 'asc' } },
  });
```

（只在 `lineUserId: true,` 後面加一行 `familyGroupId: true,`，其餘不動。）

- [ ] **Step 4: 執行測試確認通過**

```bash
npx vitest run src/lib/services/studentService.test.ts -t familyGroupId
```

Expected: 2 個測試 PASS。

- [ ] **Step 5: 寫 PATCH route 的失敗測試**

建立 `src/app/api/students/[id]/family/route.test.ts`：

```ts
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
```

- [ ] **Step 6: 執行測試確認失敗**

```bash
npx vitest run src/app/api/students/\[id\]/family/route.test.ts
```

Expected: FAIL，找不到 `./route` 模組。

- [ ] **Step 7: 寫最小實作**

建立 `src/app/api/students/[id]/family/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setSiblings } from '@/lib/services/familyService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { siblingIds } = await req.json();
  if (!Array.isArray(siblingIds)) {
    return NextResponse.json({ error: 'siblingIds must be an array' }, { status: 400 });
  }
  try {
    await setSiblings(params.id, siblingIds);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'SIBLING_NOT_FOUND') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
```

- [ ] **Step 8: 執行測試確認通過**

```bash
npx vitest run src/app/api/students/\[id\]/family/route.test.ts
```

Expected: 3 個測試全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add src/lib/services/studentService.ts src/lib/services/studentService.test.ts src/app/api/students/\[id\]/family/
git commit -m "feat: 後台設定手足 API，listStudents 補上 familyGroupId"
```

---

## Task 8: 後台 UI — 學生名單「設定手足」

**Files:**
- Create: `src/app/admin/students/FamilySiblingModal.tsx`
- Modify: `src/app/admin/students/page.tsx:25-32`（`StudentRow` 介面）、`:409-423`（`columns`）、檔案結尾（render 區塊）

**Interfaces:**
- Consumes: Task 7 的 `PATCH /api/students/[id]/family`；既有 `Modal`、`Button`、`Input`、`DataTable`、`useToast`、`withStopPropagation`（`@/components/ui/stopPropagation`）。
- Produces: 無其他任務依賴（UI 端點）。

- [ ] **Step 1: 建立 `FamilySiblingModal.tsx`**

建立 `src/app/admin/students/FamilySiblingModal.tsx`：

```tsx
'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';

interface StudentOption {
  id: string;
  familyGroupId: string | null;
  user: { name: string };
}

export default function FamilySiblingModal({
  student,
  allStudents,
  onClose,
  onSaved,
}: {
  student: StudentOption;
  allStudents: StudentOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        allStudents
          .filter((s) => s.id !== student.id && s.familyGroupId !== null && s.familyGroupId === student.familyGroupId)
          .map((s) => s.id)
      )
  );
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/students/${student.id}/family`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siblingIds: Array.from(selected) }),
      });
      if (!res.ok) {
        showToast('設定失敗，請稍後再試');
        return;
      }
      showToast('已更新手足設定');
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const options = allStudents.filter((s) => {
    if (s.id === student.id) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return s.user.name.toLowerCase().includes(q);
  });

  return (
    <Modal open onClose={onClose} title={`設定手足：${student.user.name}`} maxWidthClassName="max-w-md">
      <Input placeholder="搜尋姓名" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-2" />
      <div className="max-h-72 overflow-y-auto">
        <DataTable
          columns={[
            {
              header: '',
              render: (s) => <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />,
            },
            { header: '姓名', render: (s) => s.user.name },
          ]}
          rows={options}
          keyField={(s) => s.id}
          emptyText="找不到符合的學生"
        />
      </div>
      <Button className="mt-3 w-full" loading={saving} onClick={save}>
        儲存
      </Button>
    </Modal>
  );
}
```

- [ ] **Step 2: `StudentRow` 加上 `familyGroupId`**

打開 `src/app/admin/students/page.tsx`，把：

```ts
interface StudentRow {
  id: string;
  parentPhone: string | null;
  studentNumber: string | null;
  lineUserId: string | null;
  user: { name: string; email: string };
  enrollments: EnrollmentQuota[];
}
```

改成：

```ts
interface StudentRow {
  id: string;
  parentPhone: string | null;
  studentNumber: string | null;
  lineUserId: string | null;
  familyGroupId: string | null;
  user: { name: string; email: string };
  enrollments: EnrollmentQuota[];
}
```

- [ ] **Step 3: 加 import 與狀態**

在 `src/app/admin/students/page.tsx` 頂部 import 區塊加上：

```ts
import { withStopPropagation } from '@/components/ui/stopPropagation';
import FamilySiblingModal from './FamilySiblingModal';
```

在 `StudentsContent()` 函式內既有的 `useState` 宣告旁（例如 `const [editing, setEditing] = useState<StudentRow | null>(null);` 附近）加上：

```ts
const [familyModalStudent, setFamilyModalStudent] = useState<StudentRow | null>(null);
```

- [ ] **Step 4: 操作欄加上「設定手足」按鈕**

把：

```tsx
    {
      header: '操作',
      render: (s) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(s)}>
          編輯
        </button>
      ),
    },
```

改成：

```tsx
    {
      header: '操作',
      render: (s) => (
        <div className="flex flex-col items-center gap-1">
          <button className="text-brandDark hover:underline" onClick={() => openEdit(s)}>
            編輯
          </button>
          <button className="text-brandDark hover:underline" onClick={withStopPropagation(() => setFamilyModalStudent(s))}>
            設定手足
          </button>
        </div>
      ),
    },
```

- [ ] **Step 5: 渲染 Modal**

在 `src/app/admin/students/page.tsx` 檔案最後、`{ConfirmDialog}` 前面（或緊接在既有的最後一個 `<Modal>` 結束標籤之後）加上：

```tsx
      {familyModalStudent && (
        <FamilySiblingModal
          student={familyModalStudent}
          allStudents={students}
          onClose={() => setFamilyModalStudent(null)}
          onSaved={load}
        />
      )}
```

- [ ] **Step 6: 型別檢查與 lint**

```bash
npx tsc --noEmit
npx next lint
```

Expected: 都沒有錯誤（`next lint` 可能維持既有那條 `mergedRows` warning，不算新增）。

- [ ] **Step 7: 瀏覽器手動驗證**

啟動 dev server（`npm run dev`），用 admin 帳號（seed：`admin@example.com` / `password123`）登入，到「學生名單」：

1. 找兩個學生列，點「設定手足」，勾選對方，按「儲存」→ 應該顯示 toast「已更新手足設定」。
2. 再點其中一個學生的「設定手足」→ 應該看到剛剛勾選的對方已經是勾選狀態（確認 pre-check 邏輯正確）。
3. 點掉勾選存檔 → 再打開應該變成沒有勾選（確認解除手足關係）。

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/students/FamilySiblingModal.tsx src/app/admin/students/page.tsx
git commit -m "feat: 學生名單新增「設定手足」功能"
```

---

## Task 9: 學生端 UI — 頁首手足切換

**Files:**
- Modify: `src/components/ui/AppShell.tsx`

**Interfaces:**
- Consumes: Task 6 的 `GET /api/students/me/siblings`；Task 5 的 `POST /api/auth/family-switch-token`；Task 4 的 `authorize()` 權杖分支；`signIn`（`next-auth/react`，既有 `/login` 頁面已使用同一個函式）。
- Produces: 無其他任務依賴（UI 端點，整個功能的最後一塊）。

- [ ] **Step 1: 加 import 與狀態**

打開 `src/components/ui/AppShell.tsx`，把最上面的 import 改成：

```tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signIn, signOut } from 'next-auth/react';
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';
```

在 `export default function AppShell({ role, children }: { role: Role; children: ReactNode }) {` 函式內、既有 `const pathname = usePathname();` 那行下面加上：

```tsx
  const router = useRouter();
  const [siblings, setSiblings] = useState<{ id: string; name: string }[]>([]);
  const [selfName, setSelfName] = useState('');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (role !== 'STUDENT') return;
    fetch('/api/students/me/siblings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setSelfName(data.self.name);
        setSiblings(data.siblings);
      });
  }, [role]);

  async function switchToSibling(targetStudentId: string) {
    setSwitching(true);
    try {
      const tokenRes = await fetch('/api/auth/family-switch-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStudentId }),
      });
      if (!tokenRes.ok) return;
      const { switchToken } = await tokenRes.json();
      const result = await signIn('credentials', { switchToken, redirect: false });
      if (!result?.error) router.push('/student');
    } finally {
      setSwitching(false);
      setSwitcherOpen(false);
    }
  }
```

- [ ] **Step 2: 加切換按鈕到頁首右上角**

找到：

```tsx
        <div className="flex shrink-0 items-center justify-self-end gap-1 sm:gap-2">
          <ThemeToggle />
          <button onClick={() => signOut()} className="cursor-pointer text-xs text-inkMuted hover:text-ink sm:text-sm">
            登出
          </button>
        </div>
```

改成：

```tsx
        <div className="flex shrink-0 items-center justify-self-end gap-1 sm:gap-2">
          {role === 'STUDENT' && siblings.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setSwitcherOpen((v) => !v)}
                className="flex items-center gap-1 rounded-full bg-cream px-2.5 py-1 text-xs font-semibold text-ink hover:opacity-80 sm:text-sm"
              >
                {selfName} ▾
              </button>
              {switcherOpen && (
                <div className="animate-fade-in absolute right-0 top-full z-20 mt-2 w-40 rounded-lg border border-borderStrong bg-card py-1 text-left shadow-md">
                  <div className="px-3 py-1.5 text-xs font-semibold text-inkMuted">{selfName}（目前）</div>
                  {siblings.map((s) => (
                    <button
                      key={s.id}
                      disabled={switching}
                      onClick={() => switchToSibling(s.id)}
                      className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-stripe disabled:opacity-50"
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <ThemeToggle />
          <button onClick={() => signOut()} className="cursor-pointer text-xs text-inkMuted hover:text-ink sm:text-sm">
            登出
          </button>
        </div>
```

- [ ] **Step 3: 型別檢查與 lint**

```bash
npx tsc --noEmit
npx next lint
```

Expected: 都沒有錯誤。

- [ ] **Step 4: 瀏覽器手動驗證整個流程**

啟動 dev server（`npm run dev`）：

1. 用 admin 帳號到「學生名單」，把 seed 帳號 `student@example.com`（小明）跟另一個學生設成手足（沿用 Task 8 驗證時建立的關係，或另外建一個測試學生）。
2. 用 `student@example.com` / `password123` 登入，確認頁首右上角（登出左邊）出現「小明 ▾」按鈕。
3. 點開，應該看到手足姓名列表；點下去，畫面應該導到 `/student` 首頁，標題變成對方的名字（例如「XXX您好！」），確認身份確實切換成功。
4. 再點右上角的切換按鈕（此時顯示的是新身份的名字），切回小明，確認能切回去。
5. 確認沒有手足的帳號（例如 `admin@example.com` 對應的學生，或任何沒設定過手足的學生）登入後，頁首**不會**出現切換按鈕。

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/AppShell.tsx
git commit -m "feat: 學生頁首新增手足快速切換"
```

---

## Task 10: 全套驗證與收尾

**Files:** 無新增／修改檔案，純驗證。

**Interfaces:** 無。

- [ ] **Step 1: 型別檢查**

```bash
npx tsc --noEmit
```

Expected: 無錯誤。

- [ ] **Step 2: Lint（含 next build 會執行的規則）**

```bash
npx next lint
```

Expected: 只剩既有那條 `admin/makeup-requests/page.tsx` 的 `mergedRows` warning，沒有新的 error。

- [ ] **Step 3: 完整測試套件**

```bash
npm test
```

Expected: 全部 PASS（原本 498 個 + 這個功能新增的約 25 個）。

- [ ] **Step 4: 完整 production build（跟 Vercel 部署時執行的指令一致）**

```bash
npm run build
```

Expected: `Compiled successfully`，沒有 `Failed to compile`。

- [ ] **Step 5: 準備正式環境 SQL**

比照本專案既有慣例（見 `docs/superpowers/2026-08-07-tutoring-module-production.sql` 的格式），建立 `docs/superpowers/2026-08-08-family-account-switch-production.sql`：

```sql
-- 手足帳號快速切換 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：Student 新增 familyGroupId 欄位、新增 FamilySwitchToken 表，無現有資料異動。
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "familyGroupId" TEXT;

CREATE TABLE IF NOT EXISTS "FamilySwitchToken" (
  "id" TEXT PRIMARY KEY,
  "token" TEXT NOT NULL UNIQUE,
  "targetUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3)
);
```

這份檔案 commit 進 repo，但**不要**在這個 plan 裡自動執行——交給使用者在 merge/push 前到 Supabase Dashboard SQL Editor 手動貼上執行，跟本專案其他功能上線的既有流程一致。

```bash
git add docs/superpowers/2026-08-08-family-account-switch-production.sql
git commit -m "docs: 手足帳號快速切換正式環境 SQL"
```

- [ ] **Step 6: 確認沒有殘留的除錯用檔案或未預期變更**

```bash
git status --short
```

Expected: 只有這個 plan 所有 task 累積下來、已經逐一 commit 的變更；沒有殘留的未追蹤除錯檔案。
