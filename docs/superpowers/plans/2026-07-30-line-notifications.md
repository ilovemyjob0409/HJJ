# LINE 官方帳號通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let parents (the actual users of "student" accounts in this system) receive LINE push notifications for three events — check-in/out, low remaining-session warning, and makeup-request decisions — bound to their child's student record by an admin-driven QR-code flow.

**Architecture:** One new service file (`lineService.ts`) owns everything LINE-specific: bind-code generation, webhook signature verification, incoming-message handling, and the two outbound LINE API calls (push/reply). Three new API routes expose this to the admin UI and to LINE's webhook. `attendanceService.ts` and `makeupRequestService.ts` call `pushLineMessage` from their existing success paths — LINE is a dependency of attendance/makeup-request, never the other way around. The admin student-edit page gets a new "LINE 通知" section; a new static `/admin/line-setup` page carries both the one-time technical setup instructions and the day-to-day binding walkthrough.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma 7 (`@prisma/adapter-pg`), Vitest against the real test database, Tailwind, LINE Messaging API (no SDK — plain `fetch`), `qrcode` npm package for client-side QR rendering.

## Global Constraints

- Schema changes go through `npx prisma db push` (dev DB) + `npm run test:dbpush` (test DB) — this project has no `prisma/migrations` folder; never run `npx prisma migrate`.
- LINE push/reply calls must never break the calling operation: `pushLineMessage`/`replyLineMessage` catch every failure internally and only `console.error` — they never throw. Callers `await` them directly with no extra try/catch.
- If `LINE_CHANNEL_ACCESS_TOKEN` is unset (e.g. local dev with no real LINE credentials), `pushLineMessage`/`replyLineMessage` must no-op without attempting a network call.
- Bind codes are 8-character random uppercase alphanumeric strings generated with `crypto.randomBytes`. Matching in `handleIncomingMessage` is an exact match after `trim()` — no substring search.
- `LINE_OA_BASIC_ID` is stored **including** its leading `@` (e.g. `@abc1234`), copied verbatim from the LINE console — code must not prepend another `@`.
- Message templates are exact, copied verbatim from the design spec (`docs/superpowers/specs/2026-07-30-line-notifications-design.md`) — do not paraphrase them.
- The low-quota check only runs from the kiosk check-in path (`checkInByStudentNumber` / `resolveCheckIn`) on a **class-based** check-in (`class:` or `insertion:` candidate), never from the roster bulk-save page, and never from a one-on-one makeup check-in.
- `/admin/line-setup` is a new page but must **not** be added to `NAV_LINKS` in `src/components/ui/AppShell.tsx` — it's only reachable via a link from the student edit page's "LINE 通知" section.
- Project testing convention: service-layer functions get real Vitest coverage against the real test database, no mocks. The **sole exception** in this codebase is `pushLineMessage`/`replyLineMessage`, which mock `fetch` (there is no real LINE credential to test against, and tests must not send real messages). API routes and admin pages get zero test files — verify with `npx tsc --noEmit`, `npx eslint`, and manual browser check only.

---

### Task 1: `lineService.ts` — schema, bind codes, signature verification, push/reply

**Files:**
- Modify: `prisma/schema.prisma` (`Student` model, `ClassEnrollment` model)
- Modify: `.env.example`
- Create: `src/lib/services/lineService.ts`
- Test: `src/lib/services/lineService.test.ts`

**Interfaces:**
- Produces: `generateBindCode(studentId: string): Promise<{ code: string; addFriendUrl: string }>`, `unbindStudent(studentId: string): Promise<void>`, `verifyWebhookSignature(rawBody: string, signature: string): boolean`, `handleIncomingMessage(lineUserId: string, text: string): Promise<{ replyText: string }>`, `pushLineMessage(lineUserId: string, text: string): Promise<void>`, `replyLineMessage(replyToken: string, text: string): Promise<void>`. Task 2's routes and Task 3/4's service wiring call these six functions by these exact names/signatures. `Student` gains `lineUserId: string | null` and `lineBindCode: string | null`; `ClassEnrollment` gains `lowQuotaNotifiedAt: Date | null`.

- [ ] **Step 1: Add the schema fields**

In `prisma/schema.prisma`, find the `Student` model and add two fields after `studentNumber`:

```prisma
model Student {
  id                    String                 @id @default(cuid())
  userId                String                 @unique
  user                  User                   @relation(fields: [userId], references: [id])
  parentPhone           String?
  studentNumber         String?                @unique
  lineUserId            String?                @unique
  lineBindCode          String?                @unique
  enrollments           ClassEnrollment[]
  leaveRequests         LeaveRequest[]
  goHallRegistrations   GoHallRegistration[]
  activityRegistrations ActivityRegistration[]
  classAttendances    ClassAttendance[]
  goHallAttendances   GoHallAttendance[]
  activityAttendances ActivityAttendance[]
}
```

Find the `ClassEnrollment` model and add one field after `totalSessions`:

```prisma
model ClassEnrollment {
  id                 String    @id @default(cuid())
  studentId          String
  classId            String
  student            Student   @relation(fields: [studentId], references: [id])
  class              Class     @relation(fields: [classId], references: [id])
  totalSessions      Int?
  lowQuotaNotifiedAt DateTime?

  @@unique([studentId, classId])
}
```

- [ ] **Step 2: Push the schema to the dev and test databases**

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.`

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

Run: `npm run test:dbpush`
Expected: `Your database is now in sync with your Prisma schema.` (against `tutoring_makeup_system_test`)

- [ ] **Step 3: Add the new environment variables**

In `.env.example`, append:

```
LINE_CHANNEL_ACCESS_TOKEN=""
LINE_CHANNEL_SECRET=""
LINE_OA_BASIC_ID=""
```

Do **not** add real values to your local `.env` unless you have real LINE credentials — every function in this task degrades safely (no network call, no throw) when these are unset.

- [ ] **Step 4: Write the failing tests**

Create `src/lib/services/lineService.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import {
  generateBindCode,
  unbindStudent,
  verifyWebhookSignature,
  handleIncomingMessage,
  pushLineMessage,
  replyLineMessage,
} from './lineService';

beforeEach(async () => {
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

async function createTestStudent(overrides: { lineUserId?: string | null; lineBindCode?: string | null } = {}) {
  const user = await prisma.user.create({
    data: { name: '測試學生', email: 'line-test@example.com', password: 'x', role: 'STUDENT' },
  });
  return prisma.student.create({ data: { userId: user.id, ...overrides } });
}

describe('generateBindCode', () => {
  it('stores an 8-character bind code on the student and returns a matching add-friend URL', async () => {
    const student = await createTestStudent();
    process.env.LINE_OA_BASIC_ID = '@testoa';

    const { code, addFriendUrl } = await generateBindCode(student.id);

    expect(code).toHaveLength(8);
    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.lineBindCode).toBe(code);
    expect(addFriendUrl).toBe(`https://line.me/R/oaMessage/@testoa/?${code}`);
  });

  it('overwrites a previous unused bind code', async () => {
    const student = await createTestStudent({ lineBindCode: 'OLDCODE1' });

    const { code } = await generateBindCode(student.id);

    expect(code).not.toBe('OLDCODE1');
    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.lineBindCode).toBe(code);
  });
});

describe('unbindStudent', () => {
  it('clears lineUserId', async () => {
    const student = await createTestStudent({ lineUserId: 'Uabc123' });

    await unbindStudent(student.id);

    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.lineUserId).toBeNull();
  });
});

describe('verifyWebhookSignature', () => {
  afterEach(() => {
    delete process.env.LINE_CHANNEL_SECRET;
  });

  it('accepts a signature computed with the configured channel secret', () => {
    process.env.LINE_CHANNEL_SECRET = 'test-secret';
    const body = '{"events":[]}';
    const signature = crypto.createHmac('sha256', 'test-secret').update(body).digest('base64');

    expect(verifyWebhookSignature(body, signature)).toBe(true);
  });

  it('rejects a signature computed with the wrong secret', () => {
    process.env.LINE_CHANNEL_SECRET = 'test-secret';

    expect(verifyWebhookSignature('{"events":[]}', 'not-a-real-signature')).toBe(false);
  });
});

describe('handleIncomingMessage', () => {
  it('binds the LINE userId to the matching student and clears the bind code', async () => {
    const student = await createTestStudent({ lineBindCode: 'ABCD1234' });

    const { replyText } = await handleIncomingMessage('Uparent123', 'ABCD1234');

    expect(replyText).toContain('綁定成功');
    const updated = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(updated.lineUserId).toBe('Uparent123');
    expect(updated.lineBindCode).toBeNull();
  });

  it('trims whitespace before matching the bind code', async () => {
    await createTestStudent({ lineBindCode: 'ABCD1234' });

    const { replyText } = await handleIncomingMessage('Uparent123', '  ABCD1234  ');

    expect(replyText).toContain('綁定成功');
  });

  it('replies with an error when no student matches the code', async () => {
    const { replyText } = await handleIncomingMessage('Uparent123', 'NOMATCH1');

    expect(replyText).toContain('綁定碼無效');
  });
});

describe('pushLineMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  });

  it('posts to the LINE push API with the access token and message', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await pushLineMessage('Uparent123', 'hello');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        body: JSON.stringify({ to: 'Uparent123', messages: [{ type: 'text', text: 'hello' }] }),
      })
    );
  });

  it('does not throw when the fetch call rejects', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await expect(pushLineMessage('Uparent123', 'hello')).resolves.toBeUndefined();
  });

  it('does not call fetch when the access token env var is unset', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await pushLineMessage('Uparent123', 'hello');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('replyLineMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  });

  it('posts to the LINE reply API with the reply token and message', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await replyLineMessage('replyToken123', 'hello back');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/reply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ replyToken: 'replyToken123', messages: [{ type: 'text', text: 'hello back' }] }),
      })
    );
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/lineService.test.ts`
Expected: FAIL — `Cannot find module './lineService'` (the file doesn't exist yet).

- [ ] **Step 6: Implement `lineService.ts`**

Create `src/lib/services/lineService.ts`:

```ts
import crypto from 'crypto';
import { prisma } from '@/lib/db';

const BIND_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BIND_CODE_LENGTH = 8;

function randomBindCode(): string {
  const bytes = crypto.randomBytes(BIND_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < BIND_CODE_LENGTH; i++) {
    code += BIND_CODE_CHARS[bytes[i] % BIND_CODE_CHARS.length];
  }
  return code;
}

export async function generateBindCode(studentId: string): Promise<{ code: string; addFriendUrl: string }> {
  const code = randomBindCode();
  await prisma.student.update({ where: { id: studentId }, data: { lineBindCode: code } });
  const basicId = process.env.LINE_OA_BASIC_ID ?? '';
  const addFriendUrl = `https://line.me/R/oaMessage/${basicId}/?${encodeURIComponent(code)}`;
  return { code, addFriendUrl };
}

export async function unbindStudent(studentId: string): Promise<void> {
  await prisma.student.update({ where: { id: studentId }, data: { lineUserId: null } });
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET ?? '';
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export async function handleIncomingMessage(lineUserId: string, text: string): Promise<{ replyText: string }> {
  const code = text.trim();
  const student = await prisma.student.findUnique({
    where: { lineBindCode: code },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!student) {
    return { replyText: '綁定碼無效，請洽行政人員重新產生' };
  }
  await prisma.student.update({ where: { id: student.id }, data: { lineUserId, lineBindCode: null } });
  return { replyText: `綁定成功，之後會通知您 ${student.user.name} 的點名與補課申請結果` };
}

async function callLineApi(url: string, body: unknown): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    console.error(`LINE_CHANNEL_ACCESS_TOKEN not set, skipping call to ${url}`);
    return;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`LINE API call to ${url} failed with status ${res.status}`);
    }
  } catch (err) {
    console.error(`LINE API call to ${url} threw`, err);
  }
}

export async function pushLineMessage(lineUserId: string, text: string): Promise<void> {
  await callLineApi('https://api.line.me/v2/bot/message/push', {
    to: lineUserId,
    messages: [{ type: 'text', text }],
  });
}

export async function replyLineMessage(replyToken: string, text: string): Promise<void> {
  await callLineApi('https://api.line.me/v2/bot/message/reply', {
    replyToken,
    messages: [{ type: 'text', text }],
  });
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/lineService.test.ts`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma .env.example src/lib/services/lineService.ts src/lib/services/lineService.test.ts
git commit -m "feat: add LINE bind codes, webhook verification, and push/reply"
```

---

### Task 2: LINE API routes

**Files:**
- Create: `src/app/api/line/webhook/route.ts`
- Create: `src/app/api/students/[id]/line-bind-code/route.ts`
- Create: `src/app/api/students/[id]/line-unbind/route.ts`

**Interfaces:**
- Consumes: `verifyWebhookSignature`, `handleIncomingMessage`, `replyLineMessage`, `generateBindCode`, `unbindStudent` from `src/lib/services/lineService.ts` (Task 1).
- Produces: `POST /api/line/webhook` (public, no admin session — protected by LINE signature verification instead), `POST /api/students/[id]/line-bind-code` → `{ code: string; addFriendUrl: string }` (ADMIN), `POST /api/students/[id]/line-unbind` → `{ success: true }` (ADMIN). Task 5's admin UI calls the latter two by these exact paths.

- [ ] **Step 1: Create the webhook route**

Create `src/app/api/line/webhook/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, handleIncomingMessage, replyLineMessage } from '@/lib/services/lineService';

interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; text?: string };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-line-signature') ?? '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const { events } = JSON.parse(rawBody) as { events: LineWebhookEvent[] };

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text' || !event.source?.userId || !event.replyToken) {
      continue;
    }
    const { replyText } = await handleIncomingMessage(event.source.userId, event.message.text ?? '');
    await replyLineMessage(event.replyToken, replyText);
  }

  return NextResponse.json({ success: true });
}
```

This route reads the raw body via `req.text()` (not `req.json()`) because signature verification must run over the exact bytes LINE signed — parsing to JSON first and re-stringifying would not reliably reproduce the same bytes.

- [ ] **Step 2: Create the bind-code route**

Create `src/app/api/students/[id]/line-bind-code/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { generateBindCode } from '@/lib/services/lineService';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const result = await generateBindCode(params.id);
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Create the unbind route**

Create `src/app/api/students/[id]/line-unbind/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { unbindStudent } from '@/lib/services/lineService';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await unbindStudent(params.id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/api/line/webhook/route.ts src/app/api/students/[id]/line-bind-code/route.ts src/app/api/students/[id]/line-unbind/route.ts`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Per project convention this route has no test file. Verify by hand with the dev server running (`npm run dev`):

1. Log in as admin, open dev tools' network tab.
2. `POST http://localhost:3000/api/students/<any-real-student-id>/line-bind-code` with an empty body while logged in as admin — confirm it returns `200` with `{ code, addFriendUrl }` where `code` is 8 characters and `addFriendUrl` starts with `https://line.me/R/oaMessage/`.
3. `POST http://localhost:3000/api/students/<same-id>/line-unbind` — confirm it returns `200 { success: true }`.
4. `POST http://localhost:3000/api/line/webhook` with body `{"events":[]}` and no `x-line-signature` header — confirm it returns `401`.
5. Log out (or use an incognito window with no session) and repeat step 2 — confirm it returns `403`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/line/webhook/route.ts "src/app/api/students/[id]/line-bind-code/route.ts" "src/app/api/students/[id]/line-unbind/route.ts"
git commit -m "feat: add LINE webhook and bind/unbind API routes"
```

---

### Task 3: Wire check-in/out and low-quota notifications into `attendanceService.ts`

**Files:**
- Modify: `src/lib/services/attendanceService.ts`
- Modify: `src/lib/services/classService.ts` (`setStudentEnrollments`)
- Test: `src/lib/services/attendanceService.test.ts`

**Interfaces:**
- Consumes: `pushLineMessage` from `src/lib/services/lineService.ts` (Task 1).
- Produces: no new exported functions — `checkInByStudentNumber` and `resolveCheckIn` keep their existing signatures and return shapes exactly (the LINE push is a side effect, not a new field on `CheckInResult`).

- [ ] **Step 1: Give `CheckInCandidate` an optional `classId`**

In `src/lib/services/attendanceService.ts`, find the `CheckInCandidate` interface (around line 546) and add a field:

```ts
interface CheckInCandidate {
  key: string;
  title: string;
  timeLabel: string;
  teacherName: string | null;
  startMinutes: number;
  checkInTime: string | null;
  checkOutTime: string | null;
  classId?: string;
  apply: () => Promise<'CHECKED_IN' | 'CHECKED_OUT'>;
}
```

- [ ] **Step 2: Populate `classId` for class and insertion candidates**

In `getTodayCandidates`, the class-candidate push (around line 650) currently reads:

```ts
    candidates.push({
      key: `class:${cls.id}`,
      title: cls.name,
      timeLabel: `${cls.startTime}-${cls.endTime}`,
      teacherName: cls.teacher.user.name,
      startMinutes: toMinutes(cls.startTime),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () => applyClassAttendance({ classId: cls.id, studentId, date, timeStr, markedById }),
    });
```

Add `classId: cls.id,` to this object (any position — put it after `checkOutTime` for readability).

The insertion-candidate push (around line 667) currently reads:

```ts
    candidates.push({
      key: `insertion:${ins.id}`,
      title: cls.name,
      timeLabel: `${cls.startTime}-${cls.endTime}`,
      teacherName: cls.teacher.user.name,
      startMinutes: toMinutes(cls.startTime),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () =>
        applyClassAttendance({ classId: cls.id, studentId, date, timeStr, markedById, makeupRequestId: ins.id }),
    });
```

Add `classId: cls.id,` here too, same as above. Do **not** add `classId` to the one-on-one candidate push (around line 682) — it has no real class, only a `makeupRequestId`.

- [ ] **Step 3: Add the notification helpers**

Directly below `toCandidateOption` (around line 705, right before `export async function checkInByStudentNumber`), add:

```ts
async function maybeNotifyLowQuota(studentId: string, classId: string): Promise<void> {
  const enrollment = await prisma.classEnrollment.findUnique({ where: { studentId_classId: { studentId, classId } } });
  if (!enrollment || enrollment.lowQuotaNotifiedAt !== null) return;

  const { remaining } = await getClassEnrollmentQuota(classId, studentId);
  if (remaining === null || remaining > 3) return;

  await prisma.classEnrollment.update({ where: { id: enrollment.id }, data: { lowQuotaNotifiedAt: new Date() } });

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { lineUserId: true, user: { select: { name: true } } },
  });
  if (student?.lineUserId) {
    await pushLineMessage(student.lineUserId, `【MUP】${student.user.name} 目前剩餘堂數：${remaining} 堂，請盡快與行政人員聯繫續費`);
  }
}

async function notifyAttendanceResult(
  student: { id: string; lineUserId: string | null; user: { name: string } },
  match: CheckInCandidate,
  action: 'CHECKED_IN' | 'CHECKED_OUT',
  timeStr: string
): Promise<void> {
  if (student.lineUserId) {
    const verb = action === 'CHECKED_IN' ? '簽到' : '簽退';
    await pushLineMessage(student.lineUserId, `【MUP】${student.user.name} 已於 ${timeStr} 完成${verb}（${match.title}）`);
  }
  if (action === 'CHECKED_IN' && match.classId) {
    await maybeNotifyLowQuota(student.id, match.classId);
  }
}
```

Add the import at the top of the file (after `import { prisma } from '@/lib/db';`):

```ts
import { pushLineMessage } from './lineService';
```

These functions push LINE notifications synchronously (awaited, not fire-and-forget) before the request handler returns — this app runs on Vercel's serverless functions, where work started after the response is sent is not guaranteed to finish, so the push must complete inside the request lifecycle. `pushLineMessage` itself never throws (see Task 1), so awaiting it here cannot fail the check-in.

- [ ] **Step 4: Call the helper from both entry points**

In `checkInByStudentNumber` (around line 707), the initial student lookup currently reads:

```ts
  const student = await prisma.student.findUnique({
    where: { studentNumber: code },
    select: { id: true, user: { select: { name: true } } },
  });
```

Add `lineUserId: true,` to the `select`:

```ts
  const student = await prisma.student.findUnique({
    where: { studentNumber: code },
    select: { id: true, lineUserId: true, user: { select: { name: true } } },
  });
```

Further down in the same function, where the single-candidate branch currently reads:

```ts
  if (incomplete.length === 1) {
    const match = incomplete[0];
    const action = await match.apply();
    return { result: action, studentName: student.user.name, sessionTitle: match.title, time: timeStr };
  }
```

Change it to:

```ts
  if (incomplete.length === 1) {
    const match = incomplete[0];
    const action = await match.apply();
    await notifyAttendanceResult(student, match, action, timeStr);
    return { result: action, studentName: student.user.name, sessionTitle: match.title, time: timeStr };
  }
```

Make the identical two changes in `resolveCheckIn` (around line 739): add `lineUserId: true,` to its `prisma.student.findUnique` select, and insert `await notifyAttendanceResult(student, match, action, timeStr);` between `const action = await match.apply();` and the `return` statement.

- [ ] **Step 5: Reset the low-quota flag when an admin tops up a student's sessions**

In `src/lib/services/classService.ts`, find `setStudentEnrollments` (around line 130). The `toUpdate` transaction entry currently reads:

```ts
    ...toUpdate.map((e) =>
      prisma.classEnrollment.update({
        where: { studentId_classId: { studentId, classId: e.classId } },
        data: { totalSessions: e.totalSessions },
      })
    ),
```

Change the `data` to also reset the notification flag, so a student who was already flagged as low-quota gets notified again next time they drop below the threshold after being topped up:

```ts
    ...toUpdate.map((e) =>
      prisma.classEnrollment.update({
        where: { studentId_classId: { studentId, classId: e.classId } },
        data: { totalSessions: e.totalSessions, lowQuotaNotifiedAt: null },
      })
    ),
```

- [ ] **Step 6: Write the failing tests**

In `src/lib/services/attendanceService.test.ts`, inside the existing `describe('checkInByStudentNumber / resolveCheckIn', ...)` block (around line 437, alongside the existing `setupStudentWithNumber` helper), add:

```ts
  it('flags low quota after a check-in drops remaining sessions to the threshold', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-lowquota1@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S011', 'checkin-lowquota-student1@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 4 } });

    await checkInByStudentNumber('S011', '2026-08-04', '19:00', 'marker-1');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: cls.id } } });
    expect(enrollment.lowQuotaNotifiedAt).not.toBeNull();
  });

  it('does not re-flag low quota once already flagged this cycle', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-lowquota1b@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S011B', 'checkin-lowquota-student1b@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    // Simulate an earlier cycle that already notified — the guard must leave
    // this timestamp untouched, not bump it to a new "now()" on this check-in.
    const alreadyNotifiedAt = new Date('2026-07-20T00:00:00.000Z');
    await prisma.classEnrollment.update({
      where: { studentId_classId: { studentId: student.id, classId: cls.id } },
      data: { totalSessions: 4, lowQuotaNotifiedAt: alreadyNotifiedAt },
    });

    await checkInByStudentNumber('S011B', '2026-08-04', '19:00', 'marker-1');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: cls.id } } });
    expect(enrollment.lowQuotaNotifiedAt).toEqual(alreadyNotifiedAt);
  });

  it('does not flag low quota while remaining sessions stay above the threshold', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-lowquota2@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S012', 'checkin-lowquota-student2@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 10 } });

    await checkInByStudentNumber('S012', '2026-08-04', '19:00', 'marker-1');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: cls.id } } });
    expect(enrollment.lowQuotaNotifiedAt).toBeNull();
  });

  it('does not flag low quota for a one-on-one makeup check-in', async () => {
    const availabilityTeacher = await createTeacher({ name: '林老師', email: 'checkin-lowquota3-avail@example.com', password: 'x', subjects: '圍棋' });
    await prisma.teacherAvailability.create({ data: { teacherId: availabilityTeacher.id, weekday: 2, startTime: '14:00', endTime: '18:00' } });
    const homeTeacher = await createTeacher({ name: '陳老師', email: 'checkin-lowquota3-home@example.com', password: 'x', subjects: '圍棋' });
    const student = await setupStudentWithNumber('S013', 'checkin-lowquota-student3@example.com');
    const homeClass = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: homeTeacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(homeClass.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: homeClass.id } }, data: { totalSessions: 1 } });
    const leave = await createLeaveRequest({ studentId: student.id, classId: homeClass.id, date: new Date('2026-08-04'), reason: '請假' });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: availabilityTeacher.id,
      slotDate: new Date('2026-08-04'),
      slotStartTime: '15:00',
      slotEndTime: '16:00',
    });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    await checkInByStudentNumber('S013', '2026-08-04', '15:00', 'marker-1');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: homeClass.id } } });
    expect(enrollment.lowQuotaNotifiedAt).toBeNull();
  });

  it('does not throw when the student has a LINE binding but no access token is configured', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-linebound@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S014', 'checkin-linebound-student@example.com');
    await prisma.student.update({ where: { id: student.id }, data: { lineUserId: 'Uparent999' } });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const result = await checkInByStudentNumber('S014', '2026-08-04', '19:00', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '數學A班', time: '19:00' });
  });
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL — `classId` does not exist on `CheckInCandidate` / `lowQuotaNotifiedAt` does not exist on `ClassEnrollment` (until Step 1-2 land) or the low-quota assertions fail (until Step 3-4 land). Confirm the failures are the ones you expect, not unrelated ones.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: all tests PASS, including the four new ones and every pre-existing test in this file (the `toEqual` assertions in the existing tests must still match exactly — the check-in/out result shape has not changed).

- [ ] **Step 9: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts src/lib/services/classService.ts
git commit -m "feat: push LINE check-in/out and low-quota notifications from the kiosk flow"
```

---

### Task 4: Wire makeup-request decision notifications into `makeupRequestService.ts`

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts`
- Test: `src/lib/services/makeupRequestService.test.ts`

**Interfaces:**
- Consumes: `pushLineMessage` from `src/lib/services/lineService.ts` (Task 1), `formatDateWithWeekday` from `src/lib/dateFormat.ts` (existing).
- Produces: `decideMakeupRequest(id: string, decision: 'APPROVED' | 'REJECTED')` keeps its existing call signature; its return value now includes `leaveRequest.student` and `targetClass`, which is additive (existing callers reading `.status` are unaffected).

- [ ] **Step 1: Add a slot-formatting helper and rewrite `decideMakeupRequest`**

In `src/lib/services/makeupRequestService.ts`, add these imports at the top:

```ts
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { pushLineMessage } from './lineService';
```

Find `decideMakeupRequest` (around line 179):

```ts
export function decideMakeupRequest(id: string, decision: 'APPROVED' | 'REJECTED') {
  return prisma.makeupRequest.update({ where: { id }, data: { status: decision } });
}
```

Replace it with:

```ts
function formatMakeupSlot(m: {
  type: 'INSERTION' | 'ONE_ON_ONE';
  targetDate: Date | null;
  targetClass: { name: string; startTime: string; endTime: string } | null;
  slotDate: Date | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
}): string {
  if (m.type === 'INSERTION' && m.targetDate && m.targetClass) {
    return `${formatDateWithWeekday(m.targetDate)} ${m.targetClass.name} ${m.targetClass.startTime}-${m.targetClass.endTime}`;
  }
  if (m.slotDate && m.slotStartTime && m.slotEndTime) {
    return `${formatDateWithWeekday(m.slotDate)} 一對一補課 ${m.slotStartTime}-${m.slotEndTime}`;
  }
  return '';
}

export async function decideMakeupRequest(id: string, decision: 'APPROVED' | 'REJECTED') {
  const updated = await prisma.makeupRequest.update({
    where: { id },
    data: { status: decision },
    include: {
      leaveRequest: { select: { student: { select: { id: true, lineUserId: true, user: { select: { name: true } } } } } },
      targetClass: { select: { name: true, startTime: true, endTime: true } },
    },
  });

  const student = updated.leaveRequest.student;
  if (student.lineUserId) {
    const text =
      decision === 'APPROVED'
        ? `【MUP】${student.user.name}的補課申請已核准：${formatMakeupSlot(updated)}`
        : `【MUP】${student.user.name}的補課申請未通過，請洽行政人員`;
    await pushLineMessage(student.lineUserId, text);
  }

  return updated;
}
```

- [ ] **Step 2: Write the failing tests**

In `src/lib/services/makeupRequestService.test.ts`, inside the existing `describe('listPendingMakeupRequests / decideMakeupRequest', ...)` block (around line 326), add:

```ts
  it('does not throw when the student has no LINE binding', async () => {
    const { classB, leave } = await setup();
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });

    const decided = await decideMakeupRequest(makeup.id, 'APPROVED');

    expect(decided.status).toBe('APPROVED');
  });

  it('does not throw when the student has a LINE binding but no access token is configured', async () => {
    const { student, classB, leave } = await setup();
    await prisma.student.update({ where: { id: student.id }, data: { lineUserId: 'Uparent123' } });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });

    const decided = await decideMakeupRequest(makeup.id, 'REJECTED');

    expect(decided.status).toBe('REJECTED');
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: FAIL — `decideMakeupRequest` doesn't yet return a Promise resolving after the include/push logic (or the file doesn't type-check) until Step 1 lands. Confirm the failure is about the change you're about to make, not something unrelated.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: all tests PASS, including the two new ones and every pre-existing test in this file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/makeupRequestService.ts src/lib/services/makeupRequestService.test.ts
git commit -m "feat: push LINE makeup-request decision notifications"
```

---

### Task 5: Admin student-edit page — LINE binding UI

**Files:**
- Modify: `package.json` (add `qrcode` dependency)
- Modify: `src/lib/services/studentService.ts` (`listStudents`)
- Modify: `src/app/admin/students/page.tsx`

**Interfaces:**
- Consumes: `POST /api/students/[id]/line-bind-code`, `POST /api/students/[id]/line-unbind` (Task 2).
- Produces: no new exported interfaces — this is a leaf UI task.

- [ ] **Step 1: Add the `qrcode` dependency**

Run: `npm install qrcode`
Run: `npm install --save-dev @types/qrcode`
Expected: both commands succeed; `package.json` gains `qrcode` under `dependencies` and `@types/qrcode` under `devDependencies`.

- [ ] **Step 2: Expose `lineUserId` from `listStudents`**

In `src/lib/services/studentService.ts`, find `listStudents` (around line 39). Its `select` currently reads:

```ts
    select: {
      id: true,
      parentPhone: true,
      studentNumber: true,
      user: { select: SAFE_USER_SELECT },
      enrollments: { select: { classId: true } },
    },
```

Add `lineUserId: true,`:

```ts
    select: {
      id: true,
      parentPhone: true,
      studentNumber: true,
      lineUserId: true,
      user: { select: SAFE_USER_SELECT },
      enrollments: { select: { classId: true } },
    },
```

- [ ] **Step 3: Add the LINE section to the student edit modal**

In `src/app/admin/students/page.tsx`:

Add `useRef` to the existing React import (line 3):

```ts
import { ReactNode, Suspense, useEffect, useRef, useState } from 'react';
```

Add two new imports below the existing ones (after `import { useToast } from '@/components/ui/Toast';`):

```ts
import Link from 'next/link';
import QRCode from 'qrcode';
```

Add `lineUserId: string | null;` to the `StudentRow` interface (around line 19):

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

Inside `StudentsContent`, alongside the other `useState`/`useRef` declarations (after the `openHintClassId` line, around line 97), add:

```ts
  const [lineBindInfo, setLineBindInfo] = useState<{ code: string; addFriendUrl: string } | null>(null);
  const [lineBinding, setLineBinding] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (lineBindInfo && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, lineBindInfo.addFriendUrl, { width: 200 });
    }
  }, [lineBindInfo]);
```

In `openEdit` (around line 169), reset the bind state whenever a (possibly different) student is opened for editing:

```ts
  function openEdit(s: StudentRow) {
    setEditing(s);
    setEditForm({ name: s.user.name, email: s.user.email, password: '', parentPhone: s.parentPhone ?? '', studentNumber: s.studentNumber ?? '' });
    setEditEnrollments(Object.fromEntries(s.enrollments.map((e) => [e.classId, e.totalSessions === null ? '' : String(e.totalSessions)])));
    setAddClassQuery('');
    setEditError('');
    setLineBindInfo(null);
  }
```

Add these three handlers directly below `handleDelete` (around line 226):

```ts
  async function refreshEditingFromServer() {
    if (!editing) return;
    const res = await fetch('/api/students');
    const fresh: StudentRow[] = await res.json();
    setStudents(fresh);
    const match = fresh.find((s) => s.id === editing.id);
    if (match) setEditing(match);
  }

  async function handleGenerateLineBindCode() {
    if (!editing) return;
    setLineBinding(true);
    try {
      const res = await fetch(`/api/students/${editing.id}/line-bind-code`, { method: 'POST' });
      if (!res.ok) {
        showToast('產生綁定碼失敗');
        return;
      }
      setLineBindInfo(await res.json());
    } finally {
      setLineBinding(false);
    }
  }

  async function handleLineUnbind() {
    if (!editing) return;
    if (!confirm('確定要解除這位學生的 LINE 綁定嗎？')) return;
    const res = await fetch(`/api/students/${editing.id}/line-unbind`, { method: 'POST' });
    if (!res.ok) {
      showToast('解除綁定失敗');
      return;
    }
    showToast('已解除綁定');
    await refreshEditingFromServer();
  }
```

In the edit `<Modal>`'s form (around line 449, right before the closing `{editError && ...}` line), add a new section between the "加入新班級" `<div>` and `{editError && ...}`:

```tsx
          <div>
            <p className="mb-1 text-sm font-medium text-ink">LINE 通知</p>
            <div className="rounded-lg border border-borderStrong p-3">
              {editing?.lineUserId ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-approved">已綁定</span>
                  <button type="button" className="text-xs text-rejected hover:underline" onClick={handleLineUnbind}>
                    解除綁定
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-inkMuted">未綁定</span>
                    <div className="flex items-center gap-3">
                      <button type="button" className="text-xs text-brandDark hover:underline" onClick={refreshEditingFromServer}>
                        重新查詢狀態
                      </button>
                      <Button type="button" variant="secondary" loading={lineBinding} onClick={handleGenerateLineBindCode}>
                        產生綁定 QR code
                      </Button>
                    </div>
                  </div>
                  {lineBindInfo && (
                    <div className="flex flex-col items-center gap-2 rounded-lg bg-background p-3">
                      <canvas ref={qrCanvasRef} />
                      <p className="text-xs text-inkMuted">綁定碼：{lineBindInfo.code}</p>
                    </div>
                  )}
                </div>
              )}
              <Link href="/admin/line-setup" target="_blank" className="mt-2 inline-block text-xs text-brandDark hover:underline">
                查看設定教學
              </Link>
            </div>
          </div>

```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx eslint src/app/admin/students/page.tsx src/lib/services/studentService.ts`
Expected: no errors.

- [ ] **Step 3: Manual browser verification**

Start the dev server (`npm run dev`), log in as admin, go to `/admin/students`.

1. Open any student's edit modal — confirm a "LINE 通知" section appears showing "未綁定", a "重新查詢狀態" link, and a "產生綁定 QR code" button, with no leftover placeholder text.
2. Click "產生綁定 QR code" — confirm a QR code image renders below the button along with the 8-character bind code text.
3. Close the modal and reopen the same student — confirm the QR code from the previous attempt is gone (state was reset) and the section is back to its initial "未綁定" layout.
4. In a separate terminal, directly bind a test student via the database to simulate a completed LINE binding, then click "重新查詢狀態" on that student's still-open modal without closing it:

```bash
npx prisma studio
```

(Or run a one-off script/psql `UPDATE "Student" SET "lineUserId" = 'Utest123' WHERE id = '<id>';`.) After clicking "重新查詢狀態", confirm the section switches to "已綁定" with a "解除綁定" button, without needing a full page reload.

5. Click "解除綁定", confirm the browser `confirm()` dialog, confirm it — the section should return to "未綁定" and a toast "已解除綁定" should appear.
6. Click "查看設定教學" — confirm it opens `/admin/line-setup` in a new tab (this will 404 until Task 6 lands; if Task 6 is already merged, confirm the page loads instead).
7. Toggle dark mode and confirm the "LINE 通知" section remains legible (border, QR canvas background, and text colors all still readable).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/services/studentService.ts src/app/admin/students/page.tsx
git commit -m "feat: add LINE binding UI to the admin student edit page"
```

---

### Task 6: `/admin/line-setup` tutorial page

**Files:**
- Create: `src/app/admin/line-setup/page.tsx`

**Interfaces:**
- Consumes: nothing (static content, no data fetching).
- Produces: nothing consumed by other tasks — this is the last task.

- [ ] **Step 1: Create the page**

Create `src/app/admin/line-setup/page.tsx`:

```tsx
import Card from '@/components/ui/Card';

export default function LineSetupPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">LINE 官方帳號通知設定教學</h1>

      <Card className="mb-6">
        <h2 className="mb-3 font-bold text-ink">一、一次性技術設定（開通 Messaging API）</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-inkMuted">
          <li>
            登入{' '}
            <a className="text-brandDark hover:underline" href="https://manager.line.biz/" target="_blank" rel="noreferrer">
              LINE Official Account Manager
            </a>
            ，選擇要使用的官方帳號
          </li>
          <li>設定（右上角）→ Messaging API → 「啟用 Messaging API」</li>
          <li>選擇既有 Provider 或建立新的（填公司/單位名稱）</li>
          <li>
            開通後會產生一個 Channel，記下畫面上的 <strong className="text-ink">Channel secret</strong>
          </li>
          <li>
            到{' '}
            <a className="text-brandDark hover:underline" href="https://developers.line.biz/" target="_blank" rel="noreferrer">
              LINE Developers
            </a>{' '}
            主控台，找到剛剛建立的 Channel → Messaging API 分頁 → 「Channel access token（長期）」→ 點擊「發行」，複製 token
          </li>
          <li>
            同一頁面記下 Bot 的 <strong className="text-ink">Basic ID</strong>（<code className="rounded bg-background px-1 py-0.5">@xxx</code> 格式）
          </li>
          <li>
            Webhook URL 欄位填入{' '}
            <code className="rounded bg-background px-1 py-0.5">https://hjj-phi.vercel.app/api/line/webhook</code>，並開啟「使用 Webhook」
          </li>
          <li>建議關閉 LINE Official Account Manager 內建的「自動回應訊息」「加入好友歡迎訊息」，避免跟系統自己的回覆邏輯打架</li>
          <li>
            把 Channel access token、Channel secret、Basic ID 分別貼到 Vercel 專案的環境變數：
            <code className="mt-1 block rounded bg-background px-2 py-1">
              LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET / LINE_OA_BASIC_ID
            </code>
            （Basic ID 要連同開頭的 @ 一起貼）
          </li>
        </ol>
      </Card>

      <Card>
        <h2 className="mb-3 font-bold text-ink">二、日常操作：如何幫家長綁定 LINE</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-inkMuted">
          <li>打開「學生名單」，點選要綁定的學生，進入編輯頁</li>
          <li>在「LINE 通知」區塊按「產生綁定 QR code」</li>
          <li>把畫面上的 QR code 給家長看（櫃檯當面出示，或視訊/電話時用手機拍給對方）</li>
          <li>請家長用 LINE 掃描這組 QR code——會直接跳進與官方帳號的對話框，文字已經預填好，請家長直接按送出</li>
          <li>系統收到訊息後會自動完成綁定，並回覆家長「綁定成功」的訊息</li>
          <li>按「重新查詢狀態」確認是否已顯示「已綁定」</li>
          <li>如果家長換手機或封鎖了官方帳號，通知會送不出去，此時到編輯頁按「解除綁定」，再重新走一次上面的流程即可</li>
        </ol>
      </Card>
    </>
  );
}
```

This page is intentionally **not** added to `NAV_LINKS` in `src/components/ui/AppShell.tsx` — it's only reachable via the "查看設定教學" link added to the student edit page in Task 5.

- [ ] **Step 2: Type-check, lint, and build**

Run: `npx tsc --noEmit && npx eslint src/app/admin/line-setup/page.tsx`
Expected: no errors.

Run: `rm -rf .next && npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Manual browser verification**

With the dev server running, log in as admin and navigate directly to `/admin/line-setup`.

1. Confirm both sections render with real, readable content (no placeholder text).
2. Confirm the two external links (LINE Official Account Manager, LINE Developers) open in a new tab and point to the right domains.
3. Confirm the page is not present in the top nav bar.
4. Toggle dark mode and confirm both cards, the `<code>` chips, and links remain legible.
5. Log in as a teacher or student and navigate directly to `/admin/line-setup` — confirm the existing `src/middleware.ts` role gate redirects away (no new code needed for this — verifies the existing `/admin/:path*` matcher already covers this new route).

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/line-setup/page.tsx
git commit -m "feat: add /admin/line-setup tutorial page"
```

---

## Production Deployment Note

**This SQL must be run BEFORE this branch is merged/deployed — not after.** `Student.lineUserId`/`lineBindCode` are selected by `checkInByStudentNumber` / `resolveCheckIn` (the kiosk check-in flow) and `listStudents` (`/admin/students`) — both existing, daily-used code paths, not new pages. If the new application code deploys before these columns exist, both the kiosk and the admin student list will start 500ing with "column does not exist" and stay broken until the SQL below is applied. Apply it manually via Supabase's SQL Editor first (same process as the earlier `FaqItem` migration — production DB credentials are not accessible to automated tooling), then merge and deploy this branch:

```sql
ALTER TABLE "Student" ADD COLUMN "lineUserId" TEXT;
CREATE UNIQUE INDEX "Student_lineUserId_key" ON "Student"("lineUserId");
ALTER TABLE "Student" ADD COLUMN "lineBindCode" TEXT;
CREATE UNIQUE INDEX "Student_lineBindCode_key" ON "Student"("lineBindCode");
ALTER TABLE "ClassEnrollment" ADD COLUMN "lowQuotaNotifiedAt" TIMESTAMP(3);
```

The three `LINE_*` environment variables also need to be added to the Vercel project (Settings → Environment Variables) once the user has completed the one-time Messaging API setup described on `/admin/line-setup`. Until those env vars are set: `pushLineMessage`/`replyLineMessage` safely no-op (see Task 1); `verifyWebhookSignature` safely rejects every webhook request rather than accepting forged ones (see the final-review fix to Task 1 — it fails closed when `LINE_CHANNEL_SECRET` is unset); and `generateBindCode` throws a clear, named error instead of producing a broken QR code when `LINE_OA_BASIC_ID` is unset. The admin binding UI, database writes, and non-LINE parts of the feature remain testable without real LINE credentials — only the actual push/reply/webhook network calls require them.
