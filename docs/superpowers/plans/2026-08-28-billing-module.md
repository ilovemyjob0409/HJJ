# 收費模組 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立「應收計算＋繳費登記」帳本：批次→帳單→繳款三層資料、停課日曆、費率設定、行政開單/繳款/通知 UI、學生端繳費頁。

**Architecture:** 純函式計算引擎（`billingCalcService`）與資料層服務（batch/bill/payment）分離；帳單定案時快照明細（JSON）並自動充值班級堂數；通知一律走 `notifyUser`。UI 沿用既有元件（Card/DataTable/CollapsibleDataTable/Modal/useConfirm/ExportExcelButton/Input/Select）。

**Tech Stack:** Next.js App Router、Prisma（`@prisma/adapter-pg`）、Vitest（共用測試 DB，`src/lib/testUtils` resetDb 慣例）、Tailwind。

**Spec:** `docs/superpowers/specs/2026-08-28-billing-module-design.md`（本計畫的唯一需求來源，衝突時以 spec 為準）

## Global Constraints

- 日期一律 UTC 日曆日儲存／比較（`new Date(Date.UTC(...))`），「今天」以台北判定——沿用 `taipeiDateKey`（`src/lib/services/tutoringBookingService.ts`）。**絕不用 `new Date(Y, M, D)` 本地建構子**。
- 班級 `weekday` 慣例＝`date.getUTCDay()`（週日 0～週六 6），與現有 Class 資料一致。
- 通知只走 `notifyUser`／`notifyUsers`（`src/lib/services/notificationService.ts`，`NotifyPayload = {title, body, url}`）；不得 import pushService。
- 金額一律整數元（Int）。
- 顯示日期一律 `formatDateWithWeekday`（`src/lib/dateFormat.ts`）。
- 表單一律用共用 `Input`/`Select`/`Textarea` 元件（不用裸 input/select）；confirm 一律 `useConfirm()`；彈窗一律 `Modal`（自帶 a11y）。
- 表格：`DataTable`／`CollapsibleDataTable maxRows={3}`（紀錄類收合慣例）。
- 新增查詢班級記得 `active: true`（班級軟刪除）。
- schema 變更後：`npx prisma db push`（本機 dev DB）＋ `npx prisma generate` ＋ **重啟 dev server** 才會吃到新 client。
- 測試指令一律帶 `--testTimeout=30000 --hookTimeout=60000`（機器高載時避免假 flake）。
- 每個任務結尾 commit；只 stage 自己動的檔案。

---

### Task 1: Prisma schema＋正式站 SQL 草稿

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `docs/superpowers/2026-08-28-billing-module-production.sql`

**Interfaces:**
- Produces: models `ClosedDay`, `TutoringFeeTier`, `BillingSetting`, `BillingBatch`, `Bill`, `BillPayment`；enums `ClosedDaySource`, `BillingKind`, `BillingBatchStatus`, `BillStatus`, `PaymentMethod`；新欄位 `Class.feePerSession Int?`、`ClassEnrollment.feeOverride Int?`、`TutoringEnrollment.feeTierId String?`。

- [ ] **Step 1: 在 `prisma/schema.prisma` 末尾新增（並在 Class／ClassEnrollment／TutoringEnrollment／Student 補反向關聯欄位）**

```prisma
enum ClosedDaySource {
  NATIONAL
  CUSTOM
}

// 停課日曆：這張表是唯一來源。預載國定假日=source NATIONAL 的列；
// 刪除某列=該天照常上課；新增 CUSTOM 列=自訂停課（颱風假）。
model ClosedDay {
  id     String          @id @default(cuid())
  date   DateTime        @unique // UTC 日曆日
  name   String
  source ClosedDaySource @default(CUSTOM)
}

model TutoringFeeTier {
  id              String               @id @default(cuid())
  name            String
  sessionsPerWeek Int
  monthlyFee      Int
  sortOrder       Int                  @default(0)
  enrollments     TutoringEnrollment[]
}

// 單列設定（id 固定 "main"）
model BillingSetting {
  id           String @id @default("main")
  deductionCap Int    @default(2) // 上期剩餘折抵上限（堂）
  paymentInfo  String @default("") // 學生端繳費資訊卡文字（銀行帳戶等）
}

enum BillingKind {
  CLASS
  TUTORING
}

enum BillingBatchStatus {
  DRAFT
  FINALIZED
}

model BillingBatch {
  id          String             @id @default(cuid())
  kind        BillingKind
  periodStart DateTime // UTC 日曆日
  periodEnd   DateTime
  status      BillingBatchStatus @default(DRAFT)
  finalizedAt DateTime?
  createdAt   DateTime           @default(now())
  bills       Bill[]
}

enum BillStatus {
  DRAFT
  FINALIZED
}

enum PaymentMethod {
  CASH
  TRANSFER
}

model Bill {
  id                   String              @id @default(cuid())
  batchId              String?
  batch                BillingBatch?       @relation(fields: [batchId], references: [id], onDelete: Cascade)
  studentId            String
  student              Student             @relation(fields: [studentId], references: [id])
  classId              String?
  class                Class?              @relation(fields: [classId], references: [id])
  tutoringEnrollmentId String?
  tutoringEnrollment   TutoringEnrollment? @relation(fields: [tutoringEnrollmentId], references: [id])
  periodStart          DateTime
  periodEnd            DateTime
  sessionsTotal        Int? // 班級：區間堂數（扣假日後）
  deductedSessions     Int                 @default(0)
  billedSessions       Int? // 班級：計費堂數
  unitPrice            Int? // 班級帳單
  monthlyFee           Int? // 個別輔導帳單
  prorationRatio       Float? // 個別輔導折算比例（1=全額）
  amountDue            Int
  detail               Json // 定案凍結的明細快照，見 billingCalcService BillDetail
  status               BillStatus          @default(DRAFT)
  settledAsWithdrawal  Boolean             @default(false)
  notifiedAt           DateTime?
  note                 String?
  createdAt            DateTime            @default(now())
  payments             BillPayment[]

  @@index([studentId, periodStart])
  @@index([classId, periodStart])
  @@index([tutoringEnrollmentId, periodStart])
}

model BillPayment {
  id          String        @id @default(cuid())
  billId      String
  bill        Bill          @relation(fields: [billId], references: [id], onDelete: Cascade)
  amount      Int
  paidOn      DateTime // UTC 日曆日
  method      PaymentMethod
  note        String?
  createdById String
  createdAt   DateTime      @default(now())
}
```

既有 model 增欄（找到各 model 加入）：

```prisma
// model Class 內：
  feePerSession Int? // 每堂單價（收費模組）
  bills         Bill[]

// model ClassEnrollment 內：
  feeOverride Int? // 學生覆寫價；null=用班級價

// model TutoringEnrollment 內：
  feeTierId String?
  feeTier   TutoringFeeTier? @relation(fields: [feeTierId], references: [id])
  bills     Bill[]

// model Student 內：
  bills Bill[]
```

- [ ] **Step 2: 套用到本機 dev DB＋產 client**

Run: `npx prisma db push && npx prisma generate`
Expected: `Your database is now in sync`；**重啟 dev server**（如在跑）。

- [ ] **Step 3: 寫正式站冪等 SQL 草稿**（比照 `docs/superpowers/2026-08-07-tutoring-module-production.sql` 慣例：`CREATE TYPE ... EXCEPTION WHEN duplicate_object`、`CREATE TABLE IF NOT EXISTS`、`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`、FK 用 `DO $$ ... EXCEPTION WHEN duplicate_object` 包）。內容照 Step 1 的 schema 逐表寫出；`BillingSetting` 附 `INSERT ... ON CONFLICT (id) DO NOTHING` 塞入 `('main', 2, '')`。國定假日種子 SQL 由 Task 2 產生後補進同一檔。

- [ ] **Step 4: 驗證與 commit**

Run: `npx tsc --noEmit`
Expected: 乾淨（既有程式碼不受影響）。

```bash
git add prisma/schema.prisma docs/superpowers/2026-08-28-billing-module-production.sql
git commit -m "feat: 收費模組 schema（批次/帳單/繳款/停課日/級距/設定）"
```

---

### Task 2: closedDayService＋國定假日種子

**Files:**
- Create: `src/lib/services/closedDayService.ts`
- Create: `src/lib/services/closedDayService.test.ts`
- Modify: `docs/superpowers/2026-08-28-billing-module-production.sql`（附加假日種子 INSERT）

**Interfaces:**
- Produces:
  - `NATIONAL_HOLIDAYS: { date: string; name: string }[]`（'YYYY-MM-DD'）
  - `seedNationalHolidays(): Promise<number>`（冪等 upsert，回傳新增筆數）
  - `listClosedDays(from?: Date, to?: Date): Promise<{ id: string; date: Date; name: string; source: 'NATIONAL' | 'CUSTOM' }[]>`（date asc）
  - `addClosedDay(date: Date, name: string): Promise<ClosedDay>`（重複日期丟 `Error('DUPLICATE_DATE')`）
  - `removeClosedDay(id: string): Promise<void>`

- [ ] **Step 1: 寫失敗測試 `src/lib/services/closedDayService.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { seedNationalHolidays, listClosedDays, addClosedDay, removeClosedDay } from './closedDayService';

describe('closedDayService', () => {
  it('seeds national holidays idempotently', async () => {
    const first = await seedNationalHolidays();
    expect(first).toBeGreaterThan(0);
    const second = await seedNationalHolidays();
    expect(second).toBe(0); // 再跑一次不重複

    const all = await listClosedDays();
    expect(all.some((d) => d.name.includes('中秋'))).toBe(true);
    expect(all.every((d) => d.source === 'NATIONAL')).toBe(true);
  });

  it('adds a custom closed day and rejects duplicates', async () => {
    const day = await addClosedDay(new Date(Date.UTC(2026, 8, 30)), '颱風停課');
    expect(day.source).toBe('CUSTOM');
    await expect(addClosedDay(new Date(Date.UTC(2026, 8, 30)), '重複')).rejects.toThrow('DUPLICATE_DATE');
  });

  it('removes a day (holiday held-as-usual) and range-filters', async () => {
    await seedNationalHolidays();
    const all = await listClosedDays();
    await removeClosedDay(all[0].id);
    expect((await listClosedDays()).length).toBe(all.length - 1);

    const ranged = await listClosedDays(new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 31)));
    expect(ranged.every((d) => d.date >= new Date(Date.UTC(2026, 9, 1)))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/closedDayService.test.ts --testTimeout=30000 --hookTimeout=60000`
Expected: FAIL（module 不存在）。

- [ ] **Step 3: 實作 `src/lib/services/closedDayService.ts`**

```ts
import { prisma } from '@/lib/db';

// 台灣國定假日種子（2026-09 起）。⚠️ 上線前由使用者對照人事行政總處
// 行事曆核對；之後年度用停課日曆後台自行增補即可（表是唯一來源）。
export const NATIONAL_HOLIDAYS: { date: string; name: string }[] = [
  { date: '2026-09-25', name: '中秋節' },
  { date: '2026-09-28', name: '教師節' },
  { date: '2026-10-09', name: '國慶連假' },
  { date: '2026-10-10', name: '國慶日' },
  { date: '2026-10-25', name: '光復節' },
  { date: '2026-10-26', name: '光復節補假' },
  { date: '2026-12-25', name: '行憲紀念日' },
  { date: '2027-01-01', name: '元旦' },
  { date: '2027-02-05', name: '農曆除夕' },
  { date: '2027-02-06', name: '春節初一' },
  { date: '2027-02-07', name: '春節初二' },
  { date: '2027-02-08', name: '春節初三' },
  { date: '2027-02-09', name: '春節補假' },
  { date: '2027-02-28', name: '和平紀念日' },
  { date: '2027-03-01', name: '和平紀念日補假' },
  { date: '2027-04-04', name: '兒童節' },
  { date: '2027-04-05', name: '清明節' },
  { date: '2027-04-06', name: '清明連假補假' },
  { date: '2027-05-01', name: '勞動節' },
  { date: '2027-06-09', name: '端午節' },
  { date: '2027-09-15', name: '中秋節' },
  { date: '2027-10-10', name: '國慶日' },
  { date: '2027-10-11', name: '國慶日補假' },
  { date: '2027-10-25', name: '光復節' },
  { date: '2027-12-25', name: '行憲紀念日' },
];

function toUtcDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export async function seedNationalHolidays(): Promise<number> {
  const result = await prisma.closedDay.createMany({
    data: NATIONAL_HOLIDAYS.map((h) => ({ date: toUtcDate(h.date), name: h.name, source: 'NATIONAL' as const })),
    skipDuplicates: true,
  });
  return result.count;
}

export async function listClosedDays(from?: Date, to?: Date) {
  return prisma.closedDay.findMany({
    where: from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : undefined,
    orderBy: { date: 'asc' },
  });
}

export async function addClosedDay(date: Date, name: string) {
  const existing = await prisma.closedDay.findUnique({ where: { date } });
  if (existing) throw new Error('DUPLICATE_DATE');
  return prisma.closedDay.create({ data: { date, name, source: 'CUSTOM' } });
}

export async function removeClosedDay(id: string): Promise<void> {
  await prisma.closedDay.delete({ where: { id } });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/closedDayService.test.ts --testTimeout=30000 --hookTimeout=60000`
Expected: PASS。

- [ ] **Step 5: 把假日種子補進正式站 SQL**（對每筆 `INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2026-09-25', '中秋節', 'NATIONAL') ON CONFLICT (date) DO NOTHING;` 逐列展開——25 列照 NATIONAL_HOLIDAYS 抄）

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/closedDayService.ts src/lib/services/closedDayService.test.ts docs/superpowers/2026-08-28-billing-module-production.sql
git commit -m "feat: 停課日曆服務＋台灣國定假日種子（冪等）"
```

---

### Task 3: billingCalcService（純函式計算引擎）

**Files:**
- Create: `src/lib/billingCalc.ts`（純函式、不碰 DB——放 `src/lib/` 跟 dateFormat 同層）
- Create: `src/lib/billingCalc.test.ts`

**Interfaces:**
- Produces:
  - `interface SessionDateEntry { dateKey: string; closed: boolean; closedName?: string }`（dateKey='YYYY-MM-DD'）
  - `interface BillDetail { sessionDates: SessionDateEntry[]; deduction: { previousRemaining: number; cap: number; deducted: number } | null; formula: string }`
  - `computeClassSessionDates(weekday: number, periodStart: Date, periodEnd: Date, closedDays: { date: Date; name: string }[]): SessionDateEntry[]`
  - `countOpenSessions(entries: SessionDateEntry[]): number`
  - `computeDeduction(previousRemaining: number | null, cap: number): number`
  - `computeTutoringProration(periodStart: Date, periodEnd: Date): number`
  - `buildClassBillDetail(entries: SessionDateEntry[], deduction: {previousRemaining: number; cap: number; deducted: number} | null, billedSessions: number, unitPrice: number): BillDetail`
  - `utcKey(d: Date): string`（'YYYY-MM-DD'）
  - `getPaidState(amountDue: number, payments: { amount: number }[]): { paid: number; outstanding: number; state: 'UNPAID' | 'PARTIAL' | 'PAID' }`（純函式，放這裡而非 billPaymentService，讓 billNotifyService／billPaymentService／學生端 UI 都能直接 import，不互相依賴）

- [ ] **Step 1: 寫失敗測試 `src/lib/billingCalc.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  computeClassSessionDates,
  countOpenSessions,
  computeDeduction,
  computeTutoringProration,
  buildClassBillDetail,
  getPaidState,
} from './billingCalc';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('computeClassSessionDates', () => {
  it('expands weekly session dates and marks closed days', () => {
    // 週六班（weekday 6），9/1～9/30：9/5, 9/12, 9/19, 9/26
    const entries = computeClassSessionDates(6, D(2026, 9, 1), D(2026, 9, 30), [
      { date: D(2026, 9, 26), name: '測試假日' },
      { date: D(2026, 9, 15), name: '不在上課日的假日' }, // 週二，不影響
    ]);
    expect(entries.map((e) => e.dateKey)).toEqual(['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']);
    expect(entries[3]).toMatchObject({ closed: true, closedName: '測試假日' });
    expect(countOpenSessions(entries)).toBe(3);
  });

  it('crosses month and year boundaries', () => {
    // 週一班（weekday 1），2026/12/28～2027/1/11：12/28, 1/4, 1/11
    const entries = computeClassSessionDates(1, D(2026, 12, 28), D(2027, 1, 11), []);
    expect(entries.map((e) => e.dateKey)).toEqual(['2026-12-28', '2027-01-04', '2027-01-11']);
  });

  it('handles sunday classes (weekday 0) and inclusive endpoints', () => {
    // 9/6 與 9/27 都是週日，區間端點含入
    const entries = computeClassSessionDates(0, D(2026, 9, 6), D(2026, 9, 27), []);
    expect(entries.map((e) => e.dateKey)).toEqual(['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
  });
});

describe('computeDeduction', () => {
  it('caps at the configured limit and floors at zero', () => {
    expect(computeDeduction(5, 2)).toBe(2);
    expect(computeDeduction(1, 2)).toBe(1);
    expect(computeDeduction(0, 2)).toBe(0);
    expect(computeDeduction(null, 2)).toBe(0); // 未設堂數上限的報名
    expect(computeDeduction(-3, 2)).toBe(0); // 超上餘額為負不倒扣
  });
});

describe('computeTutoringProration', () => {
  it('full month → 1, half month → 0.5, capped at 1', () => {
    expect(computeTutoringProration(D(2026, 9, 1), D(2026, 9, 30))).toBe(1); // 30天→4週→100%
    expect(computeTutoringProration(D(2026, 9, 15), D(2026, 9, 30))).toBe(0.5); // 16天→2週→50%
    expect(computeTutoringProration(D(2026, 9, 1), D(2026, 10, 31))).toBe(1); // 超過一個月上限 1
    expect(computeTutoringProration(D(2026, 9, 24), D(2026, 9, 30))).toBe(0.25); // 7天→1週→25%
  });
});

describe('buildClassBillDetail', () => {
  it('builds frozen detail with formula, deduction only when present', () => {
    const entries = computeClassSessionDates(6, D(2026, 9, 1), D(2026, 9, 30), [{ date: D(2026, 9, 26), name: '假日' }]);
    const withDeduction = buildClassBillDetail(entries, { previousRemaining: 5, cap: 2, deducted: 2 }, 1, 500);
    expect(withDeduction.deduction).toMatchObject({ previousRemaining: 5, deducted: 2 });
    expect(withDeduction.formula).toBe('3 − 2 ＝ 1 堂 × 500 ＝ 500 元');

    const noDeduction = buildClassBillDetail(entries, null, 3, 500);
    expect(noDeduction.deduction).toBeNull();
    expect(noDeduction.formula).toBe('3 堂 × 500 ＝ 1,500 元');
  });
});

describe('getPaidState', () => {
  it('derives UNPAID / PARTIAL / PAID from amountDue and payments', () => {
    expect(getPaidState(2000, [])).toMatchObject({ paid: 0, outstanding: 2000, state: 'UNPAID' });
    expect(getPaidState(2000, [{ amount: 500 }])).toMatchObject({ paid: 500, outstanding: 1500, state: 'PARTIAL' });
    expect(getPaidState(2000, [{ amount: 500 }, { amount: 1500 }])).toMatchObject({ outstanding: 0, state: 'PAID' });
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/billingCalc.test.ts --testTimeout=30000 --hookTimeout=60000`
Expected: FAIL（module 不存在）。

- [ ] **Step 3: 實作 `src/lib/billingCalc.ts`**

```ts
// 收費模組計算引擎：純函式、不碰 DB。日期一律 UTC 日曆日。

export interface SessionDateEntry {
  dateKey: string; // 'YYYY-MM-DD'
  closed: boolean;
  closedName?: string;
}

export interface BillDetail {
  sessionDates: SessionDateEntry[];
  deduction: { previousRemaining: number; cap: number; deducted: number } | null;
  formula: string;
}

export function utcKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeClassSessionDates(
  weekday: number,
  periodStart: Date,
  periodEnd: Date,
  closedDays: { date: Date; name: string }[]
): SessionDateEntry[] {
  const closedByKey = new Map(closedDays.map((c) => [utcKey(c.date), c.name]));
  const entries: SessionDateEntry[] = [];
  // 從區間起日往後找到第一個該 weekday，再一週一週跳。
  const cursor = new Date(periodStart.getTime());
  const offset = (weekday - cursor.getUTCDay() + 7) % 7;
  cursor.setUTCDate(cursor.getUTCDate() + offset);
  while (cursor.getTime() <= periodEnd.getTime()) {
    const key = utcKey(cursor);
    const closedName = closedByKey.get(key);
    entries.push(closedName ? { dateKey: key, closed: true, closedName } : { dateKey: key, closed: false });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return entries;
}

export function countOpenSessions(entries: SessionDateEntry[]): number {
  return entries.filter((e) => !e.closed).length;
}

export function computeDeduction(previousRemaining: number | null, cap: number): number {
  return Math.max(0, Math.min(previousRemaining ?? 0, cap));
}

// 月費折算：週數 = round(天數/7)，比例 = min(1, 週數/4)。整月＝全額。
export function computeTutoringProration(periodStart: Date, periodEnd: Date): number {
  const days = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1;
  return Math.min(1, Math.round(days / 7) / 4);
}

export function buildClassBillDetail(
  entries: SessionDateEntry[],
  deduction: { previousRemaining: number; cap: number; deducted: number } | null,
  billedSessions: number,
  unitPrice: number
): BillDetail {
  const open = countOpenSessions(entries);
  const amount = (billedSessions * unitPrice).toLocaleString('en-US');
  const formula = deduction && deduction.deducted > 0
    ? `${open} − ${deduction.deducted} ＝ ${billedSessions} 堂 × ${unitPrice} ＝ ${amount} 元`
    : `${billedSessions} 堂 × ${unitPrice} ＝ ${amount} 元`;
  return { sessionDates: entries, deduction: deduction && deduction.deducted > 0 ? deduction : null, formula };
}

// 已繳/尚欠/繳費狀態的唯一算法——billPaymentService、billNotifyService（催繳）、
// 學生端 UI 都從這裡 import，不互相依賴，避免循環 import。
export function getPaidState(amountDue: number, payments: { amount: number }[]) {
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = amountDue - paid;
  return { paid, outstanding, state: paid === 0 ? ('UNPAID' as const) : outstanding > 0 ? ('PARTIAL' as const) : ('PAID' as const) };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/billingCalc.test.ts --testTimeout=30000 --hookTimeout=60000`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/billingCalc.ts src/lib/billingCalc.test.ts
git commit -m "feat: 收費計算引擎（堂數展開/假日扣除/折抵上限/月費折算，純函式）"
```

---

### Task 4: billingSettingService＋tutoringFeeTierService

**Files:**
- Create: `src/lib/services/billingSettingService.ts`
- Create: `src/lib/services/billingSettingService.test.ts`
- Create: `src/lib/services/tutoringFeeTierService.ts`
- Create: `src/lib/services/tutoringFeeTierService.test.ts`

**Interfaces:**
- Produces:
  - `getBillingSetting(): Promise<{ deductionCap: number; paymentInfo: string }>`（無列時自動建立預設 `{deductionCap: 2, paymentInfo: ''}`）
  - `updateBillingSetting(input: { deductionCap?: number; paymentInfo?: string }): Promise<void>`（`deductionCap < 0` 丟 `Error('INVALID_CAP')`）
  - `listFeeTiers(): Promise<TutoringFeeTier[]>`（sortOrder asc）
  - `createFeeTier(input: { name: string; sessionsPerWeek: number; monthlyFee: number }): Promise<TutoringFeeTier>`
  - `updateFeeTier(id: string, input: { name?: string; sessionsPerWeek?: number; monthlyFee?: number }): Promise<TutoringFeeTier>`
  - `deleteFeeTier(id: string): Promise<void>`（有報名引用時丟 `Error('TIER_IN_USE')`）
  - `seedDefaultFeeTiers(): Promise<void>`（表空時建「一週兩堂 3000／一週一堂 1500」，冪等）
  - `setEnrollmentFeeTier(enrollmentId: string, feeTierId: string | null): Promise<void>`

- [ ] **Step 1: 寫失敗測試（兩個檔案）**

`src/lib/services/billingSettingService.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { getBillingSetting, updateBillingSetting } from './billingSettingService';

describe('billingSettingService', () => {
  it('returns defaults on first read and persists updates', async () => {
    const initial = await getBillingSetting();
    expect(initial).toMatchObject({ deductionCap: 2, paymentInfo: '' });

    await updateBillingSetting({ deductionCap: 3, paymentInfo: '銀行帳戶 123' });
    expect(await getBillingSetting()).toMatchObject({ deductionCap: 3, paymentInfo: '銀行帳戶 123' });
  });

  it('rejects a negative cap', async () => {
    await expect(updateBillingSetting({ deductionCap: -1 })).rejects.toThrow('INVALID_CAP');
  });
});
```

`src/lib/services/tutoringFeeTierService.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { createProgram } from './tutoringProgramService';
import {
  listFeeTiers, createFeeTier, updateFeeTier, deleteFeeTier, seedDefaultFeeTiers, setEnrollmentFeeTier,
} from './tutoringFeeTierService';

describe('tutoringFeeTierService', () => {
  it('seeds defaults once, lists in sort order', async () => {
    await seedDefaultFeeTiers();
    await seedDefaultFeeTiers(); // 冪等
    const tiers = await listFeeTiers();
    expect(tiers.map((t) => [t.name, t.monthlyFee])).toEqual([
      ['一週兩堂', 3000],
      ['一週一堂', 1500],
    ]);
  });

  it('creates, updates, and blocks deleting a tier in use', async () => {
    const tier = await createFeeTier({ name: '一週三堂', sessionsPerWeek: 3, monthlyFee: 4200 });
    await updateFeeTier(tier.id, { monthlyFee: 4500 });
    expect((await listFeeTiers()).find((t) => t.id === tier.id)?.monthlyFee).toBe(4500);

    const student = await createStudent({ name: '小明', email: 'tier-ming@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
    await setEnrollmentFeeTier(enrollment.id, tier.id);
    await expect(deleteFeeTier(tier.id)).rejects.toThrow('TIER_IN_USE');

    await setEnrollmentFeeTier(enrollment.id, null);
    await deleteFeeTier(tier.id); // 解除引用後可刪
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/billingSettingService.test.ts src/lib/services/tutoringFeeTierService.test.ts --testTimeout=30000 --hookTimeout=60000`
Expected: FAIL。

- [ ] **Step 3: 實作兩個 service**

`src/lib/services/billingSettingService.ts`：

```ts
import { prisma } from '@/lib/db';

export async function getBillingSetting() {
  const row = await prisma.billingSetting.upsert({
    where: { id: 'main' },
    create: { id: 'main' },
    update: {},
  });
  return { deductionCap: row.deductionCap, paymentInfo: row.paymentInfo };
}

export async function updateBillingSetting(input: { deductionCap?: number; paymentInfo?: string }): Promise<void> {
  if (input.deductionCap !== undefined && input.deductionCap < 0) throw new Error('INVALID_CAP');
  await prisma.billingSetting.upsert({
    where: { id: 'main' },
    create: { id: 'main', ...input },
    update: input,
  });
}
```

`src/lib/services/tutoringFeeTierService.ts`：

```ts
import { prisma } from '@/lib/db';

export function listFeeTiers() {
  return prisma.tutoringFeeTier.findMany({ orderBy: { sortOrder: 'asc' } });
}

export function createFeeTier(input: { name: string; sessionsPerWeek: number; monthlyFee: number }) {
  return prisma.tutoringFeeTier.create({ data: { ...input, sortOrder: input.sessionsPerWeek * -1 } });
}

export function updateFeeTier(id: string, input: { name?: string; sessionsPerWeek?: number; monthlyFee?: number }) {
  return prisma.tutoringFeeTier.update({ where: { id }, data: input });
}

export async function deleteFeeTier(id: string): Promise<void> {
  const inUse = await prisma.tutoringEnrollment.count({ where: { feeTierId: id } });
  if (inUse > 0) throw new Error('TIER_IN_USE');
  await prisma.tutoringFeeTier.delete({ where: { id } });
}

// 預設級距：一週兩堂 3000／一週一堂 1500（表空時才建）
export async function seedDefaultFeeTiers(): Promise<void> {
  const count = await prisma.tutoringFeeTier.count();
  if (count > 0) return;
  await prisma.tutoringFeeTier.createMany({
    data: [
      { name: '一週兩堂', sessionsPerWeek: 2, monthlyFee: 3000, sortOrder: 0 },
      { name: '一週一堂', sessionsPerWeek: 1, monthlyFee: 1500, sortOrder: 1 },
    ],
  });
}

export async function setEnrollmentFeeTier(enrollmentId: string, feeTierId: string | null): Promise<void> {
  await prisma.tutoringEnrollment.update({ where: { id: enrollmentId }, data: { feeTierId } });
}
```

（`createFeeTier` 的 `sortOrder: sessionsPerWeek * -1` 讓堂數多的排前面，跟預設一致。）

- [ ] **Step 4: 跑測試確認通過＋commit**

Run: `npx vitest run src/lib/services/billingSettingService.test.ts src/lib/services/tutoringFeeTierService.test.ts --testTimeout=30000 --hookTimeout=60000`
Expected: PASS。

```bash
git add src/lib/services/billingSettingService.ts src/lib/services/billingSettingService.test.ts src/lib/services/tutoringFeeTierService.ts src/lib/services/tutoringFeeTierService.test.ts
git commit -m "feat: 收費設定（折抵上限/繳費資訊）＋英數級距表服務"
```

---

### Task 5: 班級單價＋學生覆寫價（服務層＋後台表單）

**Files:**
- Modify: `src/lib/services/classService.ts`（`CreateClassInput`/`UpdateClassInput`/`EnrollmentInput` 加價格欄位）
- Modify: `src/lib/services/classService.test.ts`
- Modify: `src/app/admin/classes/page.tsx`（班級編輯 Modal 加「每堂單價」欄位）
- Modify: `src/app/admin/students/page.tsx`（報名管理的每列報名加「覆寫價」欄位；找到 totalSessions 輸入框旁）

**Interfaces:**
- Consumes: Task 1 的 `Class.feePerSession`、`ClassEnrollment.feeOverride`。
- Produces: `CreateClassInput`/`UpdateClassInput` 多 `feePerSession?: number | null`；`EnrollmentInput` 多 `feeOverride?: number | null`（`setStudentEnrollments` 寫入）。

- [ ] **Step 1: 在 `classService.test.ts` 加失敗測試**

```ts
describe('class fee fields', () => {
  it('stores feePerSession on class and feeOverride on enrollment', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'fee-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'fee-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
    expect(cls.feePerSession).toBe(500);

    await updateClass(cls.id, { feePerSession: 550 });
    expect((await prisma.class.findUniqueOrThrow({ where: { id: cls.id } })).feePerSession).toBe(550);

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: null, feeOverride: 450 }]);
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(enrollment.feeOverride).toBe(450);
  });
});
```

- [ ] **Step 2: 跑 `npx vitest run src/lib/services/classService.test.ts --testTimeout=30000 --hookTimeout=60000`** — Expected: FAIL（型別錯誤／欄位不存在）。

- [ ] **Step 3: 實作服務層**：`CreateClassInput`/`UpdateClassInput` 各加 `feePerSession?: number | null`（`createClass`/`updateClass` 直接透傳，Prisma data 已涵蓋）；`EnrollmentInput` 加 `feeOverride?: number | null`，`setStudentEnrollments` 的 `toAdd` create data 與 `toUpdate` update data 各補 `feeOverride: e.feeOverride ?? null`。`CLASS_WITH_TEACHER_SELECT` 加 `feePerSession: true`，enrollments select 加 `feeOverride: true`（班級管理頁要顯示）。

- [ ] **Step 4: 跑同一測試** — Expected: PASS。既有 setStudentEnrollments 測試也要仍綠（回歸）。

- [ ] **Step 5: 後台表單**：
  - `admin/classes/page.tsx` 班級編輯 Modal：在 endTime 欄位之後加一個共用 `Input`（`type="number"`、label「每堂單價（元）」、空值存 null），state 與 submit payload 帶 `feePerSession`。
  - `admin/students/page.tsx` 報名管理：每列報名在 totalSessions 輸入框旁加共用 `Input`（`type="number"`、placeholder「覆寫價」、寬度比照堂數框），空值＝null＝用班級價；submit 的 enrollments payload 帶 `feeOverride`。
  - 對應的 API route（`/api/classes`、學生報名更新 route）把新欄位透傳（找到現有 body 解構處加欄位）。

- [ ] **Step 6: 驗證＋commit**

Run: `npx tsc --noEmit && npx eslint src/app/admin/classes/page.tsx src/app/admin/students/page.tsx src/lib/services/classService.ts`
Expected: 乾淨。dev server 手動確認兩個表單可存值。

```bash
git add src/lib/services/classService.ts src/lib/services/classService.test.ts src/app/admin/classes/page.tsx src/app/admin/students/page.tsx src/app/api/classes/route.ts
git commit -m "feat: 班級每堂單價＋學生覆寫價（服務層＋後台表單）"
```

---

### Task 6: billingBatchService — 草稿產生＋重疊偵測

**Files:**
- Create: `src/lib/services/billingBatchService.ts`
- Create: `src/lib/services/billingBatchService.test.ts`

**Interfaces:**
- Consumes: `computeClassSessionDates`/`countOpenSessions`/`computeDeduction`/`computeTutoringProration`/`buildClassBillDetail`（Task 3）、`listClosedDays`（Task 2）、`getBillingSetting`（Task 4）、`getClassEnrollmentQuota`（attendanceService）。
- Produces:
  - `interface SkippedRow { studentName: string; targetName: string; reason: string }`
  - `createClassBatch(input: { periodStart: Date; periodEnd: Date; classIds: string[] }): Promise<{ batchId: string; skipped: SkippedRow[] }>`
  - `createTutoringBatch(input: { periodStart: Date; periodEnd: Date; programIds: string[] }): Promise<{ batchId: string; skipped: SkippedRow[] }>`
  - `listBatches(): Promise<{ id; kind; periodStart; periodEnd; status; totalDue: number; totalPaid: number; totalOutstanding: number }[]>`（createdAt desc；DRAFT 的三個 total 為 null）
  - `getBatchDetail(batchId)`：batch＋bills（含 student.user.name、class.name／program 名、payments、notifiedAt）
  - `updateDraftBill(billId, input: { billedSessions?: number; amountDue?: number; note?: string }): Promise<void>`（billedSessions 變更且 unitPrice 非 null 時自動重算 amountDue 與 detail.formula；FINALIZED 帳單丟 `Error('BILL_FINALIZED')`）
  - `deleteDraftBill(billId)` / `deleteDraftBatch(batchId)`（僅 DRAFT）
  - 重疊規則：同 studentId × 同 classId（或 tutoringEnrollmentId）存在任何 Bill 滿足 `periodStart <= 新End AND periodEnd >= 新Start` → 跳過（含其他批次的 DRAFT）。

- [ ] **Step 1: 寫失敗測試 `billingBatchService.test.ts`**（fixture helper 共用）

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { addClosedDay } from './closedDayService';
import { updateBillingSetting } from './billingSettingService';
import { createProgram } from './tutoringProgramService';
import { seedDefaultFeeTiers, listFeeTiers, setEnrollmentFeeTier } from './tutoringFeeTierService';
import { createClassBatch, createTutoringBatch, listBatches, getBatchDetail, updateDraftBill, deleteDraftBatch } from './billingBatchService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

async function setupClassFixture() {
  const teacher = await createTeacher({ name: '陳老師', email: `bb-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `bb-s-${Date.now()}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  return { teacher, student, cls };
}

describe('createClassBatch', () => {
  it('generates draft bills: session count minus closed days, price from class', async () => {
    const { student, cls } = await setupClassFixture();
    await addClosedDay(D(2026, 9, 26), '測試假日'); // 週六
    const { batchId, skipped } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    expect(skipped).toHaveLength(0);

    const detail = await getBatchDetail(batchId);
    expect(detail.bills).toHaveLength(1);
    const bill = detail.bills[0];
    // 9/5,12,19,26 共 4 個週六，扣假日 1 → 3 堂 × 500
    expect(bill).toMatchObject({ sessionsTotal: 3, deductedSessions: 0, billedSessions: 3, unitPrice: 500, amountDue: 1500, status: 'DRAFT' });
    const d = bill.detail as { sessionDates: { dateKey: string; closed: boolean }[] };
    expect(d.sessionDates).toHaveLength(4);
    expect(d.sessionDates.filter((e) => e.closed)).toHaveLength(1);
    expect(bill.studentId).toBe(student.id);
  });

  it('applies previous-remaining deduction up to the cap', async () => {
    const { student, cls } = await setupClassFixture();
    // 充值 5 堂、沒上過課 → 剩餘 5；cap 預設 2
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 5 } });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    const bill = (await getBatchDetail(batchId)).bills[0];
    // 4 堂 − 折抵 2 ＝ 2 堂 × 500
    expect(bill).toMatchObject({ sessionsTotal: 4, deductedSessions: 2, billedSessions: 2, amountDue: 1000 });
    const d = bill.detail as { deduction: { previousRemaining: number; cap: number; deducted: number } };
    expect(d.deduction).toMatchObject({ previousRemaining: 5, cap: 2, deducted: 2 });
  });

  it('respects a changed cap from settings', async () => {
    const { student, cls } = await setupClassFixture();
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 5 } });
    await updateBillingSetting({ deductionCap: 4 });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    expect((await getBatchDetail(batchId)).bills[0]).toMatchObject({ deductedSessions: 4, billedSessions: 0, amountDue: 0 });
  });

  it('marks missing unit price with amountDue 0 and null unitPrice', async () => {
    const { cls } = await setupClassFixture();
    await prisma.class.update({ where: { id: cls.id }, data: { feePerSession: null } });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    expect((await getBatchDetail(batchId)).bills[0]).toMatchObject({ unitPrice: null, amountDue: 0 });
  });

  it('uses feeOverride over class price', async () => {
    const { student, cls } = await setupClassFixture();
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { feeOverride: 450 } });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    expect((await getBatchDetail(batchId)).bills[0]).toMatchObject({ unitPrice: 450, amountDue: 4 * 450 });
  });

  it('skips a student whose existing bill overlaps (including partial overlap)', async () => {
    const { student, cls } = await setupClassFixture();
    await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 11, 30), classIds: [cls.id] });
    const { batchId, skipped } = await createClassBatch({ periodStart: D(2026, 11, 1), periodEnd: D(2027, 1, 31), classIds: [cls.id] });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ studentName: '小明', targetName: '週六基礎班' });
    expect(skipped[0].reason).toContain('已有');
    expect((await getBatchDetail(batchId)).bills).toHaveLength(0);
  });

  it('does not skip a fully non-overlapping period, or a different class for the same student', async () => {
    const { student, cls } = await setupClassFixture();
    await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });

    // 完全不重疊的下一期：正常產生
    const nextPeriod = await createClassBatch({ periodStart: D(2026, 10, 1), periodEnd: D(2026, 10, 31), classIds: [cls.id] });
    expect(nextPeriod.skipped).toHaveLength(0);
    expect((await getBatchDetail(nextPeriod.batchId)).bills).toHaveLength(1);

    // 同學生、同區間、但「不同班級」——不該被誤判成重疊而跳過
    const teacher2 = await createTeacher({ name: '林老師', email: `bb-other-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const otherClass = await createClass({ name: '週三班', subject: '圍棋', level: '基礎', teacherId: teacher2.id, weekday: 3, startTime: '18:00', endTime: '20:00', feePerSession: 500 });
    await enrollStudent(otherClass.id, student.id);
    const otherClassBatch = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [otherClass.id] });
    expect(otherClassBatch.skipped).toHaveLength(0);
    expect((await getBatchDetail(otherClassBatch.batchId)).bills).toHaveLength(1);
  });
});

describe('createTutoringBatch', () => {
  it('bills full monthly fee per enrolled tier; skips enrollments without a tier', async () => {
    await seedDefaultFeeTiers();
    const tiers = await listFeeTiers();
    const s1 = await createStudent({ name: '小華', email: `bb-t1-${Date.now()}@example.com`, password: 'x' });
    const s2 = await createStudent({ name: '小美', email: `bb-t2-${Date.now()}@example.com`, password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    const e1 = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: s1.id } });
    await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: s2.id } }); // 無級距
    await setEnrollmentFeeTier(e1.id, tiers[0].id); // 一週兩堂 3000

    const { batchId, skipped } = await createTutoringBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), programIds: [program.id] });
    const detail = await getBatchDetail(batchId);
    expect(detail.bills).toHaveLength(1);
    expect(detail.bills[0]).toMatchObject({ monthlyFee: 3000, prorationRatio: 1, amountDue: 3000 });
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain('級距');
  });
});

describe('draft editing', () => {
  it('recomputes amount when billedSessions changes; batch totals null while draft; deleteDraftBatch removes all', async () => {
    const { cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    const bill = (await getBatchDetail(batchId)).bills[0];

    await updateDraftBill(bill.id, { billedSessions: 2 });
    expect((await getBatchDetail(batchId)).bills[0]).toMatchObject({ billedSessions: 2, amountDue: 1000 });

    const rows = await listBatches();
    expect(rows.find((b) => b.id === batchId)?.status).toBe('DRAFT');

    await deleteDraftBatch(batchId);
    expect(await prisma.bill.count({ where: { batchId } })).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗** — `npx vitest run src/lib/services/billingBatchService.test.ts --testTimeout=30000 --hookTimeout=60000` → FAIL。

- [ ] **Step 3: 實作 `billingBatchService.ts`**

```ts
import { prisma } from '@/lib/db';
import { listClosedDays } from './closedDayService';
import { getBillingSetting } from './billingSettingService';
import {
  buildClassBillDetail, computeClassSessionDates, computeDeduction, countOpenSessions,
} from '@/lib/billingCalc';

export interface SkippedRow { studentName: string; targetName: string; reason: string }

const fmtRange = (s: Date, e: Date) => `${s.toISOString().slice(0, 10)}～${e.toISOString().slice(0, 10)}`;

async function overlappingClassBill(studentId: string, classId: string, periodStart: Date, periodEnd: Date) {
  return prisma.bill.findFirst({
    where: { studentId, classId, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } },
    select: { periodStart: true, periodEnd: true },
  });
}

export async function createClassBatch(input: { periodStart: Date; periodEnd: Date; classIds: string[] }) {
  const [closedDays, setting, classes] = await Promise.all([
    listClosedDays(input.periodStart, input.periodEnd),
    getBillingSetting(),
    prisma.class.findMany({
      where: { id: { in: input.classIds }, active: true },
      select: {
        id: true, name: true, weekday: true, feePerSession: true,
        enrollments: { select: { studentId: true, totalSessions: true, feeOverride: true, student: { select: { user: { select: { name: true } } } } } },
      },
    }),
  ]);
  const skipped: SkippedRow[] = [];
  const batch = await prisma.billingBatch.create({ data: { kind: 'CLASS', periodStart: input.periodStart, periodEnd: input.periodEnd } });

  for (const cls of classes) {
    const entries = computeClassSessionDates(cls.weekday, input.periodStart, input.periodEnd, closedDays);
    const open = countOpenSessions(entries);
    for (const e of cls.enrollments) {
      const existing = await overlappingClassBill(e.studentId, cls.id, input.periodStart, input.periodEnd);
      if (existing) {
        skipped.push({ studentName: e.student.user.name, targetName: cls.name, reason: `已有 ${fmtRange(existing.periodStart, existing.periodEnd)} 的帳單涵蓋本區間，本批略過` });
        continue;
      }
      // 剩餘＝totalSessions − 已扣堂（請假/未報名不扣，同 getClassEnrollmentQuota 語意）
      const used = await prisma.classAttendance.count({ where: { classId: cls.id, studentId: e.studentId, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } } });
      const remaining = e.totalSessions === null ? null : e.totalSessions - used;
      const deducted = computeDeduction(remaining, setting.deductionCap);
      const billed = Math.max(0, open - deducted);
      const unitPrice = e.feeOverride ?? cls.feePerSession ?? null;
      const detail = unitPrice === null
        ? { sessionDates: entries, deduction: null, formula: '（請先設定班級單價）' }
        : buildClassBillDetail(entries, deducted > 0 ? { previousRemaining: remaining ?? 0, cap: setting.deductionCap, deducted } : null, billed, unitPrice);
      await prisma.bill.create({
        data: {
          batchId: batch.id, studentId: e.studentId, classId: cls.id,
          periodStart: input.periodStart, periodEnd: input.periodEnd,
          sessionsTotal: open, deductedSessions: deducted, billedSessions: billed,
          unitPrice, amountDue: unitPrice === null ? 0 : billed * unitPrice, detail,
        },
      });
    }
  }
  return { batchId: batch.id, skipped };
}

export async function createTutoringBatch(input: { periodStart: Date; periodEnd: Date; programIds: string[] }) {
  const enrollments = await prisma.tutoringEnrollment.findMany({
    where: { programId: { in: input.programIds }, active: true },
    select: { id: true, feeTier: true, program: { select: { name: true } }, studentId: true, student: { select: { user: { select: { name: true } } } } },
  });
  const skipped: SkippedRow[] = [];
  const batch = await prisma.billingBatch.create({ data: { kind: 'TUTORING', periodStart: input.periodStart, periodEnd: input.periodEnd } });
  for (const e of enrollments) {
    if (!e.feeTier) {
      skipped.push({ studentName: e.student.user.name, targetName: e.program.name, reason: '尚未指定收費級距，本批略過' });
      continue;
    }
    const existing = await prisma.bill.findFirst({
      where: { tutoringEnrollmentId: e.id, periodStart: { lte: input.periodEnd }, periodEnd: { gte: input.periodStart } },
      select: { periodStart: true, periodEnd: true },
    });
    if (existing) {
      skipped.push({ studentName: e.student.user.name, targetName: e.program.name, reason: `已有 ${fmtRange(existing.periodStart, existing.periodEnd)} 的帳單涵蓋本區間，本批略過` });
      continue;
    }
    await prisma.bill.create({
      data: {
        batchId: batch.id, studentId: e.studentId, tutoringEnrollmentId: e.id,
        periodStart: input.periodStart, periodEnd: input.periodEnd,
        monthlyFee: e.feeTier.monthlyFee, prorationRatio: 1, amountDue: e.feeTier.monthlyFee,
        detail: { sessionDates: [], deduction: null, formula: `月費（${e.feeTier.name}）＝ ${e.feeTier.monthlyFee.toLocaleString('en-US')} 元` },
      },
    });
  }
  return { batchId: batch.id, skipped };
}

export async function listBatches() {
  const batches = await prisma.billingBatch.findMany({
    orderBy: { createdAt: 'desc' },
    include: { bills: { select: { amountDue: true, status: true, payments: { select: { amount: true } } } } },
  });
  return batches.map((b) => {
    const finalized = b.status === 'FINALIZED';
    const totalDue = b.bills.reduce((s, bill) => s + bill.amountDue, 0);
    const totalPaid = b.bills.reduce((s, bill) => s + bill.payments.reduce((p, x) => p + x.amount, 0), 0);
    return {
      id: b.id, kind: b.kind, periodStart: b.periodStart, periodEnd: b.periodEnd, status: b.status,
      totalDue: finalized ? totalDue : null, totalPaid: finalized ? totalPaid : null,
      totalOutstanding: finalized ? totalDue - totalPaid : null,
    };
  });
}

const BILL_DETAIL_INCLUDE = {
  student: { select: { id: true, userId: true, user: { select: { name: true } } } },
  class: { select: { name: true } },
  tutoringEnrollment: { select: { program: { select: { name: true } }, feeTier: { select: { name: true } } } },
  payments: { orderBy: { paidOn: 'asc' as const } },
} as const;

export async function getBatchDetail(batchId: string) {
  return prisma.billingBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { bills: { include: BILL_DETAIL_INCLUDE, orderBy: { createdAt: 'asc' } } },
  }).then((batch) => ({ ...batch, bills: batch.bills }));
}

export async function updateDraftBill(billId: string, input: { billedSessions?: number; amountDue?: number; note?: string }) {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
  if (bill.status === 'FINALIZED') throw new Error('BILL_FINALIZED');
  const data: { billedSessions?: number; amountDue?: number; note?: string; detail?: object } = { ...input };
  if (input.billedSessions !== undefined && bill.unitPrice !== null && input.amountDue === undefined) {
    data.amountDue = input.billedSessions * bill.unitPrice;
    const detail = bill.detail as { sessionDates: unknown[]; deduction: { previousRemaining: number; cap: number; deducted: number } | null };
    const amount = data.amountDue.toLocaleString('en-US');
    const formula = detail.deduction
      ? `${bill.sessionsTotal} − ${detail.deduction.deducted} ＝ ${input.billedSessions} 堂 × ${bill.unitPrice} ＝ ${amount} 元（手動調整）`
      : `${input.billedSessions} 堂 × ${bill.unitPrice} ＝ ${amount} 元`;
    data.detail = { ...detail, formula };
  }
  await prisma.bill.update({ where: { id: billId }, data });
}

export async function deleteDraftBill(billId: string): Promise<void> {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, select: { status: true } });
  if (bill.status === 'FINALIZED') throw new Error('BILL_FINALIZED');
  await prisma.bill.delete({ where: { id: billId } });
}

export async function deleteDraftBatch(batchId: string): Promise<void> {
  const batch = await prisma.billingBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true } });
  if (batch.status === 'FINALIZED') throw new Error('BATCH_FINALIZED');
  await prisma.billingBatch.delete({ where: { id: batchId } }); // bills onDelete: Cascade
}
```

- [ ] **Step 4: 跑測試確認通過＋commit**

```bash
git add src/lib/services/billingBatchService.ts src/lib/services/billingBatchService.test.ts
git commit -m "feat: 收費批次草稿產生（堂數/折抵/單價解析）＋重疊偵測"
```

---

### Task 7: 批次定案＋自動充值＋通知選項

**Files:**
- Modify: `src/lib/services/billingBatchService.ts`
- Modify: `src/lib/services/billingBatchService.test.ts`
- Create: `src/lib/services/billNotifyService.ts`（通知共用，Task 10 也用）

**Interfaces:**
- Consumes: `addEnrollmentSessions(classId, studentId, amount, options?)`（classService）、`notifyUser(userId, {title, body, url})`。
- Produces:
  - `finalizeBatch(batchId: string, options: { notifyNow: boolean }): Promise<void>`——CLASS 批次有 `unitPrice === null` 的帳單時丟 `Error('MISSING_PRICE')`；定案＝batch/bills 轉 FINALIZED＋每張 CLASS 帳單 `addEnrollmentSessions(classId, studentId, billedSessions)`（billedSessions 0 的跳過充值）；`notifyNow` 時呼叫 `notifyBills(所有 bill id)`。
  - `notifyBills(billIds: string[]): Promise<void>`（billNotifyService）——逐張：`notifyUser(bill.student.userId, { title: '繳費通知', body: '{項目} {M/D～M/D} 應繳 {金額} 元', url: '/student/billing' })`＋set `notifiedAt: new Date()`；只接受 FINALIZED 帳單（DRAFT 丟 `Error('BILL_NOT_FINALIZED')`）。

- [ ] **Step 1: 加失敗測試（billingBatchService.test.ts 追加）**

```ts
import { finalizeBatch } from './billingBatchService';
import { notifyBills } from './billNotifyService';

describe('finalizeBatch', () => {
  it('finalizes bills, tops up class sessions, and stamps notifiedAt when notifyNow', async () => {
    const { student, cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await finalizeBatch(batchId, { notifyNow: true });

    const detail = await getBatchDetail(batchId);
    expect(detail.status).toBe('FINALIZED');
    expect(detail.bills[0].status).toBe('FINALIZED');
    expect(detail.bills[0].notifiedAt).not.toBeNull();

    // 自動充值：totalSessions 從 null → 4（開一期）
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(enrollment.totalSessions).toBe(4);
    expect(await prisma.enrollmentPeriod.count({ where: { enrollmentId: enrollment.id } })).toBe(1);

    // 收件夾有通知
    const notes = await prisma.notification.findMany({ where: { userId: (await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).userId } });
    expect(notes.some((n) => n.title === '繳費通知')).toBe(true);
  });

  it('does not notify when notifyNow=false; notifyBills later stamps notifiedAt', async () => {
    const { cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await finalizeBatch(batchId, { notifyNow: false });
    let bill = (await getBatchDetail(batchId)).bills[0];
    expect(bill.notifiedAt).toBeNull();

    await notifyBills([bill.id]);
    bill = (await getBatchDetail(batchId)).bills[0];
    expect(bill.notifiedAt).not.toBeNull();
  });

  it('refuses to finalize with a missing unit price and refuses double finalize', async () => {
    const { cls } = await setupClassFixture();
    await prisma.class.update({ where: { id: cls.id }, data: { feePerSession: null } });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await expect(finalizeBatch(batchId, { notifyNow: false })).rejects.toThrow('MISSING_PRICE');

    await prisma.class.update({ where: { id: cls.id }, data: { feePerSession: 500 } });
    await prisma.bill.updateMany({ where: { batchId }, data: { unitPrice: 500, amountDue: 2000 } });
    await finalizeBatch(batchId, { notifyNow: false });
    await expect(finalizeBatch(batchId, { notifyNow: false })).rejects.toThrow('BATCH_FINALIZED');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗。**

- [ ] **Step 3: 實作**

`billNotifyService.ts`：

```ts
import { prisma } from '@/lib/db';
import { notifyUser } from './notificationService';
import { formatDateWithWeekday } from '@/lib/dateFormat';

const BILL_NOTIFY_INCLUDE = {
  student: { select: { userId: true } },
  class: { select: { name: true } },
  tutoringEnrollment: { select: { program: { select: { name: true } } } },
} as const;

export function billTargetName(bill: { class: { name: string } | null; tutoringEnrollment: { program: { name: string } } | null }): string {
  return bill.class?.name ?? bill.tutoringEnrollment?.program.name ?? '';
}

export async function notifyBills(billIds: string[]): Promise<void> {
  const bills = await prisma.bill.findMany({ where: { id: { in: billIds } }, include: BILL_NOTIFY_INCLUDE });
  if (bills.some((b) => b.status !== 'FINALIZED')) throw new Error('BILL_NOT_FINALIZED');
  const now = new Date();
  for (const bill of bills) {
    await notifyUser(bill.student.userId, {
      title: '繳費通知',
      body: `${billTargetName(bill)} ${formatDateWithWeekday(bill.periodStart)}～${formatDateWithWeekday(bill.periodEnd)} 應繳 ${bill.amountDue.toLocaleString('en-US')} 元，點擊查看明細`,
      url: '/student/billing',
    });
    await prisma.bill.update({ where: { id: bill.id }, data: { notifiedAt: now } });
  }
}
```

`billingBatchService.ts` 追加：

```ts
import { addEnrollmentSessions } from './classService';
import { notifyBills } from './billNotifyService';

export async function finalizeBatch(batchId: string, options: { notifyNow: boolean }): Promise<void> {
  const batch = await prisma.billingBatch.findUniqueOrThrow({ where: { id: batchId }, include: { bills: true } });
  if (batch.status === 'FINALIZED') throw new Error('BATCH_FINALIZED');
  if (batch.kind === 'CLASS' && batch.bills.some((b) => b.unitPrice === null)) throw new Error('MISSING_PRICE');

  await prisma.$transaction([
    prisma.billingBatch.update({ where: { id: batchId }, data: { status: 'FINALIZED', finalizedAt: new Date() } }),
    prisma.bill.updateMany({ where: { batchId }, data: { status: 'FINALIZED' } }),
  ]);
  // 定案即自動充值（開一期）：帳與堂一致；billedSessions 0 沒東西可充。
  for (const bill of batch.bills) {
    if (bill.classId && (bill.billedSessions ?? 0) > 0) {
      await addEnrollmentSessions(bill.classId, bill.studentId, bill.billedSessions as number);
    }
  }
  if (options.notifyNow) await notifyBills(batch.bills.map((b) => b.id));
}
```

- [ ] **Step 4: 跑整檔測試確認全綠＋commit**

```bash
git add src/lib/services/billingBatchService.ts src/lib/services/billingBatchService.test.ts src/lib/services/billNotifyService.ts
git commit -m "feat: 批次定案（凍結＋自動充值）＋繳費通知（立即/稍後）"
```

---

### Task 8: 單獨開單（standalone bill）

**Files:**
- Create: `src/lib/services/standaloneBillService.ts`
- Create: `src/lib/services/standaloneBillService.test.ts`

**Interfaces:**
- Consumes: Task 3 引擎、Task 2/4 設定、Task 7 `notifyBills`、`addEnrollmentSessions`。
- Produces:
  - `previewStandaloneClassBill(input: { studentId: string; classId: string; periodStart: Date; periodEnd: Date }): Promise<{ sessionsTotal; deductedSessions; billedSessions; unitPrice; amountDue; detail; overlapWarning: string | null }>`（不寫 DB；重疊時 overlapWarning 帶說明但不擋——單獨開單本來就是補開用，由行政自行判斷）
  - `previewStandaloneTutoringBill(input: { enrollmentId: string; periodStart: Date; periodEnd: Date }): Promise<{ monthlyFee; prorationRatio; amountDue; overlapWarning: string | null }>`（無級距丟 `Error('NO_FEE_TIER')`）
  - `createStandaloneClassBill(input: { studentId; classId; periodStart; periodEnd; billedSessions: number; amountDue: number; note?: string; notifyNow: boolean }): Promise<{ billId: string }>`——以 preview 重算 detail、直接建 `status: 'FINALIZED'`、`batchId: null`，充值 billedSessions（>0 時），`notifyNow` 走 `notifyBills`。單價未設丟 `Error('MISSING_PRICE')`。
  - `createStandaloneTutoringBill(input: { enrollmentId; periodStart; periodEnd; amountDue: number; note?: string; notifyNow: boolean }): Promise<{ billId: string }>`
  - `listStandaloneBills()`：`batchId: null` 的帳單（含付款、通知狀態），createdAt desc。

- [ ] **Step 1: 寫失敗測試**（fixture 同 Task 6 寫法，另建檔案內 helper；不 import Task 6 測試檔）

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createProgram } from './tutoringProgramService';
import { seedDefaultFeeTiers, listFeeTiers, setEnrollmentFeeTier } from './tutoringFeeTierService';
import {
  previewStandaloneClassBill, createStandaloneClassBill,
  previewStandaloneTutoringBill, createStandaloneTutoringBill, listStandaloneBills,
} from './standaloneBillService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('standalone class bill', () => {
  it('previews with the same engine and creates a finalized bill with top-up', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: `sb-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '王小強', email: `sb-s-${Date.now()}@example.com`, password: 'x' });
    const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
    await enrollStudent(cls.id, student.id);

    const preview = await previewStandaloneClassBill({ studentId: student.id, classId: cls.id, periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30) });
    expect(preview).toMatchObject({ sessionsTotal: 4, billedSessions: 4, unitPrice: 500, amountDue: 2000, overlapWarning: null });

    const { billId } = await createStandaloneClassBill({ studentId: student.id, classId: cls.id, periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), billedSessions: 4, amountDue: 2000, notifyNow: false });
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill).toMatchObject({ status: 'FINALIZED', batchId: null, amountDue: 2000 });
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(enrollment.totalSessions).toBe(4);

    // 之後的批次會因重疊跳過（preview 會警示）
    const again = await previewStandaloneClassBill({ studentId: student.id, classId: cls.id, periodStart: D(2026, 9, 15), periodEnd: D(2026, 10, 15) });
    expect(again.overlapWarning).toContain('已有');

    expect((await listStandaloneBills()).some((b) => b.id === billId)).toBe(true);
  });
});

describe('standalone tutoring bill', () => {
  it('prorates by weeks for a mid-month period', async () => {
    await seedDefaultFeeTiers();
    const tiers = await listFeeTiers();
    const student = await createStudent({ name: '林小柔', email: `sb-t-${Date.now()}@example.com`, password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
    await setEnrollmentFeeTier(enrollment.id, tiers[0].id); // 3000

    const preview = await previewStandaloneTutoringBill({ enrollmentId: enrollment.id, periodStart: D(2026, 9, 15), periodEnd: D(2026, 9, 30) });
    expect(preview).toMatchObject({ monthlyFee: 3000, prorationRatio: 0.5, amountDue: 1500 });

    const { billId } = await createStandaloneTutoringBill({ enrollmentId: enrollment.id, periodStart: D(2026, 9, 15), periodEnd: D(2026, 9, 30), amountDue: 1500, notifyNow: false });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: billId } })).prorationRatio).toBe(0.5);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗。**

- [ ] **Step 3: 實作 `standaloneBillService.ts`**——preview 邏輯與 Task 6 `createClassBatch` 單一學生版相同（抽用同一批 import：`listClosedDays`/`getBillingSetting`/引擎函式；剩餘堂數同一段 count 查詢）；`amountDue = billedSessions × unitPrice` 由呼叫端傳入（行政可能微調過），detail 重算但 formula 以傳入值為準（有調整時附註「（手動調整）」，比對 preview 值即可判斷）。`createStandalone*` 寫入後：CLASS 且 billedSessions>0 → `addEnrollmentSessions`；`notifyNow` → `notifyBills([billId])`。`listStandaloneBills()` 用 Task 6 的 `BILL_DETAIL_INCLUDE`（把它 export）。

- [ ] **Step 4: 跑測試確認通過＋commit**

```bash
git add src/lib/services/standaloneBillService.ts src/lib/services/standaloneBillService.test.ts src/lib/services/billingBatchService.ts
git commit -m "feat: 單獨開單（預覽＋定案建立，班級/個輔，含月費折算與重疊警示）"
```

---

### Task 9: billPaymentService — 繳款登記＋電子收據通知

**Files:**
- Create: `src/lib/services/billPaymentService.ts`
- Create: `src/lib/services/billPaymentService.test.ts`

**Interfaces:**
- Consumes: `notifyUser`、`getPaidState`（Task 3，`@/lib/billingCalc`——不在這裡重新定義，避免與 billNotifyService 之間互相 import 造成循環）。
- Produces:
  - `addPayment(billId: string, input: { amount: number; paidOn: Date; method: 'CASH' | 'TRANSFER'; note?: string }, createdById: string): Promise<void>`——`amount <= 0` 丟 `Error('INVALID_AMOUNT')`；加總超過 `amountDue` 丟 `Error('OVERPAY')`；DRAFT 帳單丟 `Error('BILL_NOT_FINALIZED')`；成功後推播收據：繳清→「已收到繳費 N 元，已繳清，感謝您」；未繳清→「已收到繳費 N 元，尚欠 M 元」。
  - `deletePayment(paymentId: string): Promise<void>`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createClassBatch, finalizeBatch, getBatchDetail } from './billingBatchService';
import { addPayment, deletePayment } from './billPaymentService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

async function finalizedBillFixture() {
  const teacher = await createTeacher({ name: '陳老師', email: `pay-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `pay-s-${Date.now()}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
  await finalizeBatch(batchId, { notifyNow: false });
  const bill = (await getBatchDetail(batchId)).bills[0]; // amountDue 2000
  return { student, bill };
}

describe('addPayment / deletePayment', () => {
  it('records multiple payments, blocks overpay, notifies a receipt, and restores on delete', async () => {
    const { student, bill } = await finalizedBillFixture();
    await addPayment(bill.id, { amount: 500, paidOn: D(2026, 9, 3), method: 'TRANSFER' }, 'admin-1');
    await expect(addPayment(bill.id, { amount: 1600, paidOn: D(2026, 9, 4), method: 'CASH' }, 'admin-1')).rejects.toThrow('OVERPAY');
    await addPayment(bill.id, { amount: 1500, paidOn: D(2026, 9, 5), method: 'CASH' }, 'admin-1');

    const payments = await prisma.billPayment.findMany({ where: { billId: bill.id }, orderBy: { paidOn: 'asc' } });
    expect(payments).toHaveLength(2);

    const userId = (await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).userId;
    const notes = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    expect(notes.some((n) => n.body.includes('尚欠'))).toBe(true); // 第一筆
    expect(notes.some((n) => n.body.includes('已繳清'))).toBe(true); // 第二筆

    await deletePayment(payments[1].id);
    expect(await prisma.billPayment.count({ where: { billId: bill.id } })).toBe(1);
  });

  it('rejects non-positive amounts and draft bills', async () => {
    const { bill } = await finalizedBillFixture();
    await expect(addPayment(bill.id, { amount: 0, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1')).rejects.toThrow('INVALID_AMOUNT');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗。**

- [ ] **Step 3: 實作 `billPaymentService.ts`**

```ts
import { prisma } from '@/lib/db';
import { notifyUser } from './notificationService';
import { billTargetName } from './billNotifyService';
import { getPaidState } from '@/lib/billingCalc';

export { getPaidState }; // 沿用既有 import 路徑（'./billPaymentService'）的呼叫端不用改

export async function addPayment(
  billId: string,
  input: { amount: number; paidOn: Date; method: 'CASH' | 'TRANSFER'; note?: string },
  createdById: string
): Promise<void> {
  if (input.amount <= 0) throw new Error('INVALID_AMOUNT');
  const bill = await prisma.bill.findUniqueOrThrow({
    where: { id: billId },
    include: { payments: true, student: { select: { userId: true } }, class: { select: { name: true } }, tutoringEnrollment: { select: { program: { select: { name: true } } } } },
  });
  if (bill.status !== 'FINALIZED') throw new Error('BILL_NOT_FINALIZED');
  const { outstanding } = getPaidState(bill.amountDue, bill.payments);
  if (input.amount > outstanding) throw new Error('OVERPAY');

  await prisma.billPayment.create({ data: { billId, ...input, createdById } });
  const after = outstanding - input.amount;
  await notifyUser(bill.student.userId, {
    title: '繳費入帳通知',
    body: after > 0
      ? `${billTargetName(bill)} 已收到繳費 ${input.amount.toLocaleString('en-US')} 元，尚欠 ${after.toLocaleString('en-US')} 元`
      : `${billTargetName(bill)} 已收到繳費 ${input.amount.toLocaleString('en-US')} 元，已繳清，感謝您`,
    url: '/student/billing',
  });
}

export async function deletePayment(paymentId: string): Promise<void> {
  await prisma.billPayment.delete({ where: { id: paymentId } });
}
```

- [ ] **Step 4: 跑測試確認通過＋commit**

```bash
git add src/lib/services/billPaymentService.ts src/lib/services/billPaymentService.test.ts
git commit -m "feat: 繳款登記（分次/防超繳/可刪）＋電子收據推播"
```

---

### Task 10: 催繳＋退班結算

**Files:**
- Modify: `src/lib/services/billNotifyService.ts`（加催繳）
- Create: `src/lib/services/billSettlementService.ts`
- Create: `src/lib/services/billSettlementService.test.ts`（催繳測試也放這裡，或加在 billNotifyService 對應測試——擇一，建議獨立 `billNotifyService.test.ts`）

**Interfaces:**
- Produces:
  - `remindBill(billId: string): Promise<void>`（billNotifyService）——已繳清丟 `Error('ALREADY_PAID')`；推播 `title: '繳費提醒'`、body 帶尚欠金額、url `/student/billing`。不動 `notifiedAt`。
  - `previewSettlement(billId: string): Promise<{ attendedSessions: number; unitPrice: number; suggestedAmount: number; paid: number; diff: number }>`（僅 CLASS 帳單；attendedSessions＝區間內 classAttendance count，`status notIn [ON_LEAVE, NOT_REGISTERED]`；diff＝suggestedAmount − paid，正=應追收、負=應退）
  - `settleBill(billId: string, input: { amount: number; note: string }): Promise<void>`——`amountDue = input.amount`、`settledAsWithdrawal = true`、note 追加；TUTORING 帳單也可呼叫（直接改金額，不算堂數）。已結算過丟 `Error('ALREADY_SETTLED')`。

- [ ] **Step 1: 寫失敗測試 `billSettlementService.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { saveClassAttendance } from './attendanceService';
import { createClassBatch, finalizeBatch, getBatchDetail } from './billingBatchService';
import { addPayment } from './billPaymentService';
import { remindBill } from './billNotifyService';
import { previewSettlement, settleBill } from './billSettlementService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

async function fixture() {
  const teacher = await createTeacher({ name: '陳老師', email: `st-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `st-s-${Date.now()}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
  await finalizeBatch(batchId, { notifyNow: false });
  const bill = (await getBatchDetail(batchId)).bills[0]; // 4 堂 × 500 = 2000
  return { teacher, student, cls, bill };
}

describe('remindBill', () => {
  it('sends a reminder with the outstanding amount; refuses on a paid bill', async () => {
    const { student, bill } = await fixture();
    await addPayment(bill.id, { amount: 500, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1');
    await remindBill(bill.id);
    const userId = (await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).userId;
    const notes = await prisma.notification.findMany({ where: { userId, title: '繳費提醒' } });
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('1,500');

    await addPayment(bill.id, { amount: 1500, paidOn: D(2026, 9, 4), method: 'CASH' }, 'admin-1');
    await expect(remindBill(bill.id)).rejects.toThrow('ALREADY_PAID');
  });
});

describe('settlement', () => {
  it('suggests attended × unitPrice within the period and applies the adjustment', async () => {
    const { student, cls, bill } = await fixture();
    // 區間內上了 2 堂（一堂請假不算）
    await saveClassAttendance(cls.id, D(2026, 9, 5), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, D(2026, 9, 12), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, D(2026, 9, 19), 'marker-1', [{ studentId: student.id, status: 'ON_LEAVE' }]);
    await addPayment(bill.id, { amount: 2000, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1');

    const preview = await previewSettlement(bill.id);
    expect(preview).toMatchObject({ attendedSessions: 2, unitPrice: 500, suggestedAmount: 1000, paid: 2000, diff: -1000 }); // 應退 1000

    await settleBill(bill.id, { amount: 1000, note: '退班結算：已上 2 堂' });
    const updated = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(updated).toMatchObject({ amountDue: 1000, settledAsWithdrawal: true });
    await expect(settleBill(bill.id, { amount: 1000, note: 'x' })).rejects.toThrow('ALREADY_SETTLED');
  });

  it('suggests owing more when unpaid (追收)', async () => {
    const { student, cls, bill } = await fixture();
    // 完全沒繳，但上了 3 堂
    await saveClassAttendance(cls.id, D(2026, 9, 5), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, D(2026, 9, 12), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, D(2026, 9, 19), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const preview = await previewSettlement(bill.id);
    expect(preview).toMatchObject({ attendedSessions: 3, suggestedAmount: 1500, paid: 0, diff: 1500 }); // 應追收 1500
  });

  it('suggests a smaller remainder when only part was paid (部分繳)', async () => {
    const { student, cls, bill } = await fixture();
    // 上了 1 堂，已繳 500（原帳單 2000 中的一部分）
    await saveClassAttendance(cls.id, D(2026, 9, 5), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await addPayment(bill.id, { amount: 500, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1');

    const preview = await previewSettlement(bill.id);
    expect(preview).toMatchObject({ attendedSessions: 1, suggestedAmount: 500, paid: 500, diff: 0 }); // 剛好打平，不追不退
  });
});
```

- [ ] **Step 2: 跑測試確認失敗。**

- [ ] **Step 3: 實作**

`billNotifyService.ts` 追加：

```ts
import { getPaidState } from '@/lib/billingCalc';

export async function remindBill(billId: string): Promise<void> {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, include: { ...BILL_NOTIFY_INCLUDE, payments: true } });
  const { outstanding } = getPaidState(bill.amountDue, bill.payments);
  if (outstanding <= 0) throw new Error('ALREADY_PAID');
  await notifyUser(bill.student.userId, {
    title: '繳費提醒',
    body: `${billTargetName(bill)} 尚欠 ${outstanding.toLocaleString('en-US')} 元，再麻煩您撥空繳費，感謝`,
    url: '/student/billing',
  });
}
```

（依賴方向是單向的：billPaymentService → billNotifyService（用 `billTargetName`）；billNotifyService → `@/lib/billingCalc`（用 `getPaidState`）——不互相 import，沒有循環。）

`billSettlementService.ts`：

```ts
import { prisma } from '@/lib/db';
import { getPaidState } from '@/lib/billingCalc';

export async function previewSettlement(billId: string) {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, include: { payments: true } });
  if (!bill.classId || bill.unitPrice === null) throw new Error('NOT_A_CLASS_BILL');
  const attendedSessions = await prisma.classAttendance.count({
    where: {
      classId: bill.classId, studentId: bill.studentId,
      date: { gte: bill.periodStart, lte: bill.periodEnd },
      status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] },
    },
  });
  const suggestedAmount = attendedSessions * bill.unitPrice;
  const { paid } = getPaidState(bill.amountDue, bill.payments);
  return { attendedSessions, unitPrice: bill.unitPrice, suggestedAmount, paid, diff: suggestedAmount - paid };
}

export async function settleBill(billId: string, input: { amount: number; note: string }): Promise<void> {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
  if (bill.settledAsWithdrawal) throw new Error('ALREADY_SETTLED');
  await prisma.bill.update({
    where: { id: billId },
    data: {
      amountDue: input.amount,
      settledAsWithdrawal: true,
      note: bill.note ? `${bill.note}｜${input.note}` : input.note,
    },
  });
}
```

- [ ] **Step 4: 跑測試確認通過（連同 Task 9 測試回歸）＋commit**

```bash
git add src/lib/services/billNotifyService.ts src/lib/services/billSettlementService.ts src/lib/services/billSettlementService.test.ts
git commit -m "feat: 手動催繳＋退班結算（點名紀錄自動帶已上堂數）"
```

---

### Task 11: Admin API routes

**Files:**
- Create: `src/app/api/admin/billing/batches/route.ts`（GET 列表、POST 建批次）
- Create: `src/app/api/admin/billing/batches/[id]/route.ts`（GET 詳情、POST finalize、DELETE 草稿）
- Create: `src/app/api/admin/billing/bills/[id]/route.ts`（PATCH 草稿列、DELETE 草稿列）
- Create: `src/app/api/admin/billing/bills/[id]/payments/route.ts`（POST 繳款）
- Create: `src/app/api/admin/billing/payments/[id]/route.ts`（DELETE 繳款）
- Create: `src/app/api/admin/billing/bills/[id]/settle/route.ts`（GET preview、POST 套用）
- Create: `src/app/api/admin/billing/notify/route.ts`（POST {billIds} 分批通知）
- Create: `src/app/api/admin/billing/bills/[id]/remind/route.ts`（POST 催繳）
- Create: `src/app/api/admin/billing/standalone/route.ts`（GET 列表、POST {preview:true|false}）
- Create: `src/app/api/admin/billing/closed-days/route.ts`（GET＋POST；GET 首次呼叫先 `seedNationalHolidays()` 再回清單——上線後自動補種子）
- Create: `src/app/api/admin/billing/closed-days/[id]/route.ts`（DELETE）
- Create: `src/app/api/admin/billing/settings/route.ts`（GET 設定＋級距（GET 先 `seedDefaultFeeTiers()`）、PATCH 設定）
- Create: `src/app/api/admin/billing/fee-tiers/route.ts`（POST）＋ `src/app/api/admin/billing/fee-tiers/[id]/route.ts`（PATCH、DELETE）
- Create: `src/app/api/admin/billing/routes.test.ts`（權限＋happy path）

**Interfaces:**
- Consumes: Tasks 2–10 全部服務。
- Produces: 上列 API；全部 `if (!session || session.user.role !== 'ADMIN') return 403`（比照既有 admin route 寫法）；日期參數一律 `new Date(body.date)`（前端送 'YYYY-MM-DD'，Date 建構為 UTC 午夜）；服務層丟出的 `Error(code)` 對應 `{ error: code }` 400 回傳，**不外洩原始 Prisma 錯誤**（未知錯誤一律 `{ error: 'INTERNAL' }` 500）。

- [ ] **Step 1: 寫權限測試**（route.test.ts 慣例：直接 import route handler，用 `getServerSession` mock——參照 `src/app/api/tutoring-enrollments/[id]/attendance/route.test.ts` 的既有寫法）：未登入 403、STUDENT 403、ADMIN 200 的三態各覆蓋「批次列表 GET」「建批次 POST」「繳款 POST」三支代表路由；happy path 驗證 POST 建批次回 `{ batchId, skipped }`。

- [ ] **Step 2: 跑測試確認失敗。**

- [ ] **Step 3: 實作全部 route**（薄殼：解析 body → 呼叫服務 → try/catch 映射錯誤碼。範例——`batches/route.ts`）：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listBatches, createClassBatch, createTutoringBatch } from '@/lib/services/billingBatchService';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return null;
  return session;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await listBatches());
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.kind || !body.periodStart || !body.periodEnd) return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  try {
    const input = { periodStart: new Date(body.periodStart), periodEnd: new Date(body.periodEnd) };
    const result = body.kind === 'CLASS'
      ? await createClassBatch({ ...input, classIds: body.classIds ?? [] })
      : await createTutoringBatch({ ...input, programIds: body.programIds ?? [] });
    return NextResponse.json(result);
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    return NextResponse.json({ error: code }, { status: /^[A-Z_]+$/.test(code) ? 400 : 500 });
  }
}
```

其餘 route 同模式（`requireAdmin` 抽到 `src/lib/apiGuards.ts` 共用，若已有同功能 helper 則沿用既有的）。

- [ ] **Step 4: 跑測試確認通過＋`npx tsc --noEmit`＋commit**

```bash
git add src/app/api/admin/billing src/lib/apiGuards.ts
git commit -m "feat: 收費模組 admin API（批次/帳單/繳款/通知/結算/日曆/設定）"
```

---

### Task 12: 學生端 API `/api/billing/me`

**Files:**
- Create: `src/app/api/billing/me/route.ts`
- Create: `src/app/api/billing/me/route.test.ts`

**Interfaces:**
- Consumes: `getBillingSetting`（Task 4）、`getPaidState`（Task 3，`@/lib/billingCalc`）、`billTargetName`（Task 7，`billNotifyService`）。
- Produces: GET（STUDENT only，403 otherwise）→ `{ paymentInfo: string, bills: BillingMeBill[] }`，其中
  `interface BillingMeBill { id: string; targetName: string; periodStart: string; periodEnd: string; amountDue: number; paid: number; outstanding: number; state: 'UNPAID' | 'PARTIAL' | 'PAID'; detail: unknown; notifiedAt: string | null; settledAsWithdrawal: boolean; monthlyFee: number | null; prorationRatio: number | null; feeTierName: string | null; payments: { amount: number; paidOn: string; method: 'CASH' | 'TRANSFER' }[] }`——只回**本人**（session→student）的 FINALIZED 帳單，periodStart desc。

- [ ] **Step 1: 寫失敗測試 `src/app/api/billing/me/route.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createClass, enrollStudent } from '@/lib/services/classService';
import { createClassBatch, finalizeBatch } from '@/lib/services/billingBatchService';
import { updateBillingSetting } from '@/lib/services/billingSettingService';

beforeEach(() => sessionMock.mockReset());

const asStudent = (userId: string) => sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });
const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

// createStudent() 回傳的物件沒有 userId 欄位（只有 Student.id）；
// 這是既有測試檔（如 tutoring-enrollments/[id]/attendance/route.test.ts）
// 共用的查法。
async function studentUserId(studentId: string): Promise<string> {
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } });
  return userId;
}

async function billedStudent(name: string, email: string) {
  const teacher = await createTeacher({ name: '陳老師', email: `me-${Date.now()}-${Math.random()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name, email, password: 'x' });
  const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
  await finalizeBatch(batchId, { notifyNow: false });
  return student;
}

describe('GET /api/billing/me', () => {
  it('403 when not logged in or not a student', async () => {
    asAnon();
    expect((await GET()).status).toBe(403);
    asAdmin();
    expect((await GET()).status).toBe(403);
  });

  it('returns only the caller\'s finalized bills, not another student\'s, and includes paymentInfo', async () => {
    await updateBillingSetting({ paymentInfo: '銀行帳戶 123' });
    const me = await billedStudent('小明', `me-ming-${Date.now()}@example.com`);
    const other = await billedStudent('小華', `me-hua-${Date.now()}@example.com`);
    void other;

    asStudent(await studentUserId(me.id));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentInfo).toBe('銀行帳戶 123');
    expect(body.bills).toHaveLength(1);
    expect(body.bills[0]).toMatchObject({ targetName: '週六班', amountDue: 2000, paid: 0, outstanding: 2000, state: 'UNPAID' });
  });

  it('excludes draft bills', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: `me-draft-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小美', email: `me-draft-s-${Date.now()}@example.com`, password: 'x' });
    const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
    await enrollStudent(cls.id, student.id);
    await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] }); // 未定案

    asStudent(await studentUserId(student.id));
    const body = await (await GET()).json();
    expect(body.bills).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/app/api/billing/me/route.test.ts --testTimeout=30000 --hookTimeout=60000`
Expected: FAIL（route 不存在）。

- [ ] **Step 3: 實作 `src/app/api/billing/me/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getBillingSetting } from '@/lib/services/billingSettingService';
import { getPaidState } from '@/lib/billingCalc';
import { billTargetName } from '@/lib/services/billNotifyService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const [setting, bills] = await Promise.all([
    getBillingSetting(),
    prisma.bill.findMany({
      where: { studentId: student.id, status: 'FINALIZED' },
      include: {
        payments: { orderBy: { paidOn: 'asc' } },
        class: { select: { name: true } },
        tutoringEnrollment: { select: { program: { select: { name: true } }, feeTier: { select: { name: true } } } },
      },
      orderBy: { periodStart: 'desc' },
    }),
  ]);
  return NextResponse.json({
    paymentInfo: setting.paymentInfo,
    bills: bills.map((b) => {
      const { paid, outstanding, state } = getPaidState(b.amountDue, b.payments);
      return {
        id: b.id,
        targetName: billTargetName(b),
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
        amountDue: b.amountDue,
        paid,
        outstanding,
        state,
        detail: b.detail,
        notifiedAt: b.notifiedAt,
        settledAsWithdrawal: b.settledAsWithdrawal,
        monthlyFee: b.monthlyFee,
        prorationRatio: b.prorationRatio,
        feeTierName: b.tutoringEnrollment?.feeTier?.name ?? null,
        payments: b.payments.map((p) => ({ amount: p.amount, paidOn: p.paidOn, method: p.method })),
      };
    }),
  });
}
```

- [ ] **Step 4: 跑測試確認通過＋commit**

Run: `npx vitest run src/app/api/billing/me/route.test.ts --testTimeout=30000 --hookTimeout=60000`
Expected: PASS。

```bash
git add src/app/api/billing/me
git commit -m "feat: 學生端繳費資料 API（本人帳單＋繳費資訊）"
```

---

### Task 13: 行政 UI — 收費主頁＋開批次＋草稿頁

> 視覺以 design canvas 定稿為準：https://claude.ai/code/artifact/b2ac12d8-1032-4076-aa85-2bb04ff85f56（「行政・收費主頁」「行政・批次草稿」兩塊 artboard）。

**Files:**
- Create: `src/app/admin/billing/page.tsx`（'use client'；主頁：分頁籤＋批次列表＋單獨開單清單）
- Create: `src/app/admin/billing/BatchWizardModal.tsx`（開新批次三步驟）
- Create: `src/app/admin/billing/StandaloneBillModal.tsx`（單獨開單：選學生→選班級/個輔→區間→預覽→定案）
- Create: `src/app/admin/billing/[batchId]/page.tsx`（批次頁：DRAFT 顯示草稿清單；FINALIZED 顯示 Task 14 的詳情——本任務先做 DRAFT 部分）
- Create: `src/app/admin/billing/BillDetailBlock.tsx`（帳單明細區塊：日期清單＋折抵＋算式——行政/學生端共用，放 `src/components/BillDetailBlock.tsx`）
- Modify: `src/components/ui/AppShell.tsx`（ADMIN nav 在「請假管理」後插入 `{ href: '/admin/billing', label: '收費' }`）

**Interfaces:**
- Consumes: Task 11 API。
- Produces: `BillDetailBlock({ detail, monthlyFee, prorationRatio, feeTierName })`——渲染規則：`sessionDates` 以「、」分隔、`formatDateWithWeekday` 顯示；`closed` 的日期紅字（`text-rejected`）＋`line-through`＋假日名；`deduction` 非 null 才渲染折抵行（金色 `text-brand`）；最後一行 `formula` 粗體。

- [ ] **Step 1: `BillDetailBlock.tsx`**（核心渲染，行政草稿/詳情與學生端都 import）

```tsx
import { formatDateWithWeekday } from '@/lib/dateFormat';

export interface BillDetailJson {
  sessionDates: { dateKey: string; closed: boolean; closedName?: string }[];
  deduction: { previousRemaining: number; cap: number; deducted: number } | null;
  formula: string;
}

export default function BillDetailBlock({ detail }: { detail: BillDetailJson }) {
  return (
    <div className="rounded-lg border border-borderSubtle bg-cream/40 px-4 py-3 text-sm leading-relaxed">
      {detail.sessionDates.length > 0 && (
        <p className="mb-2 text-ink">
          {detail.sessionDates.map((e, i) => (
            <span key={e.dateKey}>
              {i > 0 && '、'}
              {e.closed ? (
                <span className="text-rejected line-through">{formatDateWithWeekday(e.dateKey)}{e.closedName}</span>
              ) : (
                formatDateWithWeekday(e.dateKey)
              )}
            </span>
          ))}
        </p>
      )}
      {detail.deduction && (
        <p className="mb-1 border-t border-borderSubtle pt-2 text-brandDark">
          上期剩餘 {detail.deduction.previousRemaining} 堂｜折抵上限 {detail.deduction.cap} 堂 → 本期折抵 {detail.deduction.deducted} 堂，其餘 {detail.deduction.previousRemaining - detail.deduction.deducted} 堂保留至本期繼續使用
        </p>
      )}
      <p className="font-bold text-ink">{detail.formula}</p>
    </div>
  );
}
```

- [ ] **Step 2: 主頁 `admin/billing/page.tsx`**——結構照 mockup：
  - 分頁籤 state：`'batches' | 'closedDays' | 'settings'`（後兩籤 Task 15 填內容，先渲染佔位空 Card）。
  - 批次列表：`DataTable` 欄位「種類（CLASS→圍棋班級/TUTORING→英數個別輔導）｜收費區間（`formatDateWithWeekday` 起～訖）｜狀態（草稿=pendingBg 徽章/已定案=approvedBg 徽章）｜總應收｜已收（`text-approved`）｜未收（>0 紅字）」，DRAFT 列 total 顯示「—」；整列 `cursor-pointer` 點擊 `router.push('/admin/billing/' + id)`。
  - 按鈕列：「＋ 開新批次」（primary Button，開 BatchWizardModal）「單獨開單」（secondary，開 StandaloneBillModal）。
  - 「單獨開單帳單」區塊：`CollapsibleDataTable maxRows={3}`，欄位「學生｜項目｜區間｜應繳｜繳費狀態（getPaidState → 未繳/部分繳/繳清 徽章）」，點列進入繳款彈窗（Task 14 完成後接上；本任務先渲染表格）。
- [ ] **Step 3: `BatchWizardModal.tsx`**——單一 Modal 內三步 state machine：
  1. 種類：兩張可點選卡（圍棋班級／英數個別輔導）。
  2. 區間：兩個共用 `Input type="date"`；kind=TUTORING 時上方多一排「月份快捷」按鈕（本月/下月，點了自動帶整月起訖，仍可手改）。
  3. 勾選：CLASS→抓 `/api/classes` 列 checkbox 清單（預設全勾）；TUTORING→抓課程清單全勾。
  送出 POST `/api/admin/billing/batches` → 成功 `router.push('/admin/billing/' + batchId)`；`skipped` 帶進草稿頁顯示（放進 sessionStorage 或 URL state 皆可——**用 query string 不放**，改由草稿頁重新 GET 詳情時後端另回 skipped？skipped 未入庫，**由 wizard 送出後直接以 props/router state 傳遞：存 sessionStorage key `billing-skipped-{batchId}`**，草稿頁讀出顯示）。
- [ ] **Step 4: 草稿頁（`[batchId]/page.tsx` DRAFT 分支）**——照 mockup：
  - 標題列：麵包屑「收費 ›」＋種類名＋草稿徽章；副標「收費區間＋N 個班級＋N 位學生」。
  - 草稿表：欄位「學生｜班級/課程｜計費堂數（共用 `Input type="number"` 窄框，onBlur PATCH `/api/admin/billing/bills/{id}`）｜單價（null 顯示紅字「未設定」）｜金額（unitPrice null 顯示紅字「請先設定班級單價」）｜明細（展開/收合 toggle → 列下方渲染 `BillDetailBlock`）｜刪除（`useConfirm` 後 DELETE）」。
  - 略過清單：sessionStorage 讀 `billing-skipped-{batchId}` 渲染灰卡。
  - 底部列：「本批合計應收 N 元（M 筆）」＋「刪除草稿」（confirm→DELETE→回主頁）＋「定案並通知家長」primary——點擊開 `useConfirm` 變體訊息：「定案後帳單金額凍結並自動充值堂數。要立即推播通知全部家長嗎？」→ 三鍵：立即通知／先不通知／取消（用 Modal 自製三鍵，不硬塞 useConfirm）→ POST finalize `{ notifyNow }` → 成功後 refetch（頁面轉入 FINALIZED 顯示）。
  - 有 `unitPrice === null` 列時定案按鈕 disabled＋提示文字。
- [ ] **Step 5: `StandaloneBillModal.tsx`**——選學生（既有學生下拉/搜尋模式，參照請假管理的選人寫法）→ 選該生的班級或個輔報名（GET 現有 API）→ 區間 → 「試算」呼叫 standalone preview → 顯示 `BillDetailBlock`＋可改堂數/金額 → 「建立帳單」（三鍵通知選項同上）POST。preview 的 `overlapWarning` 非 null 時黃字警示但不擋。
- [ ] **Step 6: AppShell nav 插入「收費」；`npx tsc --noEmit && npx eslint src/app/admin/billing src/components/BillDetailBlock.tsx src/components/ui/AppShell.tsx`乾淨；dev server 手動走一輪：開批次→草稿→微調→定案。**
- [ ] **Step 7: Commit**

```bash
git add src/app/admin/billing src/components/BillDetailBlock.tsx src/components/ui/AppShell.tsx
git commit -m "feat: 收費後台主頁/開批次三步驟/草稿清單（含明細展開與定案三鍵）"
```

---

### Task 14: 行政 UI — 批次詳情（定案後）＋繳款/通知/催繳/結算/匯出

**Files:**
- Modify: `src/app/admin/billing/[batchId]/page.tsx`（FINALIZED 分支）
- Create: `src/app/admin/billing/PaymentModal.tsx`
- Create: `src/app/admin/billing/SettleModal.tsx`

**Interfaces:**
- Consumes: Task 11 API、`getPaidState`（從 `@/lib/billingCalc` import，client 可用——純函式）。

- [ ] **Step 1: FINALIZED 分支表格**——欄位「☑（checkbox）｜學生｜班級/課程｜金額（settledAsWithdrawal 加「已結算（退班）」小字）｜已繳｜尚欠｜繳費狀態徽章（未繳=rejectedBg/部分繳=pendingBg/繳清=approvedBg）｜通知（未通知=灰字／已通知＋`formatDateWithWeekday(notifiedAt)`）｜操作（「繳款」開 PaymentModal、「催繳」（繳清者隱藏）、「結算」開 SettleModal、「明細」展開 BillDetailBlock）」。
- [ ] **Step 2: 通知列**——表格上方：「通知勾選家長（N）」（勾選數 0 時 disabled）＋「一鍵通知所有未通知（M）」，各自 `useConfirm` 後 POST `/api/admin/billing/notify` `{ billIds }` → toast 成功 → refetch。
- [ ] **Step 3: `PaymentModal.tsx`**——上半：該帳單摘要（金額/已繳/尚欠）＋繳款紀錄表（金額/日期/方式/備註/刪除鈕—`useConfirm`）；下半新增表單：金額 `Input type="number"`、日期 `Input type="date"`（預設今天台北）、方式共用 `Select`（現金/轉帳）、備註 `Input`；送出 POST → 錯誤碼 `OVERPAY` 顯示「超過尚欠金額」`AlertModal`。
- [ ] **Step 4: `SettleModal.tsx`**——開啟即 GET settle preview，顯示「區間內已實際上課 N 堂 × 單價 ＝ 建議結算金額；已繳 M → 應追收/應退 |diff|」；金額欄預設建議值可改＋備註必填；`useConfirm` 後 POST。TUTORING 帳單 preview 404 時隱藏堂數段、只留金額＋備註。
- [ ] **Step 5: 匯出**——`ExportExcelButton` rows=目前批次 bills、columns：學生/班級/區間/堂數/單價/金額/已繳/尚欠/繳費狀態/通知時間，filename=`收費批次_{區間}.xlsx`。
- [ ] **Step 6: 主頁「單獨開單帳單」區塊接上同一組 PaymentModal/催繳/SettleModal。**
- [ ] **Step 7: `npx tsc --noEmit`＋eslint 乾淨；dev server 手動：繳款（部分→繳清）、刪繳款、勾選通知、催繳、結算。Commit**

```bash
git add src/app/admin/billing
git commit -m "feat: 批次詳情（繳款/分批通知/催繳/退班結算/匯出 Excel）"
```

---

### Task 15: 行政 UI — 停課日曆分頁＋收費設定分頁＋個輔級距指定

**Files:**
- Create: `src/app/admin/billing/ClosedDaysTab.tsx`
- Create: `src/app/admin/billing/SettingsTab.tsx`
- Modify: `src/app/admin/billing/page.tsx`（接上兩分頁）
- Modify: `src/app/admin/tutoring/page.tsx`（報名編輯處加「收費級距」`Select`）

**Interfaces:**
- Consumes: Task 11 closed-days/settings/fee-tiers API、`setEnrollmentFeeTier`（經由既有個輔報名更新 route 加 `feeTierId` 欄位透傳）。

- [ ] **Step 1: `ClosedDaysTab.tsx`**——`CollapsibleDataTable maxRows={3}` 之外的例外：這是 CRUD 管理清單，**用一般 `DataTable` 不收合**（表格收合慣例只套紀錄類）。欄位「日期（`formatDateWithWeekday`）｜名稱｜來源（國定假日/自訂）｜刪除（`useConfirm`：「刪除後該日照常上課並計費，確定？」）」。上方新增列：日期 `Input type="date"`＋名稱 `Input`＋「新增停課日」Button；重複日期錯誤碼 `DUPLICATE_DATE` → `AlertModal`「該日期已在停課日曆中」。只顯示「今天（台北）以後」的日期預設篩選＋「顯示過去」toggle。
- [ ] **Step 2: `SettingsTab.tsx`**——三張 Card：
  1. 英數級距表：`DataTable`「名稱｜每週堂數｜月費｜操作（編輯=行內 Input、刪除—`TIER_IN_USE` 錯誤 `AlertModal`「仍有報名使用此級距」）」＋新增列表單。
  2. 折抵上限：`Input type="number"`＋說明文字「圍棋批次產生時套用；已定案帳單不受影響」＋儲存。
  3. 繳費資訊：`Textarea`（學生端繳費頁原文顯示）＋儲存。
- [ ] **Step 3: 個輔報名編輯加級距 `Select`**（選項來自 fee-tiers API；含「未指定」空選項）；選定時若該級距 `sessionsPerWeek === 1` 且報名月額度非 4，顯示提示文字「建議把月額度改成 4」（僅提示不強制——spec 定案）。
- [ ] **Step 4: tsc/eslint 乾淨；dev server 手動：加/刪停課日、改折抵上限、改繳費資訊、指定級距。Commit**

```bash
git add src/app/admin/billing src/app/admin/tutoring/page.tsx
git commit -m "feat: 停課日曆/收費設定分頁＋個輔報名收費級距指定"
```

---

### Task 16: 學生端繳費頁＋導航

> 視覺以 design canvas「家長端・繳費頁（手機）」artboard 為準。

**Files:**
- Create: `src/app/student/billing/page.tsx`（'use client'）
- Modify: `src/components/ui/AppShell.tsx`（STUDENT nav 在「我的出席紀錄」前插入 `{ href: '/student/billing', label: '繳費' }`；**不加入 `CLASS_ONLY_HREFS`**——純輔導學生也要看英數帳單）

**Interfaces:**
- Consumes: `/api/billing/me`、`BillDetailBlock`、`getPaidState` 已在 API 算好（直接用回傳的 paid/outstanding/state）。

- [ ] **Step 1: 頁面結構**（fetch `/api/billing/me`，骨架屏 loading 比照現有頁面 skeleton-shimmer 慣例）：
  1. **繳費資訊卡**：Card，標題「繳費方式」＋固定文字「現金（櫃檯）／銀行轉帳」＋分隔線＋`paymentInfo`（`whitespace-pre-line` 渲染多行）。`paymentInfo` 空字串時整卡仍顯示（只有繳費方式行）。
  2. **待繳帳單**：`state !== 'PAID'` 的帳單每張一張 Card——項目名＋區間（小字）＋右上狀態徽章；金額大字 `text-brand text-2xl font-bold`＋「已繳 N・尚欠 M（紅字）」；下方 `BillDetailBlock`；再下方繳款紀錄小字（「M/D（週N） 轉帳 500 元」逐筆）。沒有待繳時顯示空狀態文字「目前沒有待繳帳單 🎉」→ **不用 emoji**，顯示「目前沒有待繳帳單」。
  3. **繳費紀錄**：`CollapsibleDataTable maxRows={3}`——欄位「項目｜區間｜金額｜狀態徽章」，點列展開 `BillDetailBlock`＋繳款紀錄（用既有可展開列模式；若複雜度過高退而求其次：點列開 `Modal` 顯示明細）。
- [ ] **Step 2: 手足切換驗證**——AppShell 換帳號是整頁導航，資料自然隔離；測試登入兩個手足帳號各自只看到自己的帳單。
- [ ] **Step 3: tsc/eslint 乾淨；dev server 以測試學生帳號目視比對 mockup。Commit**

```bash
git add src/app/student/billing src/components/ui/AppShell.tsx
git commit -m "feat: 學生端繳費頁（繳費資訊卡/待繳明細/繳費紀錄）＋導航"
```

---

### Task 17: 整合驗證＋上線準備

**Files:**
- Modify: `docs/superpowers/2026-08-28-billing-module-production.sql`（最終核對）

- [ ] **Step 1: 全量測試**：`npx vitest run --testTimeout=30000 --hookTimeout=60000` 全綠（先看 `uptime`，高載時逐檔重跑分辨假 flake——共用測試 DB 教訓）。
- [ ] **Step 2: `npx next build`**——**會 lint 測試檔**（0bd4fa9 事故教訓），修到乾淨。若有並行 session，考慮在隔離 worktree 跑 build。
- [ ] **Step 3: 端到端手動流程**（dev server，行政＋學生帳號各一輪）：
  1. 設定班級單價＋學生覆寫 → 開圍棋批次（含停課日）→ 草稿微調 → 定案（先不通知）→ 分批通知 → 學生端看到帳單＋鈴鐺通知。
  2. 登記部分繳款 → 學生端收據通知＋尚欠顯示 → 繳清。
  3. 英數批次（級距）→ 定案；單獨開單（月中折算）。
  4. 催繳、退班結算、匯出 Excel。
  5. 再開下一期批次驗證「折抵」與「重疊跳過」。
- [ ] **Step 4: production SQL 對 schema 最終核對**（逐表比對欄位/enum/index；假日種子 25 列在內；`BillingSetting` 種子在內）。
- [ ] **Step 5: 停課日曆假日清單請使用者對照政府行事曆確認**（列出 NATIONAL_HOLIDAYS 給使用者過目——特別是補假日）。
- [ ] **Step 6: Commit＋合併回 main 後記得 `npx prisma generate`＋重啟 dev server（worktree 隔離教訓）。上線順序：正式站 SQL（Supabase Dashboard 手動）→ push main → Vercel 部署 → 正式站行政帳號煙霧測試（開一個測試草稿批次再刪除）。**

```bash
git add -A docs/superpowers/2026-08-28-billing-module-production.sql
git commit -m "chore: 收費模組整合驗證＋正式站 SQL 定稿"
```

---

### Task 18: 國定假日自動更新機制（DGPA 官方資料每日檢查）

> 使用者 2026-08-28 要求：Task 2 手動寫死的 NATIONAL_HOLIDAYS 陣列人工核對過 2026/2027，但無法涵蓋未來年度。這裡加一個每日自動檢查機制，向人事行政總處（DGPA）官方開放資料抓取，避免每年都要手動更新程式碼。

**Files:**
- Modify: `src/lib/services/closedDayService.ts`（加 `refreshNationalHolidaysFromDGPA`）
- Create: `src/lib/services/closedDayService.dgpa.test.ts`（獨立測試檔，隔離會打外部網路的測試——不跟其他不連網的單元測試混在同一檔，方便日後單獨排除／重跑）
- Modify: `src/app/api/cron/daily-reminders/route.ts`（掛進既有 jobs 清單，不開新 cron——Vercel 免費方案 cron 數量上限 2 個已用滿，見 `vercel.json`）

**背景（DGPA 開放資料格式，2026-08-28 人工查證）**：
- 資料集：`https://data.gov.tw/api/v2/rest/dataset/14718`（政府資料開放平台，JSON API，穩定網址，回傳當前所有年度資源的中繼資料，含每份 CSV 的實際下載網址——下載網址本身含隨機 UUID，不可預測，必須先打這支 API 查出來）。
- 每個資源物件的 `name` 欄位形如「116年中華民國政府行政機關辦公日曆表」（標準版）或「116年中華民國政府行政機關辦公日曆表_Google行事曆專用」（要排除的版本）；`resource_format` 或副檔名為 CSV；下載網址欄位在 API 回傳的 JSON 裡（實際 key 名稱需執行時親自查看該 API 回應結構，不要用臆測的 key 名稱硬寫死）。
- CSV 格式：欄位「西元日期,星期,是否放假,備註」，日期格式 `YYYYMMDD`（無分隔符）。近年（115/116年，即 2026/2027）的檔案是 **UTF-8 with BOM**；較舊年度（114年/2025 以前）可能是 **Big5**——這個任務**只需要正確處理 UTF-8-with-BOM**（未來年度預期延續近年格式），Big5 不必支援：解碼後若表頭第一格不是「西元日期」（代表編碼不對或格式跳號），視為解析失敗，記 log 略過、不拋錯，等下次排程再試。
- 篩選規則：只取 `是否放假 === "2"` 且 `備註` 非空的列（這樣會排除純粹週六週日的例假日，只留下有名稱的真正國定假日／補假——跟 Task 2 現有種子資料的篩選邏輯完全一致）。

**Interfaces:**
- Consumes: `prisma`（`@/lib/db`）、`fetch`（Node 18+/26 全域內建，不需額外套件）。
- Produces：
  - `interface DgpaHolidayRow { date: Date; name: string }`
  - `parseDgpaCsv(csvText: string): DgpaHolidayRow[]`（純函式，方便單獨測試解析邏輯，不含網路呼叫；輸入是已經去除 BOM 的 UTF-8 字串；日期用 `Date.UTC` 建構，不用本地建構子）
  - `fetchDgpaResourceUrl(rocYear: number): Promise<string | null>`（打 dataset API，找出該民國年「標準版」CSV 網址；找不到該年度資源時回傳 `null`，不拋錯）
  - `refreshNationalHolidaysFromDGPA(now: Date = new Date()): Promise<{ year: number; inserted: number }[]>`——對「今年」與「明年」（台北曆年，`taipeiDateKey` 換算）各自檢查：若該年**已有任何** `source: 'NATIONAL'` 的 `ClosedDay` 列，跳過（代表已經種過，不管理員後續有沒有手動刪掉某幾筆，都不再重新整批處理，避免蓋掉管理員「這天照常上課」的手動覆寫）；若該年還沒有任何 NATIONAL 列，才呼叫 `fetchDgpaResourceUrl`＋抓 CSV＋`parseDgpaCsv`＋`createMany({ skipDuplicates: true, data: rows.map(r => ({ date: r.date, name: r.name, source: 'NATIONAL' })) })`。回傳每個實際處理過（不管有沒有抓到資料）的年度及插入筆數；若該年資源尚未公告（`fetchDgpaResourceUrl` 回 `null`）或解析失敗，該年度**不放進回傳陣列**（代表「這次沒動作」，不算錯誤）。

**民國年／西元年換算**：民國年 = 西元年 − 1911（例如西元 2027 年 = 民國 116 年）。

- [ ] **Step 1: 寫失敗測試 `src/lib/services/closedDayService.dgpa.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { parseDgpaCsv, refreshNationalHolidaysFromDGPA } from './closedDayService';

const SAMPLE_CSV = `西元日期,星期,是否放假,備註
20270101,五,2,開國紀念日
20270102,六,2,
20270103,日,2,
20270928,二,2,孔子誕辰紀念日/教師節
`;

describe('parseDgpaCsv', () => {
  it('keeps only rows with a real holiday name, skipping plain weekends', () => {
    const rows = parseDgpaCsv(SAMPLE_CSV);
    expect(rows).toEqual([
      { date: new Date(Date.UTC(2027, 0, 1)), name: '開國紀念日' },
      { date: new Date(Date.UTC(2027, 8, 28)), name: '孔子誕辰紀念日/教師節' },
    ]);
  });

  it('returns empty array for malformed header (wrong encoding guard)', () => {
    expect(parseDgpaCsv('garbled,header\n1,2')).toEqual([]);
  });
});

describe('refreshNationalHolidaysFromDGPA', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and inserts when the year has no NATIONAL rows yet', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('rest/dataset')) {
        return {
          ok: true,
          json: async () => ({
            result: {
              resources: [
                { name: '116年中華民國政府行政機關辦公日曆表', Format: 'CSV', url: 'https://example.test/116.csv' },
                { name: '116年中華民國政府行政機關辦公日曆表_Google行事曆專用', Format: 'CSV', url: 'https://example.test/116-google.csv' },
              ],
            },
          }),
        };
      }
      return { ok: true, text: async () => '﻿' + SAMPLE_CSV };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshNationalHolidaysFromDGPA(new Date(Date.UTC(2026, 11, 31)));
    // 今年（2026 台北曆）已被 Task 2 種過，跳過；明年（2027）沒種過，抓取
    const entry2027 = result.find((r) => r.year === 2027);
    expect(entry2027).toMatchObject({ year: 2027, inserted: 2 });

    const rows = await prisma.closedDay.findMany({ where: { date: { gte: new Date(Date.UTC(2027, 0, 1)) } } });
    expect(rows.some((r) => r.name === '開國紀念日')).toBe(true);
  });

  it('skips a year that already has NATIONAL rows, without calling fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // 2026 已由 Task 2 seedNationalHolidays() 種過（本檔測試共用整合測試 DB，
    // beforeEach 由 vitest 全域 setup 的 resetDb 清過，這裡改用單獨插入一筆代替跑整個 Task 2 種子）
    await prisma.closedDay.create({ data: { date: new Date(Date.UTC(2026, 8, 25)), name: '中秋節', source: 'NATIONAL' } });

    const result = await refreshNationalHolidaysFromDGPA(new Date(Date.UTC(2026, 5, 1)));
    expect(result.find((r) => r.year === 2026)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw when the target year resource is not published yet', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { resources: [] } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshNationalHolidaysFromDGPA(new Date(Date.UTC(2026, 5, 1)));
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/closedDayService.dgpa.test.ts --testTimeout=30000 --hookTimeout=60000`
Expected: FAIL（`parseDgpaCsv`/`refreshNationalHolidaysFromDGPA` 不存在）。

- [ ] **Step 3: 實作**（加進 `src/lib/services/closedDayService.ts`）

```ts
import { taipeiDateKey } from './tutoringBookingService';

export interface DgpaHolidayRow {
  date: Date;
  name: string;
}

// 只信任「西元日期,星期,是否放假,備註」表頭；表頭對不上代表編碼錯誤或
// 格式改版，直接回空陣列讓呼叫端略過，不要憑錯誤資料寫進資料庫。
export function parseDgpaCsv(csvText: string): DgpaHolidayRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0 || !lines[0].startsWith('西元日期')) return [];
  const rows: DgpaHolidayRow[] = [];
  for (const line of lines.slice(1)) {
    const [dateStr, , isHoliday, name] = line.split(',');
    if (isHoliday !== '2' || !name || !name.trim()) continue;
    const y = Number(dateStr.slice(0, 4));
    const m = Number(dateStr.slice(4, 6));
    const d = Number(dateStr.slice(6, 8));
    rows.push({ date: new Date(Date.UTC(y, m - 1, d)), name: name.trim() });
  }
  return rows;
}

// 民國年 = 西元年 - 1911。只找「標準版」（排除 Google 行事曆專用版）。
export async function fetchDgpaResourceUrl(rocYear: number): Promise<string | null> {
  const res = await fetch('https://data.gov.tw/api/v2/rest/dataset/14718');
  if (!res.ok) return null;
  const data = await res.json();
  const resources: { name?: string; url?: string; Format?: string }[] = data?.result?.resources ?? [];
  const match = resources.find(
    (r) => r.name?.includes(`${rocYear}年`) && r.name?.includes('辦公日曆表') && !r.name?.includes('Google') && r.Format === 'CSV'
  );
  return match?.url ?? null;
}

async function refreshYearIfMissing(year: number): Promise<{ year: number; inserted: number } | null> {
  const existing = await prisma.closedDay.count({
    where: { source: 'NATIONAL', date: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
  });
  if (existing > 0) return null;

  const rocYear = year - 1911;
  const url = await fetchDgpaResourceUrl(rocYear);
  if (!url) return null;

  const csvRes = await fetch(url);
  if (!csvRes.ok) return null;
  const rawText = await csvRes.text();
  const text = rawText.startsWith('﻿') ? rawText.slice(1) : rawText;
  const rows = parseDgpaCsv(text);
  if (rows.length === 0) return null;

  const result = await prisma.closedDay.createMany({
    data: rows.map((r) => ({ date: r.date, name: r.name, source: 'NATIONAL' as const })),
    skipDuplicates: true,
  });
  return { year, inserted: result.count };
}

// 每日排程呼叫：檢查「今年／明年」（台北曆年）是否已有國定假日資料，
// 沒有才去抓——政府行事曆通常年中就會公告下一年度，這樣一發布就近日內
// 自動補上，不用死等到 1/1；已種過的年度即使被管理員手動刪掉幾筆
// （標記某天照常上課）也不會被整批覆蓋回去。
export async function refreshNationalHolidaysFromDGPA(now: Date = new Date()): Promise<{ year: number; inserted: number }[]> {
  const [y] = taipeiDateKey(now).split('-').map(Number);
  const results = await Promise.all([refreshYearIfMissing(y), refreshYearIfMissing(y + 1)]);
  return results.filter((r): r is { year: number; inserted: number } => r !== null);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/closedDayService.dgpa.test.ts --testTimeout=30000 --hookTimeout=60000`
Expected: PASS。

- [ ] **Step 5: 掛進既有每日 cron**——修改 `src/app/api/cron/daily-reminders/route.ts`：import `refreshNationalHolidaysFromDGPA`，在 `jobs` 陣列加一筆 `['nationalHolidaysRefresh', () => refreshNationalHolidaysFromDGPA()]`（沿用既有的逐一 try/catch 隔離失敗的模式，不用另外處理）。

- [ ] **Step 6: 驗證**

Run: `npx tsc --noEmit && npx eslint src/lib/services/closedDayService.ts src/lib/services/closedDayService.dgpa.test.ts src/app/api/cron/daily-reminders/route.ts`
Expected: 乾淨。

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/closedDayService.ts src/lib/services/closedDayService.dgpa.test.ts src/app/api/cron/daily-reminders/route.ts
git commit -m "feat: 國定假日每日自動檢查更新（DGPA 官方開放資料，掛進既有每日 cron）"
```
