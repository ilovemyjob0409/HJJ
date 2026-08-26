# 尖峰負載優化（免升級版）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拿掉兩個 N+1（個輔報名額度、班級堂數）＋鈴鐺 visibilitychange 節流——行為逐位不變、只降資料庫查詢量，緩解尖峰壅塞。

**Architecture:** ① 額度分類迴圈抽成 `classifyQuotaBookings` 純函式（單一事實來源），`listEnrollments` 一次撈全部當月 bookings 分組計算；② `listStudentEnrolledClasses` 用 findMany＋groupBy 兩查詢組回每班 quota；③ `NotificationBell` 記上次載入時間，visibilitychange 60 秒內不重抓。

**Tech Stack:** Prisma groupBy／findMany-in + Vitest（真實 DB 對照測試）。

**Spec:** `docs/superpowers/specs/2026-08-26-peak-load-reduction-design.md`

## Global Constraints

- **行為逐位不變**：①②各加「批次結果＝逐筆舊函式結果」對照測試；既有測試全綠是主要證明。
- 額度分類口徑只能有一份（`classifyQuotaBookings`）；`getMonthlyQuotaStatus` 與批次路徑都用它。
- `getClassEnrollmentQuota` 本身保留不動（其他呼叫點還在用）。
- 測試 fixture 日期要用「台北今天」動態推導（今天永遠在當月，locked/upcoming/pendingOverQuota 三桶都能穩定造出來，不會 rot）；`new Date(Y,M,D)` 禁用，用 `Date.UTC`。
- 測試在隔離 worktree＋專用測試 DB；`npm test` ≥300000ms timeout；**最後跑 `npm run build`**（next build 會 lint 測試檔——2026-08-26 教訓）。
- 只 stage 自己改的檔案；sed 過的 `vitest.setup.ts`／`package.json` 不入 commit。

---

### Task 1: `classifyQuotaBookings` 抽取＋`listEnrollments` 批次化

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`（抽純函式、`getMonthlyQuotaStatus` 改用它）
- Modify: `src/lib/services/tutoringProgramService.ts`（`listEnrollments` 批次化）
- Test: `src/lib/services/tutoringProgramService.test.ts`（對照測試）

**Interfaces:**
- Produces: `export interface QuotaBuckets { locked: number; upcoming: number; pendingOverQuota: number; }`、`export function classifyQuotaBookings(bookings: { date: Date; status: string; attendance: { status: string } | null }[], todayKey: string): QuotaBuckets`（tutoringBookingService）。`listEnrollments` 簽名與回傳形狀不變。

- [ ] **Step 1: 寫失敗的對照測試**

`src/lib/services/tutoringProgramService.test.ts` 檔尾新增（import 依該檔既有慣例補齊：`prisma`、`createTeacher`、`createStudent`、`createProgram`、`createWindow`、`createEnrollment`、`listEnrollments`，以及從 `./tutoringBookingService` import `createBooking, getMonthlyQuotaStatus, taipeiDateKey`；marker 使用者供 `saveTutoringAttendance`——from `./attendanceService`）：

```ts
describe('listEnrollments 批次額度＝逐筆 getMonthlyQuotaStatus（對照）', () => {
  it('locked／upcoming／pendingOverQuota 三桶都與逐筆計算一致', async () => {
    // 「台北今天」動態 fixture：今天永遠在當月，三桶都能穩定造出、不會 rot
    const [ty, tm, td] = taipeiDateKey(new Date()).split('-').map(Number);
    const todayUtc = new Date(Date.UTC(ty, tm - 1, td));
    const monthKey = taipeiDateKey(new Date()).slice(0, 7);

    const teacher = await createTeacher({ name: '林老師', email: `batch-quota-t-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: todayUtc.getUTCDay(), startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
    const marker = await prisma.user.create({
      data: { email: `batch-quota-marker-${Date.now()}@example.com`, password: 'x', name: 'Marker', role: 'TEACHER' },
    });

    // A：今天到場 → locked=1
    const sa = await createStudent({ name: '甲生', email: `batch-quota-a-${Date.now()}@example.com`, password: 'x' });
    const ea = await createEnrollment({ studentId: sa.id, programId: program.id });
    const ba = await createBooking({ enrollmentId: ea.id, windowId: window.id, date: todayUtc });
    await saveTutoringAttendance(marker.id, [{ bookingId: ba.id, status: 'PRESENT', checkInTime: '16:00', checkOutTime: '17:00' }]);

    // B：quota 0＋quotaReview → 今天一筆 PENDING_ADMIN → pendingOverQuota=1
    const sb = await createStudent({ name: '乙生', email: `batch-quota-b-${Date.now()}@example.com`, password: 'x' });
    const eb = await createEnrollment({ studentId: sb.id, programId: program.id, monthlyQuota: 0 });
    await createBooking({ enrollmentId: eb.id, windowId: window.id, date: todayUtc, quotaReview: true });

    // C：今天一筆一般預約 → upcoming=1
    const sc = await createStudent({ name: '丙生', email: `batch-quota-c-${Date.now()}@example.com`, password: 'x' });
    const ec = await createEnrollment({ studentId: sc.id, programId: program.id });
    await createBooking({ enrollmentId: ec.id, windowId: window.id, date: todayUtc });

    const rows = (await listEnrollments()).filter((r) => [ea.id, eb.id, ec.id].includes(r.id));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const ref = await getMonthlyQuotaStatus(row.id, monthKey);
      expect({ locked: row.locked, upcoming: row.upcoming, pendingOverQuota: row.pendingOverQuota, quota: row.monthlyQuota })
        .toEqual({ locked: ref.locked, upcoming: ref.upcoming, pendingOverQuota: ref.pendingOverQuota, quota: ref.quota });
    }
    // 三桶各自被造出來（不是全零的空對照）
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ea.id)!.locked).toBe(1);
    expect(byId.get(eb.id)!.pendingOverQuota).toBe(1);
    expect(byId.get(ec.id)!.upcoming).toBe(1);
  });
});
```

- [ ] **Step 2: 跑測試確認狀態**

Run: `npx vitest run src/lib/services/tutoringProgramService.test.ts`
Expected: 新測試在現有實作下應 PASS（對照測試的基準線——先確認舊路徑就相等），接著才改實作。若此步 FAIL 表示 fixture 寫錯，先修 fixture。

- [ ] **Step 3: 抽取 `classifyQuotaBookings`**

`src/lib/services/tutoringBookingService.ts`——在 `getMonthlyQuotaStatus` 之前新增：

```ts
export interface QuotaBuckets {
  locked: number;
  upcoming: number;
  pendingOverQuota: number;
}

// 額度分類的唯一事實來源：getMonthlyQuotaStatus 與 listEnrollments 的批次
// 路徑共用（口徑分家就會重演超額審核前「顯示與閘門不一致」的問題）。
// 收費規範：「有預約且到場上課才扣堂」——有出席紀錄（且非缺席）才計次。
// 日期過了但沒到場、沒點名、缺席都不扣堂；當天（含）以後仍有效的預約
// 顯示為「已預約」，過期未到的預約兩邊都不算。超過額度送審中的
// PENDING_ADMIN 另計（pendingOverQuota），不佔「剩餘可約」。
export function classifyQuotaBookings(
  bookings: { date: Date; status: string; attendance: { status: string } | null }[],
  todayKey: string
): QuotaBuckets {
  let locked = 0;
  let upcoming = 0;
  let pendingOverQuota = 0;
  for (const b of bookings) {
    if (b.status === 'CANCELLED' || b.status === 'CANCELLED_LATE') continue;
    if (b.attendance && b.attendance.status !== 'ABSENT') locked++;
    else if (b.status === 'BOOKED' && utcDateKey(b.date) >= todayKey) upcoming++;
    else if (b.status === 'PENDING_ADMIN' && utcDateKey(b.date) >= todayKey) pendingOverQuota++;
  }
  return { locked, upcoming, pendingOverQuota };
}
```

`getMonthlyQuotaStatus` 的分類迴圈整段（`let locked = 0;` 到 `return { locked, upcoming, quota, pendingOverQuota };`）換成：

```ts
  const { locked, upcoming, pendingOverQuota } = classifyQuotaBookings(bookings, todayKey);
  return { locked, upcoming, quota, pendingOverQuota };
```

（原迴圈上的收費規範註解已併入 `classifyQuotaBookings` 的註解，刪除原處重複。）

- [ ] **Step 4: `listEnrollments` 批次化**

`src/lib/services/tutoringProgramService.ts`——import 行 `import { getMonthlyQuotaStatus, taipeiDateKey } from './tutoringBookingService';` 改成 `import { classifyQuotaBookings, taipeiDateKey } from './tutoringBookingService';`（若 `getMonthlyQuotaStatus` 該檔已無其他使用；有的話保留）。`listEnrollments` 整個函式改成：

```ts
export async function listEnrollments(studentId?: string): Promise<EnrollmentSummary[]> {
  const enrollments = await prisma.tutoringEnrollment.findMany({
    where: studentId ? { studentId } : {},
    include: {
      student: { select: { user: { select: { name: true } } } },
      program: { select: { name: true, defaultDurationMinutes: true, defaultMonthlyQuota: true } },
    },
    orderBy: { student: { user: { name: 'asc' } } },
  });
  const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);
  const [year, month] = monthKey.split('-').map(Number);
  // 一次撈齊所有報名的當月 REGULAR 預約、JS 端分組分類——查詢量從每筆報名
  // 2 個降為全部共 1 個（行政個輔頁列全部報名時差最多）。分類口徑共用
  // classifyQuotaBookings，與 getMonthlyQuotaStatus 永遠一致。
  const bookings = await prisma.tutoringBooking.findMany({
    where: {
      enrollmentId: { in: enrollments.map((e) => e.id) },
      kind: 'REGULAR',
      date: { gte: new Date(Date.UTC(year, month - 1, 1)), lte: new Date(Date.UTC(year, month, 0)) },
    },
    select: { enrollmentId: true, date: true, status: true, attendance: { select: { status: true } } },
  });
  const byEnrollment = new Map<string, typeof bookings>();
  for (const b of bookings) {
    if (!byEnrollment.has(b.enrollmentId)) byEnrollment.set(b.enrollmentId, []);
    byEnrollment.get(b.enrollmentId)!.push(b);
  }
  const todayKey = taipeiDateKey(new Date());
  return enrollments.map((e) => {
    const { locked, upcoming, pendingOverQuota } = classifyQuotaBookings(byEnrollment.get(e.id) ?? [], todayKey);
    return {
      id: e.id,
      studentId: e.studentId,
      studentName: e.student.user.name,
      programId: e.programId,
      programName: e.program.name,
      defaultDurationMinutes: e.program.defaultDurationMinutes,
      monthlyQuota: e.monthlyQuota ?? e.program.defaultMonthlyQuota,
      active: e.active,
      locked,
      upcoming,
      pendingOverQuota,
    };
  });
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/lib/services/tutoringProgramService.test.ts src/lib/services/tutoringBookingService.test.ts`
Expected: 全數 PASS（對照測試在新實作下仍相等＝行為不變的直接證明）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringProgramService.ts src/lib/services/tutoringProgramService.test.ts
git commit -m "perf(tutoring): batch listEnrollments quota computation via shared classifier"
```

---

### Task 2: `listStudentEnrolledClasses` 批次化

**Files:**
- Modify: `src/lib/services/classService.ts`
- Test: `src/lib/services/classService.test.ts`（對照測試）

**Interfaces:**
- Consumes: `getClassEnrollmentQuota`（attendanceService，保留不動、對照用）。
- Produces: `listStudentEnrolledClasses` 簽名與回傳形狀不變（每班 `quota: { totalSessions, usedSessions, remaining }`）。

- [ ] **Step 1: 寫失敗的對照測試**

`src/lib/services/classService.test.ts` 檔尾新增（import 依該檔既有慣例；`getClassEnrollmentQuota` from `./attendanceService`；點名紀錄直接 `prisma.classAttendance.create`，該檔 373 行已有同樣寫法可照抄欄位，`markedById` 用該檔既有 marker/user fixture 或新建一個 TEACHER user）：

```ts
describe('listStudentEnrolledClasses 批次堂數＝逐班 getClassEnrollmentQuota（對照）', () => {
  it('有無 totalSessions、含不扣堂點名的班級都一致', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: `batch-cls-t-${Date.now()}@example.com`, password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '批次生', email: `batch-cls-s-${Date.now()}@example.com`, password: 'x' });
    const marker = await prisma.user.create({
      data: { email: `batch-cls-marker-${Date.now()}@example.com`, password: 'x', name: 'Marker', role: 'TEACHER' },
    });
    const clsA = await createClass({ name: '批次A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    const clsB = await createClass({ name: '批次B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 4, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(clsA.id, student.id);
    await enrollStudent(clsB.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: clsA.id } }, data: { totalSessions: 10 } });
    // A 班：扣堂 2（PRESENT、LATE）＋不扣堂 2（ON_LEAVE、NOT_REGISTERED）
    const mk = (classId: string, day: number, status: string) =>
      prisma.classAttendance.create({ data: { classId, studentId: student.id, date: new Date(Date.UTC(2026, 7, day)), status: status as never, markedById: marker.id } });
    await mk(clsA.id, 4, 'PRESENT');
    await mk(clsA.id, 11, 'LATE');
    await mk(clsA.id, 18, 'ON_LEAVE');
    await mk(clsA.id, 25, 'NOT_REGISTERED');
    // B 班：無 totalSessions（remaining null）＋1 筆扣堂
    await mk(clsB.id, 6, 'PRESENT');

    const rows = await listStudentEnrolledClasses(student.id);
    const mine = rows.filter((r) => [clsA.id, clsB.id].includes(r.id));
    expect(mine).toHaveLength(2);
    for (const row of mine) {
      const ref = await getClassEnrollmentQuota(row.id, student.id);
      expect(row.quota).toEqual(ref);
    }
    const a = mine.find((r) => r.id === clsA.id)!;
    expect(a.quota).toEqual({ totalSessions: 10, usedSessions: 2, remaining: 8 });
    const b = mine.find((r) => r.id === clsB.id)!;
    expect(b.quota).toEqual({ totalSessions: null, usedSessions: 1, remaining: null });
  });
});
```

- [ ] **Step 2: 跑測試確認狀態**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: 現有實作下 PASS（基準線）；FAIL 則先修 fixture。

- [ ] **Step 3: 批次化實作**

`src/lib/services/classService.ts` 的 `listStudentEnrolledClasses` 改成：

```ts
export async function listStudentEnrolledClasses(studentId: string) {
  const classes = await prisma.class.findMany({
    where: { enrollments: { some: { studentId } } },
    select: CLASS_BOOKING_SELECT,
    orderBy: { name: 'asc' },
  });
  const classIds = classes.map((c) => c.id);
  // 一次撈齊報名列與扣堂數、JS 端組回——查詢量從每班 2 個降為共 2 個。
  // 扣堂語意同 getClassEnrollmentQuota：請假、未報名不扣。
  const [enrollments, usedCounts] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { studentId, classId: { in: classIds } },
      select: { classId: true, totalSessions: true },
    }),
    prisma.classAttendance.groupBy({
      by: ['classId'],
      where: { studentId, classId: { in: classIds }, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } },
      _count: { _all: true },
    }),
  ]);
  const totalByClass = new Map(enrollments.map((e) => [e.classId, e.totalSessions]));
  const usedByClass = new Map(usedCounts.map((g) => [g.classId, g._count._all]));
  return classes.map((c) => {
    const totalSessions = totalByClass.get(c.id) ?? null;
    const usedSessions = usedByClass.get(c.id) ?? 0;
    return {
      ...c,
      quota: { totalSessions, usedSessions, remaining: totalSessions === null ? null : totalSessions - usedSessions },
    };
  });
}
```

（`getClassEnrollmentQuota` 的 import 若因此變成未使用就移除；其他呼叫點在 attendanceService 內不受影響。）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/classService.test.ts src/lib/services/attendanceService.test.ts`
Expected: 全數 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/classService.ts src/lib/services/classService.test.ts
git commit -m "perf(classes): batch student class quota lookup (findMany + groupBy)"
```

---

### Task 3: `NotificationBell` visibilitychange 節流

**Files:**
- Modify: `src/components/ui/NotificationBell.tsx`

無單元測試（元件慣例）；驗證＝tsc＋eslint＋Task 4 的 build。

- [ ] **Step 1: 實作**

1a. `useRef` 已 import。元件內 state 區加：

```ts
  const lastLoadAtRef = useRef(0);
```

1b. `load()` 開頭加一行：

```ts
  async function load() {
    lastLoadAtRef.current = Date.now();
    const res = await fetch('/api/notifications');
```

1c. 掛載 effect 的 `onVisible` 改成：

```ts
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // 60 秒內切回分頁不重抓——尖峰時少掉一大票瑣碎查詢；
      // 打開面板（toggle）仍永遠重抓，即時性不受影響
      if (Date.now() - lastLoadAtRef.current < 60_000) return;
      load().catch(() => {});
    };
```

（mount 與 toggle 的 `load()` 呼叫不動。）

- [ ] **Step 2: 檢查**

```bash
npx tsc --noEmit && npx eslint src/components/ui/NotificationBell.tsx
```

Expected: 乾淨。

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/NotificationBell.tsx
git commit -m "perf(notifications): throttle bell refetch on tab refocus (60s)"
```

---

### Task 4: 全量驗證

- [ ] `npm test`（≥300000ms timeout）全綠。
- [ ] `npm run build` 綠（worktree 內）。
- [ ] Commit 無殘留（`git status` 只剩 sed 過的 vitest.setup.ts／package.json）。
