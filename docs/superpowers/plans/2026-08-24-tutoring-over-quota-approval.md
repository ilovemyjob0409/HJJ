# 個別輔導超額預約審核（第 9 堂以上送審）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 學生自行預約個別輔導時，當月「已計次＋有效預約」達到月額度（預設 8）後，之後的預約自動建成 `PENDING_ADMIN` 送行政審核；行政在預約總覽頁核准／駁回，雙向推播通知。

**Architecture:** 額度閘門放在 `createBooking` 的 Serializable transaction 內（防並發），只在學生自行預約流程啟用（新 flag `quotaReview`）；行政代排與點名 walk-in 不送審。重用既有 `PENDING_ADMIN`／`REJECTED` 狀態，不改 schema。審核 API 走 `PATCH /api/tutoring-bookings/[id]`，佇列走新的 `GET /api/tutoring-bookings/pending`。

**Tech Stack:** Next.js App Router + Prisma + Vitest（真實測試 DB）+ Web Push（既有 pushService）。

**Spec:** `docs/superpowers/specs/2026-08-24-tutoring-over-quota-approval-design.md`

## Global Constraints

- 日期一律 UTC 日曆日儲存／比較，「今天」用台北時區（`taipeiDateKey`）；禁用 `new Date(Y, M, D)` 本地建構子，fixture 用 `new Date('YYYY-MM-DD')` 或 `Date.UTC`。
- 所有日期顯示用 `formatDateWithWeekday`（日期＋星期）。
- UI 重用共用元件：`Button`（含 loading）、`Card`、`Modal`、`DataTable`、`useConfirm()`、`StatusBadge`；不用裸 confirm/alert、不用裸 select。
- 動效重用既有 `animate-*` class 與骨架屏 pattern，不另創動畫。
- 測試 DB 是共用的：**不要同時跑多個測試 session**；單檔跑 `npx vitest run <file>`，全量跑 `npm test`。
- 工作區有其他未提交的修改（go-hall 相關）：**commit 時只 stage 自己改的檔案**，不要 `git add -A`。
- 本次不改 schema，不需要 prisma generate／重啟 dev server。
- 收費規範口徑：「有預約且到場才扣堂」——已計次＝有出席紀錄且非 `ABSENT`；取消、過期未到不佔額度。

---

### Task 1: `createBooking` 額度閘門＋行政推播＋POST route 接線

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`（`CreateBookingInput`、`createBooking`、新增 `notifyAdminsReviewNeeded`、pushService import）
- Modify: `src/app/api/tutoring-bookings/route.ts`（POST 傳入 `quotaReview`）
- Test: `src/lib/services/tutoringBookingService.test.ts`

**Interfaces:**
- Consumes: 既有 `createBooking`、`getMonthlyQuotaStatus` 的計數口徑、`pushToAdmins`（pushService 已有）。
- Produces:
  - `CreateBookingInput` 新增 `quotaReview?: boolean`。
  - `createBooking` 回傳型別改為 `Promise<{ id: string; status: 'BOOKED' | 'PENDING_ADMIN' }>`（後續 Task 3/4/5 都依賴 `status` 欄位）。
  - 測試檔頂層新增共用 fixture：`FUTURE_FRIDAYS`（2027-01 的五個星期五）與 `setupWithQuota(monthlyQuota)` helper（Task 2/3/4 的測試重用）。

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/services/tutoringBookingService.test.ts` 的 `setupProgramWithEnrollment` 附近（頂層）加入共用 fixture，並新增 describe：

```ts
// 2027-01-01 是星期五，且 2027 年 1 月的五個星期五都在未來、同一個月份，
// 額度閘門測試需要「同月多個未來日期」才能驗證 upcoming 計數。
const FUTURE_FRIDAYS = ['2027-01-01', '2027-01-08', '2027-01-15', '2027-01-22', '2027-01-29'].map(
  (d) => new Date(d)
);

async function setupWithQuota(monthlyQuota: number) {
  const ctx = await setupProgramWithEnrollment();
  await prisma.tutoringEnrollment.update({ where: { id: ctx.enrollment.id }, data: { monthlyQuota } });
  return ctx;
}
```

新增 describe（放在既有 `describe('createBooking', ...)` 之後）：

```ts
describe('createBooking 每月額度閘門', () => {
  it('quotaReview：額度內直接 BOOKED，第 quota+1 堂起建成 PENDING_ADMIN', async () => {
    const { window, enrollment } = await setupWithQuota(2);
    const b1 = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[0], quotaReview: true });
    const b2 = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[1], quotaReview: true });
    const b3 = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[2], quotaReview: true });
    expect(b1.status).toBe('BOOKED');
    expect(b2.status).toBe('BOOKED');
    expect(b3.status).toBe('PENDING_ADMIN');
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: b3.id } });
    expect(row.status).toBe('PENDING_ADMIN');
    expect(row.kind).toBe('REGULAR');
  });

  it('既有的 PENDING_ADMIN 也計入門檻（第 10 堂一樣送審）', async () => {
    const { window, enrollment } = await setupWithQuota(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[0], quotaReview: true });
    const b2 = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[1], quotaReview: true });
    const b3 = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[2], quotaReview: true });
    expect(b2.status).toBe('PENDING_ADMIN');
    expect(b3.status).toBe('PENDING_ADMIN');
  });

  it('取消的預約釋放額度', async () => {
    const { window, enrollment } = await setupWithQuota(1);
    const b1 = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[0], quotaReview: true });
    await adminCancelBooking(b1.id);
    const b2 = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[1], quotaReview: true });
    expect(b2.status).toBe('BOOKED');
  });

  it('已計次（到場非缺席）計入門檻，過去日期也算', async () => {
    const { window, enrollment } = await setupWithQuota(1);
    const marker = await prisma.user.create({
      data: { email: `quota-marker-${Date.now()}@example.com`, password: 'x', name: 'Marker', role: 'TEACHER' },
    });
    const past = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY });
    await saveTutoringAttendance(marker.id, [{ bookingId: past.id, status: 'PRESENT', checkInTime: '16:00', checkOutTime: '17:00' }]);
    // FRIDAY（2026-08-07）已到場＝已計次，同月（2026-08）再約就是第 2 堂 → 送審
    const b2 = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2026-08-14'), quotaReview: true });
    expect(b2.status).toBe('PENDING_ADMIN');
  });

  it('過期未到的預約不佔額度', async () => {
    const { window, enrollment } = await setupWithQuota(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY }); // 過期、無點名
    const b2 = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2026-08-14'), quotaReview: true });
    expect(b2.status).toBe('BOOKED');
  });

  it('不帶 quotaReview（行政代排／walk-in）超額照樣直接 BOOKED', async () => {
    const { window, enrollment } = await setupWithQuota(0);
    const b1 = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[0] });
    expect(b1.status).toBe('BOOKED');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```

Expected: 新 describe 全數 FAIL（`b1.status` 是 `undefined`——`createBooking` 尚未回傳 status；閘門測試建出來的是 BOOKED）。

- [ ] **Step 3: 實作**

`src/lib/services/tutoringBookingService.ts`：

3a. pushService import 加上 `pushToAdmins`：

```ts
import { pushToUser, pushToUsers, pushToAdmins, hasPushSubscription } from './pushService';
```

3b. `CreateBookingInput` 加欄位（放在 `notifyStaff` 之後）：

```ts
  // 學生自行預約時啟用「每月額度審核」：本月已計次＋有效預約已達額度時，
  // 這筆改建成 PENDING_ADMIN 送行政審核（不擋，行政人工判斷）。
  // 行政代排、點名現場加入不啟用，超額照樣直接成立。
  quotaReview?: boolean;
```

3c. `createBooking` 改寫（簽名、enrollment 查詢帶 program 額度、閘門、回傳 status、送審推播）。整個函式改成：

```ts
export async function createBooking(input: CreateBookingInput): Promise<{ id: string; status: 'BOOKED' | 'PENDING_ADMIN' }> {
  const booking = await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const [window, enrollment] = await Promise.all([
          tx.tutoringWindow.findUnique({ where: { id: input.windowId } }),
          tx.tutoringEnrollment.findUnique({
            where: { id: input.enrollmentId },
            include: { program: { select: { defaultMonthlyQuota: true } } },
          }),
        ]);
        if (!window) throw new Error('WINDOW_NOT_FOUND');
        if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');
        if (!enrollment.active) throw new Error('ENROLLMENT_INACTIVE');
        if (window.programId !== enrollment.programId) throw new Error('PROGRAM_MISMATCH');
        if (input.date.getUTCDay() !== window.weekday) throw new Error('INVALID_WEEKDAY');

        const closure = await tx.tutoringWindowClosure.findUnique({
          where: { windowId_date: { windowId: input.windowId, date: input.date } },
        });
        if (closure) throw new Error('WINDOW_CLOSED');

        // 一天一格：同一筆報名同一天已有有效預約（不論一般或補課）就不能再疊，
        // 否則額度條的「已預約」會多於日曆上看得到的「已約」天數
        const sameDay = await tx.tutoringBooking.count({
          where: { enrollmentId: input.enrollmentId, date: input.date, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
        });
        if (sameDay > 0) throw new Error('ALREADY_BOOKED_SAME_DAY');

        if (!input.allowOverCapacity) {
          const booked = await tx.tutoringBooking.count({
            where: { windowId: input.windowId, date: input.date, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
          });
          if (booked >= window.capacity) throw new Error('WINDOW_FULL');
        }

        // 每月額度閘門（學生自行預約才啟用）：以預約日期所屬 UTC 月份計，
        // 「已計次（到場非缺席）＋今天（台北）起的有效預約（BOOKED＋待審）」
        // 達到額度時，這筆改建成 PENDING_ADMIN 送行政審核。取消與過期未到
        // 不佔額度——口徑同 getMonthlyQuotaStatus。放在 transaction 內，
        // 並發送出多筆時不會同時以「第 quota 堂」的身分通過。
        let needsReview = false;
        if (input.quotaReview && input.kind !== 'MAKEUP') {
          const quota = enrollment.monthlyQuota ?? enrollment.program.defaultMonthlyQuota;
          const y = input.date.getUTCFullYear();
          const m = input.date.getUTCMonth();
          const monthBookings = await tx.tutoringBooking.findMany({
            where: {
              enrollmentId: input.enrollmentId,
              kind: 'REGULAR',
              status: { in: ['BOOKED', 'PENDING_ADMIN'] },
              date: { gte: new Date(Date.UTC(y, m, 1)), lte: new Date(Date.UTC(y, m + 1, 0)) },
            },
            select: { date: true, attendance: { select: { status: true } } },
          });
          const todayKey = taipeiDateKey(new Date());
          let used = 0;
          for (const b of monthBookings) {
            if (b.attendance && b.attendance.status !== 'ABSENT') used++;
            else if (utcDateKey(b.date) >= todayKey) used++;
          }
          needsReview = used >= quota;
        }

        return tx.tutoringBooking.create({
          data: {
            enrollmentId: input.enrollmentId,
            windowId: input.windowId,
            date: input.date,
            startTime: window.startTime,
            endTime: window.endTime,
            kind: input.kind ?? 'REGULAR',
            status: input.kind === 'MAKEUP' || needsReview ? 'PENDING_ADMIN' : 'BOOKED',
            makeupForId: input.makeupForId,
          },
          select: { id: true, status: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  if (booking.status === 'PENDING_ADMIN' && input.quotaReview) await notifyAdminsReviewNeeded(booking.id);
  if (input.notifyStaff) await notifyStaffBookingChange(booking.id, 'BOOKED');
  return { id: booking.id, status: booking.status as 'BOOKED' | 'PENDING_ADMIN' };
}
```

（函式開頭原有的「預約不再選時段…」註解保留不動。）

3d. 在 `notifyStaffBookingChange` 之後新增：

```ts
// 超額預約送審成立時推播行政（2026-08-20 慣例：行政只收「需要審核」的
// 通知）。失敗只記 log，不影響主流程。
async function notifyAdminsReviewNeeded(bookingId: string) {
  try {
    const booking = await prisma.tutoringBooking.findUnique({
      where: { id: bookingId },
      select: {
        date: true,
        window: { select: { program: { select: { name: true } } } },
        enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      },
    });
    if (!booking) return;
    await pushToAdmins({
      title: '個別輔導超額預約審核',
      body: `${booking.enrollment.student.user.name} 預約 ${formatDateWithWeekday(booking.date, 'zh-TW')}「${booking.window.program.name}」已超過本月額度，請至系統審核`,
      url: '/admin/tutoring/bookings',
    });
  } catch (err) {
    console.error('tutoring over-quota review push failed', err);
  }
}
```

3e. `src/app/api/tutoring-bookings/route.ts` 的 POST，`createBooking` 呼叫改為：

```ts
    const booking = await createBooking({
      enrollmentId,
      windowId: body.windowId,
      date: new Date(body.date),
      notifyStaff: session.user.role === 'STUDENT',
      quotaReview: session.user.role === 'STUDENT',
    });
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```

Expected: 全數 PASS（含既有測試——`createBooking` 回傳多了 `status` 欄位是向下相容的加寬）。

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts src/app/api/tutoring-bookings/route.ts && git commit -m "feat(tutoring): monthly quota gate — over-quota student bookings go to admin review"
```

---

### Task 2: `getMonthlyQuotaStatus` 增加 `pendingOverQuota`＋`listEnrollments` 傳遞

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`（`getMonthlyQuotaStatus`）
- Modify: `src/lib/services/tutoringProgramService.ts`（`EnrollmentSummary`、`listEnrollments`）
- Test: `src/lib/services/tutoringBookingService.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `quotaReview` flag、`FUTURE_FRIDAYS`／`setupWithQuota` fixture。
- Produces: `getMonthlyQuotaStatus` 回傳型別改為 `Promise<{ locked: number; upcoming: number; quota: number; pendingOverQuota: number }>`；`EnrollmentSummary` 新增 `pendingOverQuota: number`。`/api/tutoring-enrollments/[id]` 的 GET 用 `...quota` spread，自動帶出新欄位，不用改。

- [ ] **Step 1: 寫失敗測試**

在既有 `describe('getMonthlyQuotaStatus', ...)`（若無此 describe 就放在 Task 1 新增的 describe 之後）加入：

```ts
  it('超額待審（今天以後的 PENDING_ADMIN）另計為 pendingOverQuota', async () => {
    const { window, enrollment } = await setupWithQuota(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[0], quotaReview: true });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[1], quotaReview: true });
    const status = await getMonthlyQuotaStatus(enrollment.id, '2027-01');
    expect(status).toMatchObject({ locked: 0, upcoming: 1, pendingOverQuota: 1, quota: 1 });
  });
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```

Expected: 新測試 FAIL（回傳物件沒有 `pendingOverQuota`）。

- [ ] **Step 3: 實作**

3a. `getMonthlyQuotaStatus` 簽名與迴圈改為：

```ts
export async function getMonthlyQuotaStatus(
  enrollmentId: string,
  monthKey: string // 'YYYY-MM'
): Promise<{ locked: number; upcoming: number; quota: number; pendingOverQuota: number }> {
```

迴圈（保留原註解，多一行 else if 與計數器）：

```ts
  let locked = 0;
  let upcoming = 0;
  let pendingOverQuota = 0;
  for (const b of bookings) {
    if (b.status === 'CANCELLED' || b.status === 'CANCELLED_LATE') continue;
    // 收費規範：「有預約且到場上課才扣堂」——有出席紀錄（且非缺席）才計次。
    // 日期過了但沒到場、沒點名、缺席都不扣堂；當天（含）以後仍有效的預約
    // 顯示為「已預約」，過期未到的預約兩邊都不算。超過額度送審中的
    // PENDING_ADMIN 另計（pendingOverQuota），不佔「剩餘可約」。
    if (b.attendance && b.attendance.status !== 'ABSENT') locked++;
    else if (b.status === 'BOOKED' && utcDateKey(b.date) >= todayKey) upcoming++;
    else if (b.status === 'PENDING_ADMIN' && utcDateKey(b.date) >= todayKey) pendingOverQuota++;
  }
  return { locked, upcoming, quota, pendingOverQuota };
```

3b. `src/lib/services/tutoringProgramService.ts`：`EnrollmentSummary` interface 加 `pendingOverQuota: number;`（放在 `upcoming` 之後）；`listEnrollments` 的 map 改為：

```ts
      const { locked, upcoming, quota, pendingOverQuota } = await getMonthlyQuotaStatus(e.id, monthKey);
      return {
        id: e.id,
        studentId: e.studentId,
        studentName: e.student.user.name,
        programId: e.programId,
        programName: e.program.name,
        defaultDurationMinutes: e.program.defaultDurationMinutes,
        monthlyQuota: quota,
        active: e.active,
        locked,
        upcoming,
        pendingOverQuota,
      };
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts src/lib/services/tutoringProgramService.test.ts
```

Expected: 全數 PASS。

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts src/lib/services/tutoringProgramService.ts && git commit -m "feat(tutoring): expose pendingOverQuota in monthly quota status"
```

---

### Task 3: 核准／駁回服務＋`PATCH /api/tutoring-bookings/[id]`

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`（新增 `approveBooking`、`rejectBooking`、`notifyStudentReviewResult`）
- Modify: `src/app/api/tutoring-bookings/[id]/route.ts`（新增 PATCH）
- Test: `src/lib/services/tutoringBookingService.test.ts`
- Create (test): `src/app/api/tutoring-bookings/[id]/route.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `quotaReview`＋`setupWithQuota(0)`（額度 0 → 第一筆就送審，最省 fixture）。
- Produces: `approveBooking(bookingId: string): Promise<void>`、`rejectBooking(bookingId: string): Promise<void>`；錯誤字串 `'BOOKING_NOT_FOUND'`／`'NOT_PENDING'`。`PATCH /api/tutoring-bookings/[id]` body `{ action: 'approve' | 'reject' }` → 200 `{ success: true }`；403 非 ADMIN、400 action 錯誤、404 不存在、409 非待審狀態。

- [ ] **Step 1: 寫失敗的服務層測試**

`src/lib/services/tutoringBookingService.test.ts` import 行加上 `approveBooking, rejectBooking`（併入既有的 tutoringBookingService import），新增：

```ts
describe('approveBooking / rejectBooking', () => {
  it('核准：PENDING_ADMIN → BOOKED', async () => {
    const { window, enrollment } = await setupWithQuota(0);
    const b = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[0], quotaReview: true });
    expect(b.status).toBe('PENDING_ADMIN');
    await approveBooking(b.id);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.status).toBe('BOOKED');
  });

  it('駁回：PENDING_ADMIN → REJECTED，同一天可以重新預約', async () => {
    const { window, enrollment } = await setupWithQuota(0);
    const b = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[0], quotaReview: true });
    await rejectBooking(b.id);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.status).toBe('REJECTED');
    // REJECTED 不佔同日防呆也不佔名額
    const again = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[0], quotaReview: true });
    expect(again.status).toBe('PENDING_ADMIN');
  });

  it('非待審狀態丟 NOT_PENDING（重複審核擋下）', async () => {
    const { window, enrollment } = await setupWithQuota(0);
    const b = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[0], quotaReview: true });
    await approveBooking(b.id);
    await expect(approveBooking(b.id)).rejects.toThrow('NOT_PENDING');
    await expect(rejectBooking(b.id)).rejects.toThrow('NOT_PENDING');
  });

  it('不存在的 id 丟 BOOKING_NOT_FOUND', async () => {
    await expect(approveBooking('no-such-id')).rejects.toThrow('BOOKING_NOT_FOUND');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```

Expected: FAIL（`approveBooking` 不存在，import 錯誤）。

- [ ] **Step 3: 實作服務層**

在 `tutoringBookingService.ts` 的 `adminCancelBooking` 之後新增：

```ts
// 行政審核超額預約：核准 → BOOKED、駁回 → REJECTED。用條件式 updateMany
// 避免重複審核的競態（只有 PENDING_ADMIN 能轉出），結果推播通知學生。
async function reviewBooking(bookingId: string, to: 'BOOKED' | 'REJECTED'): Promise<void> {
  const result = await prisma.tutoringBooking.updateMany({
    where: { id: bookingId, status: 'PENDING_ADMIN' },
    data: { status: to },
  });
  if (result.count === 0) {
    const exists = await prisma.tutoringBooking.findUnique({ where: { id: bookingId }, select: { id: true } });
    throw new Error(exists ? 'NOT_PENDING' : 'BOOKING_NOT_FOUND');
  }
  await notifyStudentReviewResult(bookingId, to);
}

export function approveBooking(bookingId: string): Promise<void> {
  return reviewBooking(bookingId, 'BOOKED');
}

export function rejectBooking(bookingId: string): Promise<void> {
  return reviewBooking(bookingId, 'REJECTED');
}

// 審核結果通知學生。失敗只記 log，不影響主流程。
async function notifyStudentReviewResult(bookingId: string, to: 'BOOKED' | 'REJECTED') {
  try {
    const booking = await prisma.tutoringBooking.findUnique({
      where: { id: bookingId },
      select: {
        date: true,
        window: { select: { program: { select: { name: true } } } },
        enrollment: { select: { student: { select: { user: { select: { id: true } } } } } },
      },
    });
    if (!booking) return;
    const dateLabel = formatDateWithWeekday(booking.date, 'zh-TW');
    const payload =
      to === 'BOOKED'
        ? { title: '超額預約已核准', body: `${dateLabel}「${booking.window.program.name}」的預約已核准` }
        : {
            title: '超額預約未核准',
            body: `${dateLabel}「${booking.window.program.name}」的預約未核准，這筆預約不成立，若有疑問請與班主任聯繫`,
          };
    await pushToUser(booking.enrollment.student.user.id, { ...payload, url: '/student/tutoring' });
  } catch (err) {
    console.error('tutoring review result push failed', err);
  }
}
```

- [ ] **Step 4: 跑測試確認服務層通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```

Expected: PASS。

- [ ] **Step 5: 寫失敗的 route 測試**

Create `src/app/api/tutoring-bookings/[id]/route.test.ts`（session mock pattern 同 `src/app/api/tutoring-enrollments/[id]/attendance/route.test.ts`）：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { PATCH } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow, createEnrollment } from '@/lib/services/tutoringProgramService';
import { createBooking } from '@/lib/services/tutoringBookingService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'stu-1', role: 'STUDENT' } });

// 額度 0 → 學生流程第一筆就是 PENDING_ADMIN
async function setupPendingBooking() {
  const teacher = await createTeacher({ name: '林老師', email: `patch-route-t-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const student = await createStudent({ name: '小明', email: `patch-route-s-${Date.now()}@example.com`, password: 'x' });
  const enrollment = await createEnrollment({ studentId: student.id, programId: program.id, monthlyQuota: 0 });
  // 2027-01-01 是星期五，未來日期
  const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2027-01-01'), quotaReview: true });
  return booking;
}

function patchReq(body: unknown) {
  return { json: async () => body } as never;
}

describe('PATCH /api/tutoring-bookings/[id]', () => {
  it('403：非 ADMIN', async () => {
    asStudent();
    const res = await PATCH(patchReq({ action: 'approve' }), { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('400：action 不合法', async () => {
    asAdmin();
    const res = await PATCH(patchReq({ action: 'oops' }), { params: { id: 'x' } });
    expect(res.status).toBe(400);
  });

  it('核准成功，DB 狀態轉 BOOKED', async () => {
    asAdmin();
    const booking = await setupPendingBooking();
    const res = await PATCH(patchReq({ action: 'approve' }), { params: { id: booking.id } });
    expect(res.status).toBe(200);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('BOOKED');
  });

  it('駁回成功，DB 狀態轉 REJECTED', async () => {
    asAdmin();
    const booking = await setupPendingBooking();
    const res = await PATCH(patchReq({ action: 'reject' }), { params: { id: booking.id } });
    expect(res.status).toBe(200);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('REJECTED');
  });

  it('409：重複審核', async () => {
    asAdmin();
    const booking = await setupPendingBooking();
    await PATCH(patchReq({ action: 'approve' }), { params: { id: booking.id } });
    const res = await PATCH(patchReq({ action: 'reject' }), { params: { id: booking.id } });
    expect(res.status).toBe(409);
  });

  it('404：不存在的 id', async () => {
    asAdmin();
    const res = await PATCH(patchReq({ action: 'approve' }), { params: { id: 'no-such-id' } });
    expect(res.status).toBe(404);
  });
});
```

（注意：`createEnrollment` 已支援 `monthlyQuota` 參數，直接傳 0。）

- [ ] **Step 6: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run "src/app/api/tutoring-bookings/[id]/route.test.ts"
```

Expected: FAIL（route 沒有 export PATCH）。

- [ ] **Step 7: 實作 PATCH route**

`src/app/api/tutoring-bookings/[id]/route.ts`：import 行加上 `approveBooking, rejectBooking`，檔尾新增：

```ts
// 行政審核超額預約：approve → BOOKED、reject → REJECTED。
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 });
  }
  try {
    if (body.action === 'approve') await approveBooking(params.id);
    else await rejectBooking(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'BOOKING_NOT_FOUND' ? 404 : message === 'NOT_PENDING' ? 409 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 8: 跑測試確認通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run "src/app/api/tutoring-bookings/[id]/route.test.ts" src/lib/services/tutoringBookingService.test.ts
```

Expected: 全數 PASS。

- [ ] **Step 9: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts "src/app/api/tutoring-bookings/[id]/route.ts" "src/app/api/tutoring-bookings/[id]/route.test.ts" && git commit -m "feat(tutoring): admin approve/reject for over-quota bookings via PATCH"
```

---

### Task 4: 待審佇列服務＋`GET /api/tutoring-bookings/pending`

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`（新增 `shiftMonthKey`、`PendingReviewRow`、`listPendingReviewBookings`）
- Create: `src/app/api/tutoring-bookings/pending/route.ts`
- Test: `src/lib/services/tutoringBookingService.test.ts`
- Create (test): `src/app/api/tutoring-bookings/pending/route.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `getMonthlyQuotaStatus`（含 `pendingOverQuota`）、Task 1 fixture。
- Produces:

```ts
export interface PendingReviewRow {
  id: string;
  enrollmentId: string;
  studentName: string;
  programName: string;
  date: Date;            // API 端序列化成 ISO 字串
  seq: number;           // 核准後是當月第幾堂（已計次＋已約＋前面的待審筆數＋1）
  quota: number;
  monthUsage: { monthKey: string; attended: number }[]; // 近3個月已計次，新→舊
}
export async function listPendingReviewBookings(now?: Date): Promise<PendingReviewRow[]>
```

- [ ] **Step 1: 寫失敗的服務層測試**

import 行加上 `listPendingReviewBookings`，新增：

```ts
describe('listPendingReviewBookings', () => {
  it('列出今天以後的待審預約，含第幾堂與近3月參考', async () => {
    const { window, enrollment } = await setupWithQuota(0);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[0], quotaReview: true });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FUTURE_FRIDAYS[1], quotaReview: true });
    // 共用測試 DB 可能有其他報名的待審資料，只驗自己這筆報名的列
    const rows = (await listPendingReviewBookings()).filter((r) => r.enrollmentId === enrollment.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].studentName).toBe('小明');
    expect(rows[0].programName).toBe('英文個別輔導');
    expect(rows[0].seq).toBe(1); // 額度 0、沒有已計次與已約 → 這筆核准後是第 1 堂
    expect(rows[1].seq).toBe(2);
    expect(rows[0].quota).toBe(0);
    expect(rows[0].monthUsage).toHaveLength(3);
  });

  it('過期的待審（舊制補課遺留）不列', async () => {
    const { window, enrollment } = await setupWithQuota(0);
    const past = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, kind: 'MAKEUP' });
    const rows = await listPendingReviewBookings();
    expect(rows.find((r) => r.id === past.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```

Expected: FAIL（`listPendingReviewBookings` 不存在）。

- [ ] **Step 3: 實作服務層**

在 `tutoringBookingService.ts` 的 `listBookingsOverview` 之後新增：

```ts
function shiftMonthKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface PendingReviewRow {
  id: string;
  enrollmentId: string;
  studentName: string;
  programName: string;
  date: Date;
  seq: number; // 核准後是當月第幾堂（已計次＋已約＋前面的待審筆數＋1）
  quota: number;
  // 近 3 個月（預約當月、上月、前月）已計次堂數，供行政人工判斷是否真有未補的課
  monthUsage: { monthKey: string; attended: number }[];
}

// 行政待審佇列：今天（台北）起、狀態 PENDING_ADMIN 的預約，依送出時間排序。
// 已過期的待審（含舊制補課遺留資料）不列——到場與否已由點名決定，事後審核
// 無意義。統計以「預約日期所屬月份」為準（目前預約範圍只開放當月，兩者相同）。
export async function listPendingReviewBookings(now: Date = new Date()): Promise<PendingReviewRow[]> {
  const [ty, tm, td] = taipeiDateKey(now).split('-').map(Number);
  const todayUtc = new Date(Date.UTC(ty, tm - 1, td));

  const pending = await prisma.tutoringBooking.findMany({
    where: { status: 'PENDING_ADMIN', date: { gte: todayUtc } },
    select: {
      id: true,
      enrollmentId: true,
      date: true,
      enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // 同一報名同一月份的統計只查一次；seen 累計先送審的筆數，讓 seq 依序遞增
  const statsCache = new Map<
    string,
    { locked: number; upcoming: number; quota: number; monthUsage: { monthKey: string; attended: number }[]; seen: number }
  >();
  const rows: PendingReviewRow[] = [];
  for (const b of pending) {
    const monthKey = utcDateKey(b.date).slice(0, 7);
    const cacheKey = `${b.enrollmentId}:${monthKey}`;
    let stats = statsCache.get(cacheKey);
    if (!stats) {
      const { locked, upcoming, quota } = await getMonthlyQuotaStatus(b.enrollmentId, monthKey);
      const monthUsage = [{ monthKey, attended: locked }];
      for (let k = 1; k < 3; k++) {
        const mk = shiftMonthKey(monthKey, -k);
        monthUsage.push({ monthKey: mk, attended: (await getMonthlyQuotaStatus(b.enrollmentId, mk)).locked });
      }
      stats = { locked, upcoming, quota, monthUsage, seen: 0 };
      statsCache.set(cacheKey, stats);
    }
    stats.seen += 1;
    rows.push({
      id: b.id,
      enrollmentId: b.enrollmentId,
      studentName: b.enrollment.student.user.name,
      programName: b.window.program.name,
      date: b.date,
      seq: stats.locked + stats.upcoming + stats.seen,
      quota: stats.quota,
      monthUsage: stats.monthUsage,
    });
  }
  return rows;
}
```

- [ ] **Step 4: 跑測試確認服務層通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```

Expected: PASS。

- [ ] **Step 5: 寫失敗的 route 測試**

Create `src/app/api/tutoring-bookings/pending/route.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow, createEnrollment } from '@/lib/services/tutoringProgramService';
import { createBooking } from '@/lib/services/tutoringBookingService';

beforeEach(() => {
  sessionMock.mockReset();
});

describe('GET /api/tutoring-bookings/pending', () => {
  it('403：非 ADMIN', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'stu-1', role: 'STUDENT' } });
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('ADMIN 拿到待審列（含 seq 與 monthUsage）', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    const teacher = await createTeacher({ name: '林老師', email: `pending-route-t-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
    const student = await createStudent({ name: '小明', email: `pending-route-s-${Date.now()}@example.com`, password: 'x' });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id, monthlyQuota: 0 });
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2027-01-01'), quotaReview: true });

    const res = await GET();
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { id: string; seq: number; monthUsage: unknown[] }[];
    const mine = rows.find((r) => r.id === booking.id);
    expect(mine).toBeDefined();
    expect(mine!.seq).toBe(1);
    expect(mine!.monthUsage).toHaveLength(3);
  });
});
```

- [ ] **Step 6: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/app/api/tutoring-bookings/pending/route.test.ts
```

Expected: FAIL（route 檔不存在）。

- [ ] **Step 7: 實作 route**

Create `src/app/api/tutoring-bookings/pending/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listPendingReviewBookings } from '@/lib/services/tutoringBookingService';

// 行政「超額預約待審核」佇列
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listPendingReviewBookings());
}
```

- [ ] **Step 8: 跑測試確認通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/app/api/tutoring-bookings/pending/route.test.ts src/lib/services/tutoringBookingService.test.ts
```

Expected: 全數 PASS。

- [ ] **Step 9: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts src/app/api/tutoring-bookings/pending && git commit -m "feat(tutoring): pending review queue service and admin API"
```

---

### Task 5: 學生端 UI——額度條超額待審段＋日曆待審顯示／取消／toast

**Files:**
- Modify: `src/components/tutoring/TutoringQuotaBar.tsx`
- Modify: `src/components/tutoring/TutoringBookingCalendar.tsx`
- Modify: `src/app/student/tutoring/page.tsx`
- Modify: `src/app/admin/tutoring/AdminBookingModal.tsx`

**Interfaces:**
- Consumes: Task 1 的 POST 回應 `{ id, status }`、Task 2 的 `pendingOverQuota`（`/api/tutoring-enrollments/me` 與 `/api/tutoring-enrollments/[id]` 都已帶出）。
- Produces: `TutoringQuotaBarProps` 新增 `pendingOverQuota?: number`（預設 0，學生儀表板 dense 版刻意不傳——細節看專屬頁）。

前端無單元測試（沿用本專案慣例，UI 靠 Task 7 瀏覽器驗證），以下為實作步驟。

- [ ] **Step 1: `TutoringQuotaBar` 加超額待審段**

interface 與元件簽名：

```ts
// pendingOverQuota＝超過額度、送行政審核中的預約筆數，另外列出、不佔「剩餘可約」。
interface TutoringQuotaBarProps {
  locked: number;
  upcoming: number;
  quota: number;
  pendingOverQuota?: number;
  selectedCount?: number;
  dense?: boolean; // 儀表板列的緊湊版：字級縮小、細進度條
}

export default function TutoringQuotaBar({ locked, upcoming, quota, pendingOverQuota = 0, selectedCount = 0, dense }: TutoringQuotaBarProps) {
```

文字列在「已預約 N 堂」之後插入（`{selectedCount > 0 && ...}` 之前）：

```tsx
        {pendingOverQuota > 0 && (
          <>
            ・超額待審 <b className="font-semibold text-pending">{pendingOverQuota}</b> 堂
          </>
        )}
```

進度條在 `bg-brandDark` 段之後加：

```tsx
        {pendingOverQuota > 0 && <div className="h-full bg-pending opacity-80" style={{ width: `${pct(pendingOverQuota)}%` }} />}
```

- [ ] **Step 2: `TutoringBookingCalendar` 待審可取消＋標籤＋toast**

2a. `renderMonthGrid` 內把 cancellable 判斷改成（含註解更新）：

```ts
            // 已約／待審日期都可按掉取消（PENDING_ADMIN＝超額送審中，一律開放
            // 本人取消，不分新舊資料；取消不計次）
            const cancellable = mine;
```

（`disabled={mine ? !cancellable : !bookable}` 那行不用動，cancellable 恆真時已約格子就恆可按。）

2b. 格子標籤改成待審顯示「待審」：

```tsx
                    {mine
                      ? day.myBookingCount > 1
                        ? `已約×${day.myBookingCount}`
                        : day.myBookingStatus === 'PENDING_ADMIN'
                          ? '待審'
                          : '已約'
                      : day.remaining > 0
                        ? `剩${day.remaining}`
                        : '已滿'}
```

2c. `submitSelected` 改為收集每筆回應的 status 並組 toast：

```ts
  async function submitSelected() {
    setSubmitting(true);
    try {
      const failed: string[] = [];
      let pendingCount = 0;
      for (const date of selectedDates) {
        const day = availabilityByDate.get(date);
        if (!day) continue;
        const res = await fetch('/api/tutoring-bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enrollmentId, windowId: day.windowId, date }),
        });
        if (!res.ok) {
          failed.push(date);
        } else {
          const created = await res.json();
          if (created.status === 'PENDING_ADMIN') pendingCount++;
        }
      }
      const okCount = selectedDates.length - failed.length;
      if (failed.length > 0) {
        showToast(`${failed.map((d) => formatDateWithWeekday(d, 'zh-TW')).join('、')} 預約失敗（可能已滿或當天已有預約），其餘已預約`);
      } else if (pendingCount === 0) {
        showToast(successMessage ?? `已預約 ${okCount} 天`);
      } else if (pendingCount === okCount) {
        showToast(`已送審 ${pendingCount} 天（超過本月額度，行政核准後才成立）`);
      } else {
        showToast(`已預約 ${okCount - pendingCount} 天，另 ${pendingCount} 天超過本月額度已送行政審核`);
      }
      setSelectedDates([]);
      onBooked();
      loadAvailability();
    } finally {
      setSubmitting(false);
    }
  }
```

2d. 已約提示文字更新：

```tsx
      {availability.some((d) => d.myBookingId) && (
        <p className="text-xs text-inkMuted">「已約／待審」為這位學生已預約的日期，點一下即可取消該天預約。</p>
      )}
```

- [ ] **Step 3: 學生頁接線**

`src/app/student/tutoring/page.tsx`：

3a. `Enrollment` interface 加 `pendingOverQuota: number;`（`upcoming` 之後）。

3b. 加已選天數 state（放在其他 useState 旁）：

```ts
  const [selectedCount, setSelectedCount] = useState(0);
```

3c. 額度條傳新欄位與已選數：

```tsx
              <TutoringQuotaBar
                locked={selectedEnrollment.locked}
                upcoming={selectedEnrollment.upcoming}
                quota={selectedEnrollment.monthlyQuota}
                pendingOverQuota={selectedEnrollment.pendingOverQuota}
                selectedCount={selectedCount}
              />
```

3d. 日曆掛 `onSelectionChange`，取消時歸零由 callback 自帶（選取清空會回呼 0）：

```tsx
              <TutoringBookingCalendar
                key={selectedEnrollment.id}
                enrollmentId={selectedEnrollment.id}
                onSelectionChange={setSelectedCount}
                onBooked={() => {
                  loadAttendance();
                  loadEnrollments();
                }}
                onCancelledBooking={() => {
                  loadAttendance();
                  loadEnrollments();
                }}
              />
```

- [ ] **Step 4: `AdminBookingModal` 接線**

4a. `QuotaStatus` interface 加 `pendingOverQuota: number;`，並把第 13 行過時註解改成：

```ts
  // MAKEUP 僅出現在歷史資料；PENDING_ADMIN＝超額送審中的預約
```

4b. 額度條傳入：

```tsx
          <TutoringQuotaBar
            locked={quotaStatus.locked}
            upcoming={quotaStatus.upcoming}
            quota={quotaStatus.quota}
            pendingOverQuota={quotaStatus.pendingOverQuota}
            selectedCount={selectedCount}
          />
```

4c. 已約日期清單的待審標籤改字（`（待核准）`→`（超額待審）`）：

```ts
                .map((b) => `${formatDateWithWeekday(b.date)}${b.kind === 'MAKEUP' ? '（補課）' : ''}${b.status === 'PENDING_ADMIN' ? '（超額待審）' : ''}`)
```

- [ ] **Step 5: 型別與 lint 檢查**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit && npx eslint src/components/tutoring/TutoringQuotaBar.tsx src/components/tutoring/TutoringBookingCalendar.tsx src/app/student/tutoring/page.tsx src/app/admin/tutoring/AdminBookingModal.tsx
```

Expected: 無錯誤。

- [ ] **Step 6: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/components/tutoring/TutoringQuotaBar.tsx src/components/tutoring/TutoringBookingCalendar.tsx src/app/student/tutoring/page.tsx src/app/admin/tutoring/AdminBookingModal.tsx && git commit -m "feat(tutoring): student-facing over-quota pending UI (quota bar, calendar, toasts)"
```

---

### Task 6: 行政端 UI——預約總覽頁頂部待審佇列

**Files:**
- Modify: `src/app/admin/tutoring/bookings/page.tsx`

**Interfaces:**
- Consumes: Task 4 的 `GET /api/tutoring-bookings/pending`（回 `PendingReviewRow[]`，date 為 ISO 字串）、Task 3 的 `PATCH /api/tutoring-bookings/[id]`。

- [ ] **Step 1: 實作待審佇列區塊**

1a. interface 區新增（`OverviewRow` 旁）：

```ts
interface PendingRow {
  id: string;
  enrollmentId: string;
  studentName: string;
  programName: string;
  date: string;
  seq: number;
  quota: number;
  monthUsage: { monthKey: string; attended: number }[];
}
```

1b. state 與載入（放在其他 state／loader 旁，並在元件 mount 時載入）：

```ts
  const [pendingRows, setPendingRows] = useState<PendingRow[]>([]);

  async function loadPending() {
    const res = await fetch('/api/tutoring-bookings/pending');
    if (res.ok) setPendingRows(await res.json());
  }

  useEffect(() => {
    loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

1c. 審核 handler：

```ts
  async function review(row: PendingRow, action: 'approve' | 'reject') {
    const label = action === 'approve' ? '核准' : '駁回';
    const msg = `確定要${label} ${row.studentName} ${formatDateWithWeekday(row.date)} 的超額預約嗎？`;
    if (!(await confirm(msg, action === 'reject' ? { danger: true } : undefined))) return;
    const res = await fetch(`/api/tutoring-bookings/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      showToast(`${label}失敗，請重新整理後再試`);
      return;
    }
    showToast(`已${label}`);
    loadPending();
    loadCounts();
  }
```

1d. 欄位定義（`columns` 旁）。近 3 月參考顯示成「1月 0 堂・12月 8 堂・11月 6 堂」：

```tsx
  const pendingColumns: Column<PendingRow>[] = [
    { header: '學生', render: (r) => r.studentName, sortValue: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName, sortValue: (r) => r.programName },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
    { header: '這筆是', render: (r) => `當月第 ${r.seq} 堂（額度 ${r.quota}）`, sortValue: (r) => r.seq },
    {
      header: '近3個月已計次',
      render: (r) => r.monthUsage.map((u) => `${Number(u.monthKey.slice(5, 7))}月 ${u.attended} 堂`).join('・'),
    },
    {
      header: '操作',
      render: (r) => (
        <div className="flex gap-2">
          <Button className="px-2 py-1 text-xs" onClick={() => review(r, 'approve')}>
            核准
          </Button>
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => review(r, 'reject')}>
            駁回
          </Button>
        </div>
      ),
    },
  ];
```

1e. JSX：在 `<h1>` 之後、月曆 `<Card>` 之前插入（待處理佇列不收合，用 `DataTable`）：

```tsx
      <h2 className="mb-2 font-bold text-ink">超額預約待審核</h2>
      <Card className="mb-6">
        <DataTable columns={pendingColumns} rows={pendingRows} keyField={(r) => r.id} emptyText="目前沒有待審核的預約" />
      </Card>
```

- [ ] **Step 2: 型別與 lint 檢查**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit && npx eslint src/app/admin/tutoring/bookings/page.tsx
```

Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/admin/tutoring/bookings/page.tsx && git commit -m "feat(tutoring): admin pending-review queue on bookings overview page"
```

---

### Task 7: 全量驗證＋瀏覽器煙霧測試

**Files:** 無新增（驗證與必要的修正）。

- [ ] **Step 1: 全量測試**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test
```

Expected: 全數 PASS。（共用測試 DB：確認沒有其他 session 同時在跑測試。）

- [ ] **Step 2: 瀏覽器煙霧測試**

用 preview 工具啟動 dev server（`.claude/launch.json` 既有設定；不要用 Bash 起 server），依序驗證：

1. 以測試學生登入（NextAuth API 測試登入切換技巧見 `project_student_guide` 記憶／`docs` 內既有說明），進 `/student/tutoring`：
   - 把該報名的當月預約約到額度上限後再多選一天送出 → toast 顯示「…超過本月額度已送行政審核」，該日期格子顯示「待審」（黃色）。
   - 額度條出現「超額待審 1 堂」段。
   - 點「待審」格子 → 可取消，取消後恢復可約。
2. 以 ADMIN 登入進 `/admin/tutoring/bookings`：
   - 頂部「超額預約待審核」表出現該筆，欄位含「當月第 N 堂（額度 8）」與近 3 個月已計次。
   - 按「核准」→ 佇列消失；學生端日曆該日期變「已約」。
   - 再造一筆送審後按「駁回」→ 佇列消失，學生端該日期恢復可約。
3. 截圖存證（學生端待審格子＋行政端佇列）。

- [ ] **Step 3: 收尾**

確認 `git status` 只剩本 feature 以外的既有未提交檔案（go-hall 相關），本 feature 的所有變更都已在 Task 1–6 的 commit 內。若煙霧測試發現問題，修正後補 commit（一樣只 stage 自己的檔案）。
