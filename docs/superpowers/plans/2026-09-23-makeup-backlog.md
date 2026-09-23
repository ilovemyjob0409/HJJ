# 未補堂數顯示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在行政學生管理、行政個別輔導報名管理、學生首頁票券管理顯示「應到未到、尚未補課」的堂數，點橘色標籤看明細。

**Architecture:** 新增 `makeupBacklogService.ts` 集中計算邏輯。班級部分用批次查詢（請假＋點名＋期別），個別輔導部分寫成純函式，重用 `listEnrollments` 已經撈好的本月預約。前端共用一個 `MakeupBacklogBadge` 元件（橘色標籤＋明細彈窗），三個畫面都重用。

**Tech Stack:** Next.js 14 App Router、Prisma、PostgreSQL、Vitest（真的測試 DB，`fileParallelism: false`）、Tailwind。

**Spec:** `docs/superpowers/specs/2026-09-23-gohall-billing-and-makeup-backlog-design.md`（功能二）

## Global Constraints

- 日期一律用 UTC 日曆日（`'YYYY-MM-DD'`）比較與儲存；「今天」用台北時區（`taipeiDateKey(now)`）。
- 顯示日期一律用 `formatDateWithWeekday`（日期（星期））。
- 彈窗一律用 `@/components/ui/Modal`；不要另外寫新的動畫，重用既有 `animate-*` class。
- 警示色：`bg-pendingBg text-pending`（跟 GoHallQualificationCard 的「單堂計費」同一套，深夜模式已經處理過）。
- 手機卡片模式靠 DataTable 內建機制，桌機 markup 不動。
- 不做 N+1：列表層級一律批次查詢。
- 測試指令：`npx vitest run <file>`（整套用 `npm test`，會先 db push 到測試 DB）。
- commit 只 stage 自己改的檔案（repo 裡有不相干的 `.impeccable/`，不要 add）。

## File Structure

- Create: `src/lib/services/makeupBacklogService.ts`：計算邏輯（班級批次查詢＋個別輔導純函式）
- Create: `src/lib/services/makeupBacklogService.test.ts`
- Create: `src/components/MakeupBacklogBadge.tsx`：橘色標籤＋明細彈窗（client component）
- Modify: `src/lib/services/tutoringProgramService.ts`：`listEnrollments` 多回傳 `makeupBacklog`
- Modify: `src/lib/services/studentService.ts`：`listStudents` 每筆 enrollment 多回傳 `makeupBacklog`
- Modify: `src/app/admin/tutoring/EnrollmentManager.tsx`：新增「未補」欄
- Modify: `src/app/admin/students/page.tsx`：新增「未補」欄
- Modify: `src/app/student/page.tsx`、`src/app/student/ClassesAndTutoringList.tsx`：首頁顯示

---

### Task 1: makeupBacklogService（計算邏輯）

**Files:**
- Create: `src/lib/services/makeupBacklogService.ts`
- Test: `src/lib/services/makeupBacklogService.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ClassBacklogItem { date: string; reason: 'LEAVE' | 'ABSENT'; makeupPending: boolean }
  export interface ClassMakeupBacklog { count: number; items: ClassBacklogItem[] } // items 新→舊
  export interface TutoringMakeupBacklog { count: number; absentCount: number; rebooked: number; absentDates: string[] } // absentDates 新→舊
  export const backlogKey: (studentId: string, classId: string) => string
  export function getClassMakeupBacklogs(pairs: { studentId: string; classId: string }[], now?: Date): Promise<Map<string, ClassMakeupBacklog>>
  export function computeTutoringBacklog(
    bookings: { date: Date; status: string; attendance: { status: string } | null }[],
    quota: number,
    todayKey: string
  ): TutoringMakeupBacklog
  ```

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { backlogKey, computeTutoringBacklog, getClassMakeupBacklogs } from './makeupBacklogService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
// 台北 2026-09-23 中午（UTC 04:00）
const NOW = new Date(Date.UTC(2026, 8, 23, 4, 0));

async function setup() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const teacher = await createTeacher({ name: '陳老師', email: `mb-t-${stamp}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `mb-s-${stamp}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00' });
  await enrollStudent(cls.id, student.id);
  const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
  // 本期從 2026-09-01 起算（清掉 enrollStudent 可能建立的期別，固定起算日）
  await prisma.enrollmentPeriod.deleteMany({ where: { enrollmentId: enrollment.id } });
  await prisma.enrollmentPeriod.create({ data: { enrollmentId: enrollment.id, sessions: 12, createdAt: new Date(Date.UTC(2026, 8, 1, 2, 0)) } });
  const markerId = (await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } })).userId;
  return { teacher, student, cls, markerId };
}

async function leave(studentId: string, classId: string, date: Date, makeupStatus?: 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED') {
  const l = await prisma.leaveRequest.create({ data: { studentId, classId, date, reason: '生病' } });
  if (makeupStatus) {
    await prisma.makeupRequest.create({
      data: { leaveRequestId: l.id, type: 'INSERTION', status: makeupStatus, targetClassId: classId, targetDate: D(2026, 10, 3) },
    });
  }
}

async function attend(studentId: string, classId: string, date: Date, status: 'PRESENT' | 'ABSENT' | 'ON_LEAVE', markedById: string) {
  await prisma.classAttendance.create({ data: { studentId, classId, date, status, markedById } });
}

describe('getClassMakeupBacklogs', () => {
  it('請假（無補課／被駁回／待審）與缺席都算，已核准補課與請假後出席不算', async () => {
    const { student, cls, markerId } = await setup();
    await leave(student.id, cls.id, D(2026, 9, 5)); // 無補課 → 算
    await leave(student.id, cls.id, D(2026, 9, 12), 'REJECTED'); // 駁回 → 算
    await leave(student.id, cls.id, D(2026, 9, 19), 'PENDING_ADMIN'); // 待審 → 算（makeupPending）
    await leave(student.id, cls.id, D(2026, 9, 6), 'APPROVED'); // 已核准 → 不算
    await attend(student.id, cls.id, D(2026, 9, 13), 'ABSENT', markerId); // 缺席 → 算
    await leave(student.id, cls.id, D(2026, 9, 20)); // 請假但後來出席 → 不算
    await attend(student.id, cls.id, D(2026, 9, 20), 'PRESENT', markerId);

    const map = await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW);
    const b = map.get(backlogKey(student.id, cls.id))!;
    expect(b.count).toBe(4);
    expect(b.items).toEqual([
      { date: '2026-09-19', reason: 'LEAVE', makeupPending: true },
      { date: '2026-09-13', reason: 'ABSENT', makeupPending: false },
      { date: '2026-09-12', reason: 'LEAVE', makeupPending: false },
      { date: '2026-09-05', reason: 'LEAVE', makeupPending: false },
    ]);
  });

  it('同一天請假＋缺席只算一次（原因記缺席）；已核准補課的請假即使點了缺席也不算', async () => {
    const { student, cls, markerId } = await setup();
    await leave(student.id, cls.id, D(2026, 9, 5));
    await attend(student.id, cls.id, D(2026, 9, 5), 'ABSENT', markerId);
    await leave(student.id, cls.id, D(2026, 9, 12), 'APPROVED');
    await attend(student.id, cls.id, D(2026, 9, 12), 'ABSENT', markerId);

    const b = (await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW)).get(backlogKey(student.id, cls.id))!;
    expect(b.count).toBe(1);
    expect(b.items).toEqual([{ date: '2026-09-05', reason: 'ABSENT', makeupPending: false }]);
  });

  it('本期起算日之前、今天之後都不算', async () => {
    const { student, cls, markerId } = await setup();
    await leave(student.id, cls.id, D(2026, 8, 29)); // 期別前
    await attend(student.id, cls.id, D(2026, 8, 22), 'ABSENT', markerId); // 期別前
    await leave(student.id, cls.id, D(2026, 9, 26)); // 未來
    const b = (await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW)).get(backlogKey(student.id, cls.id))!;
    expect(b).toEqual({ count: 0, items: [] });
  });

  it('插班補課寫進本班的點名紀錄（帶 makeupRequestId）不算', async () => {
    const { student, cls, markerId } = await setup();
    const l = await prisma.leaveRequest.create({ data: { studentId: student.id, classId: cls.id, date: D(2026, 8, 1), reason: 'x' } });
    const m = await prisma.makeupRequest.create({ data: { leaveRequestId: l.id, type: 'INSERTION', status: 'APPROVED', targetClassId: cls.id, targetDate: D(2026, 9, 5) } });
    await prisma.classAttendance.create({ data: { studentId: student.id, classId: cls.id, date: D(2026, 9, 5), status: 'ABSENT', markedById: markerId, makeupRequestId: m.id } });
    const b = (await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW)).get(backlogKey(student.id, cls.id))!;
    expect(b.count).toBe(0);
  });

  it('沒有期別紀錄時不設下限；空 pairs 回空 Map', async () => {
    const { student, cls, markerId } = await setup();
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    await prisma.enrollmentPeriod.deleteMany({ where: { enrollmentId: enrollment.id } });
    await attend(student.id, cls.id, D(2026, 3, 7), 'ABSENT', markerId);
    const b = (await getClassMakeupBacklogs([{ studentId: student.id, classId: cls.id }], NOW)).get(backlogKey(student.id, cls.id))!;
    expect(b.count).toBe(1);
    expect((await getClassMakeupBacklogs([], NOW)).size).toBe(0);
  });
});

describe('computeTutoringBacklog', () => {
  const bk = (d: string, status: string, att: string | null) => ({
    date: new Date(`${d}T00:00:00Z`),
    status,
    attendance: att ? { status: att } : null,
  });

  it('沒點名與點缺席都算缺席；今天與未來不算；取消不算', () => {
    const r = computeTutoringBacklog(
      [
        bk('2026-09-02', 'BOOKED', null), // 缺席（沒點名）
        bk('2026-09-09', 'BOOKED', 'ABSENT'), // 缺席
        bk('2026-09-16', 'BOOKED', 'PRESENT'), // 已上
        bk('2026-09-10', 'CANCELLED', null), // 取消
        bk('2026-09-23', 'BOOKED', null), // 今天 → upcoming
      ],
      8,
      '2026-09-23'
    );
    // 還能約 = 8 − 已上1 − 已約1 = 6 → 未補 = min(2, 6) = 2
    expect(r).toEqual({ count: 2, absentCount: 2, rebooked: 0, absentDates: ['2026-09-09', '2026-09-02'] });
  });

  it('另約補課後未補減少；額度用完時為 0', () => {
    const r = computeTutoringBacklog(
      [
        bk('2026-09-02', 'BOOKED', null),
        bk('2026-09-09', 'BOOKED', 'ABSENT'),
        bk('2026-09-16', 'BOOKED', 'PRESENT'),
        bk('2026-09-25', 'BOOKED', null),
        bk('2026-09-26', 'BOOKED', null),
      ],
      4,
      '2026-09-23'
    );
    // 還能約 = 4 − 1 − 2 = 1 → 未補 1、已另約 1
    expect(r.count).toBe(1);
    expect(r.rebooked).toBe(1);
    const full = computeTutoringBacklog([bk('2026-09-02', 'BOOKED', null), bk('2026-09-25', 'BOOKED', null)], 1, '2026-09-23');
    expect(full.count).toBe(0);
    expect(full.rebooked).toBe(1);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/makeupBacklogService.test.ts`
Expected: FAIL，錯誤為找不到 `./makeupBacklogService` 模組

- [ ] **Step 3: 實作**

```ts
import { prisma } from '@/lib/db';
import { classifyQuotaBookings, taipeiDateKey, utcDateKey } from './tutoringBookingService';

// 「應到未到、還沒補」的堂數（2026-09-23 使用者定案規則，見 spec 功能二）。

export interface ClassBacklogItem {
  date: string; // 'YYYY-MM-DD'
  reason: 'LEAVE' | 'ABSENT';
  makeupPending: boolean; // 請假已送補課、待行政核准
}
export interface ClassMakeupBacklog {
  count: number;
  items: ClassBacklogItem[]; // 新→舊
}
export interface TutoringMakeupBacklog {
  count: number; // 未補
  absentCount: number; // 本月缺席（含過期沒點名）
  rebooked: number; // 已另約＝absentCount − count
  absentDates: string[]; // 新→舊
}

export const backlogKey = (studentId: string, classId: string) => `${studentId}:${classId}`;

const EMPTY: ClassMakeupBacklog = { count: 0, items: [] };

// 班級（圍棋）：本期（最新一筆 EnrollmentPeriod 的 UTC 日曆日起）到台北今天，
// 以日期為單位——當天請假且補課不存在／被駁回／待審，或當天本班點名缺席，算一堂。
// 已核准補課的請假一律不算；請假後當天仍點了到場（非缺席、非請假）也不算。
// 插班補課寫進本班的點名紀錄（makeupRequestId 非 null）是別人的補課，排除。
export async function getClassMakeupBacklogs(
  pairs: { studentId: string; classId: string }[],
  now: Date = new Date()
): Promise<Map<string, ClassMakeupBacklog>> {
  const result = new Map<string, ClassMakeupBacklog>();
  if (pairs.length === 0) return result;
  const todayKey = taipeiDateKey(now);
  const todayUtc = new Date(`${todayKey}T00:00:00Z`);
  const studentIds = Array.from(new Set(pairs.map((p) => p.studentId)));
  const classIds = Array.from(new Set(pairs.map((p) => p.classId)));

  const [enrollments, leaves, attendances] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { studentId: { in: studentIds }, classId: { in: classIds } },
      select: { studentId: true, classId: true, periods: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
    prisma.leaveRequest.findMany({
      where: { studentId: { in: studentIds }, classId: { in: classIds }, date: { lte: todayUtc } },
      select: { studentId: true, classId: true, date: true, makeupRequest: { select: { status: true } } },
    }),
    prisma.classAttendance.findMany({
      where: { studentId: { in: studentIds }, classId: { in: classIds }, date: { lte: todayUtc }, makeupRequestId: null },
      select: { studentId: true, classId: true, date: true, status: true },
    }),
  ]);

  const periodStart = new Map<string, string | null>();
  for (const e of enrollments) {
    const latest = e.periods[0];
    periodStart.set(backlogKey(e.studentId, e.classId), latest ? utcDateKey(latest.createdAt) : null);
  }
  const inPeriod = (key: string, date: string) => {
    const start = periodStart.get(key);
    return start === undefined ? false : start === null || date >= start;
  };

  // key → date → 當天狀態
  type Day = { leave?: 'OPEN' | 'PENDING' | 'APPROVED'; attendance?: string };
  const days = new Map<string, Map<string, Day>>();
  const dayOf = (key: string, date: string) => {
    let m = days.get(key);
    if (!m) days.set(key, (m = new Map()));
    let d = m.get(date);
    if (!d) m.set(date, (d = {}));
    return d;
  };
  for (const l of leaves) {
    const key = backlogKey(l.studentId, l.classId);
    const date = utcDateKey(l.date);
    if (!inPeriod(key, date)) continue;
    const s = l.makeupRequest?.status;
    dayOf(key, date).leave = s === 'APPROVED' ? 'APPROVED' : s === 'PENDING_ADMIN' ? 'PENDING' : 'OPEN';
  }
  for (const a of attendances) {
    const key = backlogKey(a.studentId, a.classId);
    const date = utcDateKey(a.date);
    if (!inPeriod(key, date)) continue;
    dayOf(key, date).attendance = a.status;
  }

  for (const p of pairs) {
    const key = backlogKey(p.studentId, p.classId);
    const m = days.get(key);
    if (!m) {
      result.set(key, EMPTY);
      continue;
    }
    const items: ClassBacklogItem[] = [];
    for (const [date, d] of Array.from(m.entries())) {
      if (d.leave === 'APPROVED') continue;
      if (d.attendance === 'ABSENT') {
        items.push({ date, reason: 'ABSENT', makeupPending: false });
      } else if (d.leave && (d.attendance === undefined || d.attendance === 'ON_LEAVE')) {
        items.push({ date, reason: 'LEAVE', makeupPending: d.leave === 'PENDING' });
      }
    }
    items.sort((a, b) => (a.date < b.date ? 1 : -1));
    result.set(key, { count: items.length, items });
  }
  return result;
}

// 個別輔導（本月）：補課＝另約一般預約、兩筆無關聯（v8 條文），所以用額度推算——
// 缺席不扣堂會空出額度，另約補課會吃掉額度。未補＝min(缺席數, 還能約堂數)。
// bookings 需為該報名本月的 REGULAR 預約（同 listEnrollments / getMonthlyQuotaStatus 口徑）。
export function computeTutoringBacklog(
  bookings: { date: Date; status: string; attendance: { status: string } | null }[],
  quota: number,
  todayKey: string
): TutoringMakeupBacklog {
  const absentDates = bookings
    .filter(
      (b) =>
        b.status === 'BOOKED' &&
        utcDateKey(b.date) < todayKey &&
        (b.attendance === null || b.attendance.status === 'ABSENT')
    )
    .map((b) => utcDateKey(b.date))
    .sort((a, b) => (a < b ? 1 : -1));
  const { locked, upcoming } = classifyQuotaBookings(bookings, todayKey);
  const available = Math.max(0, quota - locked - upcoming);
  const count = Math.min(absentDates.length, available);
  return { count, absentCount: absentDates.length, rebooked: absentDates.length - count, absentDates };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/makeupBacklogService.test.ts`
Expected: PASS（7 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/makeupBacklogService.ts src/lib/services/makeupBacklogService.test.ts
git commit -m "feat: 未補堂數計算服務（班級本期＋個輔本月）"
```

---

### Task 2: MakeupBacklogBadge 共用元件＋個別輔導報名管理欄位

**Files:**
- Create: `src/components/MakeupBacklogBadge.tsx`
- Modify: `src/lib/services/tutoringProgramService.ts`（`listEnrollments`，約 276–325 行）
- Modify: `src/app/admin/tutoring/EnrollmentManager.tsx`（`EnrollmentRow` 介面約 21 行；欄位定義「本月狀態」約 383 行後）
- Test: `src/lib/services/tutoringProgramService.test.ts`（加一個 test）

**Interfaces:**
- Consumes: `computeTutoringBacklog`、`TutoringMakeupBacklog`、`ClassBacklogItem`（Task 1）
- Produces:
  ```ts
  // src/components/MakeupBacklogBadge.tsx
  export type BacklogGroup = { title: string; items: { date: string; label: string }[]; note?: string };
  export default function MakeupBacklogBadge(props: { count: number; modalTitle: string; groups: BacklogGroup[]; className?: string }): JSX.Element
  export function classItemLabel(item: ClassBacklogItem): string // '請假' | '請假（補課待審）' | '缺席'
  ```
  `listEnrollments` 每筆多一個欄位 `makeupBacklog: TutoringMakeupBacklog`

- [ ] **Step 1: 寫失敗的測試**（加在 `tutoringProgramService.test.ts` 最後）

```ts
describe('listEnrollments makeupBacklog', () => {
  it('每筆報名帶本月未補（預設 0）', async () => {
    const student = await createStudent({ name: '小華', email: `lb-${Date.now()}@example.com`, password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    await createEnrollment({ studentId: student.id, programId: program.id });
    const [row] = await listEnrollments(student.id);
    expect(row.makeupBacklog).toEqual({ count: 0, absentCount: 0, rebooked: 0, absentDates: [] });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/tutoringProgramService.test.ts -t "makeupBacklog"`
Expected: FAIL（`row.makeupBacklog` 是 undefined）

- [ ] **Step 3: 修改 `listEnrollments`**

在檔頭 import 加上：

```ts
import { computeTutoringBacklog } from './makeupBacklogService';
```

`EnrollmentSummary` 介面加欄位 `makeupBacklog: TutoringMakeupBacklog;`（同時 `import type { TutoringMakeupBacklog } from './makeupBacklogService';`）。回傳物件改成：

```ts
  return enrollments.map((e) => {
    const monthBookings = byEnrollment.get(e.id) ?? [];
    const { locked, upcoming, pendingOverQuota } = classifyQuotaBookings(monthBookings, todayKey);
    const monthlyQuota = e.monthlyQuota ?? e.program.defaultMonthlyQuota;
    return {
      id: e.id,
      studentId: e.studentId,
      studentName: e.student.user.name,
      studentNumber: e.student.studentNumber,
      email: e.student.user.email,
      programId: e.programId,
      programName: e.program.name,
      defaultDurationMinutes: e.program.defaultDurationMinutes,
      monthlyQuota,
      active: e.active,
      locked,
      upcoming,
      pendingOverQuota,
      feeTierId: e.feeTierId,
      makeupBacklog: computeTutoringBacklog(monthBookings, monthlyQuota, todayKey),
    };
  });
```

（已確認沒有循環 import：`tutoringBookingService` 不 import `tutoringProgramService`，而且三個函式它都有 export。）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/tutoringProgramService.test.ts`
Expected: PASS（整檔）

- [ ] **Step 5: 建立 `MakeupBacklogBadge.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import type { ClassBacklogItem } from '@/lib/services/makeupBacklogService';

export type BacklogGroup = { title: string; items: { date: string; label: string }[]; note?: string };

export function classItemLabel(item: ClassBacklogItem): string {
  if (item.reason === 'ABSENT') return '缺席';
  return item.makeupPending ? '請假（補課待審）' : '請假';
}

// 未補堂數標籤：>0 橘色可點（開明細彈窗），0 顯示灰色「—」。
// 放在可點擊的表格列裡時要擋掉冒泡，避免同時觸發列展開。
export default function MakeupBacklogBadge({
  count,
  modalTitle,
  groups,
  className = '',
}: {
  count: number;
  modalTitle: string;
  groups: BacklogGroup[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (count <= 0) return <span className={`text-inkMuted ${className}`}>—</span>;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={`whitespace-nowrap rounded-full bg-pendingBg px-2.5 py-0.5 text-xs font-semibold text-pending transition-opacity hover:opacity-80 ${className}`}
      >
        {count} 堂
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={modalTitle} maxWidthClassName="max-w-sm">
        <div className="flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
          {groups.map((g) => (
            <div key={g.title}>
              {groups.length > 1 && <p className="mb-1 text-sm font-semibold text-ink">{g.title}</p>}
              {g.note && <p className="mb-1 text-xs text-inkMuted">{g.note}</p>}
              <ul className="flex flex-col">
                {g.items.map((it) => (
                  <li key={it.date} className="flex justify-between border-b border-borderSubtle py-1.5 text-sm last:border-b-0">
                    <span className="text-ink">{formatDateWithWeekday(it.date)}</span>
                    <span className="text-inkMuted">{it.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
```

- [ ] **Step 6: EnrollmentManager 加「未補」欄**

`EnrollmentRow` 介面加：

```ts
  makeupBacklog: { count: number; absentCount: number; rebooked: number; absentDates: string[] };
```

import：

```ts
import MakeupBacklogBadge from '@/components/MakeupBacklogBadge';
```

在「本月狀態」欄物件之後（同一個 columns 陣列）插入：

```tsx
    {
      header: '未補',
      render: (r) => (
        <MakeupBacklogBadge
          count={r.makeupBacklog.count}
          modalTitle={`未補明細・${r.programName}`}
          groups={[
            {
              title: r.programName,
              note: `本月缺席 ${r.makeupBacklog.absentCount} 堂${r.makeupBacklog.rebooked > 0 ? `，已另約 ${r.makeupBacklog.rebooked} 堂` : ''}`,
              items: r.makeupBacklog.absentDates.map((d) => ({ date: d, label: '缺席' })),
            },
          ]}
        />
      ),
      sortValue: (r) => r.makeupBacklog.count,
    },
```

- [ ] **Step 7: 型別檢查＋lint**

Run: `npx tsc --noEmit && npx next lint --file src/components/MakeupBacklogBadge.tsx --file src/app/admin/tutoring/EnrollmentManager.tsx --file src/lib/services/tutoringProgramService.ts`
Expected: 無錯誤

- [ ] **Step 8: Commit**

```bash
git add src/components/MakeupBacklogBadge.tsx src/lib/services/tutoringProgramService.ts src/lib/services/tutoringProgramService.test.ts src/app/admin/tutoring/EnrollmentManager.tsx
git commit -m "feat: 個別輔導報名管理新增未補欄＋明細彈窗"
```

---

### Task 3: 行政學生管理「未補」欄

**Files:**
- Modify: `src/lib/services/studentService.ts`（`listStudents`，39–65 行）
- Modify: `src/app/admin/students/page.tsx`（`EnrollmentQuota` 型別、columns 約 516 行）
- Test: `src/lib/services/studentService.test.ts`（檔案已存在，在最後加一個 describe；它已經 import 了 prisma／createStudent／listStudents／createTeacher／createClass／enrollStudent，不要重複 import）

**Interfaces:**
- Consumes: `getClassMakeupBacklogs`、`backlogKey`、`ClassMakeupBacklog`（Task 1）；`MakeupBacklogBadge`、`classItemLabel`（Task 2）
- Produces: `listStudents()` 每個 `enrollments[i]` 多一個欄位 `makeupBacklog: ClassMakeupBacklog`

> 設計調整：spec 的草稿寫「展開列每班各自顯示」，但這一頁點列展開的是出缺勤面板（`StudentAttendancePanel`），不是班級表。所以改成：這一欄顯示各班加總，點標籤後的彈窗依班級分組列出明細，一樣做到「每班各自顯示」，而且不用動到展開面板。

- [ ] **Step 1: 寫失敗的測試**

```ts
describe('listStudents makeupBacklog', () => {
  it('每筆班級報名帶未補堂數', async () => {
    const stamp = `${Date.now()}`;
    const teacher = await createTeacher({ name: '陳老師', email: `ls-t-${stamp}@example.com`, password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: `ls-s-${stamp}@example.com`, password: 'x' });
    const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00' });
    await enrollStudent(cls.id, student.id);
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    await prisma.enrollmentPeriod.deleteMany({ where: { enrollmentId: enrollment.id } });
    await prisma.leaveRequest.create({ data: { studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 0, 3)), reason: 'x' } });

    const rows = await listStudents();
    const me = rows.find((r) => r.id === student.id)!;
    expect(me.enrollments[0].makeupBacklog.count).toBe(1);
    expect(me.enrollments[0].makeupBacklog.items[0]).toEqual({ date: '2026-01-03', reason: 'LEAVE', makeupPending: false });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/studentService.test.ts -t "makeupBacklog"`
Expected: FAIL（`makeupBacklog` 是 undefined）

- [ ] **Step 3: 修改 `listStudents`**

```ts
import { backlogKey, getClassMakeupBacklogs } from './makeupBacklogService';
```

把函式尾端的 `return Promise.all(...)` 改成：

```ts
  const backlogs = await getClassMakeupBacklogs(
    students.flatMap((s) => s.enrollments.map((e) => ({ studentId: s.id, classId: e.classId })))
  );
  return Promise.all(
    students.map(async ({ tutoringEnrollments, ...s }) => ({
      ...s,
      enrollments: await Promise.all(
        s.enrollments.map(async (e) => ({
          classId: e.classId,
          ...(await getClassEnrollmentQuota(e.classId, s.id)),
          makeupBacklog: backlogs.get(backlogKey(s.id, e.classId)) ?? { count: 0, items: [] },
        }))
      ),
      tutoringPrograms: tutoringEnrollments.map((e) => e.program),
    }))
  );
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/studentService.test.ts`
Expected: PASS

- [ ] **Step 5: 學生管理頁加欄**

找到 `EnrollmentQuota` 型別定義（`grep -n "EnrollmentQuota" src/app/admin/students/page.tsx`），加欄位：

```ts
  makeupBacklog: { count: number; items: { date: string; reason: 'LEAVE' | 'ABSENT'; makeupPending: boolean }[] };
```

import：

```ts
import MakeupBacklogBadge, { classItemLabel } from '@/components/MakeupBacklogBadge';
```

`classNameById` 目前宣告在 columns 之後（約 538 行）；把那行 `const classNameById = new Map(classes.map((c) => [c.id, c.name]));` 移到 `const columns` 之前。然後在「班級數」欄之後、「操作」欄之前插入：

```tsx
    {
      header: '未補',
      render: (s) => {
        const withBacklog = s.enrollments.filter((e) => e.makeupBacklog.count > 0);
        return (
          <MakeupBacklogBadge
            count={s.enrollments.reduce((sum, e) => sum + e.makeupBacklog.count, 0)}
            modalTitle={`未補明細・${s.user.name}`}
            groups={withBacklog.map((e) => ({
              title: classNameById.get(e.classId) ?? '班級',
              items: e.makeupBacklog.items.map((it) => ({ date: it.date, label: classItemLabel(it) })),
            }))}
          />
        );
      },
      sortValue: (s) => s.enrollments.reduce((sum, e) => sum + e.makeupBacklog.count, 0),
    },
```

- [ ] **Step 6: 型別檢查＋lint**

Run: `npx tsc --noEmit && npx next lint --file src/app/admin/students/page.tsx --file src/lib/services/studentService.ts`
Expected: 無錯誤

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/studentService.ts src/lib/services/studentService.test.ts src/app/admin/students/page.tsx
git commit -m "feat: 學生管理新增未補欄（各班加總、明細依班級分組）"
```

---

### Task 4: 學生首頁票券管理顯示未補

**Files:**
- Modify: `src/app/student/page.tsx`（27–47 行）
- Modify: `src/app/student/ClassesAndTutoringList.tsx`

**Interfaces:**
- Consumes: `getClassMakeupBacklogs`、`backlogKey`（Task 1）；`listEnrollments().makeupBacklog`（Task 2）；`MakeupBacklogBadge`、`classItemLabel`（Task 2）

- [ ] **Step 1: page.tsx 撈班級未補**

import：

```ts
import { backlogKey, getClassMakeupBacklogs } from '@/lib/services/makeupBacklogService';
```

在 `const activeTutoring = ...` 之前加：

```ts
  const classBacklogs = student
    ? await getClassMakeupBacklogs(myClasses.map((c) => ({ studentId: student.id, classId: c.id })))
    : new Map();
  const myClassesWithBacklog = myClasses.map((c) => ({
    ...c,
    makeupBacklog: (student && classBacklogs.get(backlogKey(student.id, c.id))) || { count: 0, items: [] },
  }));
```

並把 `<ClassesAndTutoringList myClasses={myClasses} ...` 改成 `myClasses={myClassesWithBacklog}`。

- [ ] **Step 2: ClassesAndTutoringList 顯示提示行**

介面：

```ts
interface ClassRow {
  // …既有欄位
  makeupBacklog: { count: number; items: { date: string; reason: 'LEAVE' | 'ABSENT'; makeupPending: boolean }[] };
}

interface TutoringRow {
  // …既有欄位
  makeupBacklog: { count: number; absentCount: number; rebooked: number; absentDates: string[] };
}
```

import：

```ts
import MakeupBacklogBadge, { classItemLabel } from '@/components/MakeupBacklogBadge';
```

班級列：在 `每週…` 那個 `<p>` 之後、進度條之前插入（外層是 `<button>`，所以提示行不能再放 button；改成 `div` 包 `MakeupBacklogBadge`。badge 本身是 button，巢狀 button 不合法，所以要把整列外層 `<button>` 改成 `<div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenClass(c); } }}>`，className 和 onClick 都不變）：

```tsx
          {c.makeupBacklog.count > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-pending">
              尚有
              <MakeupBacklogBadge
                count={c.makeupBacklog.count}
                modalTitle={`未補明細・${c.name}`}
                groups={[{ title: c.name, items: c.makeupBacklog.items.map((it) => ({ date: it.date, label: classItemLabel(it) })) }]}
              />
              未補
            </div>
          )}
```

個別輔導列：同樣把外層 `<button>` 改成 `div role="button"`（寫法同上，`setOpenTutoring(e)`；注意 map 變數叫 `e`，keydown handler 的參數改名 `ev`），在 `<TutoringQuotaBar …/>` 之後插入：

```tsx
          {e.makeupBacklog.count > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-pending">
              本月尚有
              <MakeupBacklogBadge
                count={e.makeupBacklog.count}
                modalTitle={`未補明細・${e.programName}`}
                groups={[
                  {
                    title: e.programName,
                    note: `本月缺席 ${e.makeupBacklog.absentCount} 堂${e.makeupBacklog.rebooked > 0 ? `，已另約 ${e.makeupBacklog.rebooked} 堂` : ''}，請至個別輔導預約補課`,
                    items: e.makeupBacklog.absentDates.map((d) => ({ date: d, label: '缺席' })),
                  },
                ]}
              />
              未補
            </div>
          )}
```

- [ ] **Step 3: 型別檢查＋lint＋整套測試**

Run: `npx tsc --noEmit && npx next lint --file src/app/student/page.tsx --file src/app/student/ClassesAndTutoringList.tsx && npm test`
Expected: 全部通過

- [ ] **Step 4: 瀏覽器驗證**

用 preview_start 開 dev server（launch.json 在上層目錄 `/Users/s.w.kung/Downloads/Wade Claude/.claude/launch.json`），用 `http://localhost:<port>`（不要用 127.0.0.1）登入：
1. 行政 `/admin/students`：「未補」欄可以排序，點橘色標籤會跳出依班級分組的明細；點標籤不會觸發列展開。
2. 行政 `/admin/tutoring` 報名管理：「未補」欄與明細彈窗（附註已另約堂數）。
3. 學生 `/student`：有未補的課出現「尚有 N 堂未補」，點數字開明細，點列的其他地方照樣開扣堂紀錄；鍵盤 Enter 也能開扣堂紀錄。
4. 用 resize_window 切 dark 和 mobile 各截一張圖，確認對比清楚、手機卡片模式正常。

dev 資料不夠的話，用 prisma studio 或測試用 SQL 在 dev DB 建一筆請假或缺席，驗證完刪除。

- [ ] **Step 5: Commit**

```bash
git add src/app/student/page.tsx src/app/student/ClassesAndTutoringList.tsx
git commit -m "feat: 學生首頁票券管理顯示未補堂數"
```
