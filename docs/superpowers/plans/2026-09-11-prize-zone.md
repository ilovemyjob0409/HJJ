# 獎品專區 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 學生用點數在系統上自助兌換獎品、取得 6 位數字兌換代號，行政在後台核銷領獎；含後台獎品目錄維護、取消退點、30 天逾期自動退點。

**Architecture:** 新增 `Prize`＋`PrizeRedemption` 兩張表，狀態機住在 `PrizeRedemption`；`PointTransaction` 維持純流水（扣點沿用 kind `REDEMPTION`、退點新增 kind `REDEMPTION_REFUND`）。服務層集中在新的 `prizeService.ts`，兌換／取消走 Serializable 交易。圖片走新的 Supabase 私有 bucket `prize-images`＋簽名網址。

**Tech Stack:** Next.js App Router、Prisma（pg driver adapter）、Supabase Storage、vitest、既有 UI 元件庫（Modal／useConfirm／CollapsibleDataTable／Input／Select／Button）。

**Spec:** `docs/superpowers/specs/2026-09-11-prize-zone-design.md`

## Global Constraints

- 執行前先用 superpowers:using-git-worktrees 建隔離 worktree；測試 DB 會被其他 session 互咬，worktree 內建議改用專用測試 DB（把 `vitest.setup.ts` 與 `test:dbpush` 的 DB 名換成專用名，只在 worktree 內改、不 commit）。
- schema 改動後：先 `npm run test:dbpush`（把 schema 推進測試 DB）才能跑測試；本地 dev server 要重啟＋`npx prisma generate` 才吃到新 client。
- 測試指令：單檔 `npx vitest run <path>`；全套 `npm test`。vitest `fileParallelism: false`、每測前 `resetDb()` TRUNCATE 全表。
- 日期慣例：日曆日一律 UTC 儲存/顯示/比較、「今天」用台北（`taipeiDateKey`）；日期運算只用 `Date.UTC`，禁用 `new Date(Y, M, D)` 本地建構子。所有日期顯示 `日期（星期）`：日曆日用 `formatDateWithWeekday`、真實時間戳用 `formatTimestampWithWeekdayTaipei`。
- 表單一律用共用 `Input`/`Select` 元件；彈窗一律 `Modal`（含 focus trap/Esc/捲動鎖定）；確認一律 `useConfirm()`；紀錄類表格 >3 筆用 `CollapsibleDataTable maxRows={3}`。
- API 不外洩原始 Prisma 錯誤：service 丟 `Error('CODE')`，route 回 `{ error: code }`，前端用 `ERROR_LABELS` Record 映射中文。
- 通知一律走 `notifyUser`（收件夾＋推播的唯一入口），失敗不影響主流程。
- 動效重用既有 `animate-*` class／Button loading／骨架屏；不另創動畫。
- 手機版用 responsive class 切換，桌機 markup 不動。
- **Task 9 是硬檢查點：UI mockup 未經使用者核可，不得開始 Task 10/11。**
- Commit 訊息結尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`；只 stage 自己改的檔案。

---

### Task 1: Schema——Prize／PrizeRedemption／enum＋正式 SQL

**Files:**
- Modify: `prisma/schema.prisma`（`PointKind` enum、`Student` model、檔尾新增兩 model＋一 enum）
- Create: `docs/superpowers/2026-09-11-prize-zone-production.sql`

**Interfaces:**
- Produces: Prisma client 的 `prisma.prize`、`prisma.prizeRedemption`、`PointKind.REDEMPTION_REFUND`、`PrizeRedemptionStatus`（後續所有任務依賴）。

- [ ] **Step 1: 改 schema**

`PointKind` enum（schema.prisma 約 55 行）加一值：

```prisma
enum PointKind {
  TEACHER_AWARD
  LOTTERY_COST
  LOTTERY_WIN
  REDEMPTION
  REDEMPTION_REFUND
  ADMIN_ADJUST
}
```

`Student` model（約 124 行）關聯清單加一行：

```prisma
  prizeRedemptions         PrizeRedemption[]
```

檔尾新增：

```prisma
enum PrizeRedemptionStatus {
  PENDING // 待領獎
  PICKED_UP // 已領取
  CANCELLED // 已取消（學生自取消或行政撤銷）
  EXPIRED // 逾期自動退點
}

// 獎品目錄（行政維護）。刪除＝下架（active:false），歷史靠 PrizeRedemption 快照。
model Prize {
  id          String            @id @default(cuid())
  name        String
  points      Int // 所需點數
  stock       Int // 庫存；0 顯示「已換完」
  imagePath   String? // Supabase prize-images bucket 路徑
  active      Boolean           @default(true)
  sortOrder   Int
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
  redemptions PrizeRedemption[]
}

// 兌換紀錄＝狀態機主體。prizeName／兩桶扣點為快照，獎品改名刪除不影響歷史，
// 退點按快照精準退回原桶。
model PrizeRedemption {
  id               String                @id @default(cuid())
  code             String                @unique // 6 位純數字兌換代號
  studentId        String
  student          Student               @relation(fields: [studentId], references: [id])
  prizeId          String
  prize            Prize                 @relation(fields: [prizeId], references: [id])
  prizeName        String
  redeemOnlyUsed   Int
  regularUsed      Int
  status           PrizeRedemptionStatus @default(PENDING)
  createdAt        DateTime              @default(now())
  pickedUpAt       DateTime?
  cancelledAt      DateTime? // CANCELLED / EXPIRED 共用
  expiryRemindedAt DateTime? // 到期前提醒只發一次
  operator         String? // 核銷／撤銷操作者（行政名／「學生本人」／「系統（逾期）」）

  @@index([studentId])
  @@index([status])
}
```

- [ ] **Step 2: 推進測試 DB＋重生 client**

Run: `npm run test:dbpush && npx prisma generate`
Expected: 無錯誤，輸出含 `Your database is now in sync`。

- [ ] **Step 3: 寫正式環境 SQL（照 2026-07-31-point-card-production.sql 慣例：冪等、可重複執行）**

```sql
-- 獎品專區 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：一個 enum type＋兩張表＋PointKind 加值（無 backfill）
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔 → Storage 建私有 bucket 'prize-images' → git push 部署新程式。

-- 1) PointKind 加 REDEMPTION_REFUND
ALTER TYPE "PointKind" ADD VALUE IF NOT EXISTS 'REDEMPTION_REFUND';

-- 2) 兌換狀態 enum
DO $$ BEGIN
  CREATE TYPE "PrizeRedemptionStatus" AS ENUM ('PENDING', 'PICKED_UP', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) 獎品目錄
CREATE TABLE IF NOT EXISTS "Prize" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "imagePath" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Prize_pkey" PRIMARY KEY ("id")
);

-- 4) 兌換紀錄
CREATE TABLE IF NOT EXISTS "PrizeRedemption" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "prizeId" TEXT NOT NULL,
    "prizeName" TEXT NOT NULL,
    "redeemOnlyUsed" INTEGER NOT NULL,
    "regularUsed" INTEGER NOT NULL,
    "status" "PrizeRedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedUpAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiryRemindedAt" TIMESTAMP(3),
    "operator" TEXT,
    CONSTRAINT "PrizeRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PrizeRedemption_code_key" ON "PrizeRedemption"("code");
CREATE INDEX IF NOT EXISTS "PrizeRedemption_studentId_idx" ON "PrizeRedemption"("studentId");
CREATE INDEX IF NOT EXISTS "PrizeRedemption_status_idx" ON "PrizeRedemption"("status");

ALTER TABLE "PrizeRedemption" DROP CONSTRAINT IF EXISTS "PrizeRedemption_studentId_fkey";
ALTER TABLE "PrizeRedemption" ADD CONSTRAINT "PrizeRedemption_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrizeRedemption" DROP CONSTRAINT IF EXISTS "PrizeRedemption_prizeId_fkey";
ALTER TABLE "PrizeRedemption" ADD CONSTRAINT "PrizeRedemption_prizeId_fkey"
  FOREIGN KEY ("prizeId") REFERENCES "Prize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 驗證：應回傳兩張表且各為 0 筆
SELECT
  (SELECT count(*) FROM "Prize")           AS prizes,
  (SELECT count(*) FROM "PrizeRedemption") AS prize_redemptions;
```

- [ ] **Step 4: 既有測試不受影響**

Run: `npx vitest run src/lib/services/pointService.test.ts`
Expected: PASS（schema 加東西不動舊表）。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma docs/superpowers/2026-09-11-prize-zone-production.sql
git commit -m "feat: 獎品專區 schema（Prize/PrizeRedemption＋REDEMPTION_REFUND）＋正式 SQL"
```

---

### Task 2: prizeDates 純日期工具

**Files:**
- Create: `src/lib/prizeDates.ts`
- Test: `src/lib/prizeDates.test.ts`

**Interfaces:**
- Consumes: `taipeiDateKey(date: Date): string`（`src/lib/taipeiDate.ts`）。
- Produces: `PRIZE_EXPIRY_DAYS = 30`、`PRIZE_REMIND_BEFORE_DAYS = 7`、`addDaysToKey(key: string, days: number): string`、`prizeDeadlineKey(createdAt: Date): string`、`prizeRemindFromKey(createdAt: Date): string`。判定口徑：`todayKey > deadlineKey` → 逾期；`todayKey >= remindFromKey` → 該提醒。

- [ ] **Step 1: 寫失敗測試**

```ts
// src/lib/prizeDates.test.ts
import { describe, it, expect } from 'vitest';
import { addDaysToKey, prizeDeadlineKey, prizeRemindFromKey, PRIZE_EXPIRY_DAYS } from './prizeDates';

describe('addDaysToKey', () => {
  it('adds days across month boundaries in UTC', () => {
    expect(addDaysToKey('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToKey('2026-02-28', 2)).toBe('2026-03-02');
    expect(addDaysToKey('2026-03-10', -7)).toBe('2026-03-03');
  });
});

describe('prizeDeadlineKey / prizeRemindFromKey', () => {
  it('deadline is Taipei calendar day of createdAt + 30 days', () => {
    // 2026-09-10T20:00:00Z = 台北 2026-09-11 04:00 → 台北曆日 09-11
    const createdAt = new Date('2026-09-10T20:00:00Z');
    expect(prizeDeadlineKey(createdAt)).toBe(addDaysToKey('2026-09-11', PRIZE_EXPIRY_DAYS));
    expect(prizeDeadlineKey(createdAt)).toBe('2026-10-11');
  });

  it('remind-from is 7 days before the deadline', () => {
    const createdAt = new Date('2026-09-10T20:00:00Z');
    expect(prizeRemindFromKey(createdAt)).toBe('2026-10-04');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/prizeDates.test.ts`
Expected: FAIL（module 不存在）。

- [ ] **Step 3: 實作**

```ts
// src/lib/prizeDates.ts
// 純日期工具（client 可 import）：不得依賴 services/*——依賴鏈牽到 @/lib/db 會
// 讓 client bundle 打包失敗，同 taipeiDate.ts 檔頭說明的理由。
import { taipeiDateKey } from './taipeiDate';

export const PRIZE_EXPIRY_DAYS = 30;
export const PRIZE_REMIND_BEFORE_DAYS = 7;

// 'YYYY-MM-DD' ± N 天。一律 Date.UTC——本地建構子在非 UTC 時區會偏移一天。
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// 領取期限（含當日有效）：兌換當下的台北曆日 + 30 天。
export function prizeDeadlineKey(createdAt: Date): string {
  return addDaysToKey(taipeiDateKey(createdAt), PRIZE_EXPIRY_DAYS);
}

// 到期前 7 天開始提醒的那一天。
export function prizeRemindFromKey(createdAt: Date): string {
  return addDaysToKey(prizeDeadlineKey(createdAt), -PRIZE_REMIND_BEFORE_DAYS);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/prizeDates.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/prizeDates.ts src/lib/prizeDates.test.ts
git commit -m "feat: 獎品兌換期限純日期工具（30 天期限／前 7 天提醒）"
```

---

### Task 3: storage.ts 加 prize-images bucket helpers

**Files:**
- Modify: `src/lib/storage.ts`
- Test: `src/lib/storage.test.ts`（加測試，不動既有）

**Interfaces:**
- Produces: `uploadPrizeImage(prizeId: string, body: Buffer, contentType: string): Promise<string>`、`createPrizeSignedUrls(paths: string[]): Promise<Map<string, string>>`、`deletePrizeImages(paths: string[]): Promise<void>`。既有 `uploadActivityImage`／`createSignedUrls`／`deleteActivityImages` 行為不變。

- [ ] **Step 1: 寫失敗測試（追加到 storage.test.ts，沿用該檔既有的 supabase mock）**

```ts
describe('prize storage', () => {
  it('uploadPrizeImage uploads under the prize folder and returns the path', async () => {
    uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null });
    const { uploadPrizeImage } = await import('./storage');
    const path = await uploadPrizeImage('prize123', Buffer.from('x'), 'image/png');
    expect(path).toMatch(/^prize123\/[0-9a-f-]+\.png$/);
    expect(uploadMock).toHaveBeenCalledWith(path, expect.any(Buffer), { contentType: 'image/png' });
  });

  it('uploadPrizeImage rejects unsupported content types', async () => {
    const { uploadPrizeImage } = await import('./storage');
    await expect(uploadPrizeImage('p1', Buffer.from('x'), 'image/gif')).rejects.toThrow(/Unsupported/);
  });

  it('createPrizeSignedUrls maps path to signed url and returns empty map for no paths', async () => {
    createSignedUrlsMock.mockResolvedValue({ data: [{ path: 'p1/a.jpg', signedUrl: 'https://signed/a' }], error: null });
    const { createPrizeSignedUrls } = await import('./storage');
    expect((await createPrizeSignedUrls(['p1/a.jpg'])).get('p1/a.jpg')).toBe('https://signed/a');
    expect((await createPrizeSignedUrls([])).size).toBe(0);
  });

  it('deletePrizeImages removes paths and no-ops on empty', async () => {
    removeMock.mockResolvedValue({ data: null, error: null });
    const { deletePrizeImages } = await import('./storage');
    await deletePrizeImages(['p1/a.jpg']);
    expect(removeMock).toHaveBeenCalledWith(['p1/a.jpg']);
    removeMock.mockClear();
    await deletePrizeImages([]);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑測試確認新測試失敗、舊測試通過**

Run: `npx vitest run src/lib/storage.test.ts`
Expected: 新增 4 條 FAIL（export 不存在），既有全 PASS。

- [ ] **Step 3: 實作——抽 bucket 參數化內部函式，兩組 export 共用**

把既有三個函式的本體改為呼叫內部 helper（行為不變），再加 prize 版：

```ts
const BUCKET = 'activity-images';
const PRIZE_BUCKET = 'prize-images';

async function uploadTo(bucket: string, folder: string, body: Buffer, contentType: string): Promise<string> {
  const ext = EXTENSION_BY_CONTENT_TYPE[contentType];
  if (!ext) throw new Error(`Unsupported content type: ${contentType}`);
  const path = `${folder}/${randomUUID()}.${ext}`;
  const { error } = await getClient().storage.from(bucket).upload(path, body, { contentType });
  if (error) throw new Error(error.message);
  return path;
}

async function signedUrlsFrom(bucket: string, paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const { data, error } = await getClient().storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((d) => [d.path ?? '', d.signedUrl as string]));
}

async function removeFrom(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await getClient().storage.from(bucket).remove(paths);
  if (error) throw new Error(error.message);
}

export function uploadActivityImage(activityId: string, body: Buffer, contentType: string): Promise<string> {
  return uploadTo(BUCKET, activityId, body, contentType);
}
export function createSignedUrls(paths: string[]): Promise<Map<string, string>> {
  return signedUrlsFrom(BUCKET, paths);
}
export function deleteActivityImages(paths: string[]): Promise<void> {
  return removeFrom(BUCKET, paths);
}

export function uploadPrizeImage(prizeId: string, body: Buffer, contentType: string): Promise<string> {
  return uploadTo(PRIZE_BUCKET, prizeId, body, contentType);
}
export function createPrizeSignedUrls(paths: string[]): Promise<Map<string, string>> {
  return signedUrlsFrom(PRIZE_BUCKET, paths);
}
export function deletePrizeImages(paths: string[]): Promise<void> {
  return removeFrom(PRIZE_BUCKET, paths);
}
```

- [ ] **Step 4: 跑測試確認全通過**

Run: `npx vitest run src/lib/storage.test.ts`
Expected: PASS（新舊全綠）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat: storage 加 prize-images bucket 上傳／簽名／刪除 helpers"
```

---

### Task 4: prizeService——redeemPrize（兌換交易）

**Files:**
- Create: `src/lib/services/prizeService.ts`
- Test: `src/lib/services/prizeService.test.ts`

**Interfaces:**
- Consumes: `runSerializableWithRetry`（`@/lib/transaction`）、`notifyUser`（`./notificationService`，`NotifyPayload = { title; body; url }`）、`prizeDeadlineKey`（`@/lib/prizeDates`）、`formatDateWithWeekday`（`@/lib/dateFormat`）。
- Produces:
  - `generatePrizeCode(): string`（6 位數字，`crypto.randomInt`）
  - `redeemPrize(input: { studentId: string; prizeId: string }, generateCode?: () => string): Promise<{ id: string; code: string; prizeName: string; points: number; createdAt: Date; deadlineKey: string }>`
  - 錯誤碼：`PRIZE_UNAVAILABLE`／`OUT_OF_STOCK`／`ALREADY_REDEEMED`／`INSUFFICIENT_POINTS`／`CODE_GENERATION_FAILED`
  - 內部（後續任務共用）：`notifyStudent(studentId, body)`、`refundAndRestock(tx, row, reasonPrefix)`

- [ ] **Step 1: 寫失敗測試**

```ts
// src/lib/services/prizeService.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { redeemPrize } from './prizeService';

async function setup(opts?: { regular?: number; redeemOnly?: number; points?: number; stock?: number }) {
  const student = await createStudent({ name: '小明', email: 'pz-ming@example.com', password: 'x' });
  const prize = await prisma.prize.create({
    data: { name: '恐龍模型', points: opts?.points ?? 50, stock: opts?.stock ?? 3, sortOrder: 0 },
  });
  const grants = [];
  if (opts?.regular) grants.push({ studentId: student.id, bucket: 'REGULAR' as const, amount: opts.regular, kind: 'TEACHER_AWARD' as const, reason: 'x' });
  if (opts?.redeemOnly) grants.push({ studentId: student.id, bucket: 'REDEEM_ONLY' as const, amount: opts.redeemOnly, kind: 'LOTTERY_WIN' as const, reason: 'x' });
  if (grants.length) await prisma.pointTransaction.createMany({ data: grants });
  return { student, prize };
}

describe('redeemPrize', () => {
  it('deducts REDEEM_ONLY first then REGULAR, snapshots both, decrements stock, issues a 6-digit code', async () => {
    const { student, prize } = await setup({ regular: 40, redeemOnly: 30, points: 50 });
    const result = await redeemPrize({ studentId: student.id, prizeId: prize.id });

    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.prizeName).toBe('恐龍模型');
    expect(result.points).toBe(50);

    const row = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.status).toBe('PENDING');
    expect(row.redeemOnlyUsed).toBe(30);
    expect(row.regularUsed).toBe(20);

    const txs = await prisma.pointTransaction.findMany({ where: { kind: 'REDEMPTION' } });
    expect(txs).toHaveLength(2);
    expect(txs.find((t) => t.bucket === 'REDEEM_ONLY')?.amount).toBe(-30);
    expect(txs.find((t) => t.bucket === 'REGULAR')?.amount).toBe(-20);
    for (const t of txs) expect(t.reason).toBe('兌換獎品：恐龍模型');

    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).stock).toBe(2);
  });

  it('writes a single-bucket transaction when redeem-only covers the whole cost', async () => {
    const { student, prize } = await setup({ redeemOnly: 60, points: 50 });
    await redeemPrize({ studentId: student.id, prizeId: prize.id });
    const txs = await prisma.pointTransaction.findMany({ where: { kind: 'REDEMPTION' } });
    expect(txs).toHaveLength(1);
    expect(txs[0].bucket).toBe('REDEEM_ONLY');
    expect(txs[0].amount).toBe(-50);
  });

  it('rejects INSUFFICIENT_POINTS without touching stock or points', async () => {
    const { student, prize } = await setup({ regular: 10, points: 50 });
    await expect(redeemPrize({ studentId: student.id, prizeId: prize.id })).rejects.toThrow('INSUFFICIENT_POINTS');
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).stock).toBe(3);
    expect(await prisma.pointTransaction.count({ where: { kind: 'REDEMPTION' } })).toBe(0);
  });

  it('rejects OUT_OF_STOCK and PRIZE_UNAVAILABLE (inactive or missing prize)', async () => {
    const { student, prize } = await setup({ regular: 100, stock: 0 });
    await expect(redeemPrize({ studentId: student.id, prizeId: prize.id })).rejects.toThrow('OUT_OF_STOCK');
    await prisma.prize.update({ where: { id: prize.id }, data: { stock: 1, active: false } });
    await expect(redeemPrize({ studentId: student.id, prizeId: prize.id })).rejects.toThrow('PRIZE_UNAVAILABLE');
    await expect(redeemPrize({ studentId: student.id, prizeId: 'nope' })).rejects.toThrow('PRIZE_UNAVAILABLE');
  });

  it('rejects ALREADY_REDEEMED while a PENDING/PICKED_UP redemption exists, allows again after CANCELLED', async () => {
    const { student, prize } = await setup({ regular: 200 });
    const first = await redeemPrize({ studentId: student.id, prizeId: prize.id });
    await expect(redeemPrize({ studentId: student.id, prizeId: prize.id })).rejects.toThrow('ALREADY_REDEEMED');
    await prisma.prizeRedemption.update({ where: { id: first.id }, data: { status: 'CANCELLED' } });
    await expect(redeemPrize({ studentId: student.id, prizeId: prize.id })).resolves.toBeTruthy();
  });

  it('retries code collisions and fails with CODE_GENERATION_FAILED when exhausted', async () => {
    const { student, prize } = await setup({ regular: 200 });
    const taken = await redeemPrize({ studentId: student.id, prizeId: prize.id }, () => '111111');
    expect(taken.code).toBe('111111');

    const other = await createStudent({ name: '小華', email: 'pz-hua@example.com', password: 'x' });
    await prisma.pointTransaction.create({ data: { studentId: other.id, bucket: 'REGULAR', amount: 100, kind: 'TEACHER_AWARD', reason: 'x' } });

    // 前幾次都撞號、最後一次給新號 → 成功
    const codes = ['111111', '111111', '222222'];
    const ok = await redeemPrize({ studentId: other.id, prizeId: prize.id }, () => codes.shift() ?? '999999');
    expect(ok.code).toBe('222222');

    // 永遠撞號 → CODE_GENERATION_FAILED
    const third = await createStudent({ name: '小美', email: 'pz-mei@example.com', password: 'x' });
    await prisma.pointTransaction.create({ data: { studentId: third.id, bucket: 'REGULAR', amount: 100, kind: 'TEACHER_AWARD', reason: 'x' } });
    await expect(redeemPrize({ studentId: third.id, prizeId: prize.id }, () => '111111')).rejects.toThrow('CODE_GENERATION_FAILED');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/prizeService.test.ts`
Expected: FAIL（module 不存在）。

- [ ] **Step 3: 實作**

```ts
// src/lib/services/prizeService.ts
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { notifyUser } from './notificationService';
import { prizeDeadlineKey } from '@/lib/prizeDates';
import { formatDateWithWeekday } from '@/lib/dateFormat';

export const CODE_ATTEMPTS = 5;

export function generatePrizeCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// 兌換相關通知（收件夾＋推播）。寫入成功後才發；失敗只記 log，不影響主流程。
async function notifyStudent(studentId: string, body: string) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { user: { select: { id: true } } },
    });
    if (!student) return;
    await notifyUser(student.user.id, { title: '獎品專區', body, url: '/student/prizes' });
  } catch (err) {
    console.error('prize notification failed', err);
  }
}

type RefundableRow = { studentId: string; prizeId: string; prizeName: string; redeemOnlyUsed: number; regularUsed: number };

// 取消／逾期共用：按快照把兩桶各自退回＋庫存加回。
async function refundAndRestock(tx: Prisma.TransactionClient, row: RefundableRow, reasonPrefix: string) {
  const reason = `${reasonPrefix}：${row.prizeName}`;
  if (row.redeemOnlyUsed > 0) {
    await tx.pointTransaction.create({
      data: { studentId: row.studentId, bucket: 'REDEEM_ONLY', amount: row.redeemOnlyUsed, kind: 'REDEMPTION_REFUND', reason },
    });
  }
  if (row.regularUsed > 0) {
    await tx.pointTransaction.create({
      data: { studentId: row.studentId, bucket: 'REGULAR', amount: row.regularUsed, kind: 'REDEMPTION_REFUND', reason },
    });
  }
  await tx.prize.update({ where: { id: row.prizeId }, data: { stock: { increment: 1 } } });
}

async function sumBucket(tx: Prisma.TransactionClient, studentId: string, bucket: 'REGULAR' | 'REDEEM_ONLY') {
  const agg = await tx.pointTransaction.aggregate({ where: { studentId, bucket }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

// 兌換：檢查上架/庫存/限換/餘額 → 扣點（先兌換專用、不足扣一般）→ 扣庫存 → 發代號。
// 全程單一 Serializable 交易，防兩個並發兌換同時通過庫存/餘額檢查。
export async function redeemPrize(
  input: { studentId: string; prizeId: string },
  generateCode: () => string = generatePrizeCode
) {
  const result = await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const prize = await tx.prize.findUnique({ where: { id: input.prizeId } });
        if (!prize || !prize.active) throw new Error('PRIZE_UNAVAILABLE');
        if (prize.stock < 1) throw new Error('OUT_OF_STOCK');

        // 每人每種獎品限 1 次：只算 PENDING/PICKED_UP，取消/逾期不佔名額
        const occupied = await tx.prizeRedemption.count({
          where: { studentId: input.studentId, prizeId: input.prizeId, status: { in: ['PENDING', 'PICKED_UP'] } },
        });
        if (occupied > 0) throw new Error('ALREADY_REDEEMED');

        const [regular, redeemOnly] = await Promise.all([
          sumBucket(tx, input.studentId, 'REGULAR'),
          sumBucket(tx, input.studentId, 'REDEEM_ONLY'),
        ]);
        if (regular + redeemOnly < prize.points) throw new Error('INSUFFICIENT_POINTS');

        const redeemOnlyUsed = Math.min(redeemOnly, prize.points);
        const regularUsed = prize.points - redeemOnlyUsed;
        const reason = `兌換獎品：${prize.name}`;
        if (redeemOnlyUsed > 0) {
          await tx.pointTransaction.create({
            data: { studentId: input.studentId, bucket: 'REDEEM_ONLY', amount: -redeemOnlyUsed, kind: 'REDEMPTION', reason },
          });
        }
        if (regularUsed > 0) {
          await tx.pointTransaction.create({
            data: { studentId: input.studentId, bucket: 'REGULAR', amount: -regularUsed, kind: 'REDEMPTION', reason },
          });
        }

        await tx.prize.update({ where: { id: prize.id }, data: { stock: { decrement: 1 } } });

        let code = '';
        for (let i = 0; i < CODE_ATTEMPTS; i++) {
          const candidate = generateCode();
          if ((await tx.prizeRedemption.count({ where: { code: candidate } })) === 0) {
            code = candidate;
            break;
          }
        }
        if (!code) throw new Error('CODE_GENERATION_FAILED');

        const row = await tx.prizeRedemption.create({
          data: { code, studentId: input.studentId, prizeId: prize.id, prizeName: prize.name, redeemOnlyUsed, regularUsed },
        });
        return { id: row.id, code, prizeName: prize.name, points: prize.points, createdAt: row.createdAt };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  const deadlineKey = prizeDeadlineKey(result.createdAt);
  await notifyStudent(
    input.studentId,
    `兌換成功：${result.prizeName}，兌換代號 ${result.code}，請於 ${formatDateWithWeekday(deadlineKey)} 前至櫃台領取`
  );
  return { ...result, deadlineKey };
}
```

（`refundAndRestock` 這個任務先定義好、Task 5/7 使用；本任務允許暫時未被呼叫。）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/prizeService.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/prizeService.ts src/lib/services/prizeService.test.ts
git commit -m "feat: 獎品兌換交易（兩桶扣點快照＋庫存＋6 位代號）"
```

---

### Task 5: prizeService——cancelRedemption／pickupRedemption

**Files:**
- Modify: `src/lib/services/prizeService.ts`
- Test: `src/lib/services/prizeService.test.ts`（追加）

**Interfaces:**
- Consumes: Task 4 的 `refundAndRestock`、`notifyStudent`、`redeemPrize`。
- Produces:
  - `cancelRedemption(input: { redemptionId: string; byStudentId?: string; operator: string }): Promise<PrizeRedemption>`——`byStudentId` 有值＝學生本人操作，必須擁有該筆否則 `NOT_FOUND`；非 PENDING → `NOT_PENDING`。
  - `pickupRedemption(input: { redemptionId: string; operator: string }): Promise<void>`——非 PENDING 依現況丟 `ALREADY_PICKED_UP`／`ALREADY_CANCELLED`／`ALREADY_EXPIRED`；查無 `NOT_FOUND`。

- [ ] **Step 1: 寫失敗測試（追加）**

```ts
import { cancelRedemption, pickupRedemption } from './prizeService';

describe('cancelRedemption', () => {
  it('refunds each bucket per snapshot, restocks, marks CANCELLED with operator', async () => {
    const { student, prize } = await setup({ regular: 40, redeemOnly: 30, points: 50 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });

    await cancelRedemption({ redemptionId: r.id, byStudentId: student.id, operator: '學生本人' });

    const row = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('CANCELLED');
    expect(row.operator).toBe('學生本人');
    expect(row.cancelledAt).not.toBeNull();

    const refunds = await prisma.pointTransaction.findMany({ where: { kind: 'REDEMPTION_REFUND' } });
    expect(refunds.find((t) => t.bucket === 'REDEEM_ONLY')?.amount).toBe(30);
    expect(refunds.find((t) => t.bucket === 'REGULAR')?.amount).toBe(20);
    for (const t of refunds) expect(t.reason).toBe('取消兌換退點：恐龍模型');

    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).stock).toBe(3);
  });

  it('a student cannot cancel someone else’s redemption; admin (no byStudentId) can', async () => {
    const { student, prize } = await setup({ regular: 100 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });
    await expect(cancelRedemption({ redemptionId: r.id, byStudentId: 'other', operator: '學生本人' })).rejects.toThrow('NOT_FOUND');
    await expect(cancelRedemption({ redemptionId: r.id, operator: '王行政' })).resolves.toBeTruthy();
  });

  it('rejects NOT_PENDING for already picked-up rows', async () => {
    const { student, prize } = await setup({ regular: 100 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });
    await pickupRedemption({ redemptionId: r.id, operator: '王行政' });
    await expect(cancelRedemption({ redemptionId: r.id, operator: '王行政' })).rejects.toThrow('NOT_PENDING');
  });
});

describe('pickupRedemption', () => {
  it('marks PICKED_UP with operator and pickedUpAt', async () => {
    const { student, prize } = await setup({ regular: 100 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });
    await pickupRedemption({ redemptionId: r.id, operator: '王行政' });
    const row = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('PICKED_UP');
    expect(row.operator).toBe('王行政');
    expect(row.pickedUpAt).not.toBeNull();
  });

  it('reports the current status when not pending', async () => {
    const { student, prize } = await setup({ regular: 100 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });
    await pickupRedemption({ redemptionId: r.id, operator: '王行政' });
    await expect(pickupRedemption({ redemptionId: r.id, operator: '王行政' })).rejects.toThrow('ALREADY_PICKED_UP');
    await expect(pickupRedemption({ redemptionId: 'nope', operator: '王行政' })).rejects.toThrow('NOT_FOUND');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/prizeService.test.ts`
Expected: 新測試 FAIL（export 不存在），Task 4 測試 PASS。

- [ ] **Step 3: 實作（追加到 prizeService.ts）**

```ts
// 取消（學生本人或行政撤銷）：退點＋補庫存＋改狀態，單一 Serializable 交易。
export async function cancelRedemption(input: { redemptionId: string; byStudentId?: string; operator: string }) {
  const row = await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const r = await tx.prizeRedemption.findUnique({ where: { id: input.redemptionId } });
        if (!r || (input.byStudentId && r.studentId !== input.byStudentId)) throw new Error('NOT_FOUND');
        if (r.status !== 'PENDING') throw new Error('NOT_PENDING');
        await refundAndRestock(tx, r, '取消兌換退點');
        return tx.prizeRedemption.update({
          where: { id: r.id },
          data: { status: 'CANCELLED', cancelledAt: new Date(), operator: input.operator },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  await notifyStudent(row.studentId, `已取消兌換：${row.prizeName}，退回 ${row.redeemOnlyUsed + row.regularUsed} 點`);
  return row;
}

// 核銷：updateMany 帶 status 條件當樂觀鎖——兩個行政同時按只會成功一次。
export async function pickupRedemption(input: { redemptionId: string; operator: string }) {
  const updated = await prisma.prizeRedemption.updateMany({
    where: { id: input.redemptionId, status: 'PENDING' },
    data: { status: 'PICKED_UP', pickedUpAt: new Date(), operator: input.operator },
  });
  if (updated.count === 0) {
    const cur = await prisma.prizeRedemption.findUnique({ where: { id: input.redemptionId } });
    if (!cur) throw new Error('NOT_FOUND');
    if (cur.status === 'PICKED_UP') throw new Error('ALREADY_PICKED_UP');
    if (cur.status === 'CANCELLED') throw new Error('ALREADY_CANCELLED');
    throw new Error('ALREADY_EXPIRED');
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/prizeService.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/prizeService.ts src/lib/services/prizeService.test.ts
git commit -m "feat: 兌換取消退點（原桶精準退回）＋行政核銷"
```

---

### Task 6: prizeService——目錄查詢／CRUD／圖片／紀錄清單

**Files:**
- Modify: `src/lib/services/prizeService.ts`
- Test: `src/lib/services/prizeService.test.ts`（追加）

**Interfaces:**
- Consumes: `createPrizeSignedUrls`、`deletePrizeImages`（`@/lib/storage`，Task 3）；`prizeDeadlineKey`。
- Produces（route／UI 層依賴的確切形狀）:
  - `listPrizesForStudent(studentId): Promise<{ id; name; points; stock; imageUrl: string | null; alreadyRedeemed: boolean }[]>`（只含 active，`sortOrder asc, createdAt asc`）
  - `listPrizesForAdmin(): Promise<{ id; name; points; stock; active; sortOrder; imageUrl: string | null }[]>`（全部）
  - `createPrize(input: { name: string; points: number; stock: number; sortOrder: number }): Promise<Prize>`；驗證失敗丟 `INVALID_NAME`／`INVALID_POINTS`／`INVALID_STOCK`
  - `updatePrize(id: string, input: { name?; points?; stock?; sortOrder?; active? }): Promise<Prize>`；查無丟 `NOT_FOUND`
  - `setPrizeImage(prizeId: string, storagePath: string): Promise<void>`（換圖時舊檔 best-effort 刪除）
  - `listMyRedemptions(studentId): Promise<{ id; code; prizeName; points: number; status; createdAt: Date; deadlineKey: string }[]>`（`createdAt desc`；`points = redeemOnlyUsed + regularUsed`）
  - `listPendingRedemptions(): Promise<{ id; code; studentName; studentNumber: string | null; prizeName; points: number; createdAt: Date; deadlineKey: string }[]>`（PENDING，`createdAt asc`）
  - `findRedemptionByCode(code: string): Promise<{ id; code; studentName; prizeName; points: number; status; createdAt: Date; deadlineKey: string } | null>`

- [ ] **Step 1: 寫失敗測試（追加；核心行為，getter 不逐欄驗證）**

```ts
import {
  listPrizesForStudent,
  listPrizesForAdmin,
  createPrize,
  updatePrize,
  listMyRedemptions,
  listPendingRedemptions,
  findRedemptionByCode,
} from './prizeService';

describe('prize catalog', () => {
  it('createPrize validates inputs; updatePrize edits fields and rejects unknown id', async () => {
    await expect(createPrize({ name: '  ', points: 10, stock: 1, sortOrder: 0 })).rejects.toThrow('INVALID_NAME');
    await expect(createPrize({ name: 'A', points: 0, stock: 1, sortOrder: 0 })).rejects.toThrow('INVALID_POINTS');
    await expect(createPrize({ name: 'A', points: 10, stock: -1, sortOrder: 0 })).rejects.toThrow('INVALID_STOCK');

    const prize = await createPrize({ name: '貼紙組', points: 10, stock: 5, sortOrder: 1 });
    const updated = await updatePrize(prize.id, { points: 15, active: false });
    expect(updated.points).toBe(15);
    expect(updated.active).toBe(false);
    await expect(updatePrize('nope', { points: 1 })).rejects.toThrow('NOT_FOUND');
  });

  it('listPrizesForStudent returns only active prizes ordered by sortOrder, with alreadyRedeemed flag', async () => {
    const { student, prize } = await setup({ regular: 100 });
    await createPrize({ name: '下架品', points: 5, stock: 1, sortOrder: 0 }).then((p) => updatePrize(p.id, { active: false }));
    await redeemPrize({ studentId: student.id, prizeId: prize.id });

    const rows = await listPrizesForStudent(student.id);
    expect(rows.map((r) => r.name)).toEqual(['恐龍模型']);
    expect(rows[0].alreadyRedeemed).toBe(true);

    expect((await listPrizesForAdmin()).map((r) => r.name).sort()).toEqual(['下架品', '恐龍模型']);
  });
});

describe('redemption lists', () => {
  it('listMyRedemptions / listPendingRedemptions / findRedemptionByCode return points and deadlineKey', async () => {
    const { student, prize } = await setup({ regular: 100, points: 50 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });

    const mine = await listMyRedemptions(student.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ code: r.code, prizeName: '恐龍模型', points: 50, status: 'PENDING', deadlineKey: r.deadlineKey });

    const pending = await listPendingRedemptions();
    expect(pending[0]).toMatchObject({ code: r.code, studentName: '小明', prizeName: '恐龍模型', points: 50 });

    expect(await findRedemptionByCode(r.code)).toMatchObject({ studentName: '小明', status: 'PENDING' });
    expect(await findRedemptionByCode('000000')).toBeNull();
  });
});
```

（`setup` 需在本任務把 `points`/`stock` 選項保留、`prize.name` 固定「恐龍模型」——Task 4 已如此。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/prizeService.test.ts`
Expected: 新測試 FAIL（export 不存在）。

- [ ] **Step 3: 實作（追加到 prizeService.ts）**

```ts
import { createPrizeSignedUrls, deletePrizeImages } from '@/lib/storage';

async function signedUrlMap(imagePaths: (string | null)[]) {
  const paths = imagePaths.filter((p): p is string => !!p);
  try {
    return await createPrizeSignedUrls(paths);
  } catch (err) {
    // 簽名失敗不擋目錄顯示（沒圖照樣能換）
    console.error('prize signed urls failed', err);
    return new Map<string, string>();
  }
}

export async function listPrizesForStudent(studentId: string) {
  const [prizes, mine] = await Promise.all([
    prisma.prize.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.prizeRedemption.findMany({
      where: { studentId, status: { in: ['PENDING', 'PICKED_UP'] } },
      select: { prizeId: true },
    }),
  ]);
  const redeemed = new Set(mine.map((m) => m.prizeId));
  const urls = await signedUrlMap(prizes.map((p) => p.imagePath));
  return prizes.map((p) => ({
    id: p.id,
    name: p.name,
    points: p.points,
    stock: p.stock,
    imageUrl: p.imagePath ? (urls.get(p.imagePath) ?? null) : null,
    alreadyRedeemed: redeemed.has(p.id),
  }));
}

export async function listPrizesForAdmin() {
  const prizes = await prisma.prize.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  const urls = await signedUrlMap(prizes.map((p) => p.imagePath));
  return prizes.map((p) => ({
    id: p.id,
    name: p.name,
    points: p.points,
    stock: p.stock,
    active: p.active,
    sortOrder: p.sortOrder,
    imageUrl: p.imagePath ? (urls.get(p.imagePath) ?? null) : null,
  }));
}

function validatePrizeInput(input: { name?: string; points?: number; stock?: number; sortOrder?: number }) {
  if (input.name !== undefined && !input.name.trim()) throw new Error('INVALID_NAME');
  if (input.points !== undefined && (!Number.isInteger(input.points) || input.points < 1)) throw new Error('INVALID_POINTS');
  if (input.stock !== undefined && (!Number.isInteger(input.stock) || input.stock < 0)) throw new Error('INVALID_STOCK');
  if (input.sortOrder !== undefined && !Number.isInteger(input.sortOrder)) throw new Error('INVALID_SORT_ORDER');
}

export async function createPrize(input: { name: string; points: number; stock: number; sortOrder: number }) {
  validatePrizeInput(input);
  return prisma.prize.create({
    data: { name: input.name.trim(), points: input.points, stock: input.stock, sortOrder: input.sortOrder },
  });
}

export async function updatePrize(
  id: string,
  input: { name?: string; points?: number; stock?: number; sortOrder?: number; active?: boolean }
) {
  validatePrizeInput(input);
  const existing = await prisma.prize.findUnique({ where: { id } });
  if (!existing) throw new Error('NOT_FOUND');
  return prisma.prize.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.points !== undefined ? { points: input.points } : {}),
      ...(input.stock !== undefined ? { stock: input.stock } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

// 換圖：DB 先 commit、舊檔刪除 best-effort（孤兒物件可接受，DB 指向被刪物件不可）
export async function setPrizeImage(prizeId: string, storagePath: string) {
  const prize = await prisma.prize.findUnique({ where: { id: prizeId } });
  if (!prize) throw new Error('NOT_FOUND');
  await prisma.prize.update({ where: { id: prizeId }, data: { imagePath: storagePath } });
  if (prize.imagePath) {
    try {
      await deletePrizeImages([prize.imagePath]);
    } catch {}
  }
}

export async function listMyRedemptions(studentId: string) {
  const rows = await prisma.prizeRedemption.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' } });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    prizeName: r.prizeName,
    points: r.redeemOnlyUsed + r.regularUsed,
    status: r.status,
    createdAt: r.createdAt,
    deadlineKey: prizeDeadlineKey(r.createdAt),
  }));
}

export async function listPendingRedemptions() {
  const rows = await prisma.prizeRedemption.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: { student: { select: { studentNumber: true, user: { select: { name: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    studentName: r.student.user.name,
    studentNumber: r.student.studentNumber,
    prizeName: r.prizeName,
    points: r.redeemOnlyUsed + r.regularUsed,
    createdAt: r.createdAt,
    deadlineKey: prizeDeadlineKey(r.createdAt),
  }));
}

export async function findRedemptionByCode(code: string) {
  const r = await prisma.prizeRedemption.findUnique({
    where: { code },
    include: { student: { select: { user: { select: { name: true } } } } },
  });
  if (!r) return null;
  return {
    id: r.id,
    code: r.code,
    studentName: r.student.user.name,
    prizeName: r.prizeName,
    points: r.redeemOnlyUsed + r.regularUsed,
    status: r.status,
    createdAt: r.createdAt,
    deadlineKey: prizeDeadlineKey(r.createdAt),
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/prizeService.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/prizeService.ts src/lib/services/prizeService.test.ts
git commit -m "feat: 獎品目錄查詢/CRUD/圖片＋兌換紀錄清單"
```

---

### Task 7: 逾期退點＋到期前提醒（掛 daily-reminders）

**Files:**
- Modify: `src/lib/services/prizeService.ts`
- Modify: `src/app/api/cron/daily-reminders/route.ts`
- Test: `src/lib/services/prizeService.test.ts`（追加）

**Interfaces:**
- Consumes: `taipeiDateKey`（`@/lib/taipeiDate`）、`prizeRemindFromKey`／`prizeDeadlineKey`、`refundAndRestock`。
- Produces: `sendPrizeExpiryReminders(): Promise<number>`、`expireOverduePrizeRedemptions(): Promise<number>`（各回傳處理筆數；daily-reminders 依賴）。

- [ ] **Step 1: 寫失敗測試（追加；用 update createdAt 造舊資料）**

```ts
import { sendPrizeExpiryReminders, expireOverduePrizeRedemptions } from './prizeService';

const DAY_MS = 86_400_000;

async function redeemDaysAgo(days: number) {
  const { student, prize } = await setup({ regular: 100, points: 50 });
  const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });
  await prisma.prizeRedemption.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - days * DAY_MS) } });
  return { student, prize, id: r.id };
}

describe('sendPrizeExpiryReminders', () => {
  it('reminds only rows in the 7-day window without a prior reminder, and only once', async () => {
    const due = await redeemDaysAgo(25); // 期限剩 5 天 → 提醒
    expect(await sendPrizeExpiryReminders()).toBe(1);
    const row = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: due.id } });
    expect(row.expiryRemindedAt).not.toBeNull();
    expect(await sendPrizeExpiryReminders()).toBe(0); // 不重複
  });

  it('skips fresh redemptions', async () => {
    await redeemDaysAgo(3);
    expect(await sendPrizeExpiryReminders()).toBe(0);
  });
});

describe('expireOverduePrizeRedemptions', () => {
  it('expires >30-day-old PENDING rows: refund, restock, EXPIRED with system operator', async () => {
    const overdue = await redeemDaysAgo(31);
    expect(await expireOverduePrizeRedemptions()).toBe(1);

    const row = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: overdue.id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.operator).toBe('系統（逾期）');
    const refunds = await prisma.pointTransaction.findMany({ where: { kind: 'REDEMPTION_REFUND' } });
    expect(refunds.reduce((s, t) => s + t.amount, 0)).toBe(50);
    for (const t of refunds) expect(t.reason).toBe('逾期退點：恐龍模型');
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: overdue.prize.id } })).stock).toBe(3);
  });

  it('leaves 30-day-old (deadline day) and picked-up rows alone', async () => {
    await redeemDaysAgo(29); // 未過期限
    const picked = await redeemDaysAgo(40);
    await prisma.prizeRedemption.update({ where: { id: picked.id }, data: { status: 'PICKED_UP' } });
    expect(await expireOverduePrizeRedemptions()).toBe(0);
  });
});
```

（注意：`redeemDaysAgo(29)` 的期限日依台北時區可能是今天或明天，皆不逾期——`todayKey > deadlineKey` 才逾期，29 天永遠不會超過。不要寫 `redeemDaysAgo(30)` 的斷言，30 天整正好落在期限日邊界、跨時區跑會 flaky。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/prizeService.test.ts`
Expected: 新測試 FAIL。

- [ ] **Step 3: 實作（追加到 prizeService.ts）**

```ts
import { taipeiDateKey } from '@/lib/taipeiDate';
import { prizeRemindFromKey } from '@/lib/prizeDates';

// 到期前 7 天提醒（每日 cron）：PENDING 且進入提醒窗、未提醒過的各發一次。
export async function sendPrizeExpiryReminders(): Promise<number> {
  const today = taipeiDateKey(new Date());
  const rows = await prisma.prizeRedemption.findMany({ where: { status: 'PENDING', expiryRemindedAt: null } });
  const due = rows.filter((r) => today >= prizeRemindFromKey(r.createdAt));
  for (const r of due) {
    await notifyStudent(
      r.studentId,
      `兌換的「${r.prizeName}」將於 ${formatDateWithWeekday(prizeDeadlineKey(r.createdAt))} 到期，請盡快至櫃台領取`
    );
    await prisma.prizeRedemption.update({ where: { id: r.id }, data: { expiryRemindedAt: new Date() } });
  }
  return due.length;
}

// 逾期自動退點（每日 cron）：期限日（含）過後才處理。逐筆各自成交易，
// 交易內重讀狀態——期間被領取/取消就跳過，不會重複退點。
export async function expireOverduePrizeRedemptions(): Promise<number> {
  const today = taipeiDateKey(new Date());
  const rows = await prisma.prizeRedemption.findMany({ where: { status: 'PENDING' } });
  const overdue = rows.filter((r) => today > prizeDeadlineKey(r.createdAt));
  let processed = 0;
  for (const r of overdue) {
    const expired = await runSerializableWithRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const cur = await tx.prizeRedemption.findUnique({ where: { id: r.id } });
          if (!cur || cur.status !== 'PENDING') return false;
          await refundAndRestock(tx, cur, '逾期退點');
          await tx.prizeRedemption.update({
            where: { id: r.id },
            data: { status: 'EXPIRED', cancelledAt: new Date(), operator: '系統（逾期）' },
          });
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
    if (expired) {
      processed += 1;
      await notifyStudent(r.studentId, `兌換的「${r.prizeName}」已逾期，${r.redeemOnlyUsed + r.regularUsed} 點已自動退回`);
    }
  }
  return processed;
}
```

- [ ] **Step 4: 掛進 daily-reminders**

`src/app/api/cron/daily-reminders/route.ts` 的 `jobs` 清單加兩行（import 對應函式；檔頭註解的任務數描述同步更新）：

```ts
    ['prizeExpiryReminder', () => sendPrizeExpiryReminders()],
    ['prizeExpireOverdue', () => expireOverduePrizeRedemptions()],
```

- [ ] **Step 5: 跑測試確認通過（含 daily-reminders 既有測試）**

Run: `npx vitest run src/lib/services/prizeService.test.ts src/app/api/cron/daily-reminders/route.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/prizeService.ts src/lib/services/prizeService.test.ts src/app/api/cron/daily-reminders/route.ts
git commit -m "feat: 兌換 30 天逾期自動退點＋前 7 天提醒（掛 daily-reminders）"
```

---

### Task 8: API routes

**Files:**
- Create: `src/app/api/prizes/route.ts`
- Create: `src/app/api/prizes/[id]/route.ts`
- Create: `src/app/api/prizes/[id]/image/route.ts`
- Create: `src/app/api/prize-redemptions/route.ts`
- Create: `src/app/api/prize-redemptions/[id]/pickup/route.ts`
- Create: `src/app/api/prize-redemptions/[id]/cancel/route.ts`
- Test: `src/app/api/prize-redemptions/route.test.ts`

**Interfaces:**
- Consumes: Task 4–6 的 prizeService exports；`uploadPrizeImage`（storage）；`getServerSession(authOptions)`。
- Produces（前端依賴）:
  - `GET /api/prizes`：STUDENT → `listPrizesForStudent` 結果陣列；ADMIN → `listPrizesForAdmin`；其他 403。
  - `POST /api/prizes`（ADMIN）：body `{ name, points, stock, sortOrder }` → 201。
  - `PATCH /api/prizes/[id]`（ADMIN）：部分欄位 → 200。
  - `POST /api/prizes/[id]/image`（ADMIN）：formData `file` → `{ ok: true }`。
  - `GET /api/prize-redemptions`：STUDENT → 自己的 `listMyRedemptions`；ADMIN＋`?code=123456` → `findRedemptionByCode` 單筆或 404；ADMIN（無 code）→ `listPendingRedemptions`。
  - `POST /api/prize-redemptions`（STUDENT）：body `{ prizeId }` → 201 `{ id, code, prizeName, points, deadlineKey }`。
  - `POST /api/prize-redemptions/[id]/pickup`（ADMIN）→ `{ success: true }`。
  - `POST /api/prize-redemptions/[id]/cancel`（STUDENT 本人或 ADMIN）→ `{ success: true }`。
  - 業務錯誤一律 `{ error: '<CODE>' }` 422；權限 403；查無 404。

- [ ] **Step 1: 寫失敗測試（照 go-hall-registrations/route.test.ts 的 next-auth mock 手法；聚焦權限與主流程）**

```ts
// src/app/api/prize-redemptions/route.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET, POST } from './route';
import { POST as PICKUP } from './[id]/pickup/route';
import { POST as CANCEL } from './[id]/cancel/route';
import { prisma } from '@/lib/db';
import { createStudent } from '@/lib/services/studentService';

beforeEach(() => sessionMock.mockReset());

async function makeStudent(email: string) {
  const student = await createStudent({ name: '小明', email, password: 'x' });
  await prisma.pointTransaction.create({
    data: { studentId: student.id, bucket: 'REGULAR', amount: 100, kind: 'TEACHER_AWARD', reason: 'x' },
  });
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  return { student, user: { id: userId } };
}

const asUser = (id: string, role: string, name = '王行政') => sessionMock.mockResolvedValue({ user: { id, role, name } });

function postReq(body: unknown) {
  return new NextRequest('http://x/api/prize-redemptions', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/prize-redemptions (student redeem)', () => {
  it('201 redeems for the logged-in student and returns the code', async () => {
    const { student, user } = await makeStudent('pzr-a@example.com');
    const prize = await prisma.prize.create({ data: { name: '貼紙', points: 10, stock: 1, sortOrder: 0 } });
    asUser(user.id, 'STUDENT');
    const res = await POST(postReq({ prizeId: prize.id }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.deadlineKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('403 for admin/anon; 422 with error code on business failure', async () => {
    const { user } = await makeStudent('pzr-b@example.com');
    asUser('admin-1', 'ADMIN');
    expect((await POST(postReq({ prizeId: 'x' }))).status).toBe(403);
    sessionMock.mockResolvedValue(null);
    expect((await POST(postReq({ prizeId: 'x' }))).status).toBe(403);
    asUser(user.id, 'STUDENT');
    const res = await POST(postReq({ prizeId: 'nope' }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('PRIZE_UNAVAILABLE');
  });
});

describe('GET /api/prize-redemptions', () => {
  it('student sees own rows; admin ?code= finds one; admin default lists pending', async () => {
    const { student, user } = await makeStudent('pzr-c@example.com');
    const prize = await prisma.prize.create({ data: { name: '貼紙', points: 10, stock: 2, sortOrder: 0 } });
    asUser(user.id, 'STUDENT');
    const created = await (await POST(postReq({ prizeId: prize.id }))).json();

    const mineRes = await GET(new NextRequest('http://x/api/prize-redemptions'));
    expect((await mineRes.json())).toHaveLength(1);

    asUser('admin-1', 'ADMIN');
    const byCode = await GET(new NextRequest(`http://x/api/prize-redemptions?code=${created.code}`));
    expect((await byCode.json()).studentName).toBe('小明');
    expect((await GET(new NextRequest('http://x/api/prize-redemptions?code=000000'))).status).toBe(404);
    const pending = await GET(new NextRequest('http://x/api/prize-redemptions'));
    expect(await pending.json()).toHaveLength(1);
  });
});

describe('pickup / cancel routes', () => {
  it('admin pickup succeeds; student cannot pickup; student cancels own PENDING', async () => {
    const { student, user } = await makeStudent('pzr-d@example.com');
    const prize = await prisma.prize.create({ data: { name: '貼紙', points: 10, stock: 2, sortOrder: 0 } });
    asUser(user.id, 'STUDENT');
    const created = await (await POST(postReq({ prizeId: prize.id }))).json();

    expect((await PICKUP(postReq({}), { params: { id: created.id } })).status).toBe(403); // 學生不能核銷

    const cancelRes = await CANCEL(postReq({}), { params: { id: created.id } });
    expect(cancelRes.status).toBe(200);
    expect((await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: created.id } })).operator).toBe('學生本人');

    // 再兌一次讓 admin 核銷
    const again = await (await POST(postReq({ prizeId: prize.id }))).json();
    asUser('admin-1', 'ADMIN', '王行政');
    expect((await PICKUP(postReq({}), { params: { id: again.id } })).status).toBe(200);
    expect((await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: again.id } })).operator).toBe('王行政');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/app/api/prize-redemptions/route.test.ts`
Expected: FAIL（route 不存在）。

- [ ] **Step 3: 實作六個 route**

`src/app/api/prizes/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listPrizesForStudent, listPrizesForAdmin, createPrize } from '@/lib/services/prizeService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'ADMIN') return NextResponse.json(await listPrizesForAdmin());
  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await listPrizesForStudent(student.id));
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { name, points, stock, sortOrder } = await req.json();
  try {
    return NextResponse.json(await createPrize({ name, points, stock, sortOrder }), { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
```

`src/app/api/prizes/[id]/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updatePrize } from '@/lib/services/prizeService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { name, points, stock, sortOrder, active } = await req.json();
  try {
    return NextResponse.json(await updatePrize(params.id, { name, points, stock, sortOrder, active }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'NOT_FOUND' ? 404 : 422 });
  }
}
```

`src/app/api/prizes/[id]/image/route.ts`（照 activities/[id]/images 的驗證慣例）：

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadPrizeImage } from '@/lib/storage';
import { setPrizeImage } from '@/lib/services/prizeService';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 4_194_304;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type) || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'INVALID_FILE' }, { status: 400 });
  }
  try {
    const storagePath = await uploadPrizeImage(params.id, Buffer.from(await file.arrayBuffer()), file.type);
    await setPrizeImage(params.id, storagePath);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'NOT_FOUND' ? 404 : 422 });
  }
}
```

`src/app/api/prize-redemptions/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  redeemPrize,
  listMyRedemptions,
  listPendingRedemptions,
  findRedemptionByCode,
} from '@/lib/services/prizeService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'ADMIN') {
    const code = req.nextUrl.searchParams.get('code');
    if (code) {
      const row = await findRedemptionByCode(code.trim());
      if (!row) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      return NextResponse.json(row);
    }
    return NextResponse.json(await listPendingRedemptions());
  }
  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await listMyRedemptions(student.id));
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { prizeId } = await req.json();
  try {
    const result = await redeemPrize({ studentId: student.id, prizeId });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
```

`src/app/api/prize-redemptions/[id]/pickup/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { pickupRedemption } from '@/lib/services/prizeService';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    await pickupRedemption({ redemptionId: params.id, operator: session.user.name ?? '行政' });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'NOT_FOUND' ? 404 : 422 });
  }
}
```

`src/app/api/prize-redemptions/[id]/cancel/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { cancelRedemption } from '@/lib/services/prizeService';

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    if (session.user.role === 'ADMIN') {
      await cancelRedemption({ redemptionId: params.id, operator: session.user.name ?? '行政' });
    } else if (session.user.role === 'STUDENT') {
      const student = await prisma.student.findUnique({ where: { userId: session.user.id }, select: { id: true } });
      if (!student) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      await cancelRedemption({ redemptionId: params.id, byStudentId: student.id, operator: '學生本人' });
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'NOT_FOUND' ? 404 : 422 });
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/app/api/prize-redemptions/route.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/prizes src/app/api/prize-redemptions
git commit -m "feat: 獎品專區 API（目錄 CRUD/圖片/兌換/核銷/取消）"
```

---

### Task 9: 【硬檢查點】UI mockup 給使用者核可

**Files:**
- Create（丟棄式，放 scratchpad，不 commit）：學生端與行政端靜態 HTML mockup

**這是使用者明確要求的關卡：「要設計UI的時候再跟我過一次」。未取得核可前，Task 10/11 不得動工。**

- [ ] **Step 1: 做兩頁靜態 mockup**（沿用系統既有視覺：Card 版面、ink/inkMuted 色、深淺色皆可看）：
  - 學生端：餘額卡 → 獎品圖卡牌（含四種按鈕狀態各一例：可兌換／還差 N 點／已換完／已兌換）→ 兌換成功彈窗（大字代號＋期限）→ 我的兌換紀錄表（含取消鈕）。
  - 行政端：待領獎核銷區（輸代號欄＋查得結果卡＋待領清單）→ 獎品管理列表＋新增/編輯彈窗（含圖片上傳欄）。
- [ ] **Step 2: 呈現給使用者**（Artifact 或瀏覽器皆可），逐區塊收意見。
- [ ] **Step 3: 依回饋修改 mockup 直到使用者說 OK。把定案的版面決定（文案、欄位順序、卡片尺寸）條列記下來，作為 Task 10/11 的依據。**
- [ ] **Step 4: STOP——取得明確核可後才繼續。**

---

### Task 10: 學生端 UI（併入集點卡頁）

> 2026-09-11 檢查點修訂：學生端不做獨立頁——獎品區併入 `/student/points`；兌換代號機制已整個拆除（Task 9A）。

**Files:**
- Modify: `src/app/student/points/page.tsx`（插入獎品區）
- Create: `src/app/student/points/PrizeZone.tsx`
- Modify: `src/lib/services/prizeService.ts`（notifyStudent 的 url `/student/prizes` → `/student/points`，一行）

**Interfaces:**
- Consumes: `listPrizesForStudent`／`listMyRedemptions`（server 端）；`POST /api/prize-redemptions`、`POST /api/prize-redemptions/[id]/cancel`（client 端）；`useConfirm`、`Modal`、`AlertModal`、`Button`、`Card`、`CollapsibleDataTable`、`formatDateWithWeekday`、`formatTimestampWithWeekdayTaipei`。
- 版面順序（使用者核可的 mockup）：餘額三卡（既有）→ 獎品目錄 → 我的兌換紀錄（收合）→ 點數紀錄（既有，殿後）。

- [ ] **Step 1: Server page 改造**

`page.tsx` 的 Promise.all 加抓 `listPrizesForStudent(student.id)`、`listMyRedemptions(student.id)`，在餘額卡 grid 之後、「點數紀錄」標題之前 render `<PrizeZone prizes={prizes} redemptions={redemptions} total={total} />`。頁面標題維持「集點卡」。

- [ ] **Step 2: PrizeZone client component**

```tsx
'use client';
// props 驅動；mutation 成功後 router.refresh() 重抓 server 資料。
```

行為規格（照核可 mockup）：
- 「獎品目錄」標題＋格狀 `grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4`；卡片含圖（imageUrl，無圖灰底 🎁 佔位）、名稱、`{points} 點`（brandDark 粗體）。按鈕四態：
  - `alreadyRedeemed` → disabled「已兌換」＋卡片右上綠徽章
  - `stock === 0` → disabled「已換完」＋右上紅徽章
  - `total < points` → disabled「還差 {points - total} 點」
  - 否則 →「兌換」：`confirm(`確定用 ${points} 點兌換「${name}」嗎？`)` → POST `/api/prize-redemptions` `{ prizeId }` → 成功開 Modal：「兌換成功 🎉」＋獎品名（點數）＋「請於 {formatDateWithWeekday(deadlineKey)} 前到櫃台領取，逾期將自動退回點數」（無代號）＋「知道了」；`router.refresh()`。失敗 AlertModal 顯示 ERROR_LABELS 映射。
- 「我的兌換紀錄」`CollapsibleDataTable maxRows={3}`，欄：獎品、點數、狀態（待領獎/已領取/已取消/已逾期，badge 配色 pending/approved/muted/rejected）、兌換時間（`formatTimestampWithWeekdayTaipei(createdAt)`）、操作（PENDING →「取消」`confirm(..., { danger: true })` → POST cancel → `router.refresh()`）。
- ERROR_LABELS：PRIZE_UNAVAILABLE「這個獎品目前無法兌換」、OUT_OF_STOCK「這個獎品已經換完了」、ALREADY_REDEEMED「你已經兌換過這個獎品囉」、INSUFFICIENT_POINTS「點數不夠，再多集一點吧！」、NOT_PENDING「這筆兌換已經處理過了」、NOT_FOUND「找不到這筆兌換紀錄」。
- Button `loading` 沿用；不加新動畫、不加導覽項、不做入口卡。

- [ ] **Step 3: notifyStudent url 改 `/student/points`**

- [ ] **Step 4: 瀏覽器驗證**（launch.json dev server）：四態按鈕、成功彈窗（無代號）、取消流程、深色模式、手機寬度。console 無錯誤。

- [ ] **Step 5: Lint＋測試**

Run: `npx next lint --dir src/app/student && npx vitest run src/lib/services/prizeService.test.ts`
Expected: 無 error、PASS。

- [ ] **Step 6: Commit**

```bash
git add src/app/student/points src/lib/services/prizeService.ts
git commit -m "feat: 集點卡頁併入獎品專區（自助兌換＋兌換紀錄）"
```

---

### Task 11: 行政端 UI（/admin/prizes）

> 2026-09-11 檢查點修訂：無兌換代號——核銷區只有待領清單（顯示學生身分），無輸代號欄。

**Files:**
- Create: `src/app/admin/prizes/page.tsx`
- Create: `src/app/admin/prizes/PrizeFormModal.tsx`
- Modify: `src/components/ui/AppShell.tsx:27`（ADMIN nav「集點」後插入 `{ href: '/admin/prizes', label: '獎品' }`）

**Interfaces:**
- Consumes: `GET/POST /api/prizes`、`PATCH /api/prizes/[id]`、`POST /api/prizes/[id]/image`、`GET /api/prize-redemptions`（ADMIN=待領清單）、`POST /api/prize-redemptions/[id]/pickup|cancel`；`compressImage`（`@/lib/imageCompression`）；`useConfirm`、`Modal`、`Input`、`Select`、`Button`、`CollapsibleDataTable`、`formatTimestampWithWeekdayTaipei`、`formatDateWithWeekday`。

- [ ] **Step 1: 頁面（client page，比照 admin/points 寫法）**

- **待領獎核銷區**（置頂 Card）：`CollapsibleDataTable maxRows={3}`，欄：學生（姓名＋學號）、獎品、點數、兌換時間（`formatTimestampWithWeekdayTaipei`）、領取期限（`formatDateWithWeekday(deadlineKey)`）、操作（「已領取」→ pickup；「撤銷退點」→ `confirm(..., { danger: true })` → cancel）。操作後重抓清單。
- **獎品管理區**（Card）：「＋ 新增獎品」Button＋列表（縮圖 64px 圓角、名稱、點數、庫存（0 紅字）、狀態上架/下架 badge、排序、「編輯」）。管理列表不收合。
- 兩區各自 fetch＋骨架屏 loading；錯誤映射：ALREADY_PICKED_UP「這筆已領取過」、ALREADY_CANCELLED「這筆已取消」、ALREADY_EXPIRED「這筆已逾期退點」、NOT_FOUND「找不到這筆兌換」、NOT_PENDING「這筆兌換已處理過」。

- [ ] **Step 2: PrizeFormModal**

- 新增模式：名稱（`Input`）、點數／庫存／排序（`Input type="number"`）→ POST `/api/prizes`。
- 編輯模式追加：狀態（`Select`：上架/下架）＋圖片區（現圖預覽＋`<input type="file" accept="image/*">` → `compressImage(file)` → FormData POST `/api/prizes/[id]/image`，提示「jpg／png／webp，4MB 內，自動壓縮」）→ PATCH。
- 錯誤映射：INVALID_NAME「請輸入獎品名稱」、INVALID_POINTS「點數需為正整數」、INVALID_STOCK「庫存不可為負數」、INVALID_FILE「圖片格式或大小不符（jpg/png/webp，4MB 內）」。
- `Modal` 標題「新增獎品」／「編輯獎品」；儲存 Button `loading`。

- [ ] **Step 3: 瀏覽器驗證**：新增獎品 → 上傳圖片 → 學生端兌換 → 後台待領清單出現 → 核銷 → 清單消失；再兌一筆「撤銷退點」確認退點。深色模式＋手機寬度。console 無錯誤。

- [ ] **Step 4: Lint＋全套測試**

Run: `npx next lint --dir src/app/admin && npm test`
Expected: 無 error、全綠。

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/prizes src/components/ui/AppShell.tsx
git commit -m "feat: 行政端獎品管理＋待領獎核銷"
```

---

### Task 12: 最終驗證

- [ ] **Step 1: 全套測試**

Run: `npm test`
Expected: 全綠。

- [ ] **Step 2: 隔離 build（會 lint 測試檔——過去踩過 build 才炸的 lint error）**

Run: `npx next build`
Expected: build 成功、無 lint error。

- [ ] **Step 3: 端到端手動走一遍**（dev server）：學生兌換 → 收到通知（小鈴鐺）→ 行政核銷 → 學生紀錄變已領取；學生取消 → 點數退回、獎品可再兌換。

- [ ] **Step 4: 用 superpowers:requesting-code-review 做整分支審查**（家族帳號切換那次的教訓：整分支審查能抓到 task-level review 漏掉的 Critical bug）。發現「原始 Prisma 錯誤外洩」類問題直接修不用問。

- [ ] **Step 5: 合併與部署（依 finishing-a-development-branch）**——部署順序照 spec：正式站跑 `docs/superpowers/2026-09-11-prize-zone-production.sql` → Supabase 建 `prize-images` 私有 bucket → push 部署 → merge 後本地 `npx prisma generate`。

---

## 部署備忘（正式站）

1. Supabase SQL Editor 跑 `docs/superpowers/2026-09-11-prize-zone-production.sql`（冪等）。
2. Supabase Storage 手動建私有 bucket **`prize-images`**（不開 public，比照 `activity-images`）。
3. git push → Vercel 自動部署。
4. 後台建幾個獎品＋上圖，學生端實測一筆兌換＋核銷。
