# 弈廳收費單 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收費模組「單獨開單」可開弈廳堂票／季票收費單，開單即入帳（堂票加帳本、季票建立），刪除與編輯時連動扣回或調整。

**Architecture:** `Bill` 加三個欄位（`goHallItem`／`goHallTickets`／`seasonPassId`）判斷是否為弈廳帳單；新服務 `goHallBillService.ts` 負責試算、開單、刪除、編輯（放在獨立檔，避免 standaloneBillService 與 billingBatchService 之間的循環 import）。`bills/[id]` route 依 `goHallItem` 分流到弈廳版的刪除和編輯。前端延伸 StandaloneBillModal、EditBillModal、OverviewTab、SettingsTab。

**Tech Stack:** Next.js 14 App Router、Prisma、PostgreSQL、Vitest（真的測試 DB）、Tailwind。

**Spec:** `docs/superpowers/specs/2026-09-23-gohall-billing-and-makeup-backlog-design.md`（功能一）

## Global Constraints

- 日期一律用 UTC 日曆日；「今天」用台北時區（`taipeiDateKey`）。顯示日期一律用 `formatDateWithWeekday`。
- 表單一律用共用 `Input`／`Select` 元件；`label` 裡面不要放按鈕或下拉。
- 錯誤一律回傳 `^[A-Z_]+$` 錯誤碼，前端對應成中文訊息，原始 Prisma 錯誤不能外洩。
- 金額計算與算式文字沿用 `buildNetFormula`：formula 只寫毛額，有優惠時 netFormula 寫最終金額，並標示「（手動調整）」。
- 堂票入帳後要把 `Student.goHallLowQuotaNotifiedAt` 設成 null（同 `purchaseTickets`）。
- 改 schema 之後：`npx prisma generate`，並重啟 dev server。
- 測試指令：`npx vitest run <file>`；整套用 `npm test`。
- commit 只 stage 自己改的檔案（不要 add `.impeccable/`）。

## File Structure

- Modify: `prisma/schema.prisma`：enum `GoHallBillItem`、`Bill` 三個欄位、`GoHallSeasonPass.bill` 反向關聯、`BillingSetting` 兩個價格欄位
- Modify: `docs/superpowers/2026-09-23-gohall-billing-production.sql`：拿掉「草稿」字樣，對齊最終 schema
- Modify: `src/lib/services/billingSettingService.ts`（+test）、`src/app/api/admin/billing/settings/route.ts`、`src/app/admin/billing/SettingsTab.tsx`
- Create: `src/lib/services/goHallBillService.ts`（+`goHallBillService.test.ts`）
- Modify: `src/lib/services/billNotifyService.ts`：`billTargetName` 支援弈廳
- Modify: `src/lib/services/goHallTicketService.ts`：`deleteSeasonPass` 擋下綁著收費單的季票
- Modify: `src/app/api/admin/billing/standalone/route.ts`：GO_HALL 分支
- Modify: `src/app/api/admin/billing/bills/[id]/route.ts`：弈廳分流
- Modify: `src/lib/services/billOverviewService.ts`：source 加 `'GO_HALL'`，多帶 goHall 欄位
- Modify: `src/app/admin/billing/StandaloneBillModal.tsx`、`EditBillModal.tsx`、`OverviewTab.tsx`
- Modify: `src/app/admin/go-hall/TicketManager.tsx`：刪季票的錯誤訊息

---

### Task 1: Schema＋預設價格設定

**Files:**
- Modify: `prisma/schema.prisma`（`BillingSetting` 約 657 行、`Bill` 約 704 行、`GoHallSeasonPass` 約 302 行）
- Modify: `src/lib/services/billingSettingService.ts`
- Modify: `src/app/api/admin/billing/settings/route.ts`
- Modify: `src/app/admin/billing/SettingsTab.tsx`
- Modify: `docs/superpowers/2026-09-23-gohall-billing-production.sql`
- Test: `src/lib/services/billingSettingService.test.ts`

**Interfaces:**
- Produces:
  - Prisma：`enum GoHallBillItem { TICKETS SEASON_PASS }`；`Bill.goHallItem GoHallBillItem?`、`Bill.goHallTickets Int?`、`Bill.seasonPassId String? @unique`（relation `seasonPass GoHallSeasonPass?`、`onDelete: Restrict`）；`GoHallSeasonPass.bill Bill?`；`BillingSetting.goHallTicketPrice Int @default(0)`、`BillingSetting.goHallSeasonPassPrice Int @default(0)`
  - `getBillingSetting()` 回傳 `{ deductionCap, paymentInfo, goHallTicketPrice, goHallSeasonPassPrice }`
  - `updateBillingSetting(input: { deductionCap?; paymentInfo?; goHallTicketPrice?: number; goHallSeasonPassPrice?: number })`：價格不是 ≥ 0 的整數時丟出 `INVALID_PRICE`

- [ ] **Step 1: 改 schema**

```prisma
enum GoHallBillItem {
  TICKETS
  SEASON_PASS
}
```

`BillingSetting` 加：

```prisma
  goHallTicketPrice     Int    @default(0) // 弈廳堂票預設單價；0＝未設定
  goHallSeasonPassPrice Int    @default(0) // 弈廳季票預設價格；0＝未設定
```

`Bill` 加（放在 `tutoringEnrollment` 之後）：

```prisma
  // 弈廳收費單（單獨開單）：goHallItem 非 null＝弈廳帳單。堂票開單即寫帳本 +N（無 FK，
  // reason 文字快照）；季票開單即建立 GoHallSeasonPass 並關聯（刪季票要先刪帳單）。
  goHallItem           GoHallBillItem?
  goHallTickets        Int?
  seasonPassId         String?             @unique
  seasonPass           GoHallSeasonPass?   @relation(fields: [seasonPassId], references: [id], onDelete: Restrict)
```

`GoHallSeasonPass` 加 `bill Bill?`。

Run: `npx prisma format && npx prisma generate && npx prisma db push`（dev DB）
Expected: 成功，沒有 data loss 警告

- [ ] **Step 2: 寫失敗的測試**（加在 `billingSettingService.test.ts` 的 describe 裡）

```ts
  it('弈廳預設價格：預設 0，可更新，負數或非整數擋下', async () => {
    const initial = await getBillingSetting();
    expect(initial.goHallTicketPrice).toBe(0);
    expect(initial.goHallSeasonPassPrice).toBe(0);
    await updateBillingSetting({ goHallTicketPrice: 300, goHallSeasonPassPrice: 4500 });
    expect(await getBillingSetting()).toMatchObject({ goHallTicketPrice: 300, goHallSeasonPassPrice: 4500 });
    await expect(updateBillingSetting({ goHallTicketPrice: -1 })).rejects.toThrow('INVALID_PRICE');
    await expect(updateBillingSetting({ goHallSeasonPassPrice: 1.5 })).rejects.toThrow('INVALID_PRICE');
  });
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npm run test:dbpush && npx vitest run src/lib/services/billingSettingService.test.ts`
Expected: FAIL（`goHallTicketPrice` 是 undefined）

- [ ] **Step 4: 實作**

```ts
import { prisma } from '@/lib/db';

export async function getBillingSetting() {
  const row = await prisma.billingSetting.upsert({
    where: { id: 'main' },
    create: { id: 'main' },
    update: {},
  });
  return {
    deductionCap: row.deductionCap,
    paymentInfo: row.paymentInfo,
    goHallTicketPrice: row.goHallTicketPrice,
    goHallSeasonPassPrice: row.goHallSeasonPassPrice,
  };
}

export async function updateBillingSetting(input: {
  deductionCap?: number;
  paymentInfo?: string;
  goHallTicketPrice?: number;
  goHallSeasonPassPrice?: number;
}): Promise<void> {
  if (input.deductionCap !== undefined && input.deductionCap < 0) throw new Error('INVALID_CAP');
  for (const price of [input.goHallTicketPrice, input.goHallSeasonPassPrice]) {
    if (price !== undefined && (!Number.isInteger(price) || price < 0)) throw new Error('INVALID_PRICE');
  }
  await prisma.billingSetting.upsert({
    where: { id: 'main' },
    create: { id: 'main', ...input },
    update: input,
  });
}
```

settings route 的 PATCH 改成：

```ts
    await updateBillingSetting({
      deductionCap: body.deductionCap,
      paymentInfo: body.paymentInfo,
      goHallTicketPrice: body.goHallTicketPrice,
      goHallSeasonPassPrice: body.goHallSeasonPassPrice,
    });
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/lib/services/billingSettingService.test.ts`
Expected: PASS

- [ ] **Step 6: SettingsTab 加「弈廳價格」卡片**

state（放在 `paymentInfo` 旁邊）：

```ts
  const [goHallTicketPrice, setGoHallTicketPrice] = useState('');
  const [goHallSeasonPassPrice, setGoHallSeasonPassPrice] = useState('');
  const [savingGoHall, setSavingGoHall] = useState(false);
```

`load()` 裡 `setPaymentInfo(data.paymentInfo);` 之後加：

```ts
        setGoHallTicketPrice(data.goHallTicketPrice ? String(data.goHallTicketPrice) : '');
        setGoHallSeasonPassPrice(data.goHallSeasonPassPrice ? String(data.goHallSeasonPassPrice) : '');
```

儲存函式（放在 `savePaymentInfo` 之後）：

```ts
  async function saveGoHallPrices() {
    const ticket = goHallTicketPrice.trim() === '' ? 0 : Number(goHallTicketPrice);
    const pass = goHallSeasonPassPrice.trim() === '' ? 0 : Number(goHallSeasonPassPrice);
    if (!Number.isInteger(ticket) || ticket < 0 || !Number.isInteger(pass) || pass < 0) {
      showToast('請輸入有效的價格（留空＝不預設）');
      return;
    }
    setSavingGoHall(true);
    try {
      const res = await fetch('/api/admin/billing/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goHallTicketPrice: ticket, goHallSeasonPassPrice: pass }),
      });
      if (!res.ok) {
        showToast('儲存失敗，請稍後再試');
        return;
      }
      showToast('已儲存弈廳價格');
    } finally {
      setSavingGoHall(false);
    }
  }
```

JSX：插在「折抵上限」Card 之前：

```tsx
      <Card className="mb-6">
        <p className="mb-2 font-bold text-ink">弈廳價格</p>
        <p className="mb-3 text-xs text-inkMuted">單獨開單選弈廳時自動帶入，開單時仍可修改；留空＝不預設</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 text-sm text-ink">
            <span>堂票單價（元／堂）</span>
            <Input type="number" min={0} value={goHallTicketPrice} onChange={(e) => setGoHallTicketPrice(e.target.value)} className="w-28" />
          </div>
          <div className="flex flex-col gap-1 text-sm text-ink">
            <span>季票價格（元）</span>
            <Input type="number" min={0} value={goHallSeasonPassPrice} onChange={(e) => setGoHallSeasonPassPrice(e.target.value)} className="w-28" />
          </div>
          <Button onClick={saveGoHallPrices} loading={savingGoHall}>
            儲存
          </Button>
        </div>
      </Card>
```

- [ ] **Step 7: 正式站 SQL 定稿**

打開 `docs/superpowers/2026-09-23-gohall-billing-production.sql`，把第 2 行 `-- ⚠️ 草稿：…` 刪掉。再跟 schema 比對一次欄位名稱與型別（`goHallItem` / `goHallTickets` / `seasonPassId` / `goHallTicketPrice` / `goHallSeasonPassPrice`、FK `ON DELETE RESTRICT ON UPDATE CASCADE`、unique index `Bill_seasonPassId_key`）。可以用 `npx prisma migrate diff --from-url "$DATABASE_URL_BEFORE" --to-schema-datamodel prisma/schema.prisma --script` 對照；沒有舊 DB URL 的話就人工比對。

- [ ] **Step 8: 型別檢查＋commit**

Run: `npx tsc --noEmit`
Expected: 無錯誤

```bash
git add prisma/schema.prisma src/lib/services/billingSettingService.ts src/lib/services/billingSettingService.test.ts src/app/api/admin/billing/settings/route.ts src/app/admin/billing/SettingsTab.tsx docs/superpowers/2026-09-23-gohall-billing-production.sql
git commit -m "feat: 弈廳收費單 schema＋設定頁弈廳預設價格"
```

---

### Task 2: goHallBillService 試算＋開單（開單即入帳）

**Files:**
- Create: `src/lib/services/goHallBillService.ts`
- Modify: `src/lib/services/billNotifyService.ts`（`billTargetName`）
- Test: `src/lib/services/goHallBillService.test.ts`

**Interfaces:**
- Consumes: `BillDiscount`、`buildNetFormula`（`./standaloneBillService`）；`notifyBills`（`./billNotifyService`）；`addSeasonPass` 的日期驗證語意（`INVALID_RANGE`）；`utcDateKey`、`taipeiDateKey`（`./goHallTicketService`）
- Produces:
  ```ts
  export type GoHallBillInput =
    | { item: 'TICKETS'; studentId: string; sessions: number; unitPrice: number; discounts?: BillDiscount[] }
    | { item: 'SEASON_PASS'; studentId: string; startDate: Date; endDate: Date; price: number; discounts?: BillDiscount[] };
  export function previewGoHallBill(input: GoHallBillInput): { grossAmount: number; amountDue: number; formula: string; netFormula?: string }
  export function createGoHallBill(input: GoHallBillInput & { amountDue: number; note?: string; notifyNow: boolean }, now?: Date): Promise<{ billId: string }>
  export function goHallItemName(bill: { goHallItem: 'TICKETS' | 'SEASON_PASS' | null; goHallTickets: number | null }): string | null
  ```
  `billTargetName` 改收 `{ class; tutoringEnrollment; goHallItem?; goHallTickets? }`，弈廳帳單回傳 `弈廳堂票 N 堂`／`弈廳季票`
  錯誤碼：`INVALID_INPUT`（堂數 < 1、單價或價格 < 0、非整數、amountDue < 0）、`INVALID_RANGE`

- [ ] **Step 1: 寫失敗的測試**

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { getTicketBalance } from './goHallTicketService';
import { previewGoHallBill, createGoHallBill } from './goHallBillService';
import { billTargetName } from './billNotifyService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = new Date(Date.UTC(2026, 8, 23, 4, 0)); // 台北 2026-09-23

async function newStudent() {
  return createStudent({ name: '小弈', email: `ghb-${Date.now()}-${Math.random()}@example.com`, password: 'x' });
}

describe('previewGoHallBill', () => {
  it('堂票：堂數×單價，有優惠時 netFormula 扣到最終金額', () => {
    const p = previewGoHallBill({ item: 'TICKETS', studentId: 's', sessions: 10, unitPrice: 300, discounts: [{ name: '手足', amount: 200 }] });
    expect(p.grossAmount).toBe(3000);
    expect(p.amountDue).toBe(2800);
    expect(p.formula).toBe('弈廳堂票 10 堂 × 300 ＝ 3,000 元');
    expect(p.netFormula).toBe('3,000 元 － 手足 200 元 ＝ 2,800 元');
  });

  it('季票：起訖＋價格；結束早於開始擋下', () => {
    const p = previewGoHallBill({ item: 'SEASON_PASS', studentId: 's', startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500 });
    expect(p.amountDue).toBe(4500);
    expect(p.formula).toContain('弈廳季票');
    expect(p.formula).toContain('4,500 元');
    expect(() => previewGoHallBill({ item: 'SEASON_PASS', studentId: 's', startDate: D(2026, 12, 1), endDate: D(2026, 10, 1), price: 1 })).toThrow('INVALID_RANGE');
    expect(() => previewGoHallBill({ item: 'TICKETS', studentId: 's', sessions: 0, unitPrice: 300 })).toThrow('INVALID_INPUT');
  });
});

describe('createGoHallBill', () => {
  it('堂票：建立已定案帳單＋帳本 +N（reason 收費單）＋清低堂數提醒戳記', async () => {
    const student = await newStudent();
    await prisma.student.update({ where: { id: student.id }, data: { goHallLowQuotaNotifiedAt: new Date() } });
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 10, unitPrice: 300, amountDue: 3000, notifyNow: false }, NOW);

    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill).toMatchObject({ status: 'FINALIZED', goHallItem: 'TICKETS', goHallTickets: 10, unitPrice: 300, amountDue: 3000, batchId: null });
    expect(bill.periodStart.toISOString().slice(0, 10)).toBe('2026-09-23');
    expect(bill.periodEnd.toISOString().slice(0, 10)).toBe('2026-09-23');
    expect(await getTicketBalance(student.id)).toBe(10);
    const tx = await prisma.goHallTicketTransaction.findFirstOrThrow({ where: { studentId: student.id } });
    expect(tx).toMatchObject({ kind: 'PURCHASE', amount: 10, reason: '收費單' });
    const s = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(s.goHallLowQuotaNotifiedAt).toBeNull();
    expect(billTargetName({ class: null, tutoringEnrollment: null, goHallItem: bill.goHallItem, goHallTickets: bill.goHallTickets })).toBe('弈廳堂票 10 堂');
  });

  it('季票：建立季票並關聯，收費區間＝季票起訖；金額與試算不同時標手動調整', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill(
      { item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4000, notifyNow: false },
      NOW
    );
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, include: { seasonPass: true } });
    expect(bill.goHallItem).toBe('SEASON_PASS');
    expect(bill.seasonPass).not.toBeNull();
    expect(bill.unitPrice).toBe(4500); // 季票價格存在 unitPrice，編輯時重建毛額用
    expect(bill.seasonPass!.startDate.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(bill.periodEnd.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect((bill.detail as { formula: string }).formula).toContain('（手動調整）');
    expect(billTargetName({ class: null, tutoringEnrollment: null, goHallItem: 'SEASON_PASS', goHallTickets: null })).toBe('弈廳季票');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/goHallBillService.test.ts`
Expected: FAIL（找不到模組）

- [ ] **Step 3: 實作 goHallBillService（開單部分）**

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { BillDiscount, buildNetFormula } from './standaloneBillService';
import { notifyBills } from './billNotifyService';
import { taipeiDateKey, utcDateKey } from './goHallTicketService';
import { formatDateWithWeekday } from '@/lib/dateFormat';

// 弈廳收費單（堂票／季票）：只走單獨開單，開單即入帳——堂票寫帳本 PURCHASE +N
// （reason 文字快照「收費單」，不建 FK），季票直接建立 GoHallSeasonPass 並以
// Bill.seasonPassId 關聯。刪除／編輯見 deleteGoHallBill／updateGoHallBill。

export type GoHallBillInput =
  | { item: 'TICKETS'; studentId: string; sessions: number; unitPrice: number; discounts?: BillDiscount[] }
  | { item: 'SEASON_PASS'; studentId: string; startDate: Date; endDate: Date; price: number; discounts?: BillDiscount[] };

const isNonNegInt = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

export { goHallItemName } from '@/lib/goHallBillItem';

function validate(input: GoHallBillInput) {
  if (input.item === 'TICKETS') {
    if (!Number.isInteger(input.sessions) || input.sessions < 1 || !isNonNegInt(input.unitPrice)) throw new Error('INVALID_INPUT');
  } else {
    if (!isNonNegInt(input.price)) throw new Error('INVALID_INPUT');
    if (utcDateKey(input.endDate) < utcDateKey(input.startDate)) throw new Error('INVALID_RANGE');
  }
}

function grossOf(input: GoHallBillInput): number {
  return input.item === 'TICKETS' ? input.sessions * input.unitPrice : input.price;
}

// formula 只寫毛額；無優惠時尾端就是最終金額（含手動調整標記），有優惠時最終金額
// 與手動調整標記移到 netFormula（同 createStandaloneClassBill 的算式規則）。
export function buildGoHallFormulas(input: GoHallBillInput, amountDue: number, discounts: BillDiscount[]) {
  const gross = grossOf(input);
  const expected = Math.max(0, gross - discounts.reduce((s, d) => s + d.amount, 0));
  const adjusted = amountDue !== expected;
  const head =
    input.item === 'TICKETS'
      ? `弈廳堂票 ${input.sessions} 堂 × ${input.unitPrice}`
      : `弈廳季票 ${formatDateWithWeekday(input.startDate)}～${formatDateWithWeekday(input.endDate)}`;
  if (discounts.length === 0) {
    return { formula: `${head} ＝ ${amountDue.toLocaleString('en-US')} 元${adjusted ? '（手動調整）' : ''}`, netFormula: undefined };
  }
  return {
    formula: `${head} ＝ ${gross.toLocaleString('en-US')} 元`,
    netFormula: buildNetFormula(gross, discounts, amountDue, adjusted),
  };
}

export function previewGoHallBill(input: GoHallBillInput) {
  validate(input);
  const discounts = input.discounts ?? [];
  const grossAmount = grossOf(input);
  const amountDue = Math.max(0, grossAmount - discounts.reduce((s, d) => s + d.amount, 0));
  const { formula, netFormula } = buildGoHallFormulas(input, amountDue, discounts);
  return { grossAmount, amountDue, formula, ...(netFormula ? { netFormula } : {}) };
}

export async function createGoHallBill(
  input: GoHallBillInput & { amountDue: number; note?: string; notifyNow: boolean },
  now: Date = new Date()
): Promise<{ billId: string }> {
  validate(input);
  if (!isNonNegInt(input.amountDue)) throw new Error('INVALID_INPUT');
  const discounts = input.discounts ?? [];
  const { formula, netFormula } = buildGoHallFormulas(input, input.amountDue, discounts);
  const detail = { sessionDates: [], deduction: null, discounts, ...(netFormula ? { netFormula } : {}), formula } as unknown as Prisma.InputJsonValue;
  const today = new Date(`${taipeiDateKey(now)}T00:00:00Z`);

  const billId = await prisma.$transaction(async (tx) => {
    if (input.item === 'TICKETS') {
      const bill = await tx.bill.create({
        data: {
          studentId: input.studentId, periodStart: today, periodEnd: today,
          goHallItem: 'TICKETS', goHallTickets: input.sessions, unitPrice: input.unitPrice,
          amountDue: input.amountDue, detail, status: 'FINALIZED', note: input.note,
        },
      });
      await tx.goHallTicketTransaction.create({ data: { studentId: input.studentId, amount: input.sessions, kind: 'PURCHASE', reason: '收費單' } });
      await tx.student.update({ where: { id: input.studentId }, data: { goHallLowQuotaNotifiedAt: null } });
      return bill.id;
    }
    const pass = await tx.goHallSeasonPass.create({ data: { studentId: input.studentId, startDate: input.startDate, endDate: input.endDate } });
    const bill = await tx.bill.create({
      data: {
        studentId: input.studentId, periodStart: input.startDate, periodEnd: input.endDate,
        goHallItem: 'SEASON_PASS', seasonPassId: pass.id, unitPrice: input.price, // 季票價格存 unitPrice，編輯時重建毛額
        amountDue: input.amountDue, detail, status: 'FINALIZED', note: input.note,
      },
    });
    return bill.id;
  });

  if (input.notifyNow) await notifyBills([billId]);
  return { billId };
}
```

新檔 `src/lib/goHallBillItem.ts`（無依賴，讓 billNotifyService 與 goHallBillService 都能 import 而不形成循環）：

```ts
// 弈廳帳單的項目顯示名稱（收費清單、推播、學生繳費頁共用）。
export function goHallItemName(bill: { goHallItem: 'TICKETS' | 'SEASON_PASS' | null; goHallTickets: number | null }): string | null {
  if (bill.goHallItem === 'TICKETS') return `弈廳堂票 ${bill.goHallTickets ?? 0} 堂`;
  if (bill.goHallItem === 'SEASON_PASS') return '弈廳季票';
  return null;
}
```

`billNotifyService.ts`：

```ts
import { goHallItemName } from '@/lib/goHallBillItem';

export function billTargetName(bill: {
  class: { name: string } | null;
  tutoringEnrollment: { program: { name: string } } | null;
  goHallItem?: 'TICKETS' | 'SEASON_PASS' | null;
  goHallTickets?: number | null;
}): string {
  return (
    bill.class?.name ??
    bill.tutoringEnrollment?.program.name ??
    goHallItemName({ goHallItem: bill.goHallItem ?? null, goHallTickets: bill.goHallTickets ?? null }) ??
    ''
  );
}
```


- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/goHallBillService.test.ts src/lib/services/billNotifyService.test.ts`
Expected: PASS（billNotifyService.test.ts 不存在就只跑前者）

- [ ] **Step 5: Commit**

```bash
git add src/lib/goHallBillItem.ts src/lib/services/goHallBillService.ts src/lib/services/goHallBillService.test.ts src/lib/services/billNotifyService.ts
git commit -m "feat: 弈廳收費單開單服務（開單即入帳堂票／季票）"
```

---

### Task 3: 弈廳帳單刪除／編輯＋季票守門

**Files:**
- Modify: `src/lib/services/goHallBillService.ts`
- Modify: `src/lib/services/goHallTicketService.ts`（`deleteSeasonPass`）
- Modify: `src/app/api/admin/billing/bills/[id]/route.ts`
- Modify: `src/app/api/go-hall-season-passes/[id]/route.ts`（錯誤碼格式）
- Test: `src/lib/services/goHallBillService.test.ts`（追加）

**Interfaces:**
- Consumes: Task 2 的 `createGoHallBill`、`buildGoHallFormulas`；`getTicketBalance`；`runSerializableWithRetry`（`@/lib/transaction`）
- Produces:
  ```ts
  export function deleteGoHallBill(billId: string): Promise<void>
  export function updateGoHallBill(billId: string, input: {
    amountDue: number; discounts: BillDiscount[];
    sessions?: number; unitPrice?: number;        // TICKETS
    startDate?: Date; endDate?: Date; price?: number; // SEASON_PASS
  }): Promise<void>
  ```
  錯誤碼：`BILL_HAS_PAYMENTS`、`BILL_NOT_FINALIZED`、`BILL_TICKETS_CONSUMED`、`BILL_SEASON_PASS_USED`、`INVALID_INPUT`、`INVALID_DISCOUNTS`、`INVALID_RANGE`；`deleteSeasonPass` 擋下時丟 `SEASON_PASS_HAS_BILL`

- [ ] **Step 1: 寫失敗的測試**（追加到 `goHallBillService.test.ts`；下面的 import 併進檔頭既有的 import）

```ts
import { deleteGoHallBill, updateGoHallBill } from './goHallBillService';
import { createTeacher } from './teacherService';
import { deleteSeasonPass } from './goHallTicketService';

async function seasonPassVisit(studentId: string, date: Date) {
  const teacher = await createTeacher({ name: '弈廳老師', email: `ghb-t-${Date.now()}-${Math.random()}@example.com`, password: 'x', subjects: '圍棋' });
  const session = await prisma.goHallSession.create({ data: { date, startTime: '14:00', endTime: '17:00', capacity: 10, teacherId: teacher.id } });
  const marker = await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } });
  await prisma.goHallAttendance.create({ data: { sessionId: session.id, studentId, status: 'PRESENT', qualification: 'SEASON_PASS', markedById: marker.userId } });
}

describe('deleteGoHallBill', () => {
  it('堂票：扣回 N 堂（ADMIN_ADJUST 刪除收費單扣回）並刪帳單', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 5, unitPrice: 300, amountDue: 1500, notifyNow: false }, NOW);
    await deleteGoHallBill(billId);
    expect(await prisma.bill.findUnique({ where: { id: billId } })).toBeNull();
    expect(await getTicketBalance(student.id)).toBe(0);
    const adj = await prisma.goHallTicketTransaction.findFirstOrThrow({ where: { studentId: student.id, kind: 'ADMIN_ADJUST' } });
    expect(adj).toMatchObject({ amount: -5, reason: '刪除收費單扣回' });
  });

  it('堂票已用掉（餘額不足扣回）擋下', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 2, unitPrice: 300, amountDue: 600, notifyNow: false }, NOW);
    await prisma.goHallTicketTransaction.create({ data: { studentId: student.id, amount: -1, kind: 'ATTEND' } });
    await expect(deleteGoHallBill(billId)).rejects.toThrow('BILL_TICKETS_CONSUMED');
    expect(await prisma.bill.findUnique({ where: { id: billId } })).not.toBeNull();
  });

  it('季票：未使用可連同季票刪除；已有季票到場且無其他季票涵蓋時擋下', async () => {
    const student = await newStudent();
    const a = await createGoHallBill({ item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4500, notifyNow: false }, NOW);
    const passId = (await prisma.bill.findUniqueOrThrow({ where: { id: a.billId } })).seasonPassId!;
    await deleteGoHallBill(a.billId);
    expect(await prisma.goHallSeasonPass.findUnique({ where: { id: passId } })).toBeNull();

    const b = await createGoHallBill({ item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4500, notifyNow: false }, NOW);
    await seasonPassVisit(student.id, D(2026, 10, 10));
    await expect(deleteGoHallBill(b.billId)).rejects.toThrow('BILL_SEASON_PASS_USED');
  });

  it('季票到場日另有季票涵蓋時允許刪除', async () => {
    const student = await newStudent();
    const b = await createGoHallBill({ item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4500, notifyNow: false }, NOW);
    await prisma.goHallSeasonPass.create({ data: { studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 10, 31) } });
    await seasonPassVisit(student.id, D(2026, 10, 10));
    await deleteGoHallBill(b.billId);
    expect(await prisma.bill.findUnique({ where: { id: b.billId } })).toBeNull();
  });

  it('有繳款紀錄擋下', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 1, unitPrice: 300, amountDue: 300, notifyNow: false }, NOW);
    await prisma.billPayment.create({ data: { billId, amount: 100, paidOn: D(2026, 9, 23), method: 'CASH', createdById: 'admin' } });
    await expect(deleteGoHallBill(billId)).rejects.toThrow('BILL_HAS_PAYMENTS');
  });
});

describe('updateGoHallBill', () => {
  it('堂票改堂數：差額寫帳本（收費單修改堂數），扣回時檢查餘額', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 5, unitPrice: 300, amountDue: 1500, notifyNow: false }, NOW);
    await updateGoHallBill(billId, { sessions: 8, unitPrice: 300, amountDue: 2400, discounts: [] });
    expect(await getTicketBalance(student.id)).toBe(8);
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill).toMatchObject({ goHallTickets: 8, amountDue: 2400 });
    expect((bill.detail as { formula: string }).formula).toBe('弈廳堂票 8 堂 × 300 ＝ 2,400 元');

    await prisma.goHallTicketTransaction.create({ data: { studentId: student.id, amount: -7, kind: 'ATTEND' } });
    await expect(updateGoHallBill(billId, { sessions: 2, unitPrice: 300, amountDue: 600, discounts: [] })).rejects.toThrow('BILL_TICKETS_CONSUMED');
  });

  it('季票改日期：同步改季票與收費區間；已用日期落到新區間外擋下', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4500, notifyNow: false }, NOW);
    await seasonPassVisit(student.id, D(2026, 10, 10));
    await updateGoHallBill(billId, { startDate: D(2026, 10, 5), endDate: D(2027, 1, 4), price: 4500, amountDue: 4500, discounts: [] });
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, include: { seasonPass: true } });
    expect(bill.periodStart.toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(bill.seasonPass!.endDate.toISOString().slice(0, 10)).toBe('2027-01-04');
    await expect(
      updateGoHallBill(billId, { startDate: D(2026, 10, 15), endDate: D(2027, 1, 4), price: 4500, amountDue: 4500, discounts: [] })
    ).rejects.toThrow('BILL_SEASON_PASS_USED');
  });
});

describe('deleteSeasonPass 守門', () => {
  it('綁著收費單的季票不能從票券管理直接刪', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4500, notifyNow: false }, NOW);
    const passId = (await prisma.bill.findUniqueOrThrow({ where: { id: billId } })).seasonPassId!;
    await expect(deleteSeasonPass(passId)).rejects.toThrow('SEASON_PASS_HAS_BILL');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/goHallBillService.test.ts`
Expected: FAIL（`deleteGoHallBill` 不存在）

- [ ] **Step 3: 實作刪除／編輯**（追加到 `goHallBillService.ts`）

```ts
import { runSerializableWithRetry } from '@/lib/transaction';
import { getTicketBalance } from './goHallTicketService';

type Tx = Prisma.TransactionClient;

// 這張季票（passId）在 [from, to] 內被拿來簽到、且當天沒有其他季票涵蓋的日期。
// 季票到場（qualification SEASON_PASS）沒有關聯是哪一張季票，只能用日期比對。
async function datesOnlyCoveredBy(tx: Tx, studentId: string, passId: string, from: Date, to: Date): Promise<string[]> {
  const [visits, others] = await Promise.all([
    tx.goHallAttendance.findMany({
      where: { studentId, qualification: 'SEASON_PASS', session: { date: { gte: from, lte: to } } },
      select: { session: { select: { date: true } } },
    }),
    tx.goHallSeasonPass.findMany({ where: { studentId, id: { not: passId } }, select: { startDate: true, endDate: true } }),
  ]);
  return visits
    .map((v) => utcDateKey(v.session.date))
    .filter((d) => !others.some((p) => utcDateKey(p.startDate) <= d && d <= utcDateKey(p.endDate)));
}

async function loadEditableGoHallBill(tx: Tx, billId: string) {
  const bill = await tx.bill.findUniqueOrThrow({
    where: { id: billId },
    select: {
      status: true, studentId: true, goHallItem: true, goHallTickets: true, unitPrice: true, seasonPassId: true,
      seasonPass: { select: { startDate: true, endDate: true } },
      payments: { select: { id: true } },
    },
  });
  if (bill.goHallItem === null) throw new Error('NOT_GO_HALL_BILL');
  if (bill.status !== 'FINALIZED') throw new Error('BILL_NOT_FINALIZED');
  if (bill.payments.length > 0) throw new Error('BILL_HAS_PAYMENTS');
  return bill;
}

export function deleteGoHallBill(billId: string): Promise<void> {
  return runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const bill = await loadEditableGoHallBill(tx, billId);
        if (bill.goHallItem === 'TICKETS') {
          const n = bill.goHallTickets ?? 0;
          if ((await getTicketBalance(bill.studentId, tx)) - n < 0) throw new Error('BILL_TICKETS_CONSUMED');
          await tx.bill.delete({ where: { id: billId } });
          if (n > 0) {
            await tx.goHallTicketTransaction.create({ data: { studentId: bill.studentId, amount: -n, kind: 'ADMIN_ADJUST', reason: '刪除收費單扣回' } });
          }
          return;
        }
        const pass = bill.seasonPass!;
        const used = await datesOnlyCoveredBy(tx, bill.studentId, bill.seasonPassId!, pass.startDate, pass.endDate);
        if (used.length > 0) throw new Error('BILL_SEASON_PASS_USED');
        await tx.bill.delete({ where: { id: billId } }); // 先刪帳單，才能刪 Restrict 的季票
        await tx.goHallSeasonPass.delete({ where: { id: bill.seasonPassId! } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export function updateGoHallBill(
  billId: string,
  input: { amountDue: number; discounts: BillDiscount[]; sessions?: number; unitPrice?: number; startDate?: Date; endDate?: Date; price?: number }
): Promise<void> {
  if (!isNonNegInt(input.amountDue)) return Promise.reject(new Error('INVALID_INPUT'));
  if (!Array.isArray(input.discounts)) return Promise.reject(new Error('INVALID_DISCOUNTS'));
  const discounts: BillDiscount[] = [];
  for (const d of input.discounts) {
    if (typeof d?.name !== 'string' || d.name.trim() === '' || !Number.isInteger(d.amount) || d.amount <= 0) {
      return Promise.reject(new Error('INVALID_DISCOUNTS'));
    }
    discounts.push({ name: d.name.trim(), amount: d.amount });
  }

  return runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const bill = await loadEditableGoHallBill(tx, billId);
        if (bill.goHallItem === 'TICKETS') {
          const sessions = input.sessions ?? bill.goHallTickets ?? 0;
          const unitPrice = input.unitPrice ?? bill.unitPrice ?? 0;
          const spec: GoHallBillInput = { item: 'TICKETS', studentId: bill.studentId, sessions, unitPrice, discounts };
          validate(spec);
          const delta = sessions - (bill.goHallTickets ?? 0);
          if (delta < 0 && (await getTicketBalance(bill.studentId, tx)) + delta < 0) throw new Error('BILL_TICKETS_CONSUMED');
          const { formula, netFormula } = buildGoHallFormulas(spec, input.amountDue, discounts);
          await tx.bill.update({
            where: { id: billId },
            data: {
              goHallTickets: sessions, unitPrice, amountDue: input.amountDue,
              detail: { sessionDates: [], deduction: null, discounts, ...(netFormula ? { netFormula } : {}), formula } as unknown as Prisma.InputJsonValue,
            },
          });
          if (delta !== 0) {
            await tx.goHallTicketTransaction.create({ data: { studentId: bill.studentId, amount: delta, kind: 'ADMIN_ADJUST', reason: '收費單修改堂數' } });
            if (delta > 0) await tx.student.update({ where: { id: bill.studentId }, data: { goHallLowQuotaNotifiedAt: null } });
          }
          return;
        }
        const pass = bill.seasonPass!;
        const startDate = input.startDate ?? pass.startDate;
        const endDate = input.endDate ?? pass.endDate;
        const price = input.price ?? bill.unitPrice ?? 0;
        const spec: GoHallBillInput = { item: 'SEASON_PASS', studentId: bill.studentId, startDate, endDate, price, discounts };
        validate(spec);
        const used = await datesOnlyCoveredBy(tx, bill.studentId, bill.seasonPassId!, pass.startDate, pass.endDate);
        const s = utcDateKey(startDate);
        const e = utcDateKey(endDate);
        if (used.some((d) => d < s || d > e)) throw new Error('BILL_SEASON_PASS_USED');
        const { formula, netFormula } = buildGoHallFormulas(spec, input.amountDue, discounts);
        await tx.goHallSeasonPass.update({ where: { id: bill.seasonPassId! }, data: { startDate, endDate } });
        await tx.bill.update({
          where: { id: billId },
          data: {
            periodStart: startDate, periodEnd: endDate, unitPrice: price, amountDue: input.amountDue,
            detail: { sessionDates: [], deduction: null, discounts, ...(netFormula ? { netFormula } : {}), formula } as unknown as Prisma.InputJsonValue,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}
```

> 季票價格在開單時存進 `Bill.unitPrice`（Task 2），編輯時沒有傳 `price` 就沿用它來重建毛額。

`goHallTicketService.ts` 的 `deleteSeasonPass`：

```ts
export async function deleteSeasonPass(id: string): Promise<void> {
  const bill = await prisma.bill.findUnique({ where: { seasonPassId: id }, select: { id: true } });
  if (bill) throw new Error('SEASON_PASS_HAS_BILL');
  await prisma.goHallSeasonPass.delete({ where: { id } });
}
```

`go-hall-season-passes/[id]/route.ts` 的 catch 改成只回錯誤碼（避免 Prisma 訊息外洩）：

```ts
  } catch (err) {
    const code = err instanceof Error ? err.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 422 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
```

`bills/[id]/route.ts` 分流：PATCH 的 `findUniqueOrThrow` select 加 `goHallItem: true`，在 `if (bill.status === 'FINALIZED')` 之前加：

```ts
    if (bill.goHallItem !== null) {
      await updateGoHallBill(params.id, {
        amountDue: body.amountDue,
        discounts: body.discounts ?? [],
        sessions: body.goHallTickets,
        unitPrice: body.unitPrice,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        endDate: body.endDate ? new Date(body.endDate) : undefined,
        price: body.price,
      });
      return NextResponse.json({ success: true });
    }
```

DELETE 改成：

```ts
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: params.id }, select: { goHallItem: true } });
    if (bill.goHallItem !== null) await deleteGoHallBill(params.id);
    else await deleteBill(params.id);
    return NextResponse.json({ success: true });
```

（import `updateGoHallBill, deleteGoHallBill` from `@/lib/services/goHallBillService`。在 `billingBatchService.deleteBill` 開頭加一行防呆：select 加 `goHallItem: true`，`if (bill.goHallItem !== null) throw new Error('USE_GO_HALL_DELETE');`，防止以後有人繞過 route 直接呼叫，造成沒扣回就刪。）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/goHallBillService.test.ts src/lib/services/goHallTicketService.test.ts src/lib/services/billingBatchService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/goHallBillService.ts src/lib/services/goHallBillService.test.ts src/lib/services/goHallTicketService.ts src/lib/services/billingBatchService.ts "src/app/api/admin/billing/bills/[id]/route.ts" "src/app/api/go-hall-season-passes/[id]/route.ts"
git commit -m "feat: 弈廳收費單刪除／編輯連動扣回＋季票守門"
```

---

### Task 4: 單獨開單 API 的 GO_HALL 分支＋收費總覽資料

**Files:**
- Modify: `src/app/api/admin/billing/standalone/route.ts`
- Modify: `src/lib/services/billOverviewService.ts`
- Test: `src/app/api/admin/billing/routes.test.ts`（追加）

**Interfaces:**
- Consumes: `previewGoHallBill`、`createGoHallBill`（Task 2）
- Produces:
  - POST body `{ kind: 'GO_HALL', preview, studentId, item: 'TICKETS'|'SEASON_PASS', sessions?, unitPrice?, startDate?, endDate?, price?, amountDue?, note?, notifyNow?, discounts? }`（GO_HALL 不需要 periodStart／periodEnd）
  - `OverviewBillRow.source: 'CLASS' | 'TUTORING' | 'GO_HALL' | null`、新增 `goHallItem`、`goHallTickets`、`seasonPassStart`、`seasonPassEnd`（`Date | null`）

- [ ] **Step 1: 寫失敗的測試**（追加到 routes.test.ts；import `POST as standalonePOST from './standalone/route'`）

```ts
describe('POST /api/admin/billing/standalone GO_HALL', () => {
  it('試算＋建立堂票帳單；overview source=GO_HALL', async () => {
    asAdmin();
    const student = await createStudent({ name: '小弈', email: `gh-route-${Date.now()}@example.com`, password: 'x' });
    const preview = await standalonePOST(jsonReq({ kind: 'GO_HALL', preview: true, studentId: student.id, item: 'TICKETS', sessions: 4, unitPrice: 250 }) as never);
    expect(preview.status).toBe(200);
    expect((await preview.json()).amountDue).toBe(1000);

    const created = await standalonePOST(jsonReq({ kind: 'GO_HALL', preview: false, studentId: student.id, item: 'TICKETS', sessions: 4, unitPrice: 250, amountDue: 1000 }) as never);
    expect(created.status).toBe(200);
    const res = await overviewGET(overviewReq(''));
    const row = (await res.json()).bills.find((b: { studentName: string }) => b.studentName === '小弈');
    expect(row).toMatchObject({ source: 'GO_HALL', goHallItem: 'TICKETS', goHallTickets: 4, targetName: '弈廳堂票 4 堂' });
  });

  it('缺欄位 400 MISSING_FIELDS；堂數 0 回 400 INVALID_INPUT', async () => {
    asAdmin();
    const r1 = await standalonePOST(jsonReq({ kind: 'GO_HALL', preview: true, item: 'TICKETS' }) as never);
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe('MISSING_FIELDS');
    const r2 = await standalonePOST(jsonReq({ kind: 'GO_HALL', preview: true, studentId: 'x', item: 'TICKETS', sessions: 0, unitPrice: 1 }) as never);
    expect((await r2.json()).error).toBe('INVALID_INPUT');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/app/api/admin/billing/routes.test.ts -t "GO_HALL"`
Expected: FAIL（回 400 MISSING_FIELDS，因為沒有 periodStart）

- [ ] **Step 3: route 實作**

在 `POST` 裡，`if (!body.kind || !body.periodStart ...)` 那行之前插入 GO_HALL 分支：

```ts
  if (body.kind === 'GO_HALL') {
    if (!body.studentId || (body.item !== 'TICKETS' && body.item !== 'SEASON_PASS')) {
      return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
    }
    if (body.item === 'SEASON_PASS' && (!body.startDate || !body.endDate)) {
      return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
    }
    const parsed = parseDiscounts(body.discounts);
    if (!parsed.ok) return NextResponse.json({ error: 'INVALID_DISCOUNTS' }, { status: 400 });
    const spec =
      body.item === 'TICKETS'
        ? { item: 'TICKETS' as const, studentId: body.studentId, sessions: Number(body.sessions), unitPrice: Number(body.unitPrice), discounts: parsed.discounts }
        : { item: 'SEASON_PASS' as const, studentId: body.studentId, startDate: new Date(body.startDate), endDate: new Date(body.endDate), price: Number(body.price), discounts: parsed.discounts };
    try {
      if (body.preview) return NextResponse.json(previewGoHallBill(spec));
      return NextResponse.json(await createGoHallBill({ ...spec, amountDue: Number(body.amountDue), note: body.note, notifyNow: !!body.notifyNow }));
    } catch (e) {
      const code = e instanceof Error ? e.message : 'INTERNAL';
      if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    }
  }
```

（import `previewGoHallBill, createGoHallBill` from `@/lib/services/goHallBillService`；更新檔頭 body 註解，加上 GO_HALL 的形狀。）

- [ ] **Step 4: overview 服務**

`OverviewBillRow` 介面：

```ts
  source: 'CLASS' | 'TUTORING' | 'GO_HALL' | null; // 批次種類；GO_HALL＝弈廳收費單；null＝其他單獨開單
  goHallItem: 'TICKETS' | 'SEASON_PASS' | null;
  goHallTickets: number | null;
  seasonPassStart: Date | null;
  seasonPassEnd: Date | null;
```

`include` 加 `seasonPass: { select: { startDate: true, endDate: true } }`；map 裡：

```ts
      source: b.goHallItem ? 'GO_HALL' : (b.batch?.kind ?? null),
      // …
      goHallItem: b.goHallItem,
      goHallTickets: b.goHallTickets,
      seasonPassStart: b.seasonPass?.startDate ?? null,
      seasonPassEnd: b.seasonPass?.endDate ?? null,
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run src/app/api/admin/billing/routes.test.ts src/lib/services/billOverviewService.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/billing/standalone/route.ts src/lib/services/billOverviewService.ts src/app/api/admin/billing/routes.test.ts
git commit -m "feat: 單獨開單 API 支援弈廳＋收費總覽 GO_HALL 來源"
```

---

### Task 5: 前端——單獨開單彈窗

**Files:**
- Modify: `src/app/admin/billing/StandaloneBillModal.tsx`

**Interfaces:**
- Consumes: Task 4 的 POST GO_HALL 形狀；settings GET 多回傳的 `goHallTicketPrice`、`goHallSeasonPassPrice`

- [ ] **Step 1: 型別與 state**

```ts
type Target =
  | { kind: 'CLASS'; classId: string }
  | { kind: 'TUTORING'; enrollmentId: string }
  | { kind: 'GO_HALL'; item: 'TICKETS' | 'SEASON_PASS' };

interface GoHallPreview {
  grossAmount: number;
  amountDue: number;
  formula: string;
  netFormula?: string;
}
```

新增 state：

```ts
  const [goHallPreview, setGoHallPreview] = useState<GoHallPreview | null>(null);
  const [goHallSessions, setGoHallSessions] = useState('');
  const [goHallUnitPrice, setGoHallUnitPrice] = useState('');
  const [goHallPrice, setGoHallPrice] = useState('');
  const [goHallDefaults, setGoHallDefaults] = useState({ ticket: 0, pass: 0 });
```

`open` 重置 effect 加 `setGoHallPreview(null); setGoHallSessions(''); setGoHallUnitPrice(''); setGoHallPrice('');`。settings fetch 改成：

```ts
      .then((data) => {
        setDiscountItems(data.discountItems ?? []);
        setGoHallDefaults({ ticket: data.goHallTicketPrice ?? 0, pass: data.goHallSeasonPassPrice ?? 0 });
      });
```

所有會清掉試算的地方（`mutateDiscountRows`、`selectStudent`）都加一句 `setGoHallPreview(null);`。

- [ ] **Step 2: 選項清單加弈廳**

在 `studentEnrollments.map(...)` 之後、「沒有可開單」提示之前插入（弈廳每個學生都能開，所以「沒有可開單」的提示改為永遠不顯示：刪掉那段 `{enrolledClasses.length === 0 && studentEnrollments.length === 0 && …}`）：

```tsx
                {(['TICKETS', 'SEASON_PASS'] as const).map((item) => (
                  <label key={`gohall-${item}`} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-ink hover:bg-stripe">
                    <input
                      type="radio"
                      name="standalone-target"
                      checked={target?.kind === 'GO_HALL' && target.item === item}
                      onChange={() => selectGoHall(item)}
                    />
                    {item === 'TICKETS' ? '弈廳堂票' : '弈廳季票'}（弈廳）
                  </label>
                ))}
```

```ts
  function selectGoHall(item: 'TICKETS' | 'SEASON_PASS') {
    setTarget({ kind: 'GO_HALL', item });
    setClassPreview(null);
    setTutoringPreview(null);
    setGoHallPreview(null);
    if (item === 'TICKETS') setGoHallUnitPrice(goHallDefaults.ticket > 0 ? String(goHallDefaults.ticket) : '');
    else setGoHallPrice(goHallDefaults.pass > 0 ? String(goHallDefaults.pass) : '');
  }
```

- [ ] **Step 3: 輸入欄位**

`{target && (<>…</>)}` 區塊裡，原本的「收費區間起／訖」兩個 label 改成只在非弈廳或弈廳季票時顯示，並依類型換標題；另外加堂票欄位和價格欄位：

```tsx
              {target.kind === 'GO_HALL' && target.item === 'TICKETS' && (
                <div className="flex flex-wrap gap-3">
                  <div className="flex flex-col gap-1 text-sm text-ink">
                    <span>堂數</span>
                    <Input type="number" min={1} value={goHallSessions} onChange={(e) => { setGoHallSessions(e.target.value); setGoHallPreview(null); }} className="w-28" />
                  </div>
                  <div className="flex flex-col gap-1 text-sm text-ink">
                    <span>單價（元／堂）</span>
                    <Input type="number" min={0} value={goHallUnitPrice} onChange={(e) => { setGoHallUnitPrice(e.target.value); setGoHallPreview(null); }} className="w-28" />
                  </div>
                </div>
              )}
              {!(target.kind === 'GO_HALL' && target.item === 'TICKETS') && (
                <>
                  <label className="flex flex-col gap-1 text-sm text-ink">
                    {target.kind === 'GO_HALL' ? '季票起' : '收費區間起'}
                    <Input type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setGoHallPreview(null); }} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm text-ink">
                    {target.kind === 'GO_HALL' ? '季票訖' : '收費區間訖'}
                    <Input type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setGoHallPreview(null); }} />
                  </label>
                </>
              )}
              {target.kind === 'GO_HALL' && target.item === 'SEASON_PASS' && (
                <div className="flex flex-col gap-1 text-sm text-ink">
                  <span>季票價格（元）</span>
                  <Input type="number" min={0} value={goHallPrice} onChange={(e) => { setGoHallPrice(e.target.value); setGoHallPreview(null); }} className="w-32" />
                </div>
              )}
```

- [ ] **Step 4: 試算／建立**

```ts
  function goHallBody(preview: boolean, discounts: { name: string; amount: number }[]) {
    if (target?.kind !== 'GO_HALL') return null;
    return target.item === 'TICKETS'
      ? { kind: 'GO_HALL', preview, studentId, item: 'TICKETS', sessions: Number(goHallSessions), unitPrice: Number(goHallUnitPrice), discounts }
      : { kind: 'GO_HALL', preview, studentId, item: 'SEASON_PASS', startDate: periodStart, endDate: periodEnd, price: Number(goHallPrice), discounts };
  }
```

`runPreview`：`body` 的決定改成 `target.kind === 'GO_HALL' ? goHallBody(true, discounts) : (原本的三元)`；成功後的分支加：

```ts
      if (target.kind === 'GO_HALL') {
        setGoHallPreview(data);
        setAmountDueDraft(String(data.amountDue));
      } else if (target.kind === 'CLASS') { …原樣 } else { …原樣 }
```

`runPreview` 開頭也要 `setGoHallPreview(null);`。`submit`：`target.kind === 'GO_HALL'` 時 body 用 `{ ...goHallBody(false, discounts)!, amountDue, notifyNow }`。

`canPreview`：

```ts
  const canPreview =
    target !== null &&
    (target.kind === 'GO_HALL' && target.item === 'TICKETS'
      ? Number(goHallSessions) >= 1 && goHallUnitPrice !== ''
      : periodStart !== '' && periodEnd !== '' && periodStart <= periodEnd &&
        (target.kind !== 'GO_HALL' || goHallPrice !== ''));
  const canCreate = (classPreview !== null || tutoringPreview !== null || goHallPreview !== null) && amountDueDraft !== '';
```

ERROR_MESSAGES 加：

```ts
  INVALID_INPUT: '請確認堂數、單價與價格為有效數字（堂數至少 1）',
  INVALID_RANGE: '季票結束日不能早於開始日',
```

試算結果區（`tutoringPreview` 區塊之後）：

```tsx
          {goHallPreview && (
            <div className="flex flex-col gap-2">
              <BillDetailBlock detail={{ sessionDates: [], deduction: null, formula: goHallPreview.formula, netFormula: goHallPreview.netFormula, discounts: collectDiscounts() ?? [] }} />
              <label className="flex flex-col gap-1 text-sm text-ink">
                金額
                <Input type="number" min={0} value={amountDueDraft} onChange={(e) => setAmountDueDraft(e.target.value)} className="w-32" />
              </label>
              <p className="text-xs text-inkMuted">
                {target?.kind === 'GO_HALL' && target.item === 'TICKETS' ? '建立後堂票會直接加進學生的弈廳帳本' : '建立後季票會直接生效'}
              </p>
            </div>
          )}
```

- [ ] **Step 5: 型別檢查＋lint＋commit**

Run: `npx tsc --noEmit && npx next lint --file src/app/admin/billing/StandaloneBillModal.tsx`
Expected: 無錯誤

```bash
git add src/app/admin/billing/StandaloneBillModal.tsx
git commit -m "feat: 單獨開單彈窗新增弈廳堂票／季票"
```

---

### Task 6: 前端——收費清單、編輯彈窗、票券管理訊息＋瀏覽器驗證

**Files:**
- Modify: `src/app/admin/billing/OverviewTab.tsx`
- Modify: `src/app/admin/billing/EditBillModal.tsx`
- Modify: `src/app/admin/go-hall/TicketManager.tsx`

**Interfaces:**
- Consumes: Task 4 overview 新欄位；Task 3 PATCH 形狀（`goHallTickets`、`unitPrice`、`startDate`、`endDate`、`price`）與錯誤碼

- [ ] **Step 1: OverviewTab**

- `OverviewBillRow` 介面加 `source` 的 `'GO_HALL'`，以及 `goHallItem: 'TICKETS' | 'SEASON_PASS' | null; goHallTickets: number | null; seasonPassStart: string | null; seasonPassEnd: string | null;`
- `SOURCE_LABEL` 改成 `Record<'CLASS' | 'TUTORING' | 'GO_HALL', string>`，加 `GO_HALL: '弈廳'`
- `SourceFilter` 加 `'GO_HALL'`；`SOURCE_FILTERS` 最後加 `{ key: 'GO_HALL', label: '弈廳' }`
- 篩選條件改成 `if ((sourceFilter === 'CLASS' || sourceFilter === 'TUTORING' || sourceFilter === 'GO_HALL') && r.source !== sourceFilter) return false;`（STANDALONE 那行不變：GO_HALL 的 source 不是 null，本來就會被排除）
- 操作選單：退班結算只給非弈廳，把該行改成 `...(r.settledAsWithdrawal || r.source === 'GO_HALL' ? [] : [{ key: 'settle', … }])`
- 編輯帳單的 `setEditBill({...})` 多帶：`goHallItem: r.goHallItem, goHallTickets: r.goHallTickets, seasonPassStart: r.seasonPassStart, seasonPassEnd: r.seasonPassEnd,`
- 刪除確認：`deleteBill(r.id, rollbackSessions)` 的確認文字在弈廳堂票時要寫「將同時扣回 N 張弈廳堂票」、季票時寫「將同時刪除這張季票」。找到 `async function deleteBill(` 的確認文字組法（`grep -n "扣回開單" OverviewTab.tsx`），加第三個參數 `goHall: { item: 'TICKETS' | 'SEASON_PASS'; tickets: number } | null`，照同樣風格組字串。
- ERROR_MESSAGES 加：
  ```ts
  BILL_TICKETS_CONSUMED: '這張收費單的弈廳堂票已有部分被使用，扣回會讓餘額變負，無法刪除',
  BILL_SEASON_PASS_USED: '這張季票已被用來簽到弈廳，無法刪除（請先調整弈廳出缺勤）',
  ```

- [ ] **Step 2: EditBillModal**

`EditableBillInfo` 加：

```ts
  goHallItem?: 'TICKETS' | 'SEASON_PASS' | null;
  goHallTickets?: number | null;
  seasonPassStart?: string | null;
  seasonPassEnd?: string | null;
```

（批次明細頁的呼叫端不用改，選填欄位預設就是 undefined。）

state：`goHallSessionsDraft`、`seasonStartDraft`、`seasonEndDraft`，在 `useEffect([bill])` 裡從 `bill.goHallTickets`／`seasonPassStart.slice(0,10)`／`seasonPassEnd.slice(0,10)` 帶入。

`grossFor` 開頭加：

```ts
    if (bill!.goHallItem === 'TICKETS') {
      const n = Number(sessionsText);
      return Number.isFinite(n) && bill!.unitPrice !== null ? n * bill!.unitPrice : null;
    }
    if (bill!.goHallItem === 'SEASON_PASS') return bill!.unitPrice; // 季票價格存在 unitPrice
```

弈廳堂票時把 `billedSessionsDraft` 的角色換成 `goHallSessionsDraft`：堂數輸入框顯示在 `isClassBill` 那一塊的旁邊，文案是「弈廳堂票張數（調整後帳本會同步增減）」，onChange 呼叫 `setGoHallSessionsDraft(v); suggestAmount(v, discountRows);`。季票時顯示兩個 date Input（季票起、季票訖，用共用 Input）。

`save()` 的 body：

```ts
      if (bill!.goHallItem === 'TICKETS') Object.assign(body, { goHallTickets: Number(goHallSessionsDraft), unitPrice: bill!.unitPrice });
      if (bill!.goHallItem === 'SEASON_PASS') Object.assign(body, { startDate: seasonStartDraft, endDate: seasonEndDraft, price: bill!.unitPrice });
```

（body 型別改成 `Record<string, unknown>`。）

`canSave` 加：堂票時 `goHallSessionsDraft !== ''`，季票時起訖都有值且起 ≤ 訖。

資訊卡的「收費區間」在弈廳堂票時改顯示「開單日」。

ERROR_MESSAGES 加 `BILL_TICKETS_CONSUMED`、`BILL_SEASON_PASS_USED`（文案同 Step 1，把「刪除」改成「調整」）、`INVALID_RANGE: '季票結束日不能早於開始日'`。

- [ ] **Step 3: TicketManager**

`handleDeletePass` 的失敗分支改成：

```ts
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error === 'SEASON_PASS_HAS_BILL' ? '這張季票是由收費單開立的，請到「收費」的收費清單刪除該帳單' : '刪除失敗，季票可能已被刪除');
        await refreshAfterMutation();
        return;
      }
```

- [ ] **Step 4: 型別檢查＋lint＋整套測試**

Run: `npx tsc --noEmit && npx next lint && npm test`
Expected: 全部通過

- [ ] **Step 5: 瀏覽器驗證**

先 `npx prisma generate`，再重啟 dev server（preview_start；launch.json 在上層目錄 `/Users/s.w.kung/Downloads/Wade Claude/.claude/launch.json`），用 `http://localhost:<port>` 登入行政：
1. 收費 → 設定：填堂票單價 300、季票 4500，儲存後重新整理仍在。
2. 單獨開單：選學生 → 「弈廳堂票」→ 單價自動帶 300 → 堂數 10 → 試算顯示 `弈廳堂票 10 堂 × 300 ＝ 3,000 元` → 加一筆自訂優惠 → 建立。到弈廳票券管理確認餘額 +10、帳本有「收費單」。
3. 單獨開單「弈廳季票」→ 起訖＋價格帶入 4500 → 建立；票券管理出現該季票，直接刪會跳出「請到收費清單刪除」。
4. 收費清單：「弈廳」篩選鈕只列出這兩張，項目欄顯示正確，沒有「退班結算」選項。編輯堂票單改成 8 張（餘額同步 −2）；刪除季票單（季票消失）。
5. 用學生帳號看 `/student/billing`：項目名稱顯示「弈廳堂票 N 堂」。
6. resize_window 切 mobile 和 dark 各截一張圖，確認單獨開單彈窗正常。
驗證資料用完就刪（刪帳單會自動扣回）。

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/billing/OverviewTab.tsx src/app/admin/billing/EditBillModal.tsx src/app/admin/go-hall/TicketManager.tsx
git commit -m "feat: 收費清單弈廳篩選／編輯＋票券管理季票刪除提示"
```

---

## 上線

1. 使用者在 Supabase SQL Editor 執行 `docs/superpowers/2026-09-23-gohall-billing-production.sql`，驗證查詢回傳 5 列。
2. 然後才 `git push`（Vercel 自動部署）。順序不能反，否則新程式會讀到不存在的欄位。
