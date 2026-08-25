# 補課申請通知（四情境）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補上四個補課通知情境——插班核准/撤銷通知目標班老師、補課前一天提醒家長、缺課 3 天未申請提醒一次、行政待審每日彙總——全部走通知中心統一入口（推播＋收件夾），並把每日 cron 整併成一個總路由（Vercel 免費方案 cron 上限 2 個）。

**Architecture:** 情境③改既有 `notifyMakeup`（核准/代排/撤銷共用的通知函式，一處改動全路徑生效）；情境①②④是 `makeupRequestService` 的三個新 cron 函式（`now` 可注入，沿用 `sendMissedSessionReminders` 慣例）；新總路由 `/api/cron/daily-reminders` 依序跑四個每日子任務（含既有個輔缺席提醒），互不影響。

**Tech Stack:** Next.js App Router + Prisma + Vitest（真實測試 DB）+ 通知中心 `notifyUser`/`notifyAdmins`。

**Spec:** `docs/superpowers/specs/2026-08-24-makeup-request-notifications-design.md`

## Global Constraints

- 所有通知一律走 `notifyUser`／`notifyAdmins`（通知中心統一入口＝推播＋收件夾，永不 throw）；不得 import pushService 發送函式。
- 「今天／明天／N 天前」以台北換算（`taipeiDateKey`），日期比較用 UTC 日曆日；顯示用 `formatDateWithWeekday`／`formatMakeupSlot`。
- 通知失敗只記 log 不影響主流程（統一入口已保證）；cron 子任務任一失敗記 log 後其餘照跑。
- 駁回不通知目標班老師——老師只收「確定成立/取消」的通知（2026-08-24 超額審核定下的原則）。
- 本次**不改 schema**、無正式站 SQL；`vercel.json` 的 cron 更新隨部署生效，總數維持 2。
- 測試在隔離 worktree＋專用測試 DB 執行；`npm test` 約 150 秒，命令 timeout 至少 300000ms。
- commit 只 stage 自己改的檔案，不要 `git add -A`。

---

### Task 1: 情境③——插班補課核准/撤銷通知目標班級老師

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts`（`MAKEUP_NOTIFY_INCLUDE`、`notifyMakeup`）
- Test: `src/lib/services/makeupRequestService.test.ts`

**Interfaces:**
- Consumes: 既有 `notifyMakeup(makeup, kind)`（核准 `decideMakeupRequest`／代排 `arrangeInsertionMakeup`・`arrangeOneOnOneMakeup`／撤銷 `revokeMakeup` 都經過它）、`formatMakeupSlot`、`notifyUser`。
- Produces: `MAKEUP_NOTIFY_INCLUDE` 的 `targetClass` select 多帶 `teacher: { select: { userId: true } }`（型別 `MakeupWithNotifyInfo` 隨之擴充；後續任務的情境①直接重用這個 include）。

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/services/makeupRequestService.test.ts` 檔尾新增（`setup()`、`createTeacher`、`createClass`、`createInsertionMakeupRequest`、`decideMakeupRequest`、`revokeMakeup` 都已 import；`prisma` 已 import）：

```ts
describe('插班補課通知目標班級老師', () => {
  // 目標班用獨立老師，才能把「目標班老師的通知」跟原班老師/家長的通知分開斷言
  async function setupInsertionToOtherTeacher() {
    const base = await setup();
    const teacherB = await createTeacher({ name: '林老師', email: `ins-tb-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const classC = await createClass({ name: '圍棋C班', subject: '圍棋', level: '初級', teacherId: teacherB.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    const makeup = await createInsertionMakeupRequest({
      leaveRequestId: base.leave.id,
      targetClassId: classC.id,
      targetDate: new Date('2026-07-22'),
    });
    const { userId: teacherBUserId } = await prisma.teacher.findUniqueOrThrow({ where: { id: teacherB.id }, select: { userId: true } });
    return { ...base, teacherB, teacherBUserId, classC, makeup };
  }

  it('核准插班 → 目標班老師收到「補課學生加入」', async () => {
    const { makeup, teacherBUserId } = await setupInsertionToOtherTeacher();
    await decideMakeupRequest(makeup.id, 'APPROVED');
    const rows = await prisma.notification.findMany({ where: { userId: teacherBUserId, title: '補課學生加入' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain('小明');
    expect(rows[0].body).toContain('圍棋C班');
    expect(rows[0].url).toBe('/teacher');
  });

  it('駁回插班 → 目標班老師不收通知', async () => {
    const { makeup, teacherBUserId } = await setupInsertionToOtherTeacher();
    await decideMakeupRequest(makeup.id, 'REJECTED');
    expect(await prisma.notification.count({ where: { userId: teacherBUserId } })).toBe(0);
  });

  it('撤銷已核准插班 → 目標班老師收到「補課學生取消」', async () => {
    const { makeup, teacherBUserId } = await setupInsertionToOtherTeacher();
    await decideMakeupRequest(makeup.id, 'APPROVED');
    await revokeMakeup(makeup.id);
    const rows = await prisma.notification.findMany({ where: { userId: teacherBUserId, title: '補課學生取消' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain('圍棋C班');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: 新 describe 的第 1、3 個 FAIL（目標班老師沒有收到通知，rows 為空）；第 2 個本來就會過（現狀不通知）。

- [ ] **Step 3: 實作**

`src/lib/services/makeupRequestService.ts`：

3a. `MAKEUP_NOTIFY_INCLUDE` 的 `targetClass` select 加 teacher：

```ts
const MAKEUP_NOTIFY_INCLUDE = {
  leaveRequest: { select: { student: { select: { id: true, user: { select: { id: true, name: true } } } } } },
  targetClass: { select: { name: true, startTime: true, endTime: true, teacher: { select: { userId: true } } } },
  teacher: { select: { userId: true } },
} as const;
```

3b. `notifyMakeup` 在「一對一補課有指定老師」區塊之後、try 結束前加：

```ts
    // 插班補課：核准＝學生會出現在目標班點名名單、撤銷＝不來了，都要讓該班
    // 老師知道；駁回不通知（老師從未被告知這筆申請存在，只收確定成立/取消
    // 的通知——與超額審核同一原則）。
    if (makeup.type === 'INSERTION' && makeup.targetClass && kind !== 'REJECTED') {
      const classTeacherMessage =
        kind === 'APPROVED'
          ? { title: '補課學生加入', body: `補課學生 ${student.user.name} 將加入：${slot}` }
          : { title: '補課學生取消', body: `補課學生 ${student.user.name} 取消加入：${slot}` };
      await notifyUser(makeup.targetClass.teacher.userId, { ...classTeacherMessage, url: '/teacher' });
    }
```

（函式開頭的說明註解「推播通知家長；一對一另通知被指派老師」順手補成「……；一對一另通知被指派老師、插班核准/撤銷另通知目標班老師」。）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: 全數 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/makeupRequestService.ts src/lib/services/makeupRequestService.test.ts
git commit -m "feat(makeup): notify target-class teacher on insertion approval/revocation"
```

---

### Task 2: 情境①②——補課前一天提醒＋缺課 3 天未申請提醒

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts`（新增兩個 cron 函式＋`taipeiDateKey` import）
- Test: `src/lib/services/makeupRequestService.test.ts`

**Interfaces:**
- Consumes: `MAKEUP_NOTIFY_INCLUDE`（Task 1 之後含 targetClass.teacher）、`formatMakeupSlot`、`notifyUser`、`taipeiDateKey`（從 `./tutoringBookingService` import）。
- Produces（Task 4 的 cron 路由依賴）:

```ts
export async function sendMakeupDayBeforeReminders(now?: Date): Promise<{ notified: number }>
export async function sendMakeupNotFiledReminders(now?: Date): Promise<{ notified: number }>
```

- [ ] **Step 1: 寫失敗測試**

`src/lib/services/makeupRequestService.test.ts` import 行加上 `sendMakeupDayBeforeReminders, sendMakeupNotFiledReminders`（併入既有 makeupRequestService import），檔尾新增：

```ts
describe('sendMakeupDayBeforeReminders（補課前一天提醒家長）', () => {
  it('明天有已核准的插班與一對一補課 → 家長各收一則「補課提醒」', async () => {
    const { student, teacher, classB, leave } = await setup();
    const insertion = await createInsertionMakeupRequest({
      leaveRequestId: leave.id,
      targetClassId: classB.id,
      targetDate: new Date('2026-07-22'),
    });
    await decideMakeupRequest(insertion.id, 'APPROVED');
    // 一對一列直接建資料列（走服務建立需要可補課時段設定，與本測試無關）
    const leave2 = await createLeaveRequest({ studentId: student.id, classId: (await setupSecondLeaveClass(student.id)).id, date: new Date(Date.UTC(2026, 6, 27)), reason: '事假' });
    await prisma.makeupRequest.create({
      data: { leaveRequestId: leave2.id, type: 'ONE_ON_ONE', status: 'APPROVED', teacherId: teacher.id, slotDate: new Date('2026-07-22'), slotStartTime: '15:00', slotEndTime: '15:40' },
    });

    const result = await sendMakeupDayBeforeReminders(new Date('2026-07-21T00:00:00Z')); // 台北 7/21 → 明天 7/22
    expect(result.notified).toBe(2);
    const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
    const rows = await prisma.notification.findMany({ where: { userId, title: '補課提醒' } });
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.body.includes('圍棋B班'))).toBe(true);
    expect(rows.some((r) => r.body.includes('一對一補課'))).toBe(true);
  });

  it('不是明天／未核准的不提醒', async () => {
    const { student, classB, leave } = await setup();
    const insertion = await createInsertionMakeupRequest({
      leaveRequestId: leave.id,
      targetClassId: classB.id,
      targetDate: new Date('2026-07-22'),
    });
    // PENDING_ADMIN、日期是後天 → 都是 0
    expect((await sendMakeupDayBeforeReminders(new Date('2026-07-21T00:00:00Z'))).notified).toBe(0); // 未核准
    await decideMakeupRequest(insertion.id, 'APPROVED');
    expect((await sendMakeupDayBeforeReminders(new Date('2026-07-20T00:00:00Z'))).notified).toBe(0); // 後天才補課
  });

  it('家長已申請撤銷（行政未確認）照提醒——行政確認前補課仍有效', async () => {
    const { student, classB, leave } = await setup();
    const insertion = await createInsertionMakeupRequest({
      leaveRequestId: leave.id,
      targetClassId: classB.id,
      targetDate: new Date('2026-07-22'),
    });
    await decideMakeupRequest(insertion.id, 'APPROVED');
    await requestMakeupCancellation(insertion.id, student.id);
    expect((await sendMakeupDayBeforeReminders(new Date('2026-07-21T00:00:00Z'))).notified).toBe(1);
  });
});

describe('sendMakeupNotFiledReminders（缺課 3 天未申請提醒）', () => {
  it('缺課日恰為 3 天前且沒有補課申請 → 提醒一次', async () => {
    const { student } = await setup(); // setup 的 leave 在 2026-07-20（一）
    const result = await sendMakeupNotFiledReminders(new Date('2026-07-23T00:00:00Z')); // 台北 7/23 → 3 天前 = 7/20
    expect(result.notified).toBe(1);
    const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
    const rows = await prisma.notification.findMany({ where: { userId, title: '補課申請提醒' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain('圍棋A班');
    expect(rows[0].url).toBe('/student/makeup-request');
  });

  it('2 天前／4 天前都不提醒（只在恰好第 3 天提醒一次）', async () => {
    await setup();
    expect((await sendMakeupNotFiledReminders(new Date('2026-07-22T00:00:00Z'))).notified).toBe(0);
    expect((await sendMakeupNotFiledReminders(new Date('2026-07-24T00:00:00Z'))).notified).toBe(0);
  });

  it('已有補課申請（含被駁回）不提醒', async () => {
    const { student, classB, leave } = await setup();
    const insertion = await createInsertionMakeupRequest({
      leaveRequestId: leave.id,
      targetClassId: classB.id,
      targetDate: new Date('2026-07-22'),
    });
    await decideMakeupRequest(insertion.id, 'REJECTED');
    expect((await sendMakeupNotFiledReminders(new Date('2026-07-23T00:00:00Z'))).notified).toBe(0);
  });
});
```

測試頂部（`setup()` 附近）加一個小 helper（第二張請假單需要另一個班，避免同班同日 unique 限制干擾）：

```ts
// 一對一測試列需要第二筆請假；掛在另一個週一班避免與 setup 的請假重複
async function setupSecondLeaveClass(studentId: string) {
  const teacher2 = await createTeacher({ name: '王老師', email: `second-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const cls = await createClass({ name: '圍棋D班', subject: '圍棋', level: '初級', teacherId: teacher2.id, weekday: 1, startTime: '17:00', endTime: '19:00' });
  await enrollStudent(cls.id, studentId);
  return cls;
}
```

（`createLeaveRequest`、`enrollStudent` 已 import；若 `createLeaveRequest` 對未報名班級會擋，enrollStudent 先行即可——helper 已做。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: FAIL（兩個函式不存在，import 錯誤）。

- [ ] **Step 3: 實作**

`makeupRequestService.ts` import 區加：

```ts
import { taipeiDateKey } from './tutoringBookingService';
```

檔尾（`listInsertionsForTeacherClasses` 之後）新增：

```ts
// ─── 每日提醒（/api/cron/daily-reminders 呼叫；now 可注入方便測試） ───

// 情境①：明天（台北）有已核准補課的家長提醒。插班看 targetDate、一對一看
// slotDate。家長申請撤銷但行政未確認的照提醒——行政確認前補課仍有效。
export async function sendMakeupDayBeforeReminders(now: Date = new Date()): Promise<{ notified: number }> {
  const [y, m, d] = taipeiDateKey(now).split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
  const makeups = await prisma.makeupRequest.findMany({
    where: {
      status: 'APPROVED',
      OR: [
        { type: 'INSERTION', targetDate: tomorrow },
        { type: 'ONE_ON_ONE', slotDate: tomorrow },
      ],
    },
    include: MAKEUP_NOTIFY_INCLUDE,
  });
  let notified = 0;
  for (const makeup of makeups) {
    const student = makeup.leaveRequest.student;
    await notifyUser(student.user.id, {
      title: '補課提醒',
      body: `${student.user.name} 明天有補課：${formatMakeupSlot(makeup)}，請準時出席`,
      url: '/student',
    });
    notified++;
  }
  return { notified };
}

// 情境②：缺課日（請假日）恰為 3 天前、還沒有任何補課申請的家長提醒。
// 「恰好第 3 天」的選法天然只提醒一次，不需要已提醒旗標；已有申請（含被
// 駁回）不提醒——駁回代表行政已裁定，不再催。
export async function sendMakeupNotFiledReminders(now: Date = new Date()): Promise<{ notified: number }> {
  const [y, m, d] = taipeiDateKey(now).split('-').map(Number);
  const threeDaysAgo = new Date(Date.UTC(y, m - 1, d - 3));
  const leaves = await prisma.leaveRequest.findMany({
    where: { status: 'APPROVED', date: threeDaysAgo, makeupRequest: { is: null } },
    include: {
      student: { select: { user: { select: { id: true, name: true } } } },
      class: { select: { name: true } },
    },
  });
  let notified = 0;
  for (const leave of leaves) {
    await notifyUser(leave.student.user.id, {
      title: '補課申請提醒',
      body: `${leave.student.user.name} ${formatDateWithWeekday(leave.date, 'zh-TW')}「${leave.class.name}」缺課尚未申請補課，請至系統安排`,
      url: '/student/makeup-request',
    });
    notified++;
  }
  return { notified };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: 全數 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/makeupRequestService.ts src/lib/services/makeupRequestService.test.ts
git commit -m "feat(makeup): day-before and not-filed parent reminders"
```

---

### Task 3: 情境④——行政待審件每日彙總

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts`
- Test: `src/lib/services/makeupRequestService.test.ts`

**Interfaces:**
- Consumes: `notifyAdmins`（已 import）。
- Produces（Task 4 依賴）: `export async function sendPendingMakeupDigest(now?: Date): Promise<{ notified: boolean }>`

- [ ] **Step 1: 寫失敗測試**

import 行加 `sendPendingMakeupDigest`，檔尾新增：

```ts
describe('sendPendingMakeupDigest（行政待審每日彙總）', () => {
  it('超過 24 小時的待審＋待確認撤銷 → 一則彙總給每個行政', async () => {
    const admin = await prisma.user.create({
      data: { email: `digest-admin-${Date.now()}@example.com`, password: 'x', name: '行政', role: 'ADMIN' },
    });
    const { student, classB, leave } = await setup();
    // 待審件：createdAt 改成 25 小時前
    const pending = await createInsertionMakeupRequest({
      leaveRequestId: leave.id,
      targetClassId: classB.id,
      targetDate: new Date('2026-07-22'),
    });
    const now = new Date('2026-07-25T01:00:00Z');
    await prisma.makeupRequest.update({ where: { id: pending.id }, data: { createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1000) } });
    // 待確認撤銷件：另一筆已核准補課＋家長申請撤銷
    const cls2 = await setupSecondLeaveClass(student.id);
    const leave2 = await createLeaveRequest({ studentId: student.id, classId: cls2.id, date: new Date(Date.UTC(2026, 6, 27)), reason: '事假' });
    const approved = await prisma.makeupRequest.create({
      data: { leaveRequestId: leave2.id, type: 'INSERTION', status: 'APPROVED', targetClassId: classB.id, targetDate: new Date('2026-07-29') },
    });
    await requestMakeupCancellation(approved.id, student.id);

    const result = await sendPendingMakeupDigest(now);
    expect(result.notified).toBe(true);
    const rows = await prisma.notification.findMany({ where: { userId: admin.id, title: '補課待審提醒' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe('有 1 件補課申請待審核，另有 1 件撤銷申請待確認，請至系統處理');
    expect(rows[0].url).toBe('/admin/makeup-requests');
  });

  it('剛送出（未滿 24 小時）不計；全部為零不發', async () => {
    const admin = await prisma.user.create({
      data: { email: `digest-admin2-${Date.now()}@example.com`, password: 'x', name: '行政', role: 'ADMIN' },
    });
    const { student, classB, leave } = await setup();
    await createInsertionMakeupRequest({
      leaveRequestId: leave.id,
      targetClassId: classB.id,
      targetDate: new Date('2026-07-22'),
    }); // createdAt = 現在（測試執行當下），距 now 不到 24h
    const result = await sendPendingMakeupDigest(new Date());
    expect(result.notified).toBe(false);
    expect(await prisma.notification.count({ where: { userId: admin.id, title: '補課待審提醒' } })).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: FAIL（函式不存在）。

- [ ] **Step 3: 實作**

`makeupRequestService.ts` 檔尾（Task 2 的兩個函式之後）新增：

```ts
// 情境④：每天一則彙總提醒行政——送出超過 24 小時未審的補課申請＋待確認的
// 撤銷申請（撤銷不設 24 小時門檻，本來就該儘快處理）。清空就不發，一天最多
// 一則；逐件通知在送出當下已各推過一次（notifyAdminsNewMakeupRequest）。
export async function sendPendingMakeupDigest(now: Date = new Date()): Promise<{ notified: boolean }> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [pending, cancels] = await Promise.all([
    prisma.makeupRequest.count({ where: { status: 'PENDING_ADMIN', createdAt: { lt: dayAgo } } }),
    prisma.makeupRequest.count({ where: { status: 'APPROVED', cancelRequestedAt: { not: null } } }),
  ]);
  if (pending === 0 && cancels === 0) return { notified: false };
  const parts: string[] = [];
  if (pending > 0) parts.push(`有 ${pending} 件補課申請待審核`);
  if (cancels > 0) parts.push(`${pending > 0 ? '另' : ''}有 ${cancels} 件撤銷申請待確認`);
  await notifyAdmins({ title: '補課待審提醒', body: `${parts.join('，')}，請至系統處理`, url: '/admin/makeup-requests' });
  return { notified: true };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: 全數 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/makeupRequestService.ts src/lib/services/makeupRequestService.test.ts
git commit -m "feat(makeup): daily pending-review digest for admins"
```

---

### Task 4: cron 整併——`/api/cron/daily-reminders` 總路由

**Files:**
- Create: `src/app/api/cron/daily-reminders/route.ts`
- Create (test): `src/app/api/cron/daily-reminders/route.test.ts`
- Delete: `src/app/api/cron/tutoring-missed-session-reminder/route.ts`（整個目錄）
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `sendMissedSessionReminders`（tutoringBookingService，既有）＋ Task 2/3 的三個函式。
- Produces: `GET /api/cron/daily-reminders`（`CRON_SECRET` Bearer 驗證；回 `{ tutoringMissedSession, makeupDayBefore, makeupNotFiled, pendingMakeupDigest }`，子任務失敗以 `{ error: true }` 呈現）。

- [ ] **Step 1: 寫失敗測試**

Create `src/app/api/cron/daily-reminders/route.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 驗證「子任務其一拋錯其餘照跑」：把個輔缺席提醒 mock 成永遠拋錯
vi.mock('@/lib/services/tutoringBookingService', () => ({
  sendMissedSessionReminders: vi.fn().mockRejectedValue(new Error('boom')),
}));

import { GET } from './route';

function reqWithAuth(auth: string | null) {
  return { headers: { get: (name: string) => (name === 'authorization' ? auth : null) } } as never;
}

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret';
});

describe('GET /api/cron/daily-reminders', () => {
  it('403：無／錯誤 Bearer', async () => {
    expect((await GET(reqWithAuth(null))).status).toBe(403);
    expect((await GET(reqWithAuth('Bearer wrong'))).status).toBe(403);
  });

  it('子任務拋錯不影響其餘：個輔提醒 boom，三個補課任務照跑', async () => {
    const res = await GET(reqWithAuth('Bearer test-secret'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tutoringMissedSession).toEqual({ error: true });
    expect(data.makeupDayBefore).toEqual({ notified: 0 });
    expect(data.makeupNotFiled).toEqual({ notified: 0 });
    expect(data.pendingMakeupDigest).toEqual({ notified: false });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/app/api/cron/daily-reminders/route.test.ts`
Expected: FAIL（route 檔不存在）。

- [ ] **Step 3: 實作 route＋整併**

Create `src/app/api/cron/daily-reminders/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sendMissedSessionReminders } from '@/lib/services/tutoringBookingService';
import {
  sendMakeupDayBeforeReminders,
  sendMakeupNotFiledReminders,
  sendPendingMakeupDigest,
} from '@/lib/services/makeupRequestService';

// 每日提醒總路由（Vercel 免費方案 cron 上限 2 個，所有每日任務併在這裡，
// 每天台北 09:00 跑一次）。子任務彼此獨立：任一失敗記 log 後其餘照跑。
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const jobs: [string, () => Promise<unknown>][] = [
    ['tutoringMissedSession', () => sendMissedSessionReminders()],
    ['makeupDayBefore', () => sendMakeupDayBeforeReminders()],
    ['makeupNotFiled', () => sendMakeupNotFiledReminders()],
    ['pendingMakeupDigest', () => sendPendingMakeupDigest()],
  ];
  const results: Record<string, unknown> = {};
  for (const [name, run] of jobs) {
    try {
      results[name] = await run();
    } catch (err) {
      console.error(`daily reminder job ${name} failed`, err);
      results[name] = { error: true };
    }
  }
  return NextResponse.json(results);
}
```

刪除舊路由：

```bash
git rm -r src/app/api/cron/tutoring-missed-session-reminder
```

`vercel.json` 把 `/api/cron/tutoring-missed-session-reminder` 條目換成新路徑（schedule 不變；`tutoring-quota-reminder` 不動）：

```json
{
  "crons": [
    {
      "path": "/api/cron/tutoring-quota-reminder",
      "schedule": "0 1 20 * *"
    },
    {
      "path": "/api/cron/daily-reminders",
      "schedule": "0 1 * * *"
    }
  ]
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/app/api/cron/daily-reminders/route.test.ts`
Expected: 全數 PASS。再確認沒有殘留引用：`grep -rn "tutoring-missed-session-reminder" src vercel.json` → 無輸出。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/daily-reminders vercel.json
git commit -m "feat(cron): consolidate daily reminders into one route (Vercel 2-cron limit)"
```

（`git rm` 的刪除已在 index，會一併進這個 commit。）

---

### Task 5: 全量驗證＋dev 實測＋部署說明

**Files:** 無新增（驗證與必要修正）。

- [ ] **Step 1: 全量測試**

```bash
npm test
```

Expected: 全數 PASS（timeout ≥ 300000ms）。

- [ ] **Step 2: dev server 實測 cron 路由**

用 preview 工具從 worktree 起 dev server（專案根 `launch.json` 加 worktree 條目、避開被佔用的 port），然後直接打 cron 路由（`CRON_SECRET` 在 `.env` 裡）：

```bash
curl -s -H "Authorization: Bearer $(grep CRON_SECRET .env | cut -d= -f2 | tr -d '\"')" http://localhost:<port>/api/cron/daily-reminders
```

Expected: 200，回應含四個子任務 key（dev DB 的實際數字視資料而定）；接著以 admin 登入看鈴鐺——若 dev DB 有超過 24 小時的待審件，應出現「補課待審提醒」彙總（沒有就造一筆再打一次）。實測產生的通知與測試資料清乾淨。

- [ ] **Step 3: 部署說明**

- **無 schema 變更、無正式站 SQL。**
- `vercel.json` 的 cron 變更隨部署生效：舊的 `/api/cron/tutoring-missed-session-reminder` 排程會被移除、新的 `/api/cron/daily-reminders` 接手（同一時間 `0 1 * * *`＝台北 09:00）。
- 部署後首日 09:00 檢查正式站行政帳號鈴鐺是否收到彙總（若有待審件），以及 Vercel cron 執行紀錄是否 200。
