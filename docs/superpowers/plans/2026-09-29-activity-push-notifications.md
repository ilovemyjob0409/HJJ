# 活動主動推播通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 活動專區補上七種通知（新活動發布、老師指派／移除、編輯更新、活動取消、行政代報名／移除、行前提醒、行政手動推播＋發送紀錄），全部走通知中心統一入口。

**Architecture:** 新增 `activityNotifyService.ts` 負責「活動快照＋文案＋收件人」；`activityService` 的五個寫入函式在寫入前後抓快照、寫入成功後以 best-effort 呼叫它。行前提醒掛進既有 `daily-reminders` cron；手動推播新增 `ActivityAnnouncement` 表與 `/api/activities/[id]/announcements`；後台活動管理頁加勾選框、刪除確認文字、通知紀錄區塊（含發送彈窗），鈴鐺加「活動」圖示。

**Tech Stack:** Next.js 14 App Router、Prisma 7（prisma-client-js）、PostgreSQL、Vitest（真實測試 DB）、Tailwind。

**Spec:** `docs/superpowers/specs/2026-09-29-activity-push-notifications-design.md`

## Global Constraints

- 所有通知一律走 `notificationService.notifyUsers`（收件夾＋推播，本身永不 throw）；**不得** import `pushService` 的發送函式。
- 自動通知是 best-effort：包在 `safeNotify` 裡，任何失敗只 `console.error`，**不得讓新增／編輯／刪除／報名失敗**；通知一律在寫入成功後才發。
- **已結束的活動（`isBeforeToday(endDate)`）不發任何自動通知**（含勾選框觸發的 1、3）；只有行政手動推播不受此限。
- 學生自己 `registerForActivity`／`cancelRegistration` 不發通知；行政端不收報名通知。
- 網址：學生 `/student/activities`、老師 `/teacher/activities`。
- 日期：單日 `formatDateWithWeekday`，區間 `formatActivityDateRange`；文案**不用括號包日期**（日期本身已含「（星期）」）。「明天」＝`taipeiDateKey(now)` 加一天的 UTC 日曆日。
- 「全體學生」＝所有 `role: 'STUDENT'` 的 User。
- 測試日期 fixture 一律 `Date.UTC(...)`／ISO 字串，不用 `new Date(Y, M, D)` 本地建構子；「未來」用 2099 年、「已結束」用 2020 年，測試結果不受執行日期影響。
- 表單控件用共用 `Input`／`Select`／`Textarea`；勾選框／單選用站內原生 `<input>` 包在 `<label className="flex items-center gap-2 text-sm text-ink">`，label 內不放按鈕。
- 紀錄類表格用 `CollapsibleDataTable maxRows={3}`；新彈窗用既有 `Modal`；不另創動畫。
- commit 只 stage 自己改的檔案，不要 `git add -A`；**永遠不要 stage `vitest.setup.ts`、`package.json`**（見執行前準備，這兩檔在 worktree 內被改成專用測試 DB）。
- 正式站建表 SQL **使用者已於 2026-09-29 跑完**，上線時不用再跑。

## 執行前準備（controller 做一次，不是任務）

主 checkout 可能有其他 session 同時在跑（多教室 `feat-multi-classroom` worktree 等），一律在隔離 worktree＋專用測試 DB 開發：

```bash
MAIN="/Users/s.w.kung/Downloads/Wade Claude/HJJ"
WT="$MAIN/.claude/worktrees/activity-push"
git -C "$MAIN" worktree add "$WT" -b feat-activity-push main
mkdir "$WT/node_modules"
for entry in "$MAIN"/node_modules/* "$MAIN"/node_modules/.bin; do
  name=$(basename "$entry")
  [ "$name" = "@prisma" ] || ln -s "$entry" "$WT/node_modules/$name"
done
# Prisma client 要實體複本：worktree 內 prisma generate 才不會污染主 checkout 的共用 client
cp -R "$MAIN/node_modules/.prisma" "$WT/node_modules/.prisma"
cp -R "$MAIN/node_modules/@prisma" "$WT/node_modules/@prisma"
cp "$MAIN/.env" "$MAIN/.env.local" "$WT/"
cd "$WT"
sed -i '' 's/tutoring_makeup_system_test/tutoring_makeup_system_test_actpush/' vitest.setup.ts package.json
createdb -h localhost -U postgres tutoring_makeup_system_test_actpush
```

之後所有指令都在 `$WT` 內執行。`npm test` 全套約 150 秒，指令 timeout 至少 300000ms。

---

### Task 1: Schema＋activityNotifyService 基礎＋新增活動通知

**Files:**
- Modify: `prisma/schema.prisma`（新 enum＋model；`Activity`、`User` 加 relation）
- Create: `src/lib/services/activityNotifyService.ts`
- Modify: `src/lib/services/activityService.ts`（`createActivity`）
- Modify: `src/app/api/activities/route.ts`（POST 收 `notifyStudents`＋`maxDuration`）
- Create: `src/lib/services/activityNotifyService.test.ts`
- Create: `src/app/api/activities/route.test.ts`

**Interfaces:**
- Produces（`activityNotifyService.ts`）：
  - `STUDENT_ACTIVITY_URL = '/student/activities'`、`TEACHER_ACTIVITY_URL = '/teacher/activities'`
  - `interface ActivitySnapshot { id; title; categoryName; location: string | null; startDate: Date; endDate: Date; capacity: number; teachers: { teacherId: string; userId: string }[]; studentUserIds: string[] }`
  - `getActivitySnapshot(activityId: string): Promise<ActivitySnapshot | null>`
  - `safeNotify(label: string, task: () => Promise<void>): Promise<void>`
  - `notifyActivityCreated(s: ActivitySnapshot, options: { notifyStudents: boolean }): Promise<void>`
  - 模組內部 helper（後續任務會用）：`isEnded(s)`、`dateRange(s)`、`allStudentUserIds()`、`notifyTeachersAssigned(s, userIds)`
- Produces（`activityService.ts`）：`createActivity(input: CreateActivityInput, options: { notifyStudents?: boolean } = {})`
- Produces（Prisma）：model `ActivityAnnouncement`、enum `ActivityAnnouncementAudience`

- [ ] **Step 1: 改 schema**

`prisma/schema.prisma` 的 `model User` 在 `notifications             Notification[]` 下一行加：

```prisma
  activityAnnouncements     ActivityAnnouncement[]
```

`model Activity` 在 `attendances   ActivityAttendance[]` 下一行加：

```prisma
  announcements ActivityAnnouncement[]
```

檔尾加：

```prisma
enum ActivityAnnouncementAudience {
  REGISTERED
  ALL_STUDENTS
}

// 活動手動推播的發送紀錄（行政在詳情彈窗送出的訊息）
model ActivityAnnouncement {
  id              String                       @id @default(cuid())
  activityId      String
  activity        Activity                     @relation(fields: [activityId], references: [id])
  senderId        String
  sender          User                         @relation(fields: [senderId], references: [id])
  audience        ActivityAnnouncementAudience
  includeTeachers Boolean
  message         String
  recipientCount  Int
  createdAt       DateTime                     @default(now())

  @@index([activityId, createdAt])
}
```

Run: `npx prisma generate && npm run test:dbpush`
Expected: generate 成功；db push 對 `tutoring_makeup_system_test_actpush` 建表成功。

- [ ] **Step 2: 寫失敗測試（service）**

Create `src/lib/services/activityNotifyService.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { formatActivityDateRange } from '@/lib/activityDateRange';

vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(),
  createSignedUrls: vi.fn(async () => new Map()),
  createSignedThumbUrls: vi.fn(async () => new Map()),
  deleteActivityImages: vi.fn(async () => {}),
}));

import { createActivity, createCategory, CreateActivityInput } from './activityService';

// 2099 一定是「未來」、2020 一定「已結束」——測試結果不受執行日期影響
const FUTURE = new Date(Date.UTC(2099, 0, 10));
const PAST = new Date(Date.UTC(2020, 0, 10));
const S_URL = '/student/activities';
const T_URL = '/teacher/activities';

async function teacherUserId(teacherId: string) {
  return (await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId }, select: { userId: true } })).userId;
}
async function studentUserId(studentId: string) {
  return (await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } })).userId;
}

async function setup() {
  const t1 = await createTeacher({ name: '陳老師', email: 't1@example.com', password: 'x', subjects: '圍棋' });
  const t2 = await createTeacher({ name: '林老師', email: 't2@example.com', password: 'x', subjects: '圍棋' });
  const s1 = await createStudent({ name: '王小明', email: 's1@example.com' });
  const s2 = await createStudent({ name: '李小華', email: 's2@example.com' });
  const category = await createCategory('營隊');
  const users = {
    t1: await teacherUserId(t1.id),
    t2: await teacherUserId(t2.id),
    s1: await studentUserId(s1.id),
    s2: await studentUserId(s2.id),
  };
  return { t1, t2, s1, s2, category, users };
}

function input(categoryId: string, teacherIds: string[], overrides: Partial<CreateActivityInput> = {}): CreateActivityInput {
  return {
    title: '冬令營',
    description: '三天營隊',
    categoryId,
    location: '活動中心',
    startDate: FUTURE,
    endDate: FUTURE,
    capacity: 20,
    teacherIds,
    ...overrides,
  };
}

function inbox(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { title: true, body: true, url: true },
  });
}

async function clearInbox() {
  await prisma.notification.deleteMany();
}

describe('新增活動通知', () => {
  it('勾選通知時：全體學生收到「新活動開放報名」、帶隊老師收到指派通知', async () => {
    const f = await setup();
    await createActivity(input(f.category.id, [f.t1.id]), { notifyStudents: true });
    const range = formatActivityDateRange(FUTURE, FUTURE);
    for (const uid of [f.users.s1, f.users.s2]) {
      expect(await inbox(uid)).toEqual([
        { title: '新活動開放報名', body: `營隊｜冬令營，${range}，名額 20 位，點擊查看報名`, url: S_URL },
      ]);
    }
    expect(await inbox(f.users.t1)).toEqual([
      { title: '活動帶隊指派', body: `你被指派帶領「冬令營」，${range}`, url: T_URL },
    ]);
    expect(await inbox(f.users.t2)).toEqual([]);
  });

  it('沒帶選項（預設不通知學生）時學生收不到，但老師照收指派', async () => {
    const f = await setup();
    await createActivity(input(f.category.id, [f.t1.id, f.t2.id]));
    expect(await inbox(f.users.s1)).toEqual([]);
    expect(await inbox(f.users.t1)).toHaveLength(1);
    expect(await inbox(f.users.t2)).toHaveLength(1);
  });

  it('已結束的活動不發任何自動通知', async () => {
    const f = await setup();
    await createActivity(input(f.category.id, [f.t1.id], { startDate: PAST, endDate: PAST }), { notifyStudents: true });
    expect(await prisma.notification.count()).toBe(0);
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/activityNotifyService.test.ts`
Expected: FAIL——第一個測試學生收件夾為空（`createActivity` 還不發通知）。

- [ ] **Step 4: 建立 activityNotifyService**

Create `src/lib/services/activityNotifyService.ts`：

```ts
import { prisma } from '@/lib/db';
import { notifyUsers } from './notificationService';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import { isBeforeToday } from '@/lib/pastDate';

export const STUDENT_ACTIVITY_URL = '/student/activities';
export const TEACHER_ACTIVITY_URL = '/teacher/activities';

// 通知用的活動快照：編輯前後各抓一份比對老師增減；刪除前抓一份保留收件人
export interface ActivitySnapshot {
  id: string;
  title: string;
  categoryName: string;
  location: string | null;
  startDate: Date;
  endDate: Date;
  capacity: number;
  teachers: { teacherId: string; userId: string }[];
  studentUserIds: string[];
}

export async function getActivitySnapshot(activityId: string): Promise<ActivitySnapshot | null> {
  const a = await prisma.activity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      title: true,
      location: true,
      startDate: true,
      endDate: true,
      capacity: true,
      category: { select: { name: true } },
      teachers: { select: { teacherId: true, teacher: { select: { userId: true } } } },
      registrations: { select: { student: { select: { userId: true } } } },
    },
  });
  if (!a) return null;
  return {
    id: a.id,
    title: a.title,
    categoryName: a.category.name,
    location: a.location,
    startDate: a.startDate,
    endDate: a.endDate,
    capacity: a.capacity,
    teachers: a.teachers.map((t) => ({ teacherId: t.teacherId, userId: t.teacher.userId })),
    studentUserIds: a.registrations.map((r) => r.student.userId),
  };
}

// 自動通知一律 best-effort：任何一步失敗只記 log，不影響活動的寫入主流程
export async function safeNotify(label: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    console.error(`activity notify (${label}) failed`, err);
  }
}

// 已結束的活動不發自動通知（行政補登舊資料時不打擾人）；手動推播不受此限
function isEnded(s: ActivitySnapshot): boolean {
  return isBeforeToday(s.endDate);
}

function dateRange(s: ActivitySnapshot): string {
  return formatActivityDateRange(s.startDate, s.endDate);
}

async function allStudentUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { role: 'STUDENT' }, select: { id: true } });
  return users.map((u) => u.id);
}

async function notifyTeachersAssigned(s: ActivitySnapshot, userIds: string[]): Promise<void> {
  await notifyUsers(userIds, {
    title: '活動帶隊指派',
    body: `你被指派帶領「${s.title}」，${dateRange(s)}`,
    url: TEACHER_ACTIVITY_URL,
  });
}

export async function notifyActivityCreated(s: ActivitySnapshot, options: { notifyStudents: boolean }): Promise<void> {
  if (isEnded(s)) return;
  await notifyTeachersAssigned(
    s,
    s.teachers.map((t) => t.userId)
  );
  if (!options.notifyStudents) return;
  await notifyUsers(await allStudentUserIds(), {
    title: '新活動開放報名',
    body: `${s.categoryName}｜${s.title}，${dateRange(s)}，名額 ${s.capacity} 位，點擊查看報名`,
    url: STUDENT_ACTIVITY_URL,
  });
}
```

- [ ] **Step 5: 改 createActivity**

`src/lib/services/activityService.ts` 頂部 import 加：

```ts
import { getActivitySnapshot, notifyActivityCreated, safeNotify } from './activityNotifyService';
```

把整個 `createActivity` 換成：

```ts
export interface CreateActivityOptions {
  // 發布後通知全體學生（後台新增表單的勾選框，前端預設勾）
  notifyStudents?: boolean;
}

export async function createActivity(input: CreateActivityInput, options: CreateActivityOptions = {}) {
  const created = await prisma.activity.create({
    data: {
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      location: input.location,
      startDate: input.startDate,
      endDate: input.endDate,
      capacity: input.capacity,
      teachers: { create: input.teacherIds.map((teacherId) => ({ teacherId })) },
    },
  });
  await safeNotify('created', async () => {
    const snapshot = await getActivitySnapshot(created.id);
    if (snapshot) await notifyActivityCreated(snapshot, { notifyStudents: options.notifyStudents ?? false });
  });
  return created;
}
```

- [ ] **Step 6: 跑 service 測試確認通過**

Run: `npx vitest run src/lib/services/activityNotifyService.test.ts src/lib/services/activityService.test.ts`
Expected: PASS（既有 activityService 測試不受影響）。

- [ ] **Step 7: 寫失敗測試（route）**

Create `src/app/api/activities/route.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(),
  createSignedUrls: vi.fn(async () => new Map()),
  createSignedThumbUrls: vi.fn(async () => new Map()),
  deleteActivityImages: vi.fn(async () => {}),
}));

import { POST } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';

async function fixture() {
  const teacher = await createTeacher({ name: '陳老師', email: 't1@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '王小明', email: 's1@example.com' });
  const category = await prisma.activityCategory.create({ data: { name: '營隊' } });
  const studentUser = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  return { teacher, category, studentUserId: studentUser.userId };
}

function body(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}) {
  return {
    title: '冬令營',
    description: 'd',
    categoryId: f.category.id,
    startDate: '2099-01-10',
    endDate: '2099-01-10',
    capacity: 20,
    teacherIds: [f.teacher.id],
    ...extra,
  };
}

function postReq(payload: unknown) {
  return new NextRequest('http://x/api/activities', { method: 'POST', body: JSON.stringify(payload) });
}

beforeEach(() => {
  sessionMock.mockReset();
  sessionMock.mockResolvedValue({ user: { id: 'u', role: 'ADMIN' } });
});

describe('POST /api/activities 發布通知旗標', () => {
  it('notifyStudents: true → 學生收到新活動通知', async () => {
    const f = await fixture();
    const res = await POST(postReq(body(f, { notifyStudents: true })));
    expect(res.status).toBe(201);
    expect(await prisma.notification.count({ where: { userId: f.studentUserId, title: '新活動開放報名' } })).toBe(1);
  });

  it('沒帶 notifyStudents → 視為 false，學生收不到', async () => {
    const f = await fixture();
    const res = await POST(postReq(body(f)));
    expect(res.status).toBe(201);
    expect(await prisma.notification.count({ where: { userId: f.studentUserId } })).toBe(0);
  });
});
```

- [ ] **Step 8: 跑測試確認失敗**

Run: `npx vitest run src/app/api/activities/route.test.ts`
Expected: FAIL——第一個測試 count 為 0（route 還沒傳旗標）。

- [ ] **Step 9: 改 POST route**

`src/app/api/activities/route.ts`：import 下方加

```ts
// 勾選「發布後通知全體學生」時要逐筆推播，給足背景推播時間（比照 admin/billing/notify）
export const maxDuration = 60;
```

把 `createActivity({ ... })` 呼叫改成帶第二個參數：

```ts
  const created = await createActivity(
    {
      title: body.title,
      description: body.description,
      categoryId: body.categoryId,
      location: body.location || undefined,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      capacity: Number(body.capacity),
      teacherIds,
    },
    { notifyStudents: body.notifyStudents === true }
  );
```

- [ ] **Step 10: 跑測試確認通過＋型別檢查**

Run: `npx vitest run src/app/api/activities/route.test.ts && npx tsc --noEmit`
Expected: PASS；tsc 無錯誤。

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma src/lib/services/activityNotifyService.ts src/lib/services/activityNotifyService.test.ts src/lib/services/activityService.ts src/app/api/activities/route.ts src/app/api/activities/route.test.ts
git commit -m "feat: 活動通知基礎＋新增活動通知學生／指派老師

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 編輯活動通知（老師增減＋勾選通知已報名者）

**Files:**
- Modify: `src/lib/services/activityNotifyService.ts`（新增 `notifyActivityChanges`、`buildUpdateBody`）
- Modify: `src/lib/services/activityService.ts`（`updateActivity`）
- Modify: `src/app/api/activities/[id]/route.ts`（PUT 收 `notifyRegistered`）
- Test: `src/lib/services/activityNotifyService.test.ts`、`src/app/api/activities/[id]/route.test.ts`

**Interfaces:**
- Consumes（Task 1）：`ActivitySnapshot`、`getActivitySnapshot`、`safeNotify`、`isEnded`、`dateRange`、`notifyTeachersAssigned`、`STUDENT_ACTIVITY_URL`、`TEACHER_ACTIVITY_URL`
- Produces：`notifyActivityChanges(before: ActivitySnapshot, after: ActivitySnapshot, options: { notifyRegistered: boolean }): Promise<void>`；`updateActivity(id: string, input: CreateActivityInput, options: { notifyRegistered?: boolean } = {})`

- [ ] **Step 1: 寫失敗測試（service）**

`src/lib/services/activityNotifyService.test.ts`：import 改為

```ts
import { createActivity, createCategory, CreateActivityInput, registerForActivity, updateActivity } from './activityService';
```

檔尾加：

```ts
describe('編輯活動通知', () => {
  it('老師名單增減：新增者收指派、被移除者收取消指派；沒勾通知時學生收不到', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await updateActivity(a.id, input(f.category.id, [f.t2.id]));
    const range = formatActivityDateRange(FUTURE, FUTURE);
    expect(await inbox(f.users.t2)).toEqual([{ title: '活動帶隊指派', body: `你被指派帶領「冬令營」，${range}`, url: T_URL }]);
    expect(await inbox(f.users.t1)).toEqual([{ title: '活動帶隊取消指派', body: `你已不再帶領「冬令營」，${range}`, url: T_URL }]);
    expect(await inbox(f.users.s1)).toEqual([]);
  });

  it('勾選通知＋日期與地點都改：已報名學生與留任老師收到變更內容，新加入老師只收指派', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    const newStart = new Date(Date.UTC(2099, 0, 20));
    const newEnd = new Date(Date.UTC(2099, 0, 22));
    await updateActivity(
      a.id,
      input(f.category.id, [f.t1.id, f.t2.id], { startDate: newStart, endDate: newEnd, location: '大禮堂' }),
      { notifyRegistered: true }
    );
    const newRange = formatActivityDateRange(newStart, newEnd);
    const body = `「冬令營」日期改為 ${newRange}；地點改為 大禮堂`;
    expect(await inbox(f.users.s1)).toEqual([{ title: '活動資訊更新', body, url: S_URL }]);
    expect(await inbox(f.users.t1)).toEqual([{ title: '活動資訊更新', body, url: T_URL }]);
    expect(await inbox(f.users.t2)).toEqual([{ title: '活動帶隊指派', body: `你被指派帶領「冬令營」，${newRange}`, url: T_URL }]);
    expect(await inbox(f.users.s2)).toEqual([]);
  });

  it('勾選通知＋只改名稱：寫出原名稱與「活動資訊已更新」', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await updateActivity(a.id, input(f.category.id, [f.t1.id], { title: '冬季營隊' }), { notifyRegistered: true });
    expect(await inbox(f.users.s1)).toEqual([
      { title: '活動資訊更新', body: '「冬季營隊」（原「冬令營」）活動資訊已更新，點擊查看', url: S_URL },
    ]);
  });

  it('勾選通知＋清空地點：寫「地點改為未定」', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await updateActivity(a.id, input(f.category.id, [f.t1.id], { location: undefined }), { notifyRegistered: true });
    expect(await inbox(f.users.s1)).toEqual([{ title: '活動資訊更新', body: '「冬令營」地點改為未定', url: S_URL }]);
  });

  it('已結束的活動：老師增減與勾選通知都不發', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: PAST, endDate: PAST }));
    await registerForActivity(a.id, f.s1.id);
    await updateActivity(a.id, input(f.category.id, [f.t2.id], { startDate: PAST, endDate: PAST }), { notifyRegistered: true });
    expect(await prisma.notification.count()).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/activityNotifyService.test.ts`
Expected: FAIL——`編輯活動通知` 的前四個測試收件夾為空（`updateActivity` 還不發通知；型別上 `updateActivity` 第三個參數也還不存在，vitest 不做型別檢查所以照跑）。

- [ ] **Step 3: 新增 notifyActivityChanges**

`src/lib/services/activityNotifyService.ts` 檔尾加：

```ts
// 編輯後的「活動資訊更新」內容：只寫出日期／地點的變動；名稱改了就附上原名稱
function buildUpdateBody(before: ActivitySnapshot, after: ActivitySnapshot): string {
  const name = before.title !== after.title ? `「${after.title}」（原「${before.title}」）` : `「${after.title}」`;
  const changes: string[] = [];
  if (
    before.startDate.getTime() !== after.startDate.getTime() ||
    before.endDate.getTime() !== after.endDate.getTime()
  ) {
    changes.push(`日期改為 ${dateRange(after)}`);
  }
  if ((before.location ?? '') !== (after.location ?? '')) {
    changes.push(after.location ? `地點改為 ${after.location}` : '地點改為未定');
  }
  return changes.length > 0 ? `${name}${changes.join('；')}` : `${name}活動資訊已更新，點擊查看`;
}

// 老師增減一律自動通知；「活動資訊更新」只在行政勾選時發給已報名學生＋留任老師
// （新加入的老師只收指派通知、被移除的只收取消指派，不重複）
export async function notifyActivityChanges(
  before: ActivitySnapshot,
  after: ActivitySnapshot,
  options: { notifyRegistered: boolean }
): Promise<void> {
  if (isEnded(after)) return;
  const beforeIds = new Set(before.teachers.map((t) => t.teacherId));
  const afterIds = new Set(after.teachers.map((t) => t.teacherId));
  const added = after.teachers.filter((t) => !beforeIds.has(t.teacherId)).map((t) => t.userId);
  const removed = before.teachers.filter((t) => !afterIds.has(t.teacherId)).map((t) => t.userId);
  const retained = after.teachers.filter((t) => beforeIds.has(t.teacherId)).map((t) => t.userId);

  await notifyTeachersAssigned(after, added);
  await notifyUsers(removed, {
    title: '活動帶隊取消指派',
    body: `你已不再帶領「${after.title}」，${dateRange(after)}`,
    url: TEACHER_ACTIVITY_URL,
  });
  if (!options.notifyRegistered) return;
  const body = buildUpdateBody(before, after);
  await notifyUsers(after.studentUserIds, { title: '活動資訊更新', body, url: STUDENT_ACTIVITY_URL });
  await notifyUsers(retained, { title: '活動資訊更新', body, url: TEACHER_ACTIVITY_URL });
}
```

- [ ] **Step 4: 改 updateActivity**

`src/lib/services/activityService.ts` 的 import 改為：

```ts
import { getActivitySnapshot, notifyActivityChanges, notifyActivityCreated, safeNotify } from './activityNotifyService';
```

把整個 `updateActivity`（含上方註解）換成：

```ts
export interface UpdateActivityOptions {
  // 通知已報名學生與帶隊老師（後台編輯彈窗的勾選框，前端預設不勾）
  notifyRegistered?: boolean;
}

// Replaces the teacher list wholesale — assignments are current state, not
// history, so the delete-and-recreate inside one transaction is safe.
export async function updateActivity(id: string, input: CreateActivityInput, options: UpdateActivityOptions = {}) {
  // 更新前抓快照，事後比對老師增減與日期／地點變動
  const before = await getActivitySnapshot(id).catch(() => null);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.activityTeacher.deleteMany({ where: { activityId: id } });
    return tx.activity.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        location: input.location ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        capacity: input.capacity,
        teachers: { create: input.teacherIds.map((teacherId) => ({ teacherId })) },
      },
    });
  });
  await safeNotify('updated', async () => {
    const after = await getActivitySnapshot(id);
    if (before && after) {
      await notifyActivityChanges(before, after, { notifyRegistered: options.notifyRegistered ?? false });
    }
  });
  return updated;
}
```

- [ ] **Step 5: 跑 service 測試確認通過**

Run: `npx vitest run src/lib/services/activityNotifyService.test.ts src/lib/services/activityService.test.ts`
Expected: PASS

- [ ] **Step 6: 寫失敗測試（route）**

`src/app/api/activities/[id]/route.test.ts`：import 區改為

```ts
import { PUT } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createActivity, registerForActivity } from '@/lib/services/activityService';
```

在 `describe('PUT /api/activities/:id', () => {` 區塊內最後加：

```ts
  it('notifyRegistered: true 才通知已報名學生（沒帶視為 false）', async () => {
    const teacher = await createTeacher({ name: '師', email: `nt${Date.now()}@x.com`, password: 'pw', subjects: '棋' });
    const category = await prisma.activityCategory.create({ data: { name: `nc${Date.now()}` } });
    const student = await createStudent({ name: '生', email: `ns${Date.now()}@x.com` });
    const activity = await createActivity({
      title: 'a',
      description: 'd',
      categoryId: category.id,
      startDate: new Date('2099-01-10'),
      endDate: new Date('2099-01-10'),
      capacity: 5,
      teacherIds: [teacher.id],
    });
    await registerForActivity(activity.id, student.id);
    const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
    const base = {
      title: 'a',
      description: 'd',
      categoryId: category.id,
      startDate: '2099-01-10',
      endDate: '2099-01-10',
      capacity: 5,
      teacherIds: [teacher.id],
    };
    asAdmin();
    await PUT(putReq(activity.id, base), { params: { id: activity.id } });
    expect(await prisma.notification.count({ where: { userId } })).toBe(0);
    await PUT(putReq(activity.id, { ...base, notifyRegistered: true }), { params: { id: activity.id } });
    expect(await prisma.notification.count({ where: { userId, title: '活動資訊更新' } })).toBe(1);
  });
```

- [ ] **Step 7: 跑測試確認失敗**

Run: `npx vitest run "src/app/api/activities/[id]/route.test.ts"`
Expected: FAIL——新測試第二個 count 為 0。

- [ ] **Step 8: 改 PUT route**

`src/app/api/activities/[id]/route.ts` 的 `updateActivity(...)` 呼叫改為：

```ts
  const updated = await updateActivity(
    params.id,
    {
      title: body.title,
      description: body.description,
      categoryId: body.categoryId,
      location: body.location || undefined,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      capacity: Number(body.capacity),
      teacherIds,
    },
    { notifyRegistered: body.notifyRegistered === true }
  );
```

- [ ] **Step 9: 跑測試確認通過＋型別檢查**

Run: `npx vitest run "src/app/api/activities/[id]/route.test.ts" && npx tsc --noEmit`
Expected: PASS；tsc 無錯誤。

- [ ] **Step 10: Commit**

```bash
git add src/lib/services/activityNotifyService.ts src/lib/services/activityNotifyService.test.ts src/lib/services/activityService.ts "src/app/api/activities/[id]/route.ts" "src/app/api/activities/[id]/route.test.ts"
git commit -m "feat: 編輯活動通知老師增減＋勾選通知已報名者

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 刪除活動＋行政代報名／移除報名通知

**Files:**
- Modify: `src/lib/services/activityNotifyService.ts`（新增 `locationSuffix`、`notifyActivityCancelled`、`notifyAdminRegistered`、`notifyAdminRemoved`）
- Modify: `src/lib/services/activityService.ts`（`deleteActivity`、`adminRegisterStudent`、`adminRemoveRegistration`）
- Test: `src/lib/services/activityNotifyService.test.ts`

**Interfaces:**
- Consumes（Task 1）：`ActivitySnapshot`、`getActivitySnapshot`、`safeNotify`、`isEnded`、`dateRange`、URL 常數
- Produces：`notifyActivityCancelled(s: ActivitySnapshot)`、`notifyAdminRegistered(s: ActivitySnapshot, studentUserId: string)`、`notifyAdminRemoved(s: ActivitySnapshot, studentUserId: string)`（皆 `Promise<void>`）；模組內 helper `locationSuffix(s)`（Task 4 也用）

- [ ] **Step 1: 寫失敗測試**

`src/lib/services/activityNotifyService.test.ts`：import 改為

```ts
import {
  createActivity,
  createCategory,
  CreateActivityInput,
  registerForActivity,
  cancelRegistration,
  updateActivity,
  deleteActivity,
  adminRegisterStudent,
  adminRemoveRegistration,
} from './activityService';
```

檔尾加：

```ts
describe('刪除活動與行政代報名／移除通知', () => {
  it('刪除未結束活動：已報名學生與帶隊老師收到「活動取消」', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await deleteActivity(a.id);
    const body = `「冬令營」已取消，原訂 ${formatActivityDateRange(FUTURE, FUTURE)}`;
    expect(await inbox(f.users.s1)).toEqual([{ title: '活動取消', body, url: S_URL }]);
    expect(await inbox(f.users.t1)).toEqual([{ title: '活動取消', body, url: T_URL }]);
    expect(await inbox(f.users.s2)).toEqual([]);
  });

  it('刪除已結束活動不發通知', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: PAST, endDate: PAST }));
    await registerForActivity(a.id, f.s1.id);
    await deleteActivity(a.id);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('行政代報名：學生收到「活動報名成功」含地點', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await clearInbox();
    await adminRegisterStudent(a.id, f.s1.id);
    expect(await inbox(f.users.s1)).toEqual([
      {
        title: '活動報名成功',
        body: `行政已幫你報名「冬令營」，${formatActivityDateRange(FUTURE, FUTURE)}，地點：活動中心`,
        url: S_URL,
      },
    ]);
  });

  it('行政代報名：活動沒有地點時不帶地點字樣', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { location: undefined }));
    await clearInbox();
    await adminRegisterStudent(a.id, f.s1.id);
    expect(await inbox(f.users.s1)).toEqual([
      { title: '活動報名成功', body: `行政已幫你報名「冬令營」，${formatActivityDateRange(FUTURE, FUTURE)}`, url: S_URL },
    ]);
  });

  it('行政移除報名：學生收到「活動報名已取消」', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    const reg = await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await adminRemoveRegistration(reg.id);
    expect(await inbox(f.users.s1)).toEqual([
      {
        title: '活動報名已取消',
        body: `行政已取消你「冬令營」的報名，原訂 ${formatActivityDateRange(FUTURE, FUTURE)}`,
        url: S_URL,
      },
    ]);
  });

  it('學生自己報名／取消不發任何通知', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await clearInbox();
    const reg = await registerForActivity(a.id, f.s1.id);
    await cancelRegistration(reg.id, f.s1.id);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('已結束活動的代報名／移除不發通知', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: PAST, endDate: PAST }));
    const reg = await adminRegisterStudent(a.id, f.s1.id);
    await adminRemoveRegistration(reg.id);
    expect(await prisma.notification.count()).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/activityNotifyService.test.ts`
Expected: FAIL——「活動取消」「活動報名成功」「活動報名已取消」三類收件夾為空。

- [ ] **Step 3: 新增三個通知函式**

`src/lib/services/activityNotifyService.ts` 在 `dateRange` 函式下方加：

```ts
function locationSuffix(s: ActivitySnapshot): string {
  return s.location ? `，地點：${s.location}` : '';
}
```

檔尾加：

```ts
// s 是刪除「前」抓的快照：刪完就查不到報名學生與帶隊老師了
export async function notifyActivityCancelled(s: ActivitySnapshot): Promise<void> {
  if (isEnded(s)) return;
  const body = `「${s.title}」已取消，原訂 ${dateRange(s)}`;
  await notifyUsers(s.studentUserIds, { title: '活動取消', body, url: STUDENT_ACTIVITY_URL });
  await notifyUsers(
    s.teachers.map((t) => t.userId),
    { title: '活動取消', body, url: TEACHER_ACTIVITY_URL }
  );
}

export async function notifyAdminRegistered(s: ActivitySnapshot, studentUserId: string): Promise<void> {
  if (isEnded(s)) return;
  await notifyUsers([studentUserId], {
    title: '活動報名成功',
    body: `行政已幫你報名「${s.title}」，${dateRange(s)}${locationSuffix(s)}`,
    url: STUDENT_ACTIVITY_URL,
  });
}

export async function notifyAdminRemoved(s: ActivitySnapshot, studentUserId: string): Promise<void> {
  if (isEnded(s)) return;
  await notifyUsers([studentUserId], {
    title: '活動報名已取消',
    body: `行政已取消你「${s.title}」的報名，原訂 ${dateRange(s)}`,
    url: STUDENT_ACTIVITY_URL,
  });
}
```

- [ ] **Step 4: 改 activityService 三個函式**

`src/lib/services/activityService.ts` 的 import 改為：

```ts
import {
  getActivitySnapshot,
  notifyActivityCancelled,
  notifyActivityChanges,
  notifyActivityCreated,
  notifyAdminRegistered,
  notifyAdminRemoved,
  safeNotify,
} from './activityNotifyService';
```

`adminRemoveRegistration` 換成：

```ts
export async function adminRemoveRegistration(id: string) {
  // 刪除前先記下活動與學生，刪完才能通知
  const registration = await prisma.activityRegistration.findUnique({
    where: { id },
    select: { activityId: true, student: { select: { userId: true } } },
  });
  await prisma.activityRegistration.delete({ where: { id } });
  if (!registration) return;
  await safeNotify('adminRemoved', async () => {
    const snapshot = await getActivitySnapshot(registration.activityId);
    if (snapshot) await notifyAdminRemoved(snapshot, registration.student.userId);
  });
}
```

`adminRegisterStudent`（保留上方註解）換成：

```ts
export async function adminRegisterStudent(activityId: string, studentId: string) {
  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity) throw new Error('NOT_FOUND');
  const registration = await prisma.activityRegistration
    .create({ data: { activityId, studentId } })
    .catch((err: unknown) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new Error('ALREADY_REGISTERED');
      throw err;
    });
  await safeNotify('adminRegistered', async () => {
    const snapshot = await getActivitySnapshot(activityId);
    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { userId: true } });
    if (snapshot && student) await notifyAdminRegistered(snapshot, student.userId);
  });
  return registration;
}
```

`deleteActivity`（保留上方註解）換成：

```ts
export async function deleteActivity(id: string) {
  const attendanceCount = await prisma.activityAttendance.count({ where: { activityId: id } });
  if (attendanceCount > 0) {
    throw new Error('ACTIVITY_HAS_ATTENDANCE');
  }
  // 刪除前抓快照：刪完就查不到報名學生與帶隊老師，無法通知
  const snapshot = await getActivitySnapshot(id).catch(() => null);
  const images = await prisma.activityImage.findMany({ where: { activityId: id }, select: { storagePath: true } });
  await prisma.$transaction([
    prisma.activityImage.deleteMany({ where: { activityId: id } }),
    prisma.activityRegistration.deleteMany({ where: { activityId: id } }),
    prisma.activityTeacher.deleteMany({ where: { activityId: id } }),
    prisma.activity.delete({ where: { id } }),
  ]);
  try {
    await deleteActivityImages(images.map((i) => i.storagePath));
  } catch {}
  if (snapshot) await safeNotify('cancelled', () => notifyActivityCancelled(snapshot));
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/lib/services/activityNotifyService.test.ts src/lib/services/activityService.test.ts "src/app/api/activities/[id]/route.test.ts" && npx tsc --noEmit`
Expected: PASS；tsc 無錯誤。

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/activityNotifyService.ts src/lib/services/activityNotifyService.test.ts src/lib/services/activityService.ts
git commit -m "feat: 刪除活動與行政代報名／移除報名通知

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 行前提醒（每日 cron）

**Files:**
- Modify: `src/lib/services/activityNotifyService.ts`（新增 `sendActivityDayBeforeReminders`）
- Modify: `src/app/api/cron/daily-reminders/route.ts`
- Test: `src/lib/services/activityNotifyService.test.ts`、`src/app/api/cron/daily-reminders/route.test.ts`

**Interfaces:**
- Consumes：`getActivitySnapshot`、`locationSuffix`（Task 3）、URL 常數
- Produces：`sendActivityDayBeforeReminders(now?: Date): Promise<{ activities: number; notified: number }>`；cron 結果鍵名 `activityDayBefore`

- [ ] **Step 1: 寫失敗測試（service）**

`src/lib/services/activityNotifyService.test.ts` 頂部 import 加：

```ts
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { sendActivityDayBeforeReminders } from './activityNotifyService';
```

檔尾加：

```ts
describe('sendActivityDayBeforeReminders', () => {
  // 台北 2026-10-01 10:00 → 「明天」＝ 10/2
  const NOW = new Date('2026-10-01T02:00:00Z');
  const oct = (day: number) => new Date(Date.UTC(2026, 9, day));

  it('單日活動：已報名學生與帶隊老師收到行前提醒', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: oct(2), endDate: oct(2) }));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    expect(await sendActivityDayBeforeReminders(NOW)).toEqual({ activities: 1, notified: 2 });
    const start = formatDateWithWeekday(oct(2));
    expect(await inbox(f.users.s1)).toEqual([
      { title: '活動行前提醒', body: `明天 ${start} 是「冬令營」，地點：活動中心，記得準時參加`, url: S_URL },
    ]);
    expect(await inbox(f.users.t1)).toEqual([
      { title: '活動行前提醒', body: `明天 ${start} 帶領「冬令營」，目前報名 1 人，地點：活動中心`, url: T_URL },
    ]);
    expect(await inbox(f.users.s2)).toEqual([]);
  });

  it('多日活動：學生文案寫「明天開始，至結束日」；沒地點不帶地點字樣', async () => {
    const f = await setup();
    const a = await createActivity(
      input(f.category.id, [f.t1.id], { startDate: oct(2), endDate: oct(4), location: undefined })
    );
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await sendActivityDayBeforeReminders(NOW);
    expect(await inbox(f.users.s1)).toEqual([
      {
        title: '活動行前提醒',
        body: `「冬令營」明天 ${formatDateWithWeekday(oct(2))} 開始，至 ${formatDateWithWeekday(oct(4))}`,
        url: S_URL,
      },
    ]);
  });

  it('沒人報名時老師仍收到（目前報名 0 人）', async () => {
    const f = await setup();
    await createActivity(input(f.category.id, [f.t1.id], { startDate: oct(2), endDate: oct(2), location: undefined }));
    await clearInbox();
    expect(await sendActivityDayBeforeReminders(NOW)).toEqual({ activities: 1, notified: 1 });
    expect(await inbox(f.users.t1)).toEqual([
      { title: '活動行前提醒', body: `明天 ${formatDateWithWeekday(oct(2))} 帶領「冬令營」，目前報名 0 人`, url: T_URL },
    ]);
  });

  it('只看第一天：今天開始、明天仍在進行的活動不提醒', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: oct(1), endDate: oct(3) }));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    expect(await sendActivityDayBeforeReminders(NOW)).toEqual({ activities: 0, notified: 0 });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('「明天」以台北日期計算：UTC 還是 9/30、台北已是 10/1 凌晨時，明天＝10/2', async () => {
    const f = await setup();
    await createActivity(input(f.category.id, [f.t1.id], { title: '明天的', startDate: oct(2), endDate: oct(2) }));
    await createActivity(input(f.category.id, [f.t1.id], { title: '今天的', startDate: oct(1), endDate: oct(1) }));
    await clearInbox();
    const result = await sendActivityDayBeforeReminders(new Date('2026-09-30T17:00:00Z'));
    expect(result.activities).toBe(1);
    const bodies = (await inbox(f.users.t1)).map((n) => n.body);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('「明天的」');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/activityNotifyService.test.ts`
Expected: FAIL——`sendActivityDayBeforeReminders is not a function`。

- [ ] **Step 3: 實作 sendActivityDayBeforeReminders**

`src/lib/services/activityNotifyService.ts` 頂部 import 加：

```ts
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { taipeiDateKey } from '@/lib/taipeiDate';
```

檔尾加：

```ts
// 行前提醒：活動「第一天」＝台北明天才提醒——天然只發一次、不需旗標
// （比照補課前一天提醒：cron 當天沒跑就永久跳過，spec 接受）
export async function sendActivityDayBeforeReminders(
  now: Date = new Date()
): Promise<{ activities: number; notified: number }> {
  const [y, m, d] = taipeiDateKey(now).split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
  const activities = await prisma.activity.findMany({ where: { startDate: tomorrow }, select: { id: true } });
  let notified = 0;
  for (const { id } of activities) {
    const s = await getActivitySnapshot(id);
    if (!s) continue;
    const start = formatDateWithWeekday(s.startDate);
    const loc = locationSuffix(s);
    const multiDay = s.startDate.getTime() !== s.endDate.getTime();
    const studentBody = multiDay
      ? `「${s.title}」明天 ${start} 開始，至 ${formatDateWithWeekday(s.endDate)}${loc}`
      : `明天 ${start} 是「${s.title}」${loc}，記得準時參加`;
    await notifyUsers(s.studentUserIds, { title: '活動行前提醒', body: studentBody, url: STUDENT_ACTIVITY_URL });
    const teacherUserIds = s.teachers.map((t) => t.userId);
    await notifyUsers(teacherUserIds, {
      title: '活動行前提醒',
      body: `明天 ${start} 帶領「${s.title}」，目前報名 ${s.studentUserIds.length} 人${loc}`,
      url: TEACHER_ACTIVITY_URL,
    });
    notified += s.studentUserIds.length + teacherUserIds.length;
  }
  return { activities: activities.length, notified };
}
```

- [ ] **Step 4: 跑 service 測試確認通過**

Run: `npx vitest run src/lib/services/activityNotifyService.test.ts`
Expected: PASS

- [ ] **Step 5: 寫失敗測試（cron）**

`src/app/api/cron/daily-reminders/route.test.ts` 第二個測試的斷言最後加一行：

```ts
    expect(data.activityDayBefore).toEqual({ activities: 0, notified: 0 });
```

Run: `npx vitest run src/app/api/cron/daily-reminders/route.test.ts`
Expected: FAIL——`data.activityDayBefore` 為 undefined。

- [ ] **Step 6: 掛進 cron**

`src/app/api/cron/daily-reminders/route.ts` import 區加：

```ts
import { sendActivityDayBeforeReminders } from '@/lib/services/activityNotifyService';
```

`jobs` 陣列最後加一項：

```ts
    ['activityDayBefore', () => sendActivityDayBeforeReminders()],
```

並把註解「七個子任務循序跑在同一次呼叫」改成「八個子任務循序跑在同一次呼叫」。

- [ ] **Step 7: 跑測試確認通過**

Run: `npx vitest run src/app/api/cron/daily-reminders/route.test.ts && npx tsc --noEmit`
Expected: PASS；tsc 無錯誤。

- [ ] **Step 8: Commit**

```bash
git add src/lib/services/activityNotifyService.ts src/lib/services/activityNotifyService.test.ts src/app/api/cron/daily-reminders/route.ts src/app/api/cron/daily-reminders/route.test.ts
git commit -m "feat: 活動行前提醒掛進每日 cron

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 手動推播 service＋API＋發送紀錄

**Files:**
- Create: `src/lib/activityAnnouncement.ts`（client／server 共用常數，不可 import 任何 server-only 模組）
- Modify: `src/lib/services/activityNotifyService.ts`（`sendActivityAnnouncement`、`listActivityAnnouncements`）
- Modify: `src/lib/services/activityService.ts`（`deleteActivity` 一併清發送紀錄）
- Create: `src/app/api/activities/[id]/announcements/route.ts`
- Test: `src/lib/services/activityNotifyService.test.ts`、Create `src/app/api/activities/[id]/announcements/route.test.ts`

**Interfaces:**
- Produces（`src/lib/activityAnnouncement.ts`）：`ANNOUNCEMENT_MAX_LENGTH = 200`、`ANNOUNCEMENT_AUDIENCES = ['REGISTERED', 'ALL_STUDENTS'] as const`、`type AnnouncementAudience`、`isAnnouncementAudience(v: unknown): v is AnnouncementAudience`
- Produces（service）：
  - `interface SendAnnouncementInput { activityId: string; senderId: string; audience: AnnouncementAudience; includeTeachers: boolean; message: string }`
  - `sendActivityAnnouncement(input): Promise<{ recipientCount: number }>`（丟 `NOT_FOUND`／`NO_RECIPIENTS`）
  - `listActivityAnnouncements(activityId): Promise<{ id; createdAt: Date; audience; includeTeachers; message; recipientCount; sender: { name: string } }[]>`（新到舊）
- Produces（API）：`GET /api/activities/[id]/announcements` → 陣列；`POST` body `{ audience, includeTeachers, message }` → 201 `{ recipientCount }`；錯誤 JSON `{ error: 'INVALID_INPUT' | 'INVALID_AUDIENCE' | 'MESSAGE_REQUIRED' | 'MESSAGE_TOO_LONG' | 'NOT_FOUND' | 'NO_RECIPIENTS' | 'INTERNAL' }`

- [ ] **Step 1: 建共用常數檔**

Create `src/lib/activityAnnouncement.ts`：

```ts
// 活動手動推播的共用常數：前端彈窗與 API 驗證共用，刻意不 import 任何
// server-only 模組（Prisma 等），'use client' 元件才能直接引用。
export const ANNOUNCEMENT_MAX_LENGTH = 200;

export const ANNOUNCEMENT_AUDIENCES = ['REGISTERED', 'ALL_STUDENTS'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export function isAnnouncementAudience(v: unknown): v is AnnouncementAudience {
  return typeof v === 'string' && (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(v);
}
```

- [ ] **Step 2: 寫失敗測試（service）**

`src/lib/services/activityNotifyService.test.ts` 的 `./activityNotifyService` import 改為：

```ts
import {
  sendActivityDayBeforeReminders,
  sendActivityAnnouncement,
  listActivityAnnouncements,
} from './activityNotifyService';
```

檔尾加：

```ts
describe('手動推播 sendActivityAnnouncement', () => {
  function createAdmin() {
    return prisma.user.create({ data: { name: '王行政', email: 'admin@example.com', password: 'x', role: 'ADMIN' } });
  }

  it('對象＝已報名學生：只通知已報名者，並寫一筆發送紀錄', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    const result = await sendActivityAnnouncement({
      activityId: a.id,
      senderId: admin.id,
      audience: 'REGISTERED',
      includeTeachers: false,
      message: '明天記得帶水壺',
    });
    expect(result).toEqual({ recipientCount: 1 });
    expect(await inbox(f.users.s1)).toEqual([{ title: '活動通知：冬令營', body: '明天記得帶水壺', url: S_URL }]);
    expect(await inbox(f.users.s2)).toEqual([]);
    expect(await inbox(f.users.t1)).toEqual([]);
    const log = await listActivityAnnouncements(a.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      audience: 'REGISTERED',
      includeTeachers: false,
      message: '明天記得帶水壺',
      recipientCount: 1,
      sender: { name: '王行政' },
    });
  });

  it('對象＝全體學生＋含老師：全體學生與帶隊老師都收到', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await clearInbox();
    const result = await sendActivityAnnouncement({
      activityId: a.id,
      senderId: admin.id,
      audience: 'ALL_STUDENTS',
      includeTeachers: true,
      message: '名額剩 3 位',
    });
    expect(result).toEqual({ recipientCount: 3 });
    expect(await inbox(f.users.s1)).toEqual([{ title: '活動通知：冬令營', body: '名額剩 3 位', url: S_URL }]);
    expect(await inbox(f.users.s2)).toEqual([{ title: '活動通知：冬令營', body: '名額剩 3 位', url: S_URL }]);
    expect(await inbox(f.users.t1)).toEqual([{ title: '活動通知：冬令營', body: '名額剩 3 位', url: T_URL }]);
    expect(await inbox(f.users.t2)).toEqual([]);
  });

  it('已結束的活動也能手動推播', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: PAST, endDate: PAST }));
    await registerForActivity(a.id, f.s1.id);
    const result = await sendActivityAnnouncement({
      activityId: a.id,
      senderId: admin.id,
      audience: 'REGISTERED',
      includeTeachers: false,
      message: '活動照片已上傳到相簿',
    });
    expect(result).toEqual({ recipientCount: 1 });
    expect(await inbox(f.users.s1)).toHaveLength(1);
  });

  it('收件人 0 人時丟 NO_RECIPIENTS，且不寫紀錄、不發通知', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await clearInbox();
    await expect(
      sendActivityAnnouncement({ activityId: a.id, senderId: admin.id, audience: 'REGISTERED', includeTeachers: false, message: 'x' })
    ).rejects.toThrow('NO_RECIPIENTS');
    expect(await listActivityAnnouncements(a.id)).toEqual([]);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('只勾老師（沒人報名）也能送：只通知帶隊老師', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await clearInbox();
    const result = await sendActivityAnnouncement({
      activityId: a.id,
      senderId: admin.id,
      audience: 'REGISTERED',
      includeTeachers: true,
      message: '集合時間提早',
    });
    expect(result).toEqual({ recipientCount: 1 });
    expect(await inbox(f.users.t1)).toHaveLength(1);
  });

  it('活動不存在時丟 NOT_FOUND', async () => {
    const admin = await createAdmin();
    await expect(
      sendActivityAnnouncement({ activityId: 'nope', senderId: admin.id, audience: 'ALL_STUDENTS', includeTeachers: false, message: 'x' })
    ).rejects.toThrow('NOT_FOUND');
  });

  it('發送紀錄新到舊排序', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    const base = { activityId: a.id, senderId: admin.id, audience: 'REGISTERED' as const, includeTeachers: false, recipientCount: 1 };
    await prisma.activityAnnouncement.create({ data: { ...base, message: '舊', createdAt: new Date('2099-01-01T01:00:00Z') } });
    await prisma.activityAnnouncement.create({ data: { ...base, message: '新', createdAt: new Date('2099-01-02T01:00:00Z') } });
    expect((await listActivityAnnouncements(a.id)).map((r) => r.message)).toEqual(['新', '舊']);
  });

  it('刪除活動時一併清掉發送紀錄', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await sendActivityAnnouncement({ activityId: a.id, senderId: admin.id, audience: 'REGISTERED', includeTeachers: false, message: 'x' });
    await deleteActivity(a.id);
    expect(await prisma.activityAnnouncement.count()).toBe(0);
    expect(await prisma.activity.count()).toBe(0);
  });
});
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/activityNotifyService.test.ts`
Expected: FAIL——`sendActivityAnnouncement is not a function`。

- [ ] **Step 4: 實作 service**

`src/lib/services/activityNotifyService.ts` 頂部 import 加：

```ts
import type { AnnouncementAudience } from '@/lib/activityAnnouncement';
```

檔尾加：

```ts
export interface SendAnnouncementInput {
  activityId: string;
  senderId: string;
  audience: AnnouncementAudience;
  includeTeachers: boolean;
  message: string;
}

// 行政手動推播：已結束的活動也能送（例如「照片已上傳到相簿」）。
// 順序＝算收件人 → 先寫發送紀錄 → 才發通知；紀錄寫失敗就整個不送
// （寧可沒送，不要送了沒紀錄）。
export async function sendActivityAnnouncement(input: SendAnnouncementInput): Promise<{ recipientCount: number }> {
  const s = await getActivitySnapshot(input.activityId);
  if (!s) throw new Error('NOT_FOUND');
  const studentUserIds = Array.from(
    new Set(input.audience === 'ALL_STUDENTS' ? await allStudentUserIds() : s.studentUserIds)
  );
  const teacherUserIds = input.includeTeachers
    ? Array.from(new Set(s.teachers.map((t) => t.userId))).filter((id) => !studentUserIds.includes(id))
    : [];
  const recipientCount = studentUserIds.length + teacherUserIds.length;
  if (recipientCount === 0) throw new Error('NO_RECIPIENTS');

  await prisma.activityAnnouncement.create({
    data: {
      activityId: s.id,
      senderId: input.senderId,
      audience: input.audience,
      includeTeachers: input.includeTeachers,
      message: input.message,
      recipientCount,
    },
  });
  const title = `活動通知：${s.title}`;
  await notifyUsers(studentUserIds, { title, body: input.message, url: STUDENT_ACTIVITY_URL });
  await notifyUsers(teacherUserIds, { title, body: input.message, url: TEACHER_ACTIVITY_URL });
  return { recipientCount };
}

export function listActivityAnnouncements(activityId: string) {
  return prisma.activityAnnouncement.findMany({
    where: { activityId },
    select: {
      id: true,
      createdAt: true,
      audience: true,
      includeTeachers: true,
      message: true,
      recipientCount: true,
      sender: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}
```

- [ ] **Step 5: deleteActivity 一併清發送紀錄**

`src/lib/services/activityService.ts` 的 `deleteActivity` transaction 陣列，在 `prisma.activity.delete(...)` 那行**之前**加一行：

```ts
    prisma.activityAnnouncement.deleteMany({ where: { activityId: id } }),
```

並把函式上方註解第二句改成：`Registrations/teacher assignments/images/announcements are current state, not history, so they're cleared as part of the delete.`

- [ ] **Step 6: 跑 service 測試確認通過**

Run: `npx vitest run src/lib/services/activityNotifyService.test.ts src/lib/services/activityService.test.ts`
Expected: PASS

- [ ] **Step 7: 寫失敗測試（route）**

Create `src/app/api/activities/[id]/announcements/route.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(),
  createSignedUrls: vi.fn(async () => new Map()),
  createSignedThumbUrls: vi.fn(async () => new Map()),
  deleteActivityImages: vi.fn(async () => {}),
}));

import { GET, POST } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createActivity, registerForActivity } from '@/lib/services/activityService';

async function fixture() {
  const admin = await prisma.user.create({ data: { name: '王行政', email: 'admin@example.com', password: 'x', role: 'ADMIN' } });
  const teacher = await createTeacher({ name: '陳老師', email: 't1@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '王小明', email: 's1@example.com' });
  const category = await prisma.activityCategory.create({ data: { name: '營隊' } });
  const activity = await createActivity({
    title: '冬令營',
    description: 'd',
    categoryId: category.id,
    startDate: new Date('2099-01-10'),
    endDate: new Date('2099-01-10'),
    capacity: 20,
    teacherIds: [teacher.id],
  });
  return { admin, student, activity };
}

function postReq(id: string, payload: unknown) {
  return new NextRequest(`http://x/api/activities/${id}/announcements`, {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}
const getReq = (id: string) => new NextRequest(`http://x/api/activities/${id}/announcements`);
const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
  sessionMock.mockReset();
});

describe('/api/activities/:id/announcements', () => {
  it('403：未登入或非行政（GET 與 POST）', async () => {
    const { activity } = await fixture();
    sessionMock.mockResolvedValue(null);
    expect((await GET(getReq(activity.id), ctx(activity.id))).status).toBe(403);
    sessionMock.mockResolvedValue({ user: { id: 'u', role: 'TEACHER' } });
    expect((await POST(postReq(activity.id, {}), ctx(activity.id))).status).toBe(403);
  });

  it('400：JSON 壞掉、對象不合法、內容空白、超過 200 字', async () => {
    const { admin, activity } = await fixture();
    sessionMock.mockResolvedValue({ user: { id: admin.id, role: 'ADMIN' } });
    const cases: [unknown, string][] = [
      ['{not json', 'INVALID_INPUT'],
      [{ audience: 'EVERYONE', includeTeachers: false, message: 'x' }, 'INVALID_AUDIENCE'],
      [{ audience: 'REGISTERED', includeTeachers: false, message: '   ' }, 'MESSAGE_REQUIRED'],
      [{ audience: 'REGISTERED', includeTeachers: false, message: '字'.repeat(201) }, 'MESSAGE_TOO_LONG'],
    ];
    for (const [payload, error] of cases) {
      const res = await POST(postReq(activity.id, payload), ctx(activity.id));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
  });

  it('404：活動不存在；409：收件人 0 人', async () => {
    const { admin, activity } = await fixture();
    sessionMock.mockResolvedValue({ user: { id: admin.id, role: 'ADMIN' } });
    const payload = { audience: 'REGISTERED', includeTeachers: false, message: 'x' };
    const notFound = await POST(postReq('nope', payload), ctx('nope'));
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ error: 'NOT_FOUND' });
    const empty = await POST(postReq(activity.id, payload), ctx(activity.id));
    expect(empty.status).toBe(409);
    expect(await empty.json()).toEqual({ error: 'NO_RECIPIENTS' });
  });

  it('201：去頭尾空白後送出，GET 看得到紀錄', async () => {
    const { admin, student, activity } = await fixture();
    await registerForActivity(activity.id, student.id);
    sessionMock.mockResolvedValue({ user: { id: admin.id, role: 'ADMIN' } });
    const res = await POST(
      postReq(activity.id, { audience: 'REGISTERED', includeTeachers: false, message: '  明天記得帶水壺  ' }),
      ctx(activity.id)
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ recipientCount: 1 });
    const list = await (await GET(getReq(activity.id), ctx(activity.id))).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ message: '明天記得帶水壺', recipientCount: 1, sender: { name: '王行政' } });
  });
});
```

- [ ] **Step 8: 跑測試確認失敗**

Run: `npx vitest run "src/app/api/activities/[id]/announcements/route.test.ts"`
Expected: FAIL——找不到 `./route` 模組。

- [ ] **Step 9: 實作 route**

Create `src/app/api/activities/[id]/announcements/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ANNOUNCEMENT_MAX_LENGTH, isAnnouncementAudience } from '@/lib/activityAnnouncement';
import { listActivityAnnouncements, sendActivityAnnouncement } from '@/lib/services/activityNotifyService';

// 對象選「全體學生」時要逐筆推播，給足背景推播時間（比照 admin/billing/notify）
export const maxDuration = 60;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listActivityAnnouncements(params.id));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  const audience = body.audience;
  if (!isAnnouncementAudience(audience)) {
    return NextResponse.json({ error: 'INVALID_AUDIENCE' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'MESSAGE_REQUIRED' }, { status: 400 });
  if (message.length > ANNOUNCEMENT_MAX_LENGTH) {
    return NextResponse.json({ error: 'MESSAGE_TOO_LONG' }, { status: 400 });
  }
  try {
    const result = await sendActivityAnnouncement({
      activityId: params.id,
      senderId: session.user.id,
      audience,
      includeTeachers: body.includeTeachers === true,
      message,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'NOT_FOUND') return NextResponse.json({ error: code }, { status: 404 });
    if (code === 'NO_RECIPIENTS') return NextResponse.json({ error: code }, { status: 409 });
    console.error('POST /api/activities/[id]/announcements failed', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
```

- [ ] **Step 10: 跑測試確認通過＋型別檢查**

Run: `npx vitest run "src/app/api/activities/[id]/announcements/route.test.ts" && npx tsc --noEmit`
Expected: PASS；tsc 無錯誤。

- [ ] **Step 11: Commit**

```bash
git add src/lib/activityAnnouncement.ts src/lib/services/activityNotifyService.ts src/lib/services/activityNotifyService.test.ts src/lib/services/activityService.ts "src/app/api/activities/[id]/announcements/route.ts" "src/app/api/activities/[id]/announcements/route.test.ts"
git commit -m "feat: 活動手動推播 API＋發送紀錄

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 後台勾選框、刪除確認文字、鈴鐺活動圖示

**Files:**
- Modify: `src/app/admin/activities/page.tsx`
- Modify: `src/components/ui/NotificationBell.tsx`

**Interfaces:**
- Consumes：`POST /api/activities` 的 `notifyStudents`（Task 1）、`PUT /api/activities/[id]` 的 `notifyRegistered`（Task 2）、`isBeforeToday`（`@/lib/pastDate`，client 可用）

- [ ] **Step 1: 新增表單勾選框（預設勾）**

`src/app/admin/activities/page.tsx`：

import 區加：

```ts
import { isBeforeToday } from '@/lib/pastDate';
```

state 區（`const [submitting, setSubmitting] = useState(false);` 下一行）加：

```ts
  const [notifyStudentsOnCreate, setNotifyStudentsOnCreate] = useState(true);
  const [notifyRegisteredOnEdit, setNotifyRegisteredOnEdit] = useState(false);
```

`handleSubmit` 的 fetch body 改為：

```ts
        body: JSON.stringify({ ...form, capacity: Number(form.capacity), notifyStudents: notifyStudentsOnCreate }),
```

同函式成功分支 `setForm(EMPTY_ACTIVITY_FORM);` 下一行加：

```ts
      setNotifyStudentsOnCreate(true);
```

新增表單中 `{formError && <p className="text-sm text-rejected">{formError}</p>}` 的**上一行**加：

```tsx
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={notifyStudentsOnCreate}
                onChange={(e) => setNotifyStudentsOnCreate(e.target.checked)}
              />
              發布後通知全體學生
            </label>
```

- [ ] **Step 2: 編輯彈窗勾選框（預設不勾）**

`openEdit` 內 `setEditError('');` 下一行加：

```ts
    setNotifyRegisteredOnEdit(false);
```

`handleEditSubmit` 的 fetch body 改為：

```ts
        body: JSON.stringify({ ...editForm, capacity: Number(editForm.capacity), notifyRegistered: notifyRegisteredOnEdit }),
```

編輯彈窗 `{editError && <p className="text-sm text-rejected">{editError}</p>}` 的**上一行**加：

```tsx
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={notifyRegisteredOnEdit}
              onChange={(e) => setNotifyRegisteredOnEdit(e.target.checked)}
            />
            通知已報名學生與帶隊老師
            <span className="text-xs text-inkMuted">（目前報名 {editing?.registrations.length ?? 0} 人）</span>
          </label>
```

- [ ] **Step 3: 刪除確認文字**

`handleDeleteActivity` 內 `const confirmMessage = ...;` 整段換成：

```ts
    const registeredCount = viewing.registrations.length;
    const baseMessage =
      registeredCount > 0
        ? `已有 ${registeredCount} 人報名，刪除將一併取消他們的報名，確定嗎？`
        : '確定要刪除此活動嗎？';
    // 已結束的活動刪除時不發通知（與後端規則一致），就不提示
    const confirmMessage =
      registeredCount > 0 && !isBeforeToday(viewing.endDate)
        ? `${baseMessage}\n將通知 ${registeredCount} 位已報名學生與帶隊老師。`
        : baseMessage;
```

（`ConfirmModal` 的訊息是 `whitespace-pre-line`，`\n` 會換行。）

- [ ] **Step 4: 鈴鐺活動圖示**

`src/components/ui/NotificationBell.tsx` 的 `ICON_KINDS` 陣列**最後**加一項（放最後，不搶其他類別的比對）：

```ts
  { match: ['活動'], stroke: '#5fb8a8', bg: 'rgba(47,138,122,0.18)', icon: 'flag' },
```

`IconGlyph` 的 `switch` 在 `default:` 之前加：

```tsx
    case 'flag':
      return (
        <>
          <path d="M4 22V4" />
          <path d="M4 4h13l-2.5 4.5L17 13H4" />
        </>
      );
```

- [ ] **Step 5: 型別與 lint**

Run: `npx tsc --noEmit && npx next lint --file src/app/admin/activities/page.tsx --file src/components/ui/NotificationBell.tsx`
Expected: tsc 無錯誤；lint 無 error。

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/activities/page.tsx src/components/ui/NotificationBell.tsx
git commit -m "feat: 活動新增／編輯通知勾選框、刪除提示、鈴鐺活動圖示

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 通知紀錄區塊＋發送通知彈窗

**Files:**
- Modify: `src/lib/activityAnnouncement.ts`（新增 `AUDIENCE_LABEL`、`formatAnnouncementTime`）
- Create: `src/lib/activityAnnouncement.test.ts`
- Create: `src/components/ActivityAnnouncements.tsx`
- Modify: `src/components/ActivityDetail.tsx`（新增 `extraSection` 插槽）
- Modify: `src/app/admin/activities/page.tsx`（傳入插槽）

**Interfaces:**
- Consumes：Task 5 的 API 與 `ANNOUNCEMENT_MAX_LENGTH`、`AnnouncementAudience`
- Produces：`<ActivityAnnouncements activityId registeredCount teacherCount allStudentCount />`；`ActivityDetail` 新 prop `extraSection?: ReactNode`（報名名單下方、相簿上方）

- [ ] **Step 1: 寫失敗測試（時間格式）**

Create `src/lib/activityAnnouncement.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { formatAnnouncementTime, AUDIENCE_LABEL } from './activityAnnouncement';

describe('formatAnnouncementTime', () => {
  it('台北時間：日期（星期）＋ HH:mm', () => {
    expect(formatAnnouncementTime('2026-10-01T06:05:00Z')).toBe('2026/10/1（四） 14:05');
  });

  it('台北午夜顯示 00 不是 24（hourCycle h23）', () => {
    expect(formatAnnouncementTime('2026-09-30T16:30:00Z')).toBe('2026/10/1（四） 00:30');
  });
});

describe('AUDIENCE_LABEL', () => {
  it('兩種對象都有中文標籤', () => {
    expect(AUDIENCE_LABEL).toEqual({ REGISTERED: '已報名學生', ALL_STUDENTS: '全體學生' });
  });
});
```

Run: `npx vitest run src/lib/activityAnnouncement.test.ts`
Expected: FAIL——`formatAnnouncementTime` 不存在。

- [ ] **Step 2: 實作共用 helper**

`src/lib/activityAnnouncement.ts` 頂部加 import：

```ts
import { formatTimestampWithWeekdayTaipei } from './dateFormat';
```

檔尾加：

```ts
export const AUDIENCE_LABEL: Record<AnnouncementAudience, string> = {
  REGISTERED: '已報名學生',
  ALL_STUDENTS: '全體學生',
};

// hourCycle 明確指定 h23（Safari 的 hour12:false 可能落 h24）；用 formatToParts
// 組字，不依賴 zh-TW format() 的分隔字元
const TAIPEI_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Taipei',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatAnnouncementTime(date: Date | string): string {
  const parts = TAIPEI_TIME_FMT.formatToParts(new Date(date));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${formatTimestampWithWeekdayTaipei(date)} ${get('hour')}:${get('minute')}`;
}
```

Run: `npx vitest run src/lib/activityAnnouncement.test.ts`
Expected: PASS

- [ ] **Step 3: ActivityDetail 新增插槽**

`src/components/ActivityDetail.tsx`：

`ActivityDetailProps` 在 `footer?: ReactNode;` 上一行加：

```ts
  // 報名名單下方的額外區塊（行政端放「通知紀錄」）
  extraSection?: ReactNode;
```

元件參數解構 `footer,` 上一行加 `extraSection,`。

在報名名單區塊結尾（`<DataTable columns={rosterColumns} ... />` 所在 `<div>` 的結束 `</div>`）之後、`{!albumLoading && images.length === 0 && (` 之前加：

```tsx
        {extraSection}
```

- [ ] **Step 4: 建立 ActivityAnnouncements 元件**

Create `src/components/ActivityAnnouncements.tsx`：

```tsx
'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { Column } from '@/components/ui/DataTable';
import { useToast } from '@/components/ui/Toast';
import {
  ANNOUNCEMENT_MAX_LENGTH,
  AUDIENCE_LABEL,
  AnnouncementAudience,
  formatAnnouncementTime,
} from '@/lib/activityAnnouncement';

interface AnnouncementRow {
  id: string;
  createdAt: string;
  audience: AnnouncementAudience;
  includeTeachers: boolean;
  message: string;
  recipientCount: number;
  sender: { name: string };
}

interface ActivityAnnouncementsProps {
  activityId: string;
  registeredCount: number;
  teacherCount: number;
  allStudentCount: number;
}

const ERROR_TEXT: Record<string, string> = {
  INVALID_INPUT: '資料格式錯誤，請重新整理後再試',
  INVALID_AUDIENCE: '請選擇通知對象',
  MESSAGE_REQUIRED: '請輸入通知內容',
  MESSAGE_TOO_LONG: `通知內容不可超過 ${ANNOUNCEMENT_MAX_LENGTH} 字`,
  NOT_FOUND: '找不到這個活動，請重新整理',
  NO_RECIPIENTS: '沒有可通知的對象',
};

const columns: Column<AnnouncementRow>[] = [
  { header: '時間', render: (r) => formatAnnouncementTime(r.createdAt), sortValue: (r) => r.createdAt, width: 'w-44' },
  { header: '發送人', render: (r) => r.sender.name, width: 'w-24' },
  { header: '對象', render: (r) => `${AUDIENCE_LABEL[r.audience]}${r.includeTeachers ? '＋老師' : ''}`, width: 'w-32' },
  { header: '內容', render: (r) => <span className="whitespace-pre-wrap break-words">{r.message}</span> },
  { header: '人數', render: (r) => r.recipientCount, sortValue: (r) => r.recipientCount, width: 'w-16' },
];

// 行政端活動詳情的「通知紀錄」區塊：列出手動推播紀錄，並提供發送彈窗
export default function ActivityAnnouncements({
  activityId,
  registeredCount,
  teacherCount,
  allStudentCount,
}: ActivityAnnouncementsProps) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<AnnouncementAudience>('REGISTERED');
  const [includeTeachers, setIncludeTeachers] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    // stale guard：切換活動或重抓時，舊請求晚回來不得蓋掉新資料
    let cancelled = false;
    fetch(`/api/activities/${activityId}/announcements`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AnnouncementRow[]) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, refreshKey]);

  const studentCount = audience === 'ALL_STUDENTS' ? allStudentCount : registeredCount;
  const total = studentCount + (includeTeachers ? teacherCount : 0);

  function openModal() {
    setAudience('REGISTERED');
    setIncludeTeachers(false);
    setMessage('');
    setError('');
    setOpen(true);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const res = await fetch(`/api/activities/${activityId}/announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience, includeTeachers, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(ERROR_TEXT[data.error] ?? '發送失敗，請稍後再試');
        return;
      }
      showToast(`已通知 ${data.recipientCount} 人`);
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-inkMuted">通知紀錄（{rows.length}）</h3>
        <Button type="button" variant="link" className="text-xs" onClick={openModal}>
          發送通知
        </Button>
      </div>
      <CollapsibleDataTable
        columns={columns}
        rows={rows}
        keyField={(r) => r.id}
        maxRows={3}
        loading={loading}
        emptyText="尚未發送過通知"
      />

      <Modal open={open} onClose={() => setOpen(false)} title="發送活動通知">
        <form onSubmit={handleSend} className="flex flex-col gap-3">
          <div>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={ANNOUNCEMENT_MAX_LENGTH}
              placeholder="例：明天記得帶水壺"
              aria-label="通知內容"
              className="w-full"
            />
            <p className="mt-1 text-right text-xs text-inkMuted">
              {message.length}/{ANNOUNCEMENT_MAX_LENGTH}
            </p>
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium text-ink">通知對象</legend>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="audience" checked={audience === 'REGISTERED'} onChange={() => setAudience('REGISTERED')} />
              已報名學生（{registeredCount} 人）
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="audience" checked={audience === 'ALL_STUDENTS'} onChange={() => setAudience('ALL_STUDENTS')} />
              全體學生（{allStudentCount} 人）
            </label>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={includeTeachers} onChange={(e) => setIncludeTeachers(e.target.checked)} />
            同時通知帶隊老師（{teacherCount} 位）
          </label>
          {error && <p className="text-sm text-rejected">{error}</p>}
          <Button type="submit" loading={sending} disabled={total === 0 || !message.trim()}>
            發送給 {total} 人
          </Button>
        </form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 5: 後台頁接上插槽**

`src/app/admin/activities/page.tsx` import 區加：

```ts
import ActivityAnnouncements from '@/components/ActivityAnnouncements';
```

詳情彈窗的 `<ActivityDetail ...>`，在 `footer={` 屬性**上方**加：

```tsx
            extraSection={
              <ActivityAnnouncements
                activityId={viewing.id}
                registeredCount={viewing.registrations.length}
                teacherCount={viewing.teachers.length}
                allStudentCount={allStudents.length}
              />
            }
```

（`allStudents` 在開詳情彈窗時才抓 `/api/students`，載入前短暫顯示 0 人，屬預期。）

- [ ] **Step 6: 型別、lint、單元測試**

Run: `npx tsc --noEmit && npx next lint --file src/components/ActivityAnnouncements.tsx --file src/components/ActivityDetail.tsx --file src/app/admin/activities/page.tsx --file src/lib/activityAnnouncement.ts && npx vitest run src/lib/activityAnnouncement.test.ts`
Expected: 全部通過。

- [ ] **Step 7: Commit**

```bash
git add src/lib/activityAnnouncement.ts src/lib/activityAnnouncement.test.ts src/components/ActivityAnnouncements.tsx src/components/ActivityDetail.tsx src/app/admin/activities/page.tsx
git commit -m "feat: 活動詳情通知紀錄區塊＋發送通知彈窗

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 全套驗證、瀏覽器實測、合併上線（controller 執行）

**Files:** 無新程式碼（驗證中發現問題才修）

- [ ] **Step 1: 全套測試（專用測試 DB）**

Run（timeout 300000ms）：`npm test`
Expected: 全部 PASS。若有失敗，先確認不是其他 session 動到共用資源（本 worktree 用 `_actpush` 專用 DB，理論上不會）。

- [ ] **Step 2: 正式 build（會 lint 測試檔）**

Run：`npm run build`
Expected: build 成功。worktree 有自己的 `.next`，不會撞主 checkout 的 dev server。

- [ ] **Step 3: dev DB 建表＋啟動 dev server**

Run：`npx prisma db push`（**不加** `--accept-data-loss`；若 Prisma 提示要刪任何欄位／表——可能是別的 worktree 的 schema 領先——停下回報，不要硬推）

在 `/Users/s.w.kung/Downloads/Wade Claude/.claude/launch.json` 的 `configurations` 加：

```json
    {
      "name": "activity-push worktree",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev", "--", "-p", "3021"],
      "cwd": "HJJ/.claude/worktrees/activity-push",
      "port": 3021,
      "autoPort": true
    }
```

用 `preview_start({ name: "activity-push worktree" })` 啟動。

- [ ] **Step 4: 瀏覽器逐項驗證**

用行政帳號（seed：`admin@example.com`／`password123`；切帳號用 `/api/auth/csrf`＋`/api/auth/callback/credentials`）在 `/admin/activities`：

1. 新增表單底部有「發布後通知全體學生」且預設勾；新增一個未來日期的活動 → 切學生帳號（`student@example.com`），鈴鐺出現「新活動開放報名」，圖示是旗幟。
2. 編輯彈窗有「通知已報名學生與帶隊老師（目前報名 N 人）」且預設不勾；幫學生代報名後勾選、改地點儲存 → 學生鈴鐺出現「活動資訊更新」＋「活動報名成功」。
3. 詳情彈窗報名名單下方有「通知紀錄（0）」＋「發送通知」；開彈窗：字數計數、兩種對象人數、勾老師後按鈕人數變化、未輸入內容時按鈕停用；送出後 toast「已通知 N 人」、紀錄出現一列。
4. 刪除有人報名的未來活動時，確認框多一行「將通知 N 位已報名學生與帶隊老師。」
5. 深色模式下勾選框、單選、Textarea、紀錄表格顯示正常（`resize_window` colorScheme dark）；手機寬度（mobile preset）下發送彈窗與紀錄卡片不破版。

每項截圖留證；有問題回頭修對應任務的檔案並補 commit。

- [ ] **Step 5: 還原測試 DB 設定、清理**

```bash
git checkout -- vitest.setup.ts package.json
git status --short
dropdb -h localhost -U postgres tutoring_makeup_system_test_actpush
```

Expected: `git status` 無殘留改動（只有自己已 commit 的內容）。

- [ ] **Step 6: 合併與上線**

依 `superpowers:finishing-a-development-branch` 流程合併回 `main`（合併前在主 checkout 看 `git status`，確認沒有其他 session 未 commit 的同檔改動）。合併後在主 checkout：

```bash
npx prisma generate
```

並重啟主 checkout 的 dev server（若有在跑）。經使用者同意後 `git push` 觸發 Vercel 部署。**正式站建表 SQL 已於 2026-09-29 跑完，不用再跑**；不需新增環境變數。部署完成後請使用者用手機實收一次推播確認。

- [ ] **Step 7: 更新記憶**

更新 `project_activity_push_notifications.md`：上線 commit、實際行為與任何偏離 spec 之處。
