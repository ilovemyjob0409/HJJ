# 弈廳報名資格（堂票／季票／單堂）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 弈廳加入三種報名資格（堂票／季票／單堂）：點名標到場時自動判定資格並扣堂票，管理端維護票券，各名單顯示資格標籤，低堂數 LINE 提醒。

**Architecture:** 新增 `goHallTicketService`（堂票帳本＋季票區間＋資格判定），扣堂掛在 `attendanceService.saveGoHallAttendance`／`clearGoHallAttendance` 的 serializable 交易內；報名流程完全不動。餘額＝帳本加總（比照點數卡）。日期比較一律轉台北時區日曆日（`taipeiDateKey`），避免既有 UTC／本地混用問題。

**Tech Stack:** Next.js 14 App Router、Prisma 7（`db push`，無 migrations 目錄）、PostgreSQL、vitest（共用測試庫 `resetDb`）、next-auth（role 檢查）。

**Spec:** `docs/superpowers/specs/2026-08-03-go-hall-tickets-design.md`

## Global Constraints

- UI 文案繁體中文；日期顯示一律 `formatDateWithWeekday(date, 'zh-TW')`（`@/lib/dateFormat`）
- **不要修改 `src/lib/dateFormat.ts`**（工作區有另一個 session 的未提交修改）；每次 commit 只 `git add` 本任務列出的檔案，**絕不 `git add -A`**
- 「到場」＝ `PRESENT`｜`LATE`｜`LEFT_EARLY`；`ON_LEAVE`｜`ABSENT`｜`NOT_REGISTERED` 不算
- 資格優先序：季票 → 堂票 → 單堂；判定基準日＝**場次日期**
- 錯誤字串常數：`INVALID_AMOUNT`、`INSUFFICIENT_TICKETS`、`REASON_REQUIRED`、`INVALID_RANGE`
- 測試指令 `npm test`（自動 `prisma db push` 到 `tutoring_makeup_system_test` 後跑 vitest）；需要本機 docker Postgres 已啟動（`docker-compose up -d`）
- 不要同時跑 `npm run dev` 與 `npm run build`（曾發生 .next 衝突）
- 動效／骨架屏沿用既有 `animate-*`、`Button loading`、`DataTable loading` pattern，不新創動畫

---

### Task 1: Prisma schema（enum、兩張表、兩個欄位）

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `GoHallQualification`（SEASON_PASS｜TICKET｜SINGLE）、`GoHallTicketKind`（PURCHASE｜ATTEND｜ADMIN_ADJUST）、model `GoHallTicketTransaction`、model `GoHallSeasonPass`、`GoHallAttendance.qualification`、`Student.goHallLowQuotaNotifiedAt`

- [ ] **Step 1: schema 加 enum 與 model**

在 `enum PointKind { ... }` 區塊後面加：

```prisma
enum GoHallQualification {
  SEASON_PASS // 季票
  TICKET      // 堂票
  SINGLE      // 單堂（現場收費）
}

enum GoHallTicketKind {
  PURCHASE     // 購買 +N（管理員登記）
  ATTEND       // 到場扣堂 -1（系統自動，關聯場次）
  ADMIN_ADJUST // 管理員調整 ±N（附原因）
}
```

在 `model GoHallRegistration { ... }` 後面加兩個 model（餘額＝amount 加總，不另存欄位）：

```prisma
// 弈廳堂票帳本：購買 +N、到場扣 -1、調整 ±N；餘額由加總導出。
model GoHallTicketTransaction {
  id        String           @id @default(cuid())
  studentId String
  student   Student          @relation(fields: [studentId], references: [id])
  amount    Int              // 正＝加堂、負＝扣堂
  kind      GoHallTicketKind
  reason    String?          // ADMIN_ADJUST 原因等文字快照
  sessionId String?          // ATTEND 時關聯場次；場次被刪時保留帳、關聯設 null
  session   GoHallSession?   @relation(fields: [sessionId], references: [id], onDelete: SetNull)
  createdAt DateTime         @default(now())
}

// 弈廳季票：一筆一個起訖區間（含頭尾），可多筆並存留購買歷史。
model GoHallSeasonPass {
  id        String   @id @default(cuid())
  studentId String
  student   Student  @relation(fields: [studentId], references: [id])
  startDate DateTime // 含當日
  endDate   DateTime // 含當日
  createdAt DateTime @default(now())
}
```

`model Student` 內加三行（放在 `goHallAttendances` 附近）：

```prisma
  goHallLowQuotaNotifiedAt DateTime?                 // 弈廳堂票低堂數提醒防重複
  goHallTicketTransactions GoHallTicketTransaction[]
  goHallSeasonPasses       GoHallSeasonPass[]
```

`model GoHallSession` 內加一行：

```prisma
  ticketTransactions GoHallTicketTransaction[]
```

`model GoHallAttendance` 內加一行（放在 `status` 下面）：

```prisma
  qualification GoHallQualification? // 標到場時戳記的當次資格；非到場為 null
```

- [ ] **Step 2: 推進本機開發庫並重新產生 client**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx prisma db push && npx prisma generate
```

Expected: `Your database is now in sync with your Prisma schema.`（若連線失敗先 `docker-compose up -d` 再重跑）

- [ ] **Step 3: 型別檢查**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit
```

Expected: 無錯誤輸出

- [ ] **Step 4: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add prisma/schema.prisma && git commit -m "feat: 弈廳票券 schema（堂票帳本、季票、資格戳記、低堂數旗標）"
```

---

### Task 2: goHallTicketService — 帳本（餘額／購買／調整）

**Files:**
- Create: `src/lib/services/goHallTicketService.ts`
- Test: `src/lib/services/goHallTicketService.test.ts`

**Interfaces:**
- Consumes: Task 1 的 Prisma model；`runSerializableWithRetry`（`@/lib/transaction`）
- Produces:
  - `type GoHallQualificationValue = 'SEASON_PASS' | 'TICKET' | 'SINGLE'`
  - `LOW_TICKET_THRESHOLD = 3`
  - `taipeiDateKey(date: Date): string` — 回傳該時刻在台北時區的 `'YYYY-MM-DD'`
  - `getTicketBalance(studentId: string, client?): Promise<number>`
  - `purchaseTickets(input: { studentId: string; sessions: number }): Promise<void>`
  - `adjustTickets(input: { studentId: string; amount: number; reason: string }): Promise<void>`

- [ ] **Step 1: 寫失敗測試**

建立 `src/lib/services/goHallTicketService.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { taipeiDateKey, getTicketBalance, purchaseTickets, adjustTickets } from './goHallTicketService';

describe('taipeiDateKey', () => {
  it('converts an instant to its Asia/Taipei calendar date', () => {
    // UTC 2026-08-14 16:00 = 台北 2026-08-15 00:00
    expect(taipeiDateKey(new Date('2026-08-14T16:00:00.000Z'))).toBe('2026-08-15');
    // UTC 午夜＝台北早上八點，同日
    expect(taipeiDateKey(new Date('2026-08-15T00:00:00.000Z'))).toBe('2026-08-15');
  });
});

describe('purchaseTickets / getTicketBalance', () => {
  it('adds a PURCHASE transaction and the balance is the sum', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 10 });
    expect(await getTicketBalance(student.id)).toBe(10);
    const txns = await prisma.goHallTicketTransaction.findMany({ where: { studentId: student.id } });
    expect(txns).toHaveLength(1);
    expect(txns[0].kind).toBe('PURCHASE');
    expect(txns[0].amount).toBe(10);
  });

  it('rejects non-positive or non-integer sessions', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await expect(purchaseTickets({ studentId: student.id, sessions: 0 })).rejects.toThrow('INVALID_AMOUNT');
    await expect(purchaseTickets({ studentId: student.id, sessions: 1.5 })).rejects.toThrow('INVALID_AMOUNT');
  });

  it('resets goHallLowQuotaNotifiedAt on purchase', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await prisma.student.update({ where: { id: student.id }, data: { goHallLowQuotaNotifiedAt: new Date() } });
    await purchaseTickets({ studentId: student.id, sessions: 10 });
    const fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).toBeNull();
  });
});

describe('adjustTickets', () => {
  it('applies positive and negative adjustments with reason', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await adjustTickets({ studentId: student.id, amount: 5, reason: '登記錯誤補回' });
    await adjustTickets({ studentId: student.id, amount: -3, reason: '重複登記' });
    expect(await getTicketBalance(student.id)).toBe(2);
  });

  it('rejects an adjustment that would make the balance negative', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 2 });
    await expect(adjustTickets({ studentId: student.id, amount: -3, reason: '誤扣' })).rejects.toThrow('INSUFFICIENT_TICKETS');
  });

  it('rejects zero / non-integer amount and empty reason', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await expect(adjustTickets({ studentId: student.id, amount: 0, reason: 'x' })).rejects.toThrow('INVALID_AMOUNT');
    await expect(adjustTickets({ studentId: student.id, amount: 1, reason: '  ' })).rejects.toThrow('REASON_REQUIRED');
  });

  it('resets goHallLowQuotaNotifiedAt only on positive adjustment', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 5 });
    await prisma.student.update({ where: { id: student.id }, data: { goHallLowQuotaNotifiedAt: new Date() } });
    await adjustTickets({ studentId: student.id, amount: -1, reason: '誤登' });
    let fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).not.toBeNull();
    await adjustTickets({ studentId: student.id, amount: 2, reason: '補購' });
    fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/goHallTicketService.test.ts
```

Expected: FAIL（`goHallTicketService` 模組不存在）

- [ ] **Step 3: 實作 service**

建立 `src/lib/services/goHallTicketService.ts`：

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';

export type GoHallQualificationValue = 'SEASON_PASS' | 'TICKET' | 'SINGLE';

export const LOW_TICKET_THRESHOLD = 3; // 剩餘 ≤3 堂時 LINE 提醒（比照課程低堂數）

type ClientType = typeof prisma | Prisma.TransactionClient;

// 既有場次日期存在 UTC／本地午夜混用（瀏覽器 toISOString vs 'YYYY-MM-DD' 解析），
// 兩種存法都落在台北日曆日當天 → 一律轉台北日曆日字串再比較。
const TAIPEI_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function taipeiDateKey(date: Date): string {
  return TAIPEI_DATE_FMT.format(date); // 'YYYY-MM-DD'
}

export async function getTicketBalance(studentId: string, client: ClientType = prisma): Promise<number> {
  const agg = await client.goHallTicketTransaction.aggregate({ where: { studentId }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

export function purchaseTickets(input: { studentId: string; sessions: number }): Promise<void> {
  if (!Number.isInteger(input.sessions) || input.sessions < 1) return Promise.reject(new Error('INVALID_AMOUNT'));
  return prisma.$transaction(async (tx) => {
    await tx.goHallTicketTransaction.create({
      data: { studentId: input.studentId, amount: input.sessions, kind: 'PURCHASE' },
    });
    await tx.student.update({ where: { id: input.studentId }, data: { goHallLowQuotaNotifiedAt: null } });
  }).then(() => undefined);
}

export function adjustTickets(input: { studentId: string; amount: number; reason: string }): Promise<void> {
  if (!Number.isInteger(input.amount) || input.amount === 0) return Promise.reject(new Error('INVALID_AMOUNT'));
  if (!input.reason.trim()) return Promise.reject(new Error('REASON_REQUIRED'));
  return runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        if (input.amount < 0) {
          const balance = await getTicketBalance(input.studentId, tx);
          if (balance + input.amount < 0) throw new Error('INSUFFICIENT_TICKETS');
        }
        await tx.goHallTicketTransaction.create({
          data: { studentId: input.studentId, amount: input.amount, kind: 'ADMIN_ADJUST', reason: input.reason.trim() },
        });
        if (input.amount > 0) {
          await tx.student.update({ where: { id: input.studentId }, data: { goHallLowQuotaNotifiedAt: null } });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/goHallTicketService.test.ts
```

Expected: PASS（全部綠）

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/goHallTicketService.ts src/lib/services/goHallTicketService.test.ts && git commit -m "feat: 弈廳堂票帳本 service（餘額／購買／調整）"
```

---

### Task 3: goHallTicketService — 季票與資格判定

**Files:**
- Modify: `src/lib/services/goHallTicketService.ts`
- Test: `src/lib/services/goHallTicketService.test.ts`

**Interfaces:**
- Produces:
  - `addSeasonPass(input: { studentId: string; startDate: Date; endDate: Date }): Promise<{ id: string }>`
  - `deleteSeasonPass(id: string): Promise<void>`
  - `hasValidSeasonPass(client, studentId: string, onDate: Date): Promise<boolean>`（client 為 prisma 或 tx）
  - `determineQualification(client, studentId: string, sessionDate: Date): Promise<GoHallQualificationValue>` — 純判定、無副作用（不扣堂）

- [ ] **Step 1: 寫失敗測試**

在 `goHallTicketService.test.ts` 底部加：

```ts
import { addSeasonPass, deleteSeasonPass, hasValidSeasonPass, determineQualification } from './goHallTicketService';

describe('addSeasonPass / hasValidSeasonPass', () => {
  it('is valid on the start day, the end day, and days between (inclusive)', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-08-01'))).toBe(true);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-08-31'))).toBe(true);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-08-15'))).toBe(true);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-07-31'))).toBe(false);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-09-01'))).toBe(false);
  });

  it('treats a local-midnight session instant as the same Taipei calendar day', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });
    // 台北 8/1 00:00（= UTC 7/31 16:00）也要算季票第一天內
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-07-31T16:00:00.000Z'))).toBe(true);
  });

  it('rejects endDate before startDate', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await expect(
      addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-31'), endDate: new Date('2026-08-01') })
    ).rejects.toThrow('INVALID_RANGE');
  });

  it('deleteSeasonPass removes the pass', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const pass = await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });
    await deleteSeasonPass(pass.id);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-08-15'))).toBe(false);
  });
});

describe('determineQualification', () => {
  it('prefers a valid season pass even when tickets remain', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 10 });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });
    expect(await determineQualification(prisma, student.id, new Date('2026-08-15'))).toBe('SEASON_PASS');
  });

  it('falls back to TICKET when no pass covers the date but balance > 0', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 1 });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-09-01'), endDate: new Date('2026-11-30') });
    expect(await determineQualification(prisma, student.id, new Date('2026-08-15'))).toBe('TICKET');
  });

  it('falls back to SINGLE when there is no pass and no balance', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    expect(await determineQualification(prisma, student.id, new Date('2026-08-15'))).toBe('SINGLE');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/goHallTicketService.test.ts
```

Expected: FAIL（`addSeasonPass` 等函式不存在）

- [ ] **Step 3: 實作**

在 `goHallTicketService.ts` 底部加：

```ts
export async function addSeasonPass(input: { studentId: string; startDate: Date; endDate: Date }): Promise<{ id: string }> {
  if (taipeiDateKey(input.endDate) < taipeiDateKey(input.startDate)) throw new Error('INVALID_RANGE');
  const pass = await prisma.goHallSeasonPass.create({
    data: { studentId: input.studentId, startDate: input.startDate, endDate: input.endDate },
    select: { id: true },
  });
  return pass;
}

export async function deleteSeasonPass(id: string): Promise<void> {
  await prisma.goHallSeasonPass.delete({ where: { id } });
}

export async function hasValidSeasonPass(client: ClientType, studentId: string, onDate: Date): Promise<boolean> {
  const key = taipeiDateKey(onDate);
  const passes = await client.goHallSeasonPass.findMany({ where: { studentId }, select: { startDate: true, endDate: true } });
  return passes.some((p) => taipeiDateKey(p.startDate) <= key && key <= taipeiDateKey(p.endDate));
}

// 資格判定（純查詢、不扣堂）：季票一律優先 → 堂票餘額 > 0 → 單堂。
export async function determineQualification(
  client: ClientType,
  studentId: string,
  sessionDate: Date
): Promise<GoHallQualificationValue> {
  if (await hasValidSeasonPass(client, studentId, sessionDate)) return 'SEASON_PASS';
  if ((await getTicketBalance(studentId, client)) > 0) return 'TICKET';
  return 'SINGLE';
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/goHallTicketService.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/goHallTicketService.ts src/lib/services/goHallTicketService.test.ts && git commit -m "feat: 弈廳季票與資格判定（季票優先、堂票次之、否則單堂）"
```

---

### Task 4: 點名扣堂掛鉤（save／clear ＋ 冪等退堂）

**Files:**
- Modify: `src/lib/services/attendanceService.ts`（`saveGoHallAttendance`、`clearGoHallAttendance`）
- Test: `src/lib/services/attendanceService.test.ts`

**Interfaces:**
- Consumes: `determineQualification`、`getTicketBalance`（Task 3）；`runSerializableWithRetry`
- Produces: `saveGoHallAttendance(sessionId, markedById, records)` 簽名不變（呼叫端不用改）；到場時戳記 `GoHallAttendance.qualification` 並在 `TICKET` 時寫 `ATTEND -1`；轉非到場／清除時退堂。回傳新增 `Promise<void>` 不變。

- [ ] **Step 1: 寫失敗測試**

在 `attendanceService.test.ts` 底部加（沿用檔頭既有 import 與 `marker-1`）：

```ts
import { purchaseTickets as buyGoHallTickets, addSeasonPass as addGoHallSeasonPass, getTicketBalance as goHallBalance } from './goHallTicketService';

async function setupGoHallSessionWithStudent() {
  const teacher = await createTeacher({ name: '陳老師', email: 'gohall-t@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'gohall-s@example.com', password: 'x' });
  await createSessions({ dates: [new Date(2026, 7, 15)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
  const session = await prisma.goHallSession.findFirstOrThrow();
  await registerForSession(session.id, student.id);
  return { student, session };
}

describe('go-hall ticket deduction on attendance', () => {
  it('deducts one ticket and stamps TICKET when marked PRESENT', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    expect(await goHallBalance(student.id)).toBe(9);
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.qualification).toBe('TICKET');
    const attendTxn = await prisma.goHallTicketTransaction.findFirstOrThrow({ where: { studentId: student.id, kind: 'ATTEND' } });
    expect(attendTxn.amount).toBe(-1);
    expect(attendTxn.sessionId).toBe(session.id);
  });

  it('does not deduct when marked ABSENT', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);

    expect(await goHallBalance(student.id)).toBe(10);
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.qualification).toBeNull();
  });

  it('refunds when changed from PRESENT to ABSENT', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);

    expect(await goHallBalance(student.id)).toBe(10);
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.qualification).toBeNull();
    expect(await prisma.goHallTicketTransaction.count({ where: { kind: 'ATTEND' } })).toBe(0);
  });

  it('is idempotent: re-saving PRESENT (or switching PRESENT→LATE) deducts only once', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'LATE' }]);

    expect(await goHallBalance(student.id)).toBe(9);
    expect(await prisma.goHallTicketTransaction.count({ where: { kind: 'ATTEND' } })).toBe(1);
  });

  it('refunds when the attendance record is cleared', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await clearGoHallAttendance(session.id, [student.id]);

    expect(await goHallBalance(student.id)).toBe(10);
  });

  it('stamps SEASON_PASS without deduction when a pass covers the session date', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });
    await addGoHallSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    expect(await goHallBalance(student.id)).toBe(10);
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.qualification).toBe('SEASON_PASS');
  });

  it('stamps SINGLE when there is no pass and no balance', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    expect(await goHallBalance(student.id)).toBe(0);
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.qualification).toBe('SINGLE');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/attendanceService.test.ts
```

Expected: 新增的 describe 全數 FAIL（現有 `saveGoHallAttendance` 不扣堂）；既有測試 PASS

- [ ] **Step 3: 改寫 saveGoHallAttendance / clearGoHallAttendance**

`attendanceService.ts` 檔頭 import 區加：

```ts
import { Prisma } from '@prisma/client';
import { runSerializableWithRetry } from '@/lib/transaction';
import { determineQualification, getTicketBalance, LOW_TICKET_THRESHOLD, type GoHallQualificationValue } from './goHallTicketService';
```

（若檔內已有同名 import 則併入既有行。）

在 `GoHallRosterEntry` 介面上方加常數：

```ts
// 「到場」才扣堂票：出席／遲到／早退；請假、缺席、未報名不扣。
const GO_HALL_ATTENDED: ReadonlySet<string> = new Set(['PRESENT', 'LATE', 'LEFT_EARLY']);
```

把現有 `saveGoHallAttendance`（`prisma.$transaction(records.map(...))` 版本）整段替換為：

```ts
export async function saveGoHallAttendance(
  sessionId: string,
  markedById: string,
  records: SaveAttendanceRecordInput[]
): Promise<void> {
  const session = await prisma.goHallSession.findUniqueOrThrow({ where: { id: sessionId }, select: { date: true } });
  const deductedStudentIds: string[] = [];

  await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        deductedStudentIds.length = 0; // serializable 重試時歸零，避免重複通知
        for (const r of records) {
          const attended = GO_HALL_ATTENDED.has(r.status);
          const existing = await tx.goHallAttendance.findUnique({
            where: { sessionId_studentId: { sessionId, studentId: r.studentId } },
            select: { qualification: true },
          });
          // 已到場且已戳記 → 沿用（冪等）；轉非到場 → 退堂＋清戳記。
          let qualification: GoHallQualificationValue | null = existing?.qualification ?? null;
          if (attended && qualification === null) {
            qualification = await determineQualification(tx, r.studentId, session.date);
            if (qualification === 'TICKET') {
              await tx.goHallTicketTransaction.create({
                data: { studentId: r.studentId, amount: -1, kind: 'ATTEND', sessionId },
              });
              deductedStudentIds.push(r.studentId);
            }
          } else if (!attended && qualification !== null) {
            await tx.goHallTicketTransaction.deleteMany({
              where: { studentId: r.studentId, sessionId, kind: 'ATTEND' },
            });
            qualification = null;
          }
          await tx.goHallAttendance.upsert({
            where: { sessionId_studentId: { sessionId, studentId: r.studentId } },
            create: {
              sessionId,
              studentId: r.studentId,
              status: r.status,
              checkInTime: r.checkInTime,
              checkOutTime: r.checkOutTime,
              markedById,
              qualification,
            },
            update: {
              status: r.status,
              checkInTime: r.checkInTime,
              checkOutTime: r.checkOutTime,
              markedById,
              qualification,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );

  for (const studentId of deductedStudentIds) {
    await maybeNotifyLowGoHallTickets(studentId);
  }
}

export async function clearGoHallAttendance(sessionId: string, studentIds: string[]): Promise<void> {
  if (studentIds.length === 0) return;
  await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.goHallTicketTransaction.deleteMany({
          where: { sessionId, studentId: { in: studentIds }, kind: 'ATTEND' },
        });
        await tx.goHallAttendance.deleteMany({ where: { sessionId, studentId: { in: studentIds } } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}
```

在既有 `maybeNotifyLowQuota` 函式旁加（Task 5 會測它；先放實作讓本 task 編譯通過）：

```ts
// 弈廳堂票低堂數提醒：扣堂後剩餘 ≤ LOW_TICKET_THRESHOLD 且未提醒過才發，
// 登記購買／正向調整時旗標歸零（goHallTicketService）。失敗不影響點名。
async function maybeNotifyLowGoHallTickets(studentId: string): Promise<void> {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, lineUserId: true, goHallLowQuotaNotifiedAt: true, user: { select: { name: true } } },
    });
    if (!student?.lineUserId || student.goHallLowQuotaNotifiedAt !== null) return;
    const remaining = await getTicketBalance(studentId);
    if (remaining > LOW_TICKET_THRESHOLD) return;
    await prisma.student.update({ where: { id: studentId }, data: { goHallLowQuotaNotifiedAt: new Date() } });
    await pushLineMessage(student.lineUserId, `【MUP】${student.user.name} 弈廳堂票剩餘：${remaining} 堂，請盡快與行政人員聯繫續購`);
  } catch (err) {
    console.error('maybeNotifyLowGoHallTickets failed', err);
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/attendanceService.test.ts
```

Expected: PASS（新舊測試全綠）

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts && git commit -m "feat: 弈廳點名到場扣堂（冪等、改回退堂、清除退堂、季票免扣）"
```

---

### Task 5: 低堂數 LINE 提醒測試

**Files:**
- Test: `src/lib/services/attendanceService.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `maybeNotifyLowGoHallTickets`（經由 `saveGoHallAttendance` 間接觸發）
- Produces: 無新介面（行為驗證）

（`pushLineMessage` 在測試環境無 LINE token，`callLineApi` 內部 try/catch 會吞掉，安全。斷言以 `goHallLowQuotaNotifiedAt` 為準。）

- [ ] **Step 1: 寫失敗測試**

在 Task 4 的 describe 內加：

```ts
  it('sets the low-quota flag once when balance drops to the threshold', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await prisma.student.update({ where: { id: student.id }, data: { lineUserId: 'U-test-line' } });
    await buyGoHallTickets({ studentId: student.id, sessions: 4 }); // 扣 1 後剩 3 → 觸發

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).not.toBeNull();
  });

  it('does not set the flag when balance stays above the threshold or student has no LINE', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 }); // 剩 9，未達門檻；且未綁 LINE

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).toBeNull();
  });
```

- [ ] **Step 2: 跑測試**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/attendanceService.test.ts
```

Expected: PASS（Task 4 已含實作；若 FAIL 就修 `maybeNotifyLowGoHallTickets` 直到綠）

- [ ] **Step 3: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/attendanceService.test.ts && git commit -m "test: 弈廳堂票低堂數 LINE 提醒旗標"
```

---

### Task 6: 名單資格欄位（roster ＋ 場次名單）

**Files:**
- Modify: `src/lib/services/attendanceService.ts`（`GoHallRosterEntry`、`getGoHallRoster`）
- Modify: `src/lib/services/goHallService.ts`（新增 `getSessionDetailWithQualifications`）
- Test: `src/lib/services/attendanceService.test.ts`、`src/lib/services/goHallService.test.ts`

**Interfaces:**
- Consumes: `determineQualification`（Task 3）
- Produces:
  - `GoHallRosterEntry` 增加 `qualification: GoHallQualificationValue | null; qualificationPredicted: boolean`
  - `getSessionDetailWithQualifications(id: string)` — 同 `getSessionDetail` 形狀，但每筆 `registrations[]` 多 `qualification`／`qualificationPredicted`
- 規則：已點名且到場 → 回戳記（predicted=false）；已點名非到場 → null（predicted=false）；未點名 → 即時預估（predicted=true）

- [ ] **Step 1: 寫失敗測試**

`attendanceService.test.ts` 的 go-hall describe 內加：

```ts
  it('roster returns the stamped qualification for marked rows and a prediction otherwise', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });

    let roster = await getGoHallRoster(session.id);
    expect(roster[0].qualification).toBe('TICKET');
    expect(roster[0].qualificationPredicted).toBe(true);

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    roster = await getGoHallRoster(session.id);
    expect(roster[0].qualification).toBe('TICKET');
    expect(roster[0].qualificationPredicted).toBe(false);

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);
    roster = await getGoHallRoster(session.id);
    expect(roster[0].qualification).toBeNull();
    expect(roster[0].qualificationPredicted).toBe(false);
  });
```

`goHallService.test.ts` 底部加：

```ts
import { getSessionDetailWithQualifications } from './goHallService';
import { purchaseTickets } from './goHallTicketService';

describe('getSessionDetailWithQualifications', () => {
  it('attaches a predicted qualification per registration', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 15)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);
    await purchaseTickets({ studentId: student.id, sessions: 5 });

    const detail = await getSessionDetailWithQualifications(session.id);
    expect(detail.registrations).toHaveLength(1);
    expect(detail.registrations[0].qualification).toBe('TICKET');
    expect(detail.registrations[0].qualificationPredicted).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/attendanceService.test.ts src/lib/services/goHallService.test.ts
```

Expected: 新測試 FAIL（欄位／函式不存在）

- [ ] **Step 3: 實作**

`attendanceService.ts` — `GoHallRosterEntry` 改為：

```ts
export interface GoHallRosterEntry {
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  qualification: GoHallQualificationValue | null;
  qualificationPredicted: boolean;
}
```

`getGoHallRoster` 整段替換為：

```ts
export async function getGoHallRoster(sessionId: string): Promise<GoHallRosterEntry[]> {
  const [session, registrations, existing] = await Promise.all([
    prisma.goHallSession.findUniqueOrThrow({ where: { id: sessionId }, select: { date: true } }),
    prisma.goHallRegistration.findMany({
      where: { sessionId },
      select: { studentId: true, student: { select: NAME_SELECT } },
    }),
    prisma.goHallAttendance.findMany({ where: { sessionId } }),
  ]);
  const existingByStudentId = new Map(existing.map((a) => [a.studentId, a]));
  const rows = await Promise.all(
    registrations.map(async (r) => {
      const record = existingByStudentId.get(r.studentId);
      const qualification = record
        ? ((record.qualification as GoHallQualificationValue | null) ?? null)
        : await determineQualification(prisma, r.studentId, session.date);
      return {
        studentId: r.studentId,
        studentName: r.student.user.name,
        status: (record?.status as AttendanceStatusValue) ?? null,
        checkInTime: record?.checkInTime ?? null,
        checkOutTime: record?.checkOutTime ?? null,
        qualification,
        qualificationPredicted: !record,
      };
    })
  );
  return rows.sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}
```

`goHallService.ts` 檔頭加 import，底部加函式：

```ts
import { determineQualification, type GoHallQualificationValue } from './goHallTicketService';

export async function getSessionDetailWithQualifications(id: string) {
  const detail = await getSessionDetail(id);
  const attendances = await prisma.goHallAttendance.findMany({
    where: { sessionId: id },
    select: { studentId: true, qualification: true },
  });
  const byStudentId = new Map(attendances.map((a) => [a.studentId, a]));
  const registrations = await Promise.all(
    detail.registrations.map(async (r) => {
      const record = byStudentId.get(r.studentId);
      const qualification: GoHallQualificationValue | null = record
        ? ((record.qualification as GoHallQualificationValue | null) ?? null)
        : await determineQualification(prisma, r.studentId, detail.date);
      return { ...r, qualification, qualificationPredicted: !record };
    })
  );
  return { ...detail, registrations };
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/attendanceService.test.ts src/lib/services/goHallService.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/attendanceService.ts src/lib/services/goHallService.ts src/lib/services/attendanceService.test.ts src/lib/services/goHallService.test.ts && git commit -m "feat: 弈廳名單附資格（戳記優先、未點名回預估）"
```

---

### Task 7: 查詢彙整 service（學生自查／管理列表／單人明細／課堂堂數）

（2026-08-03 使用者追加：票券管理要同時顯示課堂堂數與弈廳資訊 → 本 task 一併新增 `listClassQuotaSummaries`。）

**Files:**
- Modify: `src/lib/services/goHallTicketService.ts`
- Modify: `src/lib/services/attendanceService.ts`（新增 `listClassQuotaSummaries`）
- Test: `src/lib/services/goHallTicketService.test.ts`
- Test: `src/lib/services/attendanceService.test.ts`

**Interfaces:**
- Produces:
  - `getMyTickets(studentId: string): Promise<{ balance: number; activePassEndDate: Date | null }>` — activePass 以「今日（台北）有效」判定
  - `listStudentTicketSummaries(): Promise<Array<{ id: string; name: string; studentNumber: string | null; balance: number; activePassEndDate: Date | null }>>`
  - `getTicketDetail(studentId: string): Promise<{ balance: number; seasonPasses: Array<{ id: string; startDate: Date; endDate: Date }>; history: Array<{ id: string; amount: number; kind: string; reason: string | null; createdAt: Date; sessionDate: Date | null }> }>`
  - attendanceService：`listClassQuotaSummaries(studentId?: string): Promise<ClassQuotaSummaryRow[]>`，其中 `ClassQuotaSummaryRow = { studentId: string; classId: string; className: string; usedSessions: number; totalSessions: number | null; remaining: number | null }` — 與 `getClassEnrollmentQuota` 同一套扣堂語意（`ON_LEAVE`／`NOT_REGISTERED` 不扣）

- [ ] **Step 1: 寫失敗測試**

`goHallTicketService.test.ts` 底部加：

```ts
import { getMyTickets, listStudentTicketSummaries, getTicketDetail } from './goHallTicketService';

describe('getMyTickets / listStudentTicketSummaries', () => {
  it('reports balance and the end date of a currently-valid pass', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 7 });
    const past = new Date();
    past.setDate(past.getDate() - 30);
    const future = new Date();
    future.setDate(future.getDate() + 30);
    await addSeasonPass({ studentId: student.id, startDate: past, endDate: future });

    const mine = await getMyTickets(student.id);
    expect(mine.balance).toBe(7);
    expect(mine.activePassEndDate?.getTime()).toBe(future.getTime());

    const summaries = await listStudentTicketSummaries();
    const row = summaries.find((s) => s.id === student.id)!;
    expect(row.name).toBe('小明');
    expect(row.balance).toBe(7);
    expect(row.activePassEndDate?.getTime()).toBe(future.getTime());
  });

  it('ignores expired and future-only passes for the active end date', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2020-01-01'), endDate: new Date('2020-03-31') });
    const mine = await getMyTickets(student.id);
    expect(mine.activePassEndDate).toBeNull();
  });
});

describe('getTicketDetail', () => {
  it('returns balance, passes, and newest-first history', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 10 });
    await adjustTickets({ studentId: student.id, amount: -2, reason: '登記錯誤' });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });

    const detail = await getTicketDetail(student.id);
    expect(detail.balance).toBe(8);
    expect(detail.seasonPasses).toHaveLength(1);
    expect(detail.history).toHaveLength(2);
    expect(detail.history[0].kind).toBe('ADMIN_ADJUST'); // 最新在前
    expect(detail.history[0].reason).toBe('登記錯誤');
  });
});
```

`attendanceService.test.ts` 底部加（沿用檔頭既有 import 的 `saveClassAttendance` 與 `setupClassWithStudent`；`listClassQuotaSummaries` 併入既有 `./attendanceService` import）：

```ts
describe('listClassQuotaSummaries', () => {
  it('computes used/total/remaining per enrollment, excluding ON_LEAVE and NOT_REGISTERED', async () => {
    const { student, cls } = await setupClassWithStudent();
    await prisma.classEnrollment.update({
      where: { studentId_classId: { studentId: student.id, classId: cls.id } },
      data: { totalSessions: 10 },
    });
    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'ON_LEAVE' }]);

    const all = await listClassQuotaSummaries();
    const row = all.find((r) => r.studentId === student.id && r.classId === cls.id)!;
    expect(row.className).toBe('週二基礎班');
    expect(row.usedSessions).toBe(1);
    expect(row.totalSessions).toBe(10);
    expect(row.remaining).toBe(9);

    const mine = await listClassQuotaSummaries(student.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].usedSessions).toBe(1);
  });

  it('returns null total/remaining when totalSessions is unset', async () => {
    const { student } = await setupClassWithStudent();
    const rows = await listClassQuotaSummaries(student.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalSessions).toBeNull();
    expect(rows[0].remaining).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/goHallTicketService.test.ts src/lib/services/attendanceService.test.ts
```

Expected: 新增測試 FAIL（函式不存在），其餘既有測試 PASS

- [ ] **Step 3: 實作**

`goHallTicketService.ts` 底部加：

```ts
function activePassEndDate(passes: { startDate: Date; endDate: Date }[], todayKey: string): Date | null {
  const active = passes
    .filter((p) => taipeiDateKey(p.startDate) <= todayKey && todayKey <= taipeiDateKey(p.endDate))
    .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
  return active[0]?.endDate ?? null;
}

export async function getMyTickets(studentId: string): Promise<{ balance: number; activePassEndDate: Date | null }> {
  const todayKey = taipeiDateKey(new Date());
  const [balance, passes] = await Promise.all([
    getTicketBalance(studentId),
    prisma.goHallSeasonPass.findMany({ where: { studentId }, select: { startDate: true, endDate: true } }),
  ]);
  return { balance, activePassEndDate: activePassEndDate(passes, todayKey) };
}

// 管理端「票券管理」主表：全部學生＋餘額（一次 groupBy）＋今日有效季票結束日。
export async function listStudentTicketSummaries() {
  const todayKey = taipeiDateKey(new Date());
  const [students, sums, passes] = await Promise.all([
    prisma.student.findMany({
      select: { id: true, studentNumber: true, user: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.goHallTicketTransaction.groupBy({ by: ['studentId'], _sum: { amount: true } }),
    prisma.goHallSeasonPass.findMany({ select: { studentId: true, startDate: true, endDate: true } }),
  ]);
  const balanceByStudentId = new Map(sums.map((s) => [s.studentId, s._sum.amount ?? 0]));
  const passesByStudentId = new Map<string, { startDate: Date; endDate: Date }[]>();
  for (const p of passes) {
    const list = passesByStudentId.get(p.studentId) ?? [];
    list.push(p);
    passesByStudentId.set(p.studentId, list);
  }
  return students.map((s) => ({
    id: s.id,
    name: s.user.name,
    studentNumber: s.studentNumber,
    balance: balanceByStudentId.get(s.id) ?? 0,
    activePassEndDate: activePassEndDate(passesByStudentId.get(s.id) ?? [], todayKey),
  }));
}

export async function getTicketDetail(studentId: string) {
  const [balance, seasonPasses, history] = await Promise.all([
    getTicketBalance(studentId),
    prisma.goHallSeasonPass.findMany({
      where: { studentId },
      select: { id: true, startDate: true, endDate: true },
      orderBy: { startDate: 'desc' },
    }),
    prisma.goHallTicketTransaction.findMany({
      where: { studentId },
      select: { id: true, amount: true, kind: true, reason: true, createdAt: true, session: { select: { date: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return {
    balance,
    seasonPasses,
    history: history.map((h) => ({
      id: h.id,
      amount: h.amount,
      kind: h.kind as string,
      reason: h.reason,
      createdAt: h.createdAt,
      sessionDate: h.session?.date ?? null,
    })),
  };
}
```

`attendanceService.ts` 在 `getClassEnrollmentQuota` 函式後面加：

```ts
export interface ClassQuotaSummaryRow {
  studentId: string;
  classId: string;
  className: string;
  usedSessions: number;
  totalSessions: number | null;
  remaining: number | null;
}

// 與 getClassEnrollmentQuota 同一套扣堂語意（請假、未報名不扣），
// 但一次 groupBy 算完（單人或全部學生），供票券管理顯示課堂堂數。
export async function listClassQuotaSummaries(studentId?: string): Promise<ClassQuotaSummaryRow[]> {
  const [enrollments, counts] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: studentId ? { studentId } : {},
      select: { studentId: true, totalSessions: true, class: { select: { id: true, name: true } } },
    }),
    prisma.classAttendance.groupBy({
      by: ['classId', 'studentId'],
      where: { status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] }, ...(studentId ? { studentId } : {}) },
      _count: { _all: true },
    }),
  ]);
  const usedByKey = new Map(counts.map((c) => [`${c.classId}:${c.studentId}`, c._count._all]));
  return enrollments.map((e) => {
    const usedSessions = usedByKey.get(`${e.class.id}:${e.studentId}`) ?? 0;
    return {
      studentId: e.studentId,
      classId: e.class.id,
      className: e.class.name,
      usedSessions,
      totalSessions: e.totalSessions,
      remaining: e.totalSessions === null ? null : e.totalSessions - usedSessions,
    };
  });
}
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm test -- src/lib/services/goHallTicketService.test.ts src/lib/services/attendanceService.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/goHallTicketService.ts src/lib/services/goHallTicketService.test.ts src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts && git commit -m "feat: 弈廳票券查詢彙整與課堂堂數批次查詢"
```

---

### Task 8: API routes

**Files:**
- Create: `src/app/api/go-hall-tickets/me/route.ts`
- Create: `src/app/api/go-hall-tickets/summary/route.ts`
- Create: `src/app/api/go-hall-tickets/purchase/route.ts`
- Create: `src/app/api/go-hall-tickets/adjust/route.ts`
- Create: `src/app/api/go-hall-tickets/[studentId]/route.ts`
- Create: `src/app/api/go-hall-season-passes/route.ts`
- Create: `src/app/api/go-hall-season-passes/[id]/route.ts`
- Modify: `src/app/api/go-hall-sessions/[id]/route.ts`

**Interfaces:**
- Consumes: Task 3／6／7 的 service 函式
- Produces（前端呼叫用）:
  - `GET /api/go-hall-tickets/me` → `{ balance: number, activePassEndDate: string | null, classQuotas: ClassQuotaSummaryRow[] }`（STUDENT）
  - `GET /api/go-hall-tickets/summary` → summary 陣列，每列含 `classQuotas: ClassQuotaSummaryRow[]`（ADMIN）
  - `GET /api/go-hall-tickets/[studentId]` → `{ balance, seasonPasses, history }`（ADMIN）
  - `POST /api/go-hall-tickets/purchase` body `{ studentId, sessions }` → 201（ADMIN）
  - `POST /api/go-hall-tickets/adjust` body `{ studentId, amount, reason }` → 201（ADMIN）
  - `POST /api/go-hall-season-passes` body `{ studentId, startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }` → 201（ADMIN）
  - `DELETE /api/go-hall-season-passes/[id]` → `{ success: true }`（ADMIN）
  - `GET /api/go-hall-sessions/[id]`：非 STUDENT 改回含 `qualification`／`qualificationPredicted` 的 registrations；STUDENT 維持遮罩姓名、無資格欄位

- [ ] **Step 1: 建立各 route**

`src/app/api/go-hall-tickets/me/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getMyTickets } from '@/lib/services/goHallTicketService';
import { listClassQuotaSummaries } from '@/lib/services/attendanceService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const [tickets, classQuotas] = await Promise.all([getMyTickets(student.id), listClassQuotaSummaries(student.id)]);
  return NextResponse.json({ ...tickets, classQuotas });
}
```

`src/app/api/go-hall-tickets/summary/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listStudentTicketSummaries } from '@/lib/services/goHallTicketService';
import { listClassQuotaSummaries, type ClassQuotaSummaryRow } from '@/lib/services/attendanceService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const [summaries, quotas] = await Promise.all([listStudentTicketSummaries(), listClassQuotaSummaries()]);
  const quotasByStudentId = new Map<string, ClassQuotaSummaryRow[]>();
  for (const q of quotas) {
    const list = quotasByStudentId.get(q.studentId) ?? [];
    list.push(q);
    quotasByStudentId.set(q.studentId, list);
  }
  return NextResponse.json(summaries.map((s) => ({ ...s, classQuotas: quotasByStudentId.get(s.id) ?? [] })));
}
```

`src/app/api/go-hall-tickets/purchase/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { purchaseTickets } from '@/lib/services/goHallTicketService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId, sessions } = await req.json();
  try {
    await purchaseTickets({ studentId, sessions });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
```

`src/app/api/go-hall-tickets/adjust/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { adjustTickets } from '@/lib/services/goHallTicketService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId, amount, reason } = await req.json();
  try {
    await adjustTickets({ studentId, amount, reason });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
```

`src/app/api/go-hall-tickets/[studentId]/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getTicketDetail } from '@/lib/services/goHallTicketService';

export async function GET(_req: NextRequest, { params }: { params: { studentId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getTicketDetail(params.studentId));
}
```

`src/app/api/go-hall-season-passes/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { addSeasonPass } from '@/lib/services/goHallTicketService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId, startDate, endDate } = await req.json();
  try {
    const pass = await addSeasonPass({ studentId, startDate: new Date(startDate), endDate: new Date(endDate) });
    return NextResponse.json(pass, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
```

`src/app/api/go-hall-season-passes/[id]/route.ts`：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deleteSeasonPass } from '@/lib/services/goHallTicketService';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await deleteSeasonPass(params.id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: 修改 `src/app/api/go-hall-sessions/[id]/route.ts` 的 GET**

import 行改為同時引入兩個函式，非 STUDENT 走含資格版本：

```ts
import { getSessionDetail, getSessionDetailWithQualifications, deleteSession } from '@/lib/services/goHallService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (session.user.role !== 'STUDENT') {
    return NextResponse.json(await getSessionDetailWithQualifications(params.id));
  }

  const detail = await getSessionDetail(params.id);
  return NextResponse.json({
    ...detail,
    registrations: detail.registrations.map((r) => ({
      ...r,
      student: { user: { ...r.student.user, name: maskName(r.student.user.name) } },
    })),
  });
}
```

（DELETE 不動。）

- [ ] **Step 3: 型別檢查＋全測試**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit && npm test
```

Expected: tsc 無錯誤、測試全綠

- [ ] **Step 4: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/api/go-hall-tickets src/app/api/go-hall-season-passes "src/app/api/go-hall-sessions/[id]/route.ts" && git commit -m "feat: 弈廳票券 API（購買／調整／季票／自查）與名單資格欄位"
```

---

### Task 9: 學生端「票券管理」卡片

**Files:**
- Modify: `src/app/student/go-hall/page.tsx`

**Interfaces:**
- Consumes: `GET /api/go-hall-tickets/me`
- Produces: 無（純 UI）

- [ ] **Step 1: 實作卡片**

`StudentGoHallContent` 內：

檔案頂層（其他 interface 旁）加：

```ts
interface ClassQuotaRow {
  classId: string;
  className: string;
  usedSessions: number;
  totalSessions: number | null;
}

interface MyTickets {
  balance: number;
  activePassEndDate: string | null;
  classQuotas: ClassQuotaRow[];
}
```

state 區加：

```ts
  const [tickets, setTickets] = useState<MyTickets | null>(null);
```

`load()` 的 `Promise.all` 改為三路並在其後 set：

```ts
      const [sessionsRes, myRes, ticketsRes] = await Promise.all([
        fetch('/api/go-hall-sessions'),
        fetch('/api/go-hall-registrations'),
        fetch('/api/go-hall-tickets/me'),
      ]);
      setOpenSessions(await sessionsRes.json());
      setMyRegistrations(await myRes.json());
      setTickets(await ticketsRes.json());
```

JSX 在 `<h1>弈廳</h1>` 之後、「開放中的場次」之前插入（標題為使用者指定的「票券管理」）：

```tsx
      <h2 className="mb-2 font-bold text-ink">票券管理</h2>
      <Card className="mb-6">
        {tickets === null ? (
          <div className="flex flex-col gap-2">
            <div className="skeleton-shimmer h-4 w-40 rounded" />
            <div className="skeleton-shimmer h-4 w-56 rounded" />
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm text-ink">
            {tickets.classQuotas.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="font-bold">課堂</h3>
                {tickets.classQuotas.map((q) => (
                  <p key={q.classId}>
                    {q.className}：已上 {q.usedSessions}
                    {q.totalSessions !== null ? `／共 ${q.totalSessions} 堂` : ' 堂（未設定總堂數）'}
                  </p>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1">
              <h3 className="font-bold">弈廳</h3>
              {tickets.activePassEndDate && <p>季票有效期至 {formatDateWithWeekday(tickets.activePassEndDate, 'zh-TW')}</p>}
              {tickets.balance > 0 && <p>堂票剩餘 {tickets.balance} 堂</p>}
              {!tickets.activePassEndDate && tickets.balance <= 0 && (
                <p className="text-inkMuted">目前以單堂計費（現場收費）</p>
              )}
            </div>
          </div>
        )}
      </Card>
```

- [ ] **Step 2: 型別檢查**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit
```

Expected: 無錯誤

- [ ] **Step 3: 瀏覽器驗證**

啟動 dev server（用 launch.json 的既有設定），以 seed 學生帳號登入 `student/go-hall`，確認卡片「課堂」區（各班 已上／共）與「弈廳」區（三種狀態之一）正確顯示、報名／取消不受影響。

- [ ] **Step 4: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/student/go-hall/page.tsx && git commit -m "feat: 學生弈廳頁「票券管理」卡片（季票效期／堂票剩餘／單堂提示）"
```

---

### Task 10: 管理端票券管理區塊＋場次名單資格標籤

**Files:**
- Create: `src/app/admin/go-hall/TicketManager.tsx`
- Modify: `src/app/admin/go-hall/page.tsx`

**Interfaces:**
- Consumes: Task 8 的票券 API；`formatDateWithWeekday`
- Produces: `<TicketManager />`（無 props）；`QUALIFICATION_LABEL`（TicketManager 具名匯出，供 page 的場次名單 Modal 重用）

- [ ] **Step 1: 建立 TicketManager 元件**

`src/app/admin/go-hall/TicketManager.tsx`：

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';

export const QUALIFICATION_LABEL: Record<string, string> = {
  SEASON_PASS: '季票',
  TICKET: '堂票',
  SINGLE: '單堂（現場收費）',
};

const KIND_LABELS: Record<string, string> = {
  PURCHASE: '購買',
  ATTEND: '到場扣堂',
  ADMIN_ADJUST: '調整',
};

interface ClassQuotaRow {
  classId: string;
  className: string;
  usedSessions: number;
  totalSessions: number | null;
}

interface SummaryRow {
  id: string;
  name: string;
  studentNumber: string | null;
  balance: number;
  activePassEndDate: string | null;
  classQuotas: ClassQuotaRow[];
}

interface SeasonPassRow {
  id: string;
  startDate: string;
  endDate: string;
}

interface HistoryRow {
  id: string;
  amount: number;
  kind: string;
  reason: string | null;
  createdAt: string;
  sessionDate: string | null;
}

interface TicketDetail {
  balance: number;
  seasonPasses: SeasonPassRow[];
  history: HistoryRow[];
}

export default function TicketManager() {
  const { showToast } = useToast();
  const [summaries, setSummaries] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [managing, setManaging] = useState<SummaryRow | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const [purchaseSessions, setPurchaseSessions] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [passStart, setPassStart] = useState('');
  const [passEnd, setPassEnd] = useState('');

  async function loadSummaries() {
    try {
      const res = await fetch('/api/go-hall-tickets/summary');
      if (res.ok) setSummaries(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummaries();
  }, []);

  async function openManage(row: SummaryRow) {
    setManaging(row);
    setDetail(null);
    setPurchaseSessions('');
    setAdjustAmount('');
    setAdjustReason('');
    setPassStart('');
    setPassEnd('');
    const res = await fetch(`/api/go-hall-tickets/${row.id}`);
    if (res.ok) setDetail(await res.json());
  }

  async function refreshAfterMutation() {
    if (!managing) return;
    const res = await fetch(`/api/go-hall-tickets/${managing.id}`);
    if (res.ok) setDetail(await res.json());
    loadSummaries();
  }

  async function submit(url: string, body: unknown, successText: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json();
        const messages: Record<string, string> = {
          INVALID_AMOUNT: '數量必須是不為零的整數（購買至少 1 堂）',
          INSUFFICIENT_TICKETS: '調整後餘額不能為負',
          REASON_REQUIRED: '請填寫原因',
          INVALID_RANGE: '結束日不能早於開始日',
        };
        showToast(messages[data.error] ?? `錯誤：${data.error}`);
        return;
      }
      showToast(successText);
      await refreshAfterMutation();
    } finally {
      setBusy(false);
    }
  }

  async function handlePurchase() {
    if (!managing) return;
    await submit('/api/go-hall-tickets/purchase', { studentId: managing.id, sessions: Number(purchaseSessions) }, '已登記購買');
    setPurchaseSessions('');
  }

  async function handleAdjust() {
    if (!managing) return;
    await submit('/api/go-hall-tickets/adjust', { studentId: managing.id, amount: Number(adjustAmount), reason: adjustReason }, '已調整');
    setAdjustAmount('');
    setAdjustReason('');
  }

  async function handleAddPass() {
    if (!managing) return;
    await submit('/api/go-hall-season-passes', { studentId: managing.id, startDate: passStart, endDate: passEnd }, '已新增季票');
    setPassStart('');
    setPassEnd('');
  }

  async function handleDeletePass(id: string) {
    if (!confirm('確定要刪除這筆季票嗎？')) return;
    setBusy(true);
    try {
      await fetch(`/api/go-hall-season-passes/${id}`, { method: 'DELETE' });
      showToast('已刪除季票');
      await refreshAfterMutation();
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter((s) => s.name.toLowerCase().includes(q) || (s.studentNumber ?? '').toLowerCase().includes(q));
  }, [summaries, search]);

  const columns: Column<SummaryRow>[] = [
    { header: '姓名', render: (s) => s.name },
    { header: '學號', render: (s) => s.studentNumber ?? '-' },
    {
      header: '課堂堂數',
      render: (s) =>
        s.classQuotas.length === 0 ? (
          '-'
        ) : (
          <div className="flex flex-col gap-0.5">
            {s.classQuotas.map((q) => (
              <span key={q.classId}>
                {q.className}：{q.usedSessions}／{q.totalSessions ?? '—'}
              </span>
            ))}
          </div>
        ),
    },
    { header: '堂票剩餘', render: (s) => `${s.balance} 堂` },
    {
      header: '季票',
      render: (s) => (s.activePassEndDate ? `有效至 ${formatDateWithWeekday(s.activePassEndDate, 'zh-TW')}` : '-'),
    },
    {
      header: '操作',
      render: (s) => (
        <Button className="px-3 py-1 text-xs" onClick={() => openManage(s)}>
          管理
        </Button>
      ),
    },
  ];

  const historyColumns: Column<HistoryRow>[] = [
    { header: '日期', render: (h) => formatDateWithWeekday(h.createdAt, 'zh-TW') },
    { header: '類型', render: (h) => KIND_LABELS[h.kind] ?? h.kind },
    { header: '堂數', render: (h) => (h.amount > 0 ? `+${h.amount}` : `${h.amount}`) },
    {
      header: '備註',
      render: (h) => h.reason ?? (h.sessionDate ? `場次 ${formatDateWithWeekday(h.sessionDate, 'zh-TW')}` : '-'),
    },
  ];

  return (
    <>
      <h2 className="mb-2 font-bold text-ink">票券管理</h2>
      <Card className="mb-6">
        <div className="mb-3">
          <Input placeholder="搜尋姓名或學號" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        </div>
        <DataTable columns={columns} rows={filtered} keyField={(s) => s.id} loading={loading} />
      </Card>

      <Modal open={managing !== null} onClose={() => setManaging(null)} title={managing ? `票券管理 - ${managing.name}` : ''} maxWidthClassName="max-w-2xl">
        {managing && (
          <div className="flex flex-col gap-4">
            {detail === null ? (
              <div className="flex flex-col gap-2">
                <div className="skeleton-shimmer h-4 w-40 rounded" />
                <div className="skeleton-shimmer h-4 w-56 rounded" />
              </div>
            ) : (
              <>
                <p className="text-sm text-ink">
                  堂票剩餘 <span className="font-bold">{detail.balance}</span> 堂
                </p>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-inkMuted">
                    購買堂數
                    <Input type="number" min={1} value={purchaseSessions} onChange={(e) => setPurchaseSessions(e.target.value)} className="w-24" />
                  </label>
                  <Button onClick={handlePurchase} loading={busy} disabled={!purchaseSessions}>
                    登記購買
                  </Button>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-inkMuted">
                    調整（可負）
                    <Input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} className="w-24" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-inkMuted">
                    原因
                    <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} className="w-40" />
                  </label>
                  <Button onClick={handleAdjust} loading={busy} disabled={!adjustAmount || !adjustReason.trim()}>
                    調整
                  </Button>
                </div>

                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-bold text-ink">季票</h3>
                  {detail.seasonPasses.length === 0 ? (
                    <p className="text-sm text-inkMuted">尚無季票</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {detail.seasonPasses.map((p) => (
                        <li key={p.id} className="flex items-center justify-between text-sm text-ink">
                          <span>
                            {formatDateWithWeekday(p.startDate, 'zh-TW')} ～ {formatDateWithWeekday(p.endDate, 'zh-TW')}
                          </span>
                          <button type="button" className="text-rejected hover:underline" onClick={() => handleDeletePass(p.id)}>
                            刪除
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-xs text-inkMuted">
                      開始日
                      <Input type="date" value={passStart} onChange={(e) => setPassStart(e.target.value)} />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-inkMuted">
                      結束日
                      <Input type="date" value={passEnd} onChange={(e) => setPassEnd(e.target.value)} />
                    </label>
                    <Button onClick={handleAddPass} loading={busy} disabled={!passStart || !passEnd}>
                      新增季票
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-bold text-ink">異動紀錄</h3>
                  <DataTable columns={historyColumns} rows={detail.history} keyField={(h) => h.id} />
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: 掛進 admin/go-hall 頁＋場次名單標籤**

`src/app/admin/go-hall/page.tsx`：

檔頭加：

```ts
import TicketManager, { QUALIFICATION_LABEL } from './TicketManager';
```

`RosterEntry` 介面加兩個欄位：

```ts
interface RosterEntry {
  id: string;
  student: { user: { name: string } };
  qualification?: string | null;
  qualificationPredicted?: boolean;
}
```

場次名單 Modal 中渲染 registrations 的 `<li>`（顯示 `r.student.user.name` 那行）改為：

```tsx
                  <li key={r.id} className="flex items-center justify-between text-sm text-ink">
                    <span>{r.student.user.name}</span>
                    {r.qualification && (
                      <span className={r.qualification === 'SINGLE' ? 'text-xs font-semibold text-pending' : 'text-xs text-inkMuted'}>
                        {(r.qualificationPredicted ? '預計：' : '') + QUALIFICATION_LABEL[r.qualification]}
                      </span>
                    )}
                  </li>
```

在 `AdminGoHallContent` 的 return 最外層 fragment 內、場次名單 `<Modal>` 之後（closing fragment 之前）加一行 `<TicketManager />`，讓票券管理區塊排在場次管理之下。

- [ ] **Step 3: 型別檢查**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit
```

Expected: 無錯誤

- [ ] **Step 4: 瀏覽器驗證**

dev server 以 seed 管理員帳號進 `admin/go-hall`：摘要表顯示課堂堂數欄（各班 已上／共）；購買 10 堂 → 摘要表餘額更新；調整 -3 附原因 → 餘額 7；調整 -99 → 顯示「調整後餘額不能為負」；新增季票（結束日早於開始日 → 顯示「結束日不能早於開始日」）；刪除季票；場次名單 Modal 顯示資格標籤。

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/admin/go-hall/TicketManager.tsx src/app/admin/go-hall/page.tsx && git commit -m "feat: 管理端弈廳票券管理（購買／調整／季票／帳本）與名單資格標籤"
```

---

### Task 11: 點名名單資格標籤（AttendanceHub）

**Files:**
- Modify: `src/components/AttendanceRosterEditor.tsx`（`RosterRow` 加 `quotaTone`）
- Modify: `src/components/AttendanceHub.tsx`（GO_HALL 分支帶入資格標籤）

**Interfaces:**
- Consumes: `GET /api/attendance/go-hall/[sessionId]` 現在回傳 `qualification`／`qualificationPredicted`（Task 6）
- Produces: `RosterRow.quotaTone?: 'warning'` — 標籤以橘色（`text-pending`）醒目顯示

- [ ] **Step 1: AttendanceRosterEditor 支援 tone**

`RosterRow` 介面的 `quotaLabel?: string;` 下面加一行：

```ts
  quotaTone?: 'warning';
```

渲染 `quotaLabel` 的那行改為：

```tsx
              {r.quotaLabel && (
                <span className={r.quotaTone === 'warning' ? 'text-xs font-semibold text-pending' : 'text-xs text-inkMuted'}>
                  {r.quotaLabel}
                </span>
              )}
```

- [ ] **Step 2: AttendanceHub GO_HALL 分支帶標籤**

`SimpleRosterApiRow` 下方加介面與 label 常數（檔案頂層）：

```ts
interface GoHallRosterApiRow extends SimpleRosterApiRow {
  qualification: 'SEASON_PASS' | 'TICKET' | 'SINGLE' | null;
  qualificationPredicted: boolean;
}

const GO_HALL_QUALIFICATION_LABEL: Record<string, string> = {
  SEASON_PASS: '季票',
  TICKET: '堂票',
  SINGLE: '單堂（現場收費）',
};
```

`openSession` 的 GO_HALL 分支 map 改為：

```ts
    } else if (s.type === 'GO_HALL') {
      const res = await fetch(`/api/attendance/go-hall/${s.id}`);
      const roster = await res.json();
      setRosterRows(
        roster.map((r: GoHallRosterApiRow) => ({
          key: r.studentId,
          studentId: r.studentId,
          studentName: r.studentName,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          quotaLabel: r.qualification
            ? (r.qualificationPredicted ? '預計：' : '') + GO_HALL_QUALIFICATION_LABEL[r.qualification]
            : undefined,
          quotaTone: r.qualification === 'SINGLE' ? ('warning' as const) : undefined,
        }))
      );
    } else {
```

- [ ] **Step 3: 型別檢查＋全測試**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit && npm test
```

Expected: 全綠

- [ ] **Step 4: 瀏覽器驗證**

dev server 以管理員進點名（AttendanceHub），開一場弈廳：未點名學生顯示「預計：…」標籤、單堂為橘色；標到場後標籤轉為定案（無「預計：」前綴）。

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/components/AttendanceRosterEditor.tsx src/components/AttendanceHub.tsx && git commit -m "feat: 弈廳點名名單資格標籤（單堂醒目、未點名顯示預計）"
```

---

### Task 12: Production SQL＋最終驗證

**Files:**
- Create: `docs/superpowers/2026-08-03-go-hall-tickets-production.sql`

**Interfaces:**
- Consumes: Task 1 的 schema
- Produces: 冪等 SQL（Supabase SQL Editor 執行；先跑 SQL 再部署）

- [ ] **Step 1: 撰寫 production SQL**

```sql
-- 弈廳報名資格（堂票／季票／單堂） 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：兩個 enum ＋ 兩張表 ＋ 兩個欄位（無 backfill，歷史點名不回填資格）
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

-- 1) Enum types
DO $$ BEGIN
  CREATE TYPE "GoHallQualification" AS ENUM ('SEASON_PASS', 'TICKET', 'SINGLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "GoHallTicketKind" AS ENUM ('PURCHASE', 'ATTEND', 'ADMIN_ADJUST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) 堂票帳本（餘額＝amount 加總）
CREATE TABLE IF NOT EXISTS "GoHallTicketTransaction" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" "GoHallTicketKind" NOT NULL,
    "reason" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoHallTicketTransaction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GoHallTicketTransaction" DROP CONSTRAINT IF EXISTS "GoHallTicketTransaction_studentId_fkey";
ALTER TABLE "GoHallTicketTransaction" ADD CONSTRAINT "GoHallTicketTransaction_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GoHallTicketTransaction" DROP CONSTRAINT IF EXISTS "GoHallTicketTransaction_sessionId_fkey";
ALTER TABLE "GoHallTicketTransaction" ADD CONSTRAINT "GoHallTicketTransaction_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "GoHallSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) 季票（一筆一個起訖區間，含頭尾）
CREATE TABLE IF NOT EXISTS "GoHallSeasonPass" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoHallSeasonPass_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GoHallSeasonPass" DROP CONSTRAINT IF EXISTS "GoHallSeasonPass_studentId_fkey";
ALTER TABLE "GoHallSeasonPass" ADD CONSTRAINT "GoHallSeasonPass_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) 既有表加欄位
ALTER TABLE "GoHallAttendance" ADD COLUMN IF NOT EXISTS "qualification" "GoHallQualification";
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "goHallLowQuotaNotifiedAt" TIMESTAMP(3);
```

- [ ] **Step 2: 對照驗證**

逐一核對 SQL 與 `prisma/schema.prisma` 的欄位名、型別、FK onDelete 行為一致（`sessionId` 是 `SET NULL`、`studentId` 是 Prisma 預設 `RESTRICT`）。

- [ ] **Step 3: 最終全套驗證**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit && npm run lint && npm test
```

Expected: 全部通過

- [ ] **Step 4: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add docs/superpowers/2026-08-03-go-hall-tickets-production.sql && git commit -m "docs: 弈廳票券 production SQL"
```

（push 與 Vercel 部署、正式站跑 SQL 由使用者確認後另行執行，不在本計畫自動步驟內。）
