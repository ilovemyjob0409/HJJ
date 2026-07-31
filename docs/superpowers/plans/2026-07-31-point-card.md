# 集點卡功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 老師給點、學生看集點卡與獎品目錄、行政操作兌換／線下抽獎登記／點數調整與目錄維護。

**Architecture:** 純流水帳（`PointTransaction` 單表，兩桶 REGULAR／REDEEM_ONLY，餘額由加總導出）。`pointService` 集中所有記帳規則（給點、抽獎登記、兌換跨桶扣點、調整），寫路徑用既有 `runSerializableWithRetry` serializable 交易防並發。理由與獎品維護完全比照 `makeupNoticeService` 模式。

**Tech Stack:** Next.js App Router、Prisma 7、PostgreSQL、Vitest（全域 resetDb）、next-auth。

**Spec:** `docs/superpowers/specs/2026-07-31-point-card-design.md`

## Global Constraints

- 專案根目錄 `/Users/s.w.kung/Downloads/Wade Claude/HJJ`；測試 `npm test`（已有全域 resetDb，**測試檔不寫 beforeEach 清理**）。
- 常數：`DRAW_COST = 20`、`AWARD_MAX = 10`（皆在 pointService 匯出）。
- 錯誤代碼字串：`INSUFFICIENT_POINTS`、`INVALID_AMOUNT`、`INVALID_DRAWS`、`INVALID_WON_POINTS`、`REASON_REQUIRED`、`REASON_NOT_FOUND`、`NO_STUDENTS`、`INVALID_COST`。
- `PointTransaction.reason` 一律存文字快照。
- UI 沿用 Card/Button/Input/Select/Modal/DataTable/Toast、`animate-*`、深夜模式 token、`formatDateWithWeekday`；中文繁體。
- 每 Task 結尾 commit。

---

### Task 1: Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `prisma.pointTransaction`／`pointReason`／`rewardItem` delegates、enum `PointBucket { REGULAR, REDEEM_ONLY }`、`PointKind { TEACHER_AWARD, LOTTERY_COST, LOTTERY_WIN, REDEMPTION, ADMIN_ADJUST }`；`Student.pointTransactions`、`Teacher.pointTransactions` 反向關聯。

- [ ] **Step 1: enum 區（`AttendanceStatus` 之後）加：**

```prisma
enum PointBucket {
  REGULAR
  REDEEM_ONLY
}

enum PointKind {
  TEACHER_AWARD
  LOTTERY_COST
  LOTTERY_WIN
  REDEMPTION
  ADMIN_ADJUST
}
```

- [ ] **Step 2: `Student` model 加 `pointTransactions PointTransaction[]`；`Teacher` model 加 `pointTransactions PointTransaction[]`。**

- [ ] **Step 3: 檔尾加三個 model：**

```prisma
// 點數流水：餘額＝各桶 amount 加總。reason 為文字快照，
// 理由選項／獎品之後改名刪除不影響歷史。
model PointTransaction {
  id        String      @id @default(cuid())
  studentId String
  student   Student     @relation(fields: [studentId], references: [id])
  bucket    PointBucket
  amount    Int
  kind      PointKind
  reason    String
  teacherId String?
  teacher   Teacher?    @relation(fields: [teacherId], references: [id])
  createdAt DateTime    @default(now())
}

model PointReason {
  id        String   @id @default(cuid())
  label     String
  sortOrder Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model RewardItem {
  id         String   @id @default(cuid())
  name       String
  pointsCost Int
  sortOrder  Int
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

- [ ] **Step 4:** Run `npx prisma validate && npm run test:dbpush && npx prisma db push && npx prisma generate` → 全部成功。
- [ ] **Step 5:** `git add prisma/schema.prisma && git commit -m "feat: add point card models"`

---

### Task 2: pointService（TDD）

**Files:**
- Create: `src/lib/services/pointService.ts`
- Test: `src/lib/services/pointService.test.ts`

**Interfaces:**
- Consumes: Task 1 delegates；`runSerializableWithRetry`（`@/lib/transaction`）。
- Produces:
  - `DRAW_COST = 20`、`AWARD_MAX = 10`
  - `getPointBalances(studentId: string): Promise<{ regular: number; redeemOnly: number }>`
  - `listPointHistory(studentId: string)` → 新到舊，含 `{ id, bucket, amount, kind, reason, createdAt, teacher: { user: { name } } | null }`
  - `awardPoints(input: { teacherId: string; studentIds: string[]; amount: number; reasonId: string }): Promise<void>`
  - `recordLottery(input: { studentId: string; draws: number; wonPoints: number }): Promise<void>`
  - `redeemReward(input: { studentId: string; rewardItemId: string })` → 回傳 RewardItem
  - `adjustPoints(input: { studentId: string; bucket: PointBucket; amount: number; reason: string }): Promise<void>`

- [ ] **Step 1: 寫失敗測試**（無 beforeEach 清理——全域 resetDb 處理）

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import {
  DRAW_COST,
  AWARD_MAX,
  getPointBalances,
  listPointHistory,
  awardPoints,
  recordLottery,
  redeemReward,
  adjustPoints,
} from './pointService';

async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: 'pt-chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'pt-ming@example.com', password: 'x' });
  const reason = await prisma.pointReason.create({ data: { label: '課堂表現優良', sortOrder: 0 } });
  return { teacher, student, reason };
}

describe('getPointBalances', () => {
  it('returns zeros for a student with no transactions', async () => {
    const { student } = await setup();
    expect(await getPointBalances(student.id)).toEqual({ regular: 0, redeemOnly: 0 });
  });

  it('sums each bucket independently, including negative rows', async () => {
    const { student } = await setup();
    await prisma.pointTransaction.createMany({
      data: [
        { studentId: student.id, bucket: 'REGULAR', amount: 10, kind: 'TEACHER_AWARD', reason: 'x' },
        { studentId: student.id, bucket: 'REGULAR', amount: -4, kind: 'ADMIN_ADJUST', reason: 'x' },
        { studentId: student.id, bucket: 'REDEEM_ONLY', amount: 7, kind: 'LOTTERY_WIN', reason: 'x' },
      ],
    });
    expect(await getPointBalances(student.id)).toEqual({ regular: 6, redeemOnly: 7 });
  });
});

describe('awardPoints', () => {
  it('writes one REGULAR transaction per student with the reason label snapshot and teacher', async () => {
    const { teacher, student, reason } = await setup();
    const other = await createStudent({ name: '小華', email: 'pt-hua@example.com', password: 'x' });

    await awardPoints({ teacherId: teacher.id, studentIds: [student.id, other.id], amount: 3, reasonId: reason.id });

    const rows = await prisma.pointTransaction.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.studentId).sort()).toEqual([student.id, other.id].sort());
    for (const r of rows) {
      expect(r.bucket).toBe('REGULAR');
      expect(r.amount).toBe(3);
      expect(r.kind).toBe('TEACHER_AWARD');
      expect(r.reason).toBe('課堂表現優良');
      expect(r.teacherId).toBe(teacher.id);
    }
  });

  it('rejects amount outside 1..AWARD_MAX', async () => {
    const { teacher, student, reason } = await setup();
    await expect(awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 0, reasonId: reason.id })).rejects.toThrow('INVALID_AMOUNT');
    await expect(awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: AWARD_MAX + 1, reasonId: reason.id })).rejects.toThrow('INVALID_AMOUNT');
  });

  it('rejects an empty student list and an unknown reason', async () => {
    const { teacher, student, reason } = await setup();
    await expect(awardPoints({ teacherId: teacher.id, studentIds: [], amount: 1, reasonId: reason.id })).rejects.toThrow('NO_STUDENTS');
    await expect(awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 1, reasonId: 'nope' })).rejects.toThrow('REASON_NOT_FOUND');
  });
});

describe('recordLottery', () => {
  it('deducts draws*DRAW_COST from REGULAR and credits wonPoints to REDEEM_ONLY', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });

    await recordLottery({ studentId: student.id, draws: 2, wonPoints: 15 });

    expect(await getPointBalances(student.id)).toEqual({ regular: 40 - 2 * DRAW_COST, redeemOnly: 15 });
    const cost = await prisma.pointTransaction.findFirstOrThrow({ where: { kind: 'LOTTERY_COST' } });
    expect(cost.amount).toBe(-2 * DRAW_COST);
    expect(cost.reason).toBe('抽獎 2 次');
  });

  it('writes no LOTTERY_WIN row when wonPoints is 0', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });

    await recordLottery({ studentId: student.id, draws: 1, wonPoints: 0 });

    expect(await prisma.pointTransaction.count({ where: { kind: 'LOTTERY_WIN' } })).toBe(0);
    expect(await getPointBalances(student.id)).toEqual({ regular: 0, redeemOnly: 0 });
  });

  it('throws INSUFFICIENT_POINTS when REGULAR balance cannot cover the draws', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });

    await expect(recordLottery({ studentId: student.id, draws: 1, wonPoints: 5 })).rejects.toThrow('INSUFFICIENT_POINTS');
    expect(await prisma.pointTransaction.count({ where: { kind: { in: ['LOTTERY_COST', 'LOTTERY_WIN'] } } })).toBe(0);
  });

  it('REDEEM_ONLY balance does not count toward the draw cost', async () => {
    const { student } = await setup();
    await prisma.pointTransaction.create({ data: { studentId: student.id, bucket: 'REDEEM_ONLY', amount: 100, kind: 'LOTTERY_WIN', reason: 'x' } });

    await expect(recordLottery({ studentId: student.id, draws: 1, wonPoints: 0 })).rejects.toThrow('INSUFFICIENT_POINTS');
  });

  it('rejects non-positive draws and negative wonPoints', async () => {
    const { student } = await setup();
    await expect(recordLottery({ studentId: student.id, draws: 0, wonPoints: 0 })).rejects.toThrow('INVALID_DRAWS');
    await expect(recordLottery({ studentId: student.id, draws: 1, wonPoints: -1 })).rejects.toThrow('INVALID_WON_POINTS');
  });
});

describe('redeemReward', () => {
  it('spends REDEEM_ONLY first, then REGULAR, as two rows with the reward name snapshot', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });
    await prisma.pointTransaction.create({ data: { studentId: student.id, bucket: 'REDEEM_ONLY', amount: 6, kind: 'LOTTERY_WIN', reason: 'x' } });
    const reward = await prisma.rewardItem.create({ data: { name: '棋子鑰匙圈', pointsCost: 9, sortOrder: 0 } });

    await redeemReward({ studentId: student.id, rewardItemId: reward.id });

    expect(await getPointBalances(student.id)).toEqual({ regular: 7, redeemOnly: 0 });
    const rows = await prisma.pointTransaction.findMany({ where: { kind: 'REDEMPTION' }, orderBy: { amount: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.bucket, r.amount, r.reason])).toEqual([
      ['REDEEM_ONLY', -6, '棋子鑰匙圈'],
      ['REGULAR', -3, '棋子鑰匙圈'],
    ]);
  });

  it('writes a single row when REDEEM_ONLY alone covers the cost', async () => {
    const { student } = await setup();
    await prisma.pointTransaction.create({ data: { studentId: student.id, bucket: 'REDEEM_ONLY', amount: 20, kind: 'LOTTERY_WIN', reason: 'x' } });
    const reward = await prisma.rewardItem.create({ data: { name: '文具組', pointsCost: 20, sortOrder: 0 } });

    await redeemReward({ studentId: student.id, rewardItemId: reward.id });

    expect(await prisma.pointTransaction.count({ where: { kind: 'REDEMPTION' } })).toBe(1);
    expect(await getPointBalances(student.id)).toEqual({ regular: 0, redeemOnly: 0 });
  });

  it('throws INSUFFICIENT_POINTS when the combined balance is short', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 5, reasonId: reason.id });
    const reward = await prisma.rewardItem.create({ data: { name: '大獎', pointsCost: 6, sortOrder: 0 } });

    await expect(redeemReward({ studentId: student.id, rewardItemId: reward.id })).rejects.toThrow('INSUFFICIENT_POINTS');
    expect(await prisma.pointTransaction.count({ where: { kind: 'REDEMPTION' } })).toBe(0);
  });

  it('allows only one of two concurrent redemptions when balance covers just one', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });
    const reward = await prisma.rewardItem.create({ data: { name: '獎品', pointsCost: 10, sortOrder: 0 } });

    const results = await Promise.allSettled([
      redeemReward({ studentId: student.id, rewardItemId: reward.id }),
      redeemReward({ studentId: student.id, rewardItemId: reward.id }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toBe('INSUFFICIENT_POINTS');
    expect(await getPointBalances(student.id)).toEqual({ regular: 0, redeemOnly: 0 });
  });
});

describe('adjustPoints', () => {
  it('writes a signed ADMIN_ADJUST row on the chosen bucket', async () => {
    const { student } = await setup();
    await adjustPoints({ studentId: student.id, bucket: 'REDEEM_ONLY', amount: 12, reason: '線下活動獎勵' });
    expect(await getPointBalances(student.id)).toEqual({ regular: 0, redeemOnly: 12 });
  });

  it('blocks a negative adjustment that would push the bucket below zero', async () => {
    const { student } = await setup();
    await adjustPoints({ studentId: student.id, bucket: 'REGULAR', amount: 5, reason: '補登' });
    await expect(adjustPoints({ studentId: student.id, bucket: 'REGULAR', amount: -6, reason: '修正' })).rejects.toThrow('INSUFFICIENT_POINTS');
  });

  it('rejects amount 0 and a blank reason', async () => {
    const { student } = await setup();
    await expect(adjustPoints({ studentId: student.id, bucket: 'REGULAR', amount: 0, reason: 'x' })).rejects.toThrow('INVALID_AMOUNT');
    await expect(adjustPoints({ studentId: student.id, bucket: 'REGULAR', amount: 1, reason: '  ' })).rejects.toThrow('REASON_REQUIRED');
  });
});

describe('listPointHistory', () => {
  it('returns newest-first with teacher name for awards', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 2, reasonId: reason.id });
    await adjustPoints({ studentId: student.id, bucket: 'REGULAR', amount: 1, reason: '補登' });

    const history = await listPointHistory(student.id);

    expect(history).toHaveLength(2);
    expect(history[0].kind).toBe('ADMIN_ADJUST');
    expect(history[1].kind).toBe('TEACHER_AWARD');
    expect(history[1].teacher?.user.name).toBe('陳老師');
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/lib/services/pointService.test.ts` → FAIL（模組不存在）。
- [ ] **Step 3: 實作 `pointService.ts`**

```ts
import { Prisma, PointBucket } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';

export const DRAW_COST = 20;   // 線下抽獎固定每次消耗（使用者指定）
export const AWARD_MAX = 10;   // 老師單次給點上限（防誤按）

export interface PointBalances {
  regular: number;
  redeemOnly: number;
}

type ClientType = typeof prisma | Prisma.TransactionClient;

async function sumBucket(client: ClientType, studentId: string, bucket: PointBucket) {
  const agg = await client.pointTransaction.aggregate({ where: { studentId, bucket }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

export async function getPointBalances(studentId: string): Promise<PointBalances> {
  const [regular, redeemOnly] = await Promise.all([
    sumBucket(prisma, studentId, 'REGULAR'),
    sumBucket(prisma, studentId, 'REDEEM_ONLY'),
  ]);
  return { regular, redeemOnly };
}

export function listPointHistory(studentId: string) {
  return prisma.pointTransaction.findMany({
    where: { studentId },
    select: {
      id: true,
      bucket: true,
      amount: true,
      kind: true,
      reason: true,
      createdAt: true,
      teacher: { select: { user: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function awardPoints(input: { teacherId: string; studentIds: string[]; amount: number; reasonId: string }) {
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > AWARD_MAX) throw new Error('INVALID_AMOUNT');
  if (input.studentIds.length === 0) throw new Error('NO_STUDENTS');
  const reason = await prisma.pointReason.findUnique({ where: { id: input.reasonId } });
  if (!reason) throw new Error('REASON_NOT_FOUND');
  await prisma.pointTransaction.createMany({
    data: input.studentIds.map((studentId) => ({
      studentId,
      bucket: 'REGULAR' as const,
      amount: input.amount,
      kind: 'TEACHER_AWARD' as const,
      reason: reason.label,
      teacherId: input.teacherId,
    })),
  });
}

// 線下抽獎登記：固定 DRAW_COST/次，從一般點數扣；抽中點數進兌換專用桶
// （兌換專用點數不能再拿去抽——所以檢查與扣點都只看 REGULAR）。
export function recordLottery(input: { studentId: string; draws: number; wonPoints: number }) {
  if (!Number.isInteger(input.draws) || input.draws < 1) throw new Error('INVALID_DRAWS');
  if (!Number.isInteger(input.wonPoints) || input.wonPoints < 0) throw new Error('INVALID_WON_POINTS');
  return runSerializableWithRetry(() =>
    prisma.$transaction(async (tx) => {
      const cost = input.draws * DRAW_COST;
      const regular = await sumBucket(tx, input.studentId, 'REGULAR');
      if (regular < cost) throw new Error('INSUFFICIENT_POINTS');
      await tx.pointTransaction.create({
        data: { studentId: input.studentId, bucket: 'REGULAR', amount: -cost, kind: 'LOTTERY_COST', reason: `抽獎 ${input.draws} 次` },
      });
      if (input.wonPoints > 0) {
        await tx.pointTransaction.create({
          data: { studentId: input.studentId, bucket: 'REDEEM_ONLY', amount: input.wonPoints, kind: 'LOTTERY_WIN', reason: '抽獎獲得' },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  );
}

// 兌換：兩桶合計須夠，優先扣兌換專用、不足再扣一般（各桶一筆負向紀錄）。
export function redeemReward(input: { studentId: string; rewardItemId: string }) {
  return runSerializableWithRetry(() =>
    prisma.$transaction(async (tx) => {
      const reward = await tx.rewardItem.findUniqueOrThrow({ where: { id: input.rewardItemId } });
      const [regular, redeemOnly] = await Promise.all([
        sumBucket(tx, input.studentId, 'REGULAR'),
        sumBucket(tx, input.studentId, 'REDEEM_ONLY'),
      ]);
      if (regular + redeemOnly < reward.pointsCost) throw new Error('INSUFFICIENT_POINTS');
      const fromRedeemOnly = Math.min(redeemOnly, reward.pointsCost);
      const fromRegular = reward.pointsCost - fromRedeemOnly;
      if (fromRedeemOnly > 0) {
        await tx.pointTransaction.create({
          data: { studentId: input.studentId, bucket: 'REDEEM_ONLY', amount: -fromRedeemOnly, kind: 'REDEMPTION', reason: reward.name },
        });
      }
      if (fromRegular > 0) {
        await tx.pointTransaction.create({
          data: { studentId: input.studentId, bucket: 'REGULAR', amount: -fromRegular, kind: 'REDEMPTION', reason: reward.name },
        });
      }
      return reward;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  );
}

export function adjustPoints(input: { studentId: string; bucket: PointBucket; amount: number; reason: string }) {
  if (!Number.isInteger(input.amount) || input.amount === 0) throw new Error('INVALID_AMOUNT');
  if (!input.reason.trim()) throw new Error('REASON_REQUIRED');
  return runSerializableWithRetry(() =>
    prisma.$transaction(async (tx) => {
      if (input.amount < 0) {
        const balance = await sumBucket(tx, input.studentId, input.bucket);
        if (balance + input.amount < 0) throw new Error('INSUFFICIENT_POINTS');
      }
      await tx.pointTransaction.create({
        data: { studentId: input.studentId, bucket: input.bucket, amount: input.amount, kind: 'ADMIN_ADJUST', reason: input.reason.trim() },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  );
}
```

- [ ] **Step 4:** Run `npx vitest run src/lib/services/pointService.test.ts` → 全 PASS。
- [ ] **Step 5:** `git add src/lib/services/pointService.ts src/lib/services/pointService.test.ts && git commit -m "feat: add pointService with two-bucket ledger"`

---

### Task 3: pointReasonService 與 rewardItemService（TDD）

**Files:**
- Create: `src/lib/services/pointReasonService.ts`、`src/lib/services/rewardItemService.ts`
- Test: `src/lib/services/pointReasonService.test.ts`、`src/lib/services/rewardItemService.test.ts`

**Interfaces:**
- Produces: `listPointReasons/createPointReason({label})/updatePointReason(id,{label})/deletePointReason(id)/movePointReason(id,dir)`；`listRewardItems/createRewardItem({name,pointsCost})/updateRewardItem(id,{name,pointsCost})/deleteRewardItem(id)/moveRewardItem(id,dir)`。`pointsCost` 非正整數 throw `INVALID_COST`。

兩個 service 完全比照 `makeupNoticeService.ts` 的結構（list 依 `[{sortOrder:'asc'},{createdAt:'asc'}]`、create 取 max+1、move 交易換位），欄位替換為各自的 `label`／`name`+`pointsCost`；rewardItem 的 create/update 先驗證 `Number.isInteger(pointsCost) && pointsCost >= 1` 否則 throw `INVALID_COST`。

測試比照 `makeupNoticeService.test.ts` 的九個案例模式（list 排序、create sortOrder 0 與 max+1、update 不動 sortOrder、delete、move 上下與邊界 no-op），rewardItem 另加：

```ts
  it('rejects a non-positive or non-integer pointsCost', async () => {
    await expect(createRewardItem({ name: 'x', pointsCost: 0 })).rejects.toThrow('INVALID_COST');
    await expect(createRewardItem({ name: 'x', pointsCost: 1.5 })).rejects.toThrow('INVALID_COST');
  });
```

- [ ] **Step 1:** 寫兩個測試檔（依上述模式，不寫 beforeEach 清理）。
- [ ] **Step 2:** Run `npx vitest run src/lib/services/pointReasonService.test.ts src/lib/services/rewardItemService.test.ts` → FAIL。
- [ ] **Step 3:** 實作兩個 service。
- [ ] **Step 4:** 同指令 → 全 PASS。
- [ ] **Step 5:** `git add src/lib/services/pointReasonService* src/lib/services/rewardItemService* && git commit -m "feat: add point reason and reward item services"`

---

### Task 4: 點數操作 API（5 條路由）

**Files:**
- Create: `src/app/api/points/route.ts`（GET）
- Create: `src/app/api/points/award/route.ts`（POST）
- Create: `src/app/api/points/lottery/route.ts`（POST）
- Create: `src/app/api/points/redeem/route.ts`（POST）
- Create: `src/app/api/points/adjust/route.ts`（POST）

**Interfaces:**
- Consumes: Task 2 全部函式。
- Produces: 見下表；錯誤一律 `{ error: message }`，服務層 throw 對應 422。

權限與行為：

- `GET /api/points`：ADMIN 帶 `?studentId=` 查任意學生；STUDENT 不帶參數查自己（由 session→`prisma.student.findUniqueOrThrow({where:{userId}})` 推得）；其餘 403。回傳 `{ balances, history }`。
- `POST /api/points/award`：TEACHER 限定；session→teacher；body `{ studentIds, amount, reasonId }`。
- `POST /api/points/lottery`：ADMIN 限定；body `{ studentId, draws, wonPoints }`。
- `POST /api/points/redeem`：ADMIN 限定；body `{ studentId, rewardItemId }`。
- `POST /api/points/adjust`：ADMIN 限定；body `{ studentId, bucket, amount, reason }`。

範例（`award/route.ts`，其餘四檔同構）：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { awardPoints } from '@/lib/services/pointService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
  const { studentIds, amount, reasonId } = await req.json();
  try {
    await awardPoints({ teacherId: teacher.id, studentIds, amount, reasonId });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
```

`GET /api/points` 的角色分流：

```ts
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let studentId: string;
  if (session.user.role === 'ADMIN') {
    const q = req.nextUrl.searchParams.get('studentId');
    if (!q) return NextResponse.json({ error: 'studentId required' }, { status: 400 });
    studentId = q;
  } else if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
    studentId = student.id;
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [balances, history] = await Promise.all([getPointBalances(studentId), listPointHistory(studentId)]);
  return NextResponse.json({ balances, history });
}
```

- [ ] **Step 1:** 建五個 route 檔。
- [ ] **Step 2:** `npx tsc --noEmit` → 無錯。
- [ ] **Step 3:** `git add src/app/api/points && git commit -m "feat: add point operation API routes"`

---

### Task 5: 理由與獎品維護 API（6 檔）

**Files:**
- Create: `src/app/api/point-reasons/route.ts`、`src/app/api/point-reasons/[id]/route.ts`、`src/app/api/point-reasons/[id]/reorder/route.ts`
- Create: `src/app/api/reward-items/route.ts`、`src/app/api/reward-items/[id]/route.ts`、`src/app/api/reward-items/[id]/reorder/route.ts`

**Interfaces:**
- Consumes: Task 3 服務。
- Produces: 結構完全比照 `/api/makeup-notices` 三檔（GET/POST、PATCH/DELETE、reorder POST），差異只在：
  - `point-reasons` 的 GET 允許 `ADMIN` **或 `TEACHER`**（給點頁下拉）；寫入 ADMIN。
  - `reward-items` 的 GET 允許**任何已登入角色**（學生端目錄雖走 service，但行政頁也用）；寫入 ADMIN。
  - `reward-items` 寫入的 body 為 `{ name, pointsCost }`，`INVALID_COST` 回 422。

- [ ] **Step 1:** 建六個 route 檔（比照 makeup-notices 三檔逐一改欄位與權限）。
- [ ] **Step 2:** `npx tsc --noEmit` → 無錯。
- [ ] **Step 3:** `git add src/app/api/point-reasons src/app/api/reward-items && git commit -m "feat: add point reason and reward item API routes"`

---

### Task 6: 導覽 + 老師「給點」頁

**Files:**
- Modify: `src/components/ui/AppShell.tsx`（三個角色的 NAV_LINKS）
- Create: `src/app/teacher/points/page.tsx`（server）
- Create: `src/app/teacher/points/AwardPointsForm.tsx`（client）

**Interfaces:**
- Consumes: `POST /api/points/award`、`GET /api/point-reasons`。

- [ ] **Step 1: AppShell 導覽**——TEACHER 陣列「點名」之後插 `{ href: '/teacher/points', label: '給點' }`；STUDENT 陣列「我的出席紀錄」之後插 `{ href: '/student/points', label: '集點卡' }`；ADMIN 陣列「補課須知」之前插 `{ href: '/admin/points', label: '集點' }`。

- [ ] **Step 2: `page.tsx`**（server component，比照 teacher dashboard 模式）：

```tsx
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import AwardPointsForm from './AwardPointsForm';

export const dynamic = 'force-dynamic';

export default async function TeacherPointsPage() {
  const session = await getServerSession(authOptions);
  const teacher = session ? await prisma.teacher.findUnique({ where: { userId: session.user.id } }) : null;
  const classes = teacher
    ? await prisma.class.findMany({
        where: { teacherId: teacher.id },
        select: {
          id: true,
          name: true,
          enrollments: {
            select: { student: { select: { id: true, user: { select: { name: true } } } } },
            orderBy: { student: { user: { name: 'asc' } } },
          },
        },
        orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
      })
    : [];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">給點</h1>
      <AwardPointsForm classes={classes} />
    </>
  );
}
```

- [ ] **Step 3: `AwardPointsForm.tsx`**（client）：選班級 Select → 學生 checkbox 清單（全選／清除快捷）→ 點數 number（1–10，預設 1）＋理由 Select（載自 `/api/point-reasons`；空清單顯示「請先請行政人員建立給點理由」並停用送出）→ 送出 POST `/api/points/award` → 成功 toast「已給 N 位學生各 X 點」並清除勾選。錯誤 `INVALID_AMOUNT`→「點數需為 1–10」、其餘顯「送出失敗，請稍後再試」。使用既有 Card/Button/Input/Select/Toast。

- [ ] **Step 4:** `npx tsc --noEmit && npm run lint` → 無錯。
- [ ] **Step 5:** `git add src/components/ui/AppShell.tsx src/app/teacher/points && git commit -m "feat: teacher award-points page and nav links"`

---

### Task 7: 學生「集點卡」頁

**Files:**
- Create: `src/app/student/points/page.tsx`（server component，比照 student FAQ 頁直接呼叫 service）

**Interfaces:**
- Consumes: `getPointBalances`、`listPointHistory`（pointService）、`listRewardItems`（rewardItemService）。

- [ ] **Step 1: 頁面**：session→student；無 student 顯示空狀態。內容三區：
  1. 餘額卡片列（`grid sm:grid-cols-3`）：一般點數／兌換專用點數／合計。
  2. 獎品目錄 Card：每項「名稱＋所需點數」，合計 ≥ 所需點數者加「可兌換」StatusBadge 樣式標示（沿用 `text-approved` 類 token），並附說明「請至櫃檯兌換」。目錄空→隱藏整區。
  3. 點數歷史 Card + DataTable：欄位「日期（`formatDateWithWeekday`）／項目（reason）／類型（kind 中文化：老師給點・抽獎・抽獎獲得・兌換・調整）／點數（正綠負紅 ±前綴）／給點老師（teacher?.user.name ?? '-'）」。空→顯示「尚無點數紀錄」。

kind 中文對照表寫成頁內常數：

```ts
const KIND_LABELS: Record<string, string> = {
  TEACHER_AWARD: '老師給點',
  LOTTERY_COST: '抽獎',
  LOTTERY_WIN: '抽獎獲得',
  REDEMPTION: '兌換',
  ADMIN_ADJUST: '調整',
};
```

- [ ] **Step 2:** `npx tsc --noEmit && npm run lint` → 無錯。
- [ ] **Step 3:** `git add src/app/student/points && git commit -m "feat: student point card page"`

---

### Task 8: 行政「集點管理」頁

**Files:**
- Create: `src/app/admin/points/page.tsx`（client：學生查詢＋兌換／抽獎登記／點數調整）
- Create: `src/app/admin/points/RewardItemsManager.tsx`（client：獎品目錄維護）
- Create: `src/app/admin/points/PointReasonsManager.tsx`（client：給點理由維護）

**Interfaces:**
- Consumes: `GET /api/students`（既有，ADMIN）、`GET /api/points?studentId=`、`POST /api/points/redeem|lottery|adjust`、reward-items／point-reasons 全套 API。

- [ ] **Step 1: 兩個 Manager 元件**——結構完全比照 `src/app/admin/makeup-notices/page.tsx`（新增表單＋DataTable＋編輯 Modal＋上下移），欄位替換：Reasons 用 `label`（Input 即可）；Rewards 用 `name`＋`pointsCost`（number Input），`INVALID_COST` toast「點數需為正整數」。

- [ ] **Step 2: `page.tsx` 主頁**：
  1. 學生搜尋（Input 過濾 `/api/students` 回傳的姓名／學號）→ 點選學生 → 顯示餘額（一般／兌換專用／合計）與三個操作 Card：
     - **兌換**：Select 獎品（顯示所需點數）→ Button「兌換並扣點」→ confirm →POST redeem → toast「已兌換｛獎品｝」；`INSUFFICIENT_POINTS`→toast「點數不足」。
     - **抽獎登記**：Input 抽幾次（顯示「將扣 n×20＝X 點」即時計算）＋ Input 抽中總點數 → POST lottery → toast「已登記抽獎」。
     - **點數調整**：Select 桶別（一般／兌換專用）＋ Input ±點數＋ Input 原因 → POST adjust。
     每次操作成功後重抓 `/api/points?studentId=` 更新餘額並顯示該生歷史（DataTable 同學生頁欄位）。
  2. 頁尾兩個維護區塊：`<RewardItemsManager />`、`<PointReasonsManager />`。

- [ ] **Step 3:** `npx tsc --noEmit && npm run lint` → 無錯。
- [ ] **Step 4:** `git add src/app/admin/points && git commit -m "feat: admin point management page"`

---

### Task 9: 全套驗證＋瀏覽器煙霧測試

- [ ] **Step 1:** `npm test` → 全 PASS（連跑兩次）。
- [ ] **Step 2:** `npm run lint && npm run build` → 無錯。
- [ ] **Step 3:** preview 起 dev server 實測：
  1. 行政：建 2 個給點理由、2 個獎品；對測試學生「點數調整」加兌換專用點數；抽獎登記（含餘額不足被擋的案例）。
  2. 老師：給點頁對班級多選學生給點。
  3. 學生：集點卡頁餘額／可兌換標示／歷史正確。
  4. 行政：兌換一個跨桶扣點的獎品，確認餘額變化與歷史兩筆。
  5. 深夜模式檢查新頁面。
- [ ] **Step 4:** 殘餘變更 commit。

---

### Task 10: 正式環境 SQL 文件

**Files:**
- Create: `docs/superpowers/2026-07-31-point-card-production.sql`

- [ ] **Step 1:** 產出等效 SQL（兩個 enum type、三張表、FK；無 backfill——新功能從零開始），格式比照 `docs/superpowers/2026-07-31-makeup-policy-production.sql`（含冪等寫法與驗證 SELECT）。
- [ ] **Step 2:** `git add docs && git commit -m "docs: production SQL for point card feature"`
