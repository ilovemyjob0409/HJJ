# 個別輔導模組（英文／數學）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone "個別輔導" (flexible tutoring) module — weekly-recurring capacity-limited windows, student self-service booking with a chosen start/end time inside the window, calendar-month quota tracking, a late-cancellation → makeup-request flow, and integration into the existing point-name (attendance) system — without touching the existing Class/LeaveRequest/MakeupRequest/SubstituteRequest system.

**Architecture:** Six new Prisma models (`TutoringProgram`, `TutoringWindow`, `TutoringWindowClosure`, `TutoringEnrollment`, `TutoringBooking`, `TutoringAttendance`) behind two new service files (`tutoringProgramService.ts` for catalog/roster CRUD, `tutoringBookingService.ts` for capacity math + booking/cancel/makeup/quota logic), following the existing 弈廳 (Go Hall) architecture exactly: capacity-checked self-registration, `runSerializableWithRetry` for check-then-act races, fully client-rendered pages that fetch JSON from `/api/*` routes (never a Server Component passing render-functions into a Client Component — see the design doc's reference to the 2026-08-05/06 production outage this avoids). Attendance integration extends the existing shared `attendanceService.ts` (roster/save/clear functions + `AttendanceSessionType`/`getTodayCandidates` wiring) rather than creating a parallel attendance system.

**Tech Stack:** Next.js App Router (route handlers under `src/app/api/`), Prisma + `@prisma/adapter-pg` (no `prisma migrate` — this project uses `prisma db push` for dev/test and hand-written idempotent SQL under `docs/superpowers/*.sql` for production), Vitest for service-layer tests, Vercel Cron for the monthly reminder.

## Global Constraints

- Dates are stored as **UTC-midnight pure calendar dates** and compared as calendar dates, never as instants — reuse the existing `formatDateWithWeekday`/`WEEKDAY_LABELS` from `src/lib/dateFormat.ts` for display.
- "今天" (today) is always evaluated in **Asia/Taipei** time, never server-local time — reuse the `taipeiDateKey`/`utcDateKey` string-comparison pattern already used in `goHallTicketService.ts` (this plan defines local copies inside `tutoringBookingService.ts`, matching the codebase's existing convention of small per-domain date-key helpers rather than one shared module — see `LOW_CLASS_QUOTA_THRESHOLD` vs `LOW_TICKET_THRESHOLD` in `src/lib/lowQuota.ts` for the precedent).
- Every check-then-act write (capacity check + booking create) MUST run inside `runSerializableWithRetry` + `Prisma.TransactionIsolationLevel.Serializable`, exactly like `registerForSessionTx` in `src/lib/services/goHallService.ts`.
- Every API route re-checks `getServerSession(authOptions)` + role per-handler (no shared middleware) and returns `NextResponse.json({ error: 'Forbidden' }, { status: 403 })` for both "no session" and "wrong role" — this is the uniform convention across every existing route in this codebase.
- Service-thrown errors are `Error('SOME_CODE')` strings, mapped to HTTP status at the route layer: conflict/capacity → 409, validation → 422, ownership → 403, missing body → 400.
- No Server Component may pass a `columns` array containing render functions into a Client Component (this is exactly what caused the 2026-08-05/06 production outage on `/student`, `/student/points`, `/teacher` — see `HJJ/src/app/student/LeaveHistoryTable.tsx` etc. for the corrected pattern). All new pages in this plan are fully client-rendered (`'use client'`), fetching JSON from `/api/*` — mirroring `src/app/student/go-hall/page.tsx` exactly, not `src/app/student/points/page.tsx`.
- Test convention: `src/**/*.test.ts` only (no component tests in this codebase) — `npm run test:dbpush && vitest run`; `vitest.setup.ts` truncates all tables via `resetDb()` before every test, so fixtures are built fresh per test via real service calls (`createTeacher`, `createStudent`, etc.), never raw `prisma.x.create` for entities that already have a service constructor.
- Chinese UI copy, `zh-TW` locale conventions, and the existing design system (`Card`, `Button`, `Input`, `Modal`, `DataTable`/`CollapsibleDataTable`, `StatusBadge`, `ExportCsvButton`, `useToast`, `useConfirm`) are reused as-is — no new visual patterns.

---

### Task 1: Prisma schema — new models, enums, and production SQL

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `docs/superpowers/2026-08-07-tutoring-module-production.sql`

**Interfaces:**
- Produces: `TutoringProgram`, `TutoringWindow`, `TutoringWindowClosure`, `TutoringEnrollment`, `TutoringBooking`, `TutoringAttendance` Prisma models; `TutoringBookingKind` (`REGULAR`, `MAKEUP`), `TutoringBookingStatus` (`PENDING_ADMIN`, `BOOKED`, `CANCELLED_LATE`, `REJECTED`) enums. Every later task's Prisma queries depend on these exact field names.

- [ ] **Step 1: Add the two new enums**

In `prisma/schema.prisma`, immediately after the existing `enum GoHallTicketKind { ... }` block (ends around line 73), add:

```prisma
enum TutoringBookingKind {
  REGULAR // 一般預約
  MAKEUP  // 補課（由某筆計次的 REGULAR 預約衍生）
}

enum TutoringBookingStatus {
  PENDING_ADMIN // 補課申請待行政核准（僅 MAKEUP 用）
  BOOKED        // 已確定（一般預約送出即是；補課核准後轉為此）
  CANCELLED_LATE // 當天取消，計次
  REJECTED      // 補課申請被駁回
}
```

- [ ] **Step 2: Add the six new models**

Immediately after the existing `model ActivityAttendance { ... }` block (ends around line 403, right before `model FaqItem`), add:

```prisma
model TutoringProgram {
  id                     String   @id @default(cuid())
  name                   String
  defaultMonthlyQuota    Int      @default(8)
  defaultDurationMinutes Int      @default(120)
  active                 Boolean  @default(true)
  windows                TutoringWindow[]
  enrollments            TutoringEnrollment[]
}

model TutoringWindow {
  id        String   @id @default(cuid())
  programId String
  program   TutoringProgram @relation(fields: [programId], references: [id])
  weekday   Int      // 0-6，同 Class.weekday 慣例（JS getUTCDay()）
  startTime String   // "16:00"
  endTime   String   // "21:00"
  capacity  Int      // 同時在座人數上限
  teacherId String
  teacher   Teacher  @relation(fields: [teacherId], references: [id])
  active    Boolean  @default(true)
  closures  TutoringWindowClosure[]
  bookings  TutoringBooking[]
}

model TutoringWindowClosure {
  id       String   @id @default(cuid())
  windowId String
  window   TutoringWindow @relation(fields: [windowId], references: [id], onDelete: Cascade)
  date     DateTime // UTC 日曆日

  @@unique([windowId, date])
}

model TutoringEnrollment {
  id                     String   @id @default(cuid())
  programId              String
  program                TutoringProgram @relation(fields: [programId], references: [id])
  studentId              String
  student                Student  @relation(fields: [studentId], references: [id])
  monthlyQuota           Int?     // null＝用課程預設；行政可個別覆寫
  active                 Boolean  @default(true)
  lastQuotaReminderMonth String?  // "2026-08"，月中提醒防重複
  bookings               TutoringBooking[]

  @@unique([programId, studentId])
}

model TutoringBooking {
  id           String   @id @default(cuid())
  enrollmentId String
  enrollment   TutoringEnrollment @relation(fields: [enrollmentId], references: [id])
  windowId     String
  window       TutoringWindow @relation(fields: [windowId], references: [id])
  date         DateTime // UTC 日曆日
  startTime    String   // 30 分鐘刻度，需落在窗口內
  endTime      String
  kind         TutoringBookingKind   @default(REGULAR)
  status       TutoringBookingStatus @default(BOOKED)
  makeupForId  String?  @unique
  makeupFor    TutoringBooking? @relation("MakeupFor", fields: [makeupForId], references: [id])
  makeupChild  TutoringBooking? @relation("MakeupFor")
  createdAt    DateTime @default(now())
  attendance   TutoringAttendance?
}

model TutoringAttendance {
  id           String   @id @default(cuid())
  bookingId    String   @unique
  booking      TutoringBooking @relation(fields: [bookingId], references: [id])
  status       AttendanceStatus
  checkInTime  String?
  checkOutTime String?
  markedById   String
  markedBy     User     @relation(fields: [markedById], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

- [ ] **Step 3: Add reverse relations**

In `model Student` (around line 106-125), add after `activityAttendances ActivityAttendance[]`:

```prisma
  tutoringEnrollments TutoringEnrollment[]
```

In `model Teacher` (around line 90-104), add after `pointTransactions PointTransaction[]`:

```prisma
  tutoringWindows TutoringWindow[]
```

In `model User` (around line 75-88), add after `markedActivityAttendances ActivityAttendance[]`:

```prisma
  markedTutoringAttendances TutoringAttendance[]
```

- [ ] **Step 4: Push schema to the local test DB and generate the client**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx prisma db push --accept-data-loss && npx prisma generate
```
Expected: `Your database is now in sync with your Prisma schema.` and `✔ Generated Prisma Client`.

- [ ] **Step 5: Write the production SQL file**

Create `docs/superpowers/2026-08-07-tutoring-module-production.sql`:

```sql
-- 個別輔導模組（英文／數學彈性預約）正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：新增 2 個 enum、6 張表，無現有資料異動。
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

DO $$ BEGIN
  CREATE TYPE "TutoringBookingKind" AS ENUM ('REGULAR', 'MAKEUP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TutoringBookingStatus" AS ENUM ('PENDING_ADMIN', 'BOOKED', 'CANCELLED_LATE', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "TutoringProgram" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "defaultMonthlyQuota" INTEGER NOT NULL DEFAULT 8,
  "defaultDurationMinutes" INTEGER NOT NULL DEFAULT 120,
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "TutoringWindow" (
  "id" TEXT PRIMARY KEY,
  "programId" TEXT NOT NULL REFERENCES "TutoringProgram"("id"),
  "weekday" INTEGER NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  "teacherId" TEXT NOT NULL REFERENCES "Teacher"("id"),
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "TutoringWindowClosure" (
  "id" TEXT PRIMARY KEY,
  "windowId" TEXT NOT NULL REFERENCES "TutoringWindow"("id") ON DELETE CASCADE,
  "date" TIMESTAMP(3) NOT NULL,
  UNIQUE ("windowId", "date")
);

CREATE TABLE IF NOT EXISTS "TutoringEnrollment" (
  "id" TEXT PRIMARY KEY,
  "programId" TEXT NOT NULL REFERENCES "TutoringProgram"("id"),
  "studentId" TEXT NOT NULL REFERENCES "Student"("id"),
  "monthlyQuota" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastQuotaReminderMonth" TEXT,
  UNIQUE ("programId", "studentId")
);

CREATE TABLE IF NOT EXISTS "TutoringBooking" (
  "id" TEXT PRIMARY KEY,
  "enrollmentId" TEXT NOT NULL REFERENCES "TutoringEnrollment"("id"),
  "windowId" TEXT NOT NULL REFERENCES "TutoringWindow"("id"),
  "date" TIMESTAMP(3) NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "kind" "TutoringBookingKind" NOT NULL DEFAULT 'REGULAR',
  "status" "TutoringBookingStatus" NOT NULL DEFAULT 'BOOKED',
  "makeupForId" TEXT UNIQUE REFERENCES "TutoringBooking"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "TutoringAttendance" (
  "id" TEXT PRIMARY KEY,
  "bookingId" TEXT NOT NULL UNIQUE REFERENCES "TutoringBooking"("id"),
  "status" "AttendanceStatus" NOT NULL,
  "checkInTime" TEXT,
  "checkOutTime" TEXT,
  "markedById" TEXT NOT NULL REFERENCES "User"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
```

- [ ] **Step 6: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add prisma/schema.prisma docs/superpowers/2026-08-07-tutoring-module-production.sql && git commit -m "feat: 個別輔導模組資料模型（TutoringProgram/Window/Booking/Attendance）"
```

---

### Task 2: `tutoringProgramService.ts` — catalog and roster CRUD

**Files:**
- Create: `src/lib/services/tutoringProgramService.ts`
- Test: `src/lib/services/tutoringProgramService.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `getMonthlyQuotaStatus` from `./tutoringBookingService` (Task 6 — this task's `listEnrollments`/`listEnrollmentsForStudent` call it; write a temporary stub in this task if Task 6 hasn't run yet is NOT needed since this plan executes tasks in order and Task 6 comes later — **execute Task 3-6 (tutoringBookingService.ts) before finishing this task's `listEnrollments`/`listEnrollmentsForStudent` functions**, or write them now referencing the function signature below and let the import resolve once Task 6 lands. To keep each task independently testable in order, this task defers `listEnrollments`/`listEnrollmentsForStudent` to Task 6's file instead — see Task 6 Step 4.
- Produces: `createProgram`, `listPrograms`, `updateProgram`, `deleteProgram`, `createWindow`, `updateWindow`, `deleteWindow`, `addWindowClosure`, `deleteWindowClosure`, `createEnrollment`, `updateEnrollment`, `deleteEnrollment` — all exported from `tutoringProgramService.ts`. Later tasks (7: admin API routes) call these by these exact names.

- [ ] **Step 1: Write the failing test for program CRUD**

Create `src/lib/services/tutoringProgramService.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import {
  createProgram,
  listPrograms,
  updateProgram,
  deleteProgram,
  createWindow,
  updateWindow,
  deleteWindow,
  addWindowClosure,
  deleteWindowClosure,
} from './tutoringProgramService';

describe('program CRUD', () => {
  it('creates a program with defaults and lists it back with an empty windows array', async () => {
    const program = await createProgram({ name: '英文個別輔導' });
    expect(program.defaultMonthlyQuota).toBe(8);
    expect(program.defaultDurationMinutes).toBe(120);
    expect(program.active).toBe(true);

    const programs = await listPrograms();
    expect(programs).toHaveLength(1);
    expect(programs[0].windows).toEqual([]);
  });

  it('updates and soft-deactivates a program', async () => {
    const program = await createProgram({ name: '數學個別輔導', defaultMonthlyQuota: 6 });
    const updated = await updateProgram(program.id, { defaultMonthlyQuota: 10, active: false });
    expect(updated.defaultMonthlyQuota).toBe(10);
    expect(updated.active).toBe(false);
  });

  it('hard-deletes a program', async () => {
    const program = await createProgram({ name: '暫時課程' });
    await deleteProgram(program.id);
    expect(await prisma.tutoringProgram.findUnique({ where: { id: program.id } })).toBeNull();
  });
});

describe('window CRUD', () => {
  it('creates a window under a program and lists it nested', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });

    await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });

    const programs = await listPrograms();
    expect(programs[0].windows).toHaveLength(1);
    expect(programs[0].windows[0]).toMatchObject({ weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8 });
  });

  it('updates a window capacity and deletes it', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });

    const updated = await updateWindow(window.id, { capacity: 10 });
    expect(updated.capacity).toBe(10);

    await deleteWindow(window.id);
    expect(await prisma.tutoringWindow.findUnique({ where: { id: window.id } })).toBeNull();
  });

  it('adds and removes a window closure', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });

    const closure = await addWindowClosure(window.id, new Date('2026-10-09'));
    expect(await prisma.tutoringWindowClosure.count({ where: { windowId: window.id } })).toBe(1);

    await deleteWindowClosure(closure.id);
    expect(await prisma.tutoringWindowClosure.count({ where: { windowId: window.id } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm run test:dbpush && npx vitest run src/lib/services/tutoringProgramService.test.ts
```
Expected: FAIL — `Cannot find module './tutoringProgramService'`.

- [ ] **Step 3: Implement `tutoringProgramService.ts` (program, window, closure CRUD only — enrollment CRUD is Step 4)**

Create `src/lib/services/tutoringProgramService.ts`:

```ts
import { prisma } from '@/lib/db';

export interface CreateProgramInput {
  name: string;
  defaultMonthlyQuota?: number;
  defaultDurationMinutes?: number;
}

export function createProgram(input: CreateProgramInput) {
  return prisma.tutoringProgram.create({
    data: {
      name: input.name,
      defaultMonthlyQuota: input.defaultMonthlyQuota ?? 8,
      defaultDurationMinutes: input.defaultDurationMinutes ?? 120,
    },
  });
}

export function listPrograms() {
  return prisma.tutoringProgram.findMany({
    include: { windows: { include: { teacher: { select: { user: { select: { name: true } } } }, closures: true } } },
    orderBy: { name: 'asc' },
  });
}

export interface UpdateProgramInput {
  name?: string;
  defaultMonthlyQuota?: number;
  defaultDurationMinutes?: number;
  active?: boolean;
}

export function updateProgram(id: string, input: UpdateProgramInput) {
  return prisma.tutoringProgram.update({ where: { id }, data: input });
}

export function deleteProgram(id: string) {
  return prisma.tutoringProgram.delete({ where: { id } });
}

export interface CreateWindowInput {
  programId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  teacherId: string;
}

export function createWindow(input: CreateWindowInput) {
  return prisma.tutoringWindow.create({ data: input });
}

export interface UpdateWindowInput {
  weekday?: number;
  startTime?: string;
  endTime?: string;
  capacity?: number;
  teacherId?: string;
  active?: boolean;
}

export function updateWindow(id: string, input: UpdateWindowInput) {
  return prisma.tutoringWindow.update({ where: { id }, data: input });
}

export function deleteWindow(id: string) {
  return prisma.tutoringWindow.delete({ where: { id } });
}

export function addWindowClosure(windowId: string, date: Date) {
  return prisma.tutoringWindowClosure.create({ data: { windowId, date } });
}

export function deleteWindowClosure(id: string) {
  return prisma.tutoringWindowClosure.delete({ where: { id } });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringProgramService.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/tutoringProgramService.ts src/lib/services/tutoringProgramService.test.ts && git commit -m "feat: 個別輔導課程／窗口／停開 CRUD 服務"
```

---

### Task 3: `tutoringBookingService.ts` — capacity math (pure functions)

**Files:**
- Create: `src/lib/services/tutoringBookingService.ts`
- Test: `src/lib/services/tutoringBookingService.test.ts`

**Interfaces:**
- Produces: `SLOT_MINUTES`, `toMinutes(hhmm: string): number`, `minutesToHHMM(total: number): string`, `utcDateKey(date: Date): string`, `taipeiDateKey(date: Date): string`, `countOverlapsInSlot(slotStart: number, slotEnd: number, ranges: {startTime:string;endTime:string}[]): number`, `buildSlotRemaining(windowStartTime: string, windowEndTime: string, capacity: number, existingRanges: {startTime:string;endTime:string}[]): {startTime:string; remaining:number}[]`, `hasCapacityForRange(windowStartTime: string, windowEndTime: string, capacity: number, existingRanges: {startTime:string;endTime:string}[], candidate: {startTime:string;endTime:string}): boolean`, `isCancellationLate(bookingDateUtcKey: string, nowTaipeiKey: string): boolean`. Tasks 4-6 add more exports to this same file; all later tasks that check capacity call `hasCapacityForRange` by this exact name and signature.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/services/tutoringBookingService.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  toMinutes,
  minutesToHHMM,
  utcDateKey,
  taipeiDateKey,
  countOverlapsInSlot,
  buildSlotRemaining,
  hasCapacityForRange,
  isCancellationLate,
} from './tutoringBookingService';

describe('toMinutes / minutesToHHMM', () => {
  it('round-trips', () => {
    expect(toMinutes('16:00')).toBe(960);
    expect(toMinutes('21:30')).toBe(1290);
    expect(minutesToHHMM(960)).toBe('16:00');
    expect(minutesToHHMM(1290)).toBe('21:30');
  });
});

describe('utcDateKey / taipeiDateKey', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(utcDateKey(new Date('2026-08-07T00:00:00.000Z'))).toBe('2026-08-07');
  });
});

describe('countOverlapsInSlot', () => {
  it('counts ranges whose interval overlaps the slot, excluding head-to-tail touches', () => {
    const ranges = [
      { startTime: '16:00', endTime: '18:00' },
      { startTime: '18:00', endTime: '20:00' }, // touches the first range's end, not an overlap
    ];
    expect(countOverlapsInSlot(toMinutes('16:00'), toMinutes('16:30'), ranges)).toBe(1);
    expect(countOverlapsInSlot(toMinutes('17:30'), toMinutes('18:00'), ranges)).toBe(1);
    expect(countOverlapsInSlot(toMinutes('18:00'), toMinutes('18:30'), ranges)).toBe(1);
  });
});

describe('buildSlotRemaining', () => {
  it('returns one entry per 30-minute slot with remaining = capacity - overlap count', () => {
    const slots = buildSlotRemaining('16:00', '17:00', 8, [{ startTime: '16:00', endTime: '16:30' }]);
    expect(slots).toEqual([
      { startTime: '16:00', remaining: 7 },
      { startTime: '16:30', remaining: 8 },
    ]);
  });

  it('never goes below zero when already over capacity', () => {
    const existing = Array.from({ length: 9 }, () => ({ startTime: '16:00', endTime: '16:30' }));
    const slots = buildSlotRemaining('16:00', '16:30', 8, existing);
    expect(slots[0].remaining).toBe(0);
  });
});

describe('hasCapacityForRange', () => {
  it('allows a candidate when every covered slot is under capacity', () => {
    const existing = [{ startTime: '16:00', endTime: '18:00' }];
    expect(hasCapacityForRange('16:00', '21:00', 2, existing, { startTime: '16:00', endTime: '18:00' })).toBe(true);
  });

  it('rejects when any covered slot would reach capacity', () => {
    const existing = [{ startTime: '16:00', endTime: '18:00' }];
    expect(hasCapacityForRange('16:00', '21:00', 1, existing, { startTime: '17:00', endTime: '19:00' })).toBe(false);
  });

  it('allows a candidate that starts exactly when an existing one ends (no overlap at the boundary)', () => {
    const existing = [{ startTime: '16:00', endTime: '18:00' }];
    expect(hasCapacityForRange('16:00', '21:00', 1, existing, { startTime: '18:00', endTime: '20:00' })).toBe(true);
  });
});

describe('isCancellationLate', () => {
  it('is not late when today is before the booking date', () => {
    expect(isCancellationLate('2026-08-15', '2026-08-14')).toBe(false);
  });

  it('is late on the booking date itself', () => {
    expect(isCancellationLate('2026-08-15', '2026-08-15')).toBe(true);
  });

  it('is late after the booking date has passed', () => {
    expect(isCancellationLate('2026-08-15', '2026-08-20')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: FAIL — `Cannot find module './tutoringBookingService'`.

- [ ] **Step 3: Implement the pure functions**

Create `src/lib/services/tutoringBookingService.ts`:

```ts
export const SLOT_MINUTES = 30;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHHMM(total: number): string {
  const h = Math.floor(total / 60).toString().padStart(2, '0');
  const m = (total % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const TAIPEI_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function taipeiDateKey(date: Date): string {
  return TAIPEI_DATE_FMT.format(date);
}

export function countOverlapsInSlot(slotStart: number, slotEnd: number, ranges: { startTime: string; endTime: string }[]): number {
  return ranges.filter((r) => toMinutes(r.startTime) < slotEnd && toMinutes(r.endTime) > slotStart).length;
}

export function buildSlotRemaining(
  windowStartTime: string,
  windowEndTime: string,
  capacity: number,
  existingRanges: { startTime: string; endTime: string }[]
): { startTime: string; remaining: number }[] {
  const start = toMinutes(windowStartTime);
  const end = toMinutes(windowEndTime);
  const slots: { startTime: string; remaining: number }[] = [];
  for (let t = start; t < end; t += SLOT_MINUTES) {
    const used = countOverlapsInSlot(t, t + SLOT_MINUTES, existingRanges);
    slots.push({ startTime: minutesToHHMM(t), remaining: Math.max(0, capacity - used) });
  }
  return slots;
}

export function hasCapacityForRange(
  windowStartTime: string,
  windowEndTime: string,
  capacity: number,
  existingRanges: { startTime: string; endTime: string }[],
  candidate: { startTime: string; endTime: string }
): boolean {
  const windowStart = toMinutes(windowStartTime);
  const windowEnd = toMinutes(windowEndTime);
  const candStart = toMinutes(candidate.startTime);
  const candEnd = toMinutes(candidate.endTime);
  for (let t = Math.max(windowStart, candStart); t < Math.min(windowEnd, candEnd); t += SLOT_MINUTES) {
    const used = countOverlapsInSlot(t, t + SLOT_MINUTES, existingRanges);
    if (used + 1 > capacity) return false;
  }
  return true;
}

// 前一天 23:59（台北）為分界：今天（台北）已到達或超過預約日期＝當天取消或更晚，視為 late。
export function isCancellationLate(bookingDateUtcKey: string, nowTaipeiKey: string): boolean {
  return nowTaipeiKey >= bookingDateUtcKey;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts && git commit -m "feat: 個別輔導容量重疊計算與取消分界純函式"
```

---

### Task 4: Booking create, cancel, admin-cancel, walk-in

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`
- Modify: `src/lib/services/tutoringBookingService.test.ts`

**Interfaces:**
- Consumes: `hasCapacityForRange`, `toMinutes`, `utcDateKey`, `taipeiDateKey`, `isCancellationLate` from Task 3 (same file); `prisma` from `@/lib/db`; `runSerializableWithRetry` from `@/lib/transaction`; `Prisma` from `@prisma/client`.
- Produces: `createBooking(input: CreateBookingInput): Promise<{id:string}>`, `createWalkInBooking(input: {enrollmentId:string; windowId:string; date:Date; startTime:string; endTime:string}): Promise<{id:string}>`, `cancelBooking(bookingId: string, studentId: string): Promise<void>`, `adminCancelBooking(bookingId: string, countsTowardQuota: boolean): Promise<void>`. Task 5 (makeup) calls `createBooking` with `kind: 'MAKEUP'`. Task 10 (API routes) calls all four by these exact names.

- [ ] **Step 1: Write the failing tests**

Add fixture helpers and tests to `src/lib/services/tutoringBookingService.test.ts` (append after the existing `describe` blocks, add these imports at the top alongside the existing ones):

```ts
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createProgram, createWindow } from './tutoringProgramService';
import { createBooking, createWalkInBooking, cancelBooking, adminCancelBooking } from './tutoringBookingService';
```

Then append:

```ts
async function setupProgramWithEnrollment(capacity = 8) {
  const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  return { teacher, student, program, window, enrollment };
}

// 2026-08-07 is a Friday (weekday 5), matching the fixture window above.
const FRIDAY = new Date('2026-08-07');

describe('createBooking', () => {
  it('creates a REGULAR booking as BOOKED', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('BOOKED');
    expect(row.kind).toBe('REGULAR');
  });

  it('rejects a time range outside the window', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '15:00', endTime: '17:00' })
    ).rejects.toThrow('OUT_OF_WINDOW');
  });

  it('rejects when the window is full for the requested time', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '17:00', endTime: '19:00' })
    ).rejects.toThrow('WINDOW_FULL');
  });

  it('rejects a booking on a closed date', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await prisma.tutoringWindowClosure.create({ data: { windowId: window.id, date: FRIDAY } });
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' })
    ).rejects.toThrow('WINDOW_CLOSED');
  });
});

describe('createWalkInBooking', () => {
  it('creates a BOOKED booking without checking capacity', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    const walkIn = await createWalkInBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    expect(await prisma.tutoringBooking.count({ where: { windowId: window.id, date: FRIDAY } })).toBe(2);
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: walkIn.id } })).status).toBe('BOOKED');
  });
});

describe('cancelBooking', () => {
  it('deletes the booking outright when cancelled before the day-before cutoff', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2)); // Friday, far in the future
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future, startTime: '16:00', endTime: '18:00' });
    await cancelBooking(booking.id, enrollment.studentId);
    expect(await prisma.tutoringBooking.findUnique({ where: { id: booking.id } })).toBeNull();
  });

  it('marks the booking CANCELLED_LATE when the date has already arrived', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07'); // a Friday well in the past
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await cancelBooking(booking.id, enrollment.studentId);
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.status).toBe('CANCELLED_LATE');
  });

  it('rejects cancellation by a student who does not own the booking', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future, startTime: '16:00', endTime: '18:00' });
    await expect(cancelBooking(booking.id, 'someone-else')).rejects.toThrow('NOT_OWNER');
  });
});

describe('adminCancelBooking', () => {
  it('deletes the booking when countsTowardQuota is false', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(booking.id, false);
    expect(await prisma.tutoringBooking.findUnique({ where: { id: booking.id } })).toBeNull();
  });

  it('marks CANCELLED_LATE when countsTowardQuota is true', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(booking.id, true);
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe('CANCELLED_LATE');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: FAIL — `createBooking` etc. are not exported yet.

- [ ] **Step 3: Implement the booking functions**

Append to `src/lib/services/tutoringBookingService.ts` (add these imports at the top of the file, alongside no existing imports since this file is new — put them at the very top before `export const SLOT_MINUTES`):

```ts
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
```

Then append at the end of the file:

```ts
export interface CreateBookingInput {
  enrollmentId: string;
  windowId: string;
  date: Date;
  startTime: string;
  endTime: string;
  kind?: 'REGULAR' | 'MAKEUP';
  makeupForId?: string;
}

export function createBooking(input: CreateBookingInput): Promise<{ id: string }> {
  return runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const window = await tx.tutoringWindow.findUniqueOrThrow({ where: { id: input.windowId } });
        if (toMinutes(input.endTime) <= toMinutes(input.startTime)) throw new Error('INVALID_RANGE');
        if (toMinutes(input.startTime) < toMinutes(window.startTime) || toMinutes(input.endTime) > toMinutes(window.endTime)) {
          throw new Error('OUT_OF_WINDOW');
        }
        if (input.date.getUTCDay() !== window.weekday) throw new Error('INVALID_WEEKDAY');

        const closure = await tx.tutoringWindowClosure.findUnique({
          where: { windowId_date: { windowId: input.windowId, date: input.date } },
        });
        if (closure) throw new Error('WINDOW_CLOSED');

        const existing = await tx.tutoringBooking.findMany({
          where: { windowId: input.windowId, date: input.date, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
          select: { startTime: true, endTime: true },
        });
        if (!hasCapacityForRange(window.startTime, window.endTime, window.capacity, existing, input)) {
          throw new Error('WINDOW_FULL');
        }

        return tx.tutoringBooking.create({
          data: {
            enrollmentId: input.enrollmentId,
            windowId: input.windowId,
            date: input.date,
            startTime: input.startTime,
            endTime: input.endTime,
            kind: input.kind ?? 'REGULAR',
            status: input.kind === 'MAKEUP' ? 'PENDING_ADMIN' : 'BOOKED',
            makeupForId: input.makeupForId,
          },
          select: { id: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

// 老師／行政現場補加：教室現場人數由老師目視判斷，系統不做容量檢查。
export function createWalkInBooking(input: {
  enrollmentId: string;
  windowId: string;
  date: Date;
  startTime: string;
  endTime: string;
}): Promise<{ id: string }> {
  return prisma.tutoringBooking.create({
    data: { ...input, kind: 'REGULAR', status: 'BOOKED' },
    select: { id: true },
  });
}

export async function cancelBooking(bookingId: string, studentId: string): Promise<void> {
  const booking = await prisma.tutoringBooking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { enrollment: { select: { studentId: true } } },
  });
  if (booking.enrollment.studentId !== studentId) throw new Error('NOT_OWNER');

  const late = isCancellationLate(utcDateKey(booking.date), taipeiDateKey(new Date()));
  if (!late) {
    await prisma.tutoringBooking.delete({ where: { id: bookingId } });
    return;
  }
  await prisma.tutoringBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED_LATE' } });
}

// 行政取消：可選是否計次，處理特殊個案（例如場地臨時取消，不該算學生的堂數）。
export async function adminCancelBooking(bookingId: string, countsTowardQuota: boolean): Promise<void> {
  if (!countsTowardQuota) {
    await prisma.tutoringBooking.delete({ where: { id: bookingId } });
    return;
  }
  await prisma.tutoringBooking.update({ where: { id: bookingId }, data: { status: 'CANCELLED_LATE' } });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: PASS, 20 tests (11 from Task 3 + 9 new).

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts && git commit -m "feat: 個別輔導預約建立／取消／行政取消／現場補加"
```

---

### Task 5: Makeup request and decision

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`
- Modify: `src/lib/services/tutoringBookingService.test.ts`

**Interfaces:**
- Consumes: `createBooking` from Task 4 (same file); `prisma` from `@/lib/db`.
- Produces: `requestMakeup(input: {originalBookingId:string; windowId:string; date:Date; startTime:string; endTime:string}): Promise<{id:string}>`, `decideMakeup(bookingId: string, decision: 'APPROVED'|'REJECTED'): Promise<void>`. Task 11 (admin makeup-queue API route) calls both by these exact names.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `src/lib/services/tutoringBookingService.test.ts`:

```ts
import { requestMakeup, decideMakeup } from './tutoringBookingService';
```

Append:

```ts
describe('requestMakeup / decideMakeup', () => {
  it('rejects a makeup request for a booking that was not missed', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    await expect(
      requestMakeup({ originalBookingId: booking.id, windowId: window.id, date: FRIDAY, startTime: '18:00', endTime: '20:00' })
    ).rejects.toThrow('NOT_ELIGIBLE');
  });

  it('creates a PENDING_ADMIN MAKEUP booking for a late-cancelled original, and approving it flips status without re-checking capacity', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(1);
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(original.id, true); // CANCELLED_LATE

    const makeup = await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    let row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: makeup.id } });
    expect(row.kind).toBe('MAKEUP');
    expect(row.status).toBe('PENDING_ADMIN');
    expect(row.makeupForId).toBe(original.id);

    // capacity is 1 and already reserved by the PENDING_ADMIN makeup — a second regular booking for the same slot must fail
    await expect(
      createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' })
    ).rejects.toThrow('WINDOW_FULL');

    await decideMakeup(makeup.id, 'APPROVED');
    row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: makeup.id } });
    expect(row.status).toBe('BOOKED');
  });

  it('rejects a second makeup request for the same original booking', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(original.id, true);
    await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });

    await expect(
      requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '18:00', endTime: '20:00' })
    ).rejects.toThrow('ALREADY_REQUESTED');
  });

  it('sets status to REJECTED when the admin rejects', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(original.id, true);
    const makeup = await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });

    await decideMakeup(makeup.id, 'REJECTED');
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: makeup.id } })).status).toBe('REJECTED');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: FAIL — `requestMakeup`/`decideMakeup` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/services/tutoringBookingService.ts`:

```ts
export async function requestMakeup(input: {
  originalBookingId: string;
  windowId: string;
  date: Date;
  startTime: string;
  endTime: string;
}): Promise<{ id: string }> {
  const original = await prisma.tutoringBooking.findUniqueOrThrow({
    where: { id: input.originalBookingId },
    include: { attendance: true, makeupChild: true },
  });
  if (original.kind !== 'REGULAR') throw new Error('NOT_ELIGIBLE');
  if (original.makeupChild) throw new Error('ALREADY_REQUESTED');
  const missed = original.status === 'CANCELLED_LATE' || original.attendance?.status === 'ABSENT';
  if (!missed) throw new Error('NOT_ELIGIBLE');

  return createBooking({
    enrollmentId: original.enrollmentId,
    windowId: input.windowId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    kind: 'MAKEUP',
    makeupForId: original.id,
  });
}

// 容量在 PENDING_ADMIN 建立時已檢查並佔位（createBooking 把 PENDING_ADMIN 一併算進容量），
// 核准時不必再查一次容量。
export async function decideMakeup(bookingId: string, decision: 'APPROVED' | 'REJECTED'): Promise<void> {
  await prisma.tutoringBooking.update({
    where: { id: bookingId },
    data: { status: decision === 'APPROVED' ? 'BOOKED' : 'REJECTED' },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts && git commit -m "feat: 個別輔導補課申請與核准／駁回"
```

---

### Task 6: Monthly quota, availability, listings, and the cron reminder

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`
- Modify: `src/lib/services/tutoringBookingService.test.ts`
- Modify: `src/lib/services/tutoringProgramService.ts` (adds the enrollment-CRUD functions deferred from Task 2)
- Modify: `src/lib/services/tutoringProgramService.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3-5 (same file); `pushLineMessage` from `./lineService`; `createEnrollment`/etc. need `getMonthlyQuotaStatus` from this task.
- Produces (in `tutoringBookingService.ts`): `getMonthlyQuotaStatus(enrollmentId: string, monthKey: string): Promise<{locked:number; upcoming:number; quota:number}>`, `listAvailability(enrollmentId: string, days?: number): Promise<AvailabilityDay[]>`, `listBookingsForStudent(studentId: string): Promise<StudentBookingRow[]>`, `listBookingsOverview(date: Date): Promise<OverviewBookingRow[]>`, `listPendingTutoringMakeupRequests(): Promise<PendingMakeupRow[]>`, `sendMonthlyQuotaReminders(): Promise<{notified:number}>`.
- Produces (in `tutoringProgramService.ts`): `createEnrollment`, `listEnrollments(studentId?: string)`, `updateEnrollment`, `deleteEnrollment`. Task 9 (admin enrollment routes) and Task 10 (student `/me` route) call these.

- [ ] **Step 1: Write the failing tests for `getMonthlyQuotaStatus`, `listAvailability`, `listBookingsForStudent`**

Add to the imports at the top of `src/lib/services/tutoringBookingService.test.ts`:

```ts
import { getMonthlyQuotaStatus, listAvailability, listBookingsForStudent, listBookingsOverview, listPendingTutoringMakeupRequests, sendMonthlyQuotaReminders } from './tutoringBookingService';
```

Append:

```ts
describe('getMonthlyQuotaStatus', () => {
  it('counts a past-dated REGULAR booking as locked regardless of status, and excludes MAKEUP bookings', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07'); // locked (date has passed)
    const attended = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14'), startTime: '16:00', endTime: '18:00' });
    await requestMakeup({ originalBookingId: attended.id, windowId: window.id, date: new Date('2020-08-21'), startTime: '16:00', endTime: '18:00' });

    const status = await getMonthlyQuotaStatus(enrollment.id, '2020-08');
    expect(status.locked).toBe(2); // the two REGULAR bookings, MAKEUP excluded
    expect(status.quota).toBe(8);
  });

  it('counts a future BOOKED REGULAR booking as upcoming, not locked', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future, startTime: '16:00', endTime: '18:00' });

    const status = await getMonthlyQuotaStatus(enrollment.id, '2099-01');
    expect(status.locked).toBe(0);
    expect(status.upcoming).toBe(1);
  });

  it('uses the enrollment override when set, otherwise the program default', async () => {
    const { enrollment } = await setupProgramWithEnrollment();
    await prisma.tutoringEnrollment.update({ where: { id: enrollment.id }, data: { monthlyQuota: 11 } });
    const status = await getMonthlyQuotaStatus(enrollment.id, '2026-08');
    expect(status.quota).toBe(11);
  });
});

describe('listAvailability', () => {
  it('lists remaining capacity for the matching weekday within the horizon, skipping closed dates', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(8);
    const days = await listAvailability(enrollment.id, 14);
    const fridays = days.filter((d) => d.windowId === window.id);
    expect(fridays.length).toBeGreaterThan(0);
    expect(fridays[0].slots[0]).toEqual({ startTime: '16:00', remaining: 8 });

    await prisma.tutoringWindowClosure.create({ data: { windowId: window.id, date: new Date(fridays[0].date) } });
    const daysAfterClosure = await listAvailability(enrollment.id, 14);
    expect(daysAfterClosure.filter((d) => d.windowId === window.id).length).toBe(fridays.length - 1);
  });
});

describe('listBookingsForStudent', () => {
  it('flags canCancelFree for a future booking and canRequestMakeup for a late-cancelled one', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const future = new Date(Date.UTC(2099, 0, 2));
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: future, startTime: '16:00', endTime: '18:00' });
    const past = new Date('2020-08-07');
    const missed = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(missed.id, true);

    const rows = await listBookingsForStudent(enrollment.studentId);
    expect(rows).toHaveLength(2);
    const futureRow = rows.find((r) => r.status === 'BOOKED')!;
    expect(futureRow.canCancelFree).toBe(true);
    const missedRow = rows.find((r) => r.status === 'CANCELLED_LATE')!;
    expect(missedRow.canRequestMakeup).toBe(true);
  });
});

describe('listBookingsOverview and listPendingTutoringMakeupRequests', () => {
  it('lists all bookings for a date with student and program names', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    const rows = await listBookingsOverview(FRIDAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].studentName).toBe('小明');
    expect(rows[0].programName).toBe('英文個別輔導');
  });

  it('lists pending makeup requests with the original booking date', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = new Date('2020-08-07');
    const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: past, startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(original.id, true);
    await requestMakeup({ originalBookingId: original.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });

    const rows = await listPendingTutoringMakeupRequests();
    expect(rows).toHaveLength(1);
    expect(rows[0].originalDate.toISOString().slice(0, 10)).toBe('2020-08-07');
  });
});

describe('sendMonthlyQuotaReminders', () => {
  it('notifies an under-quota enrollment with a lineUserId once, then skips it on a second run', async () => {
    const { student, program } = await setupProgramWithEnrollment();
    await prisma.student.update({ where: { id: student.id }, data: { lineUserId: 'line-1' } });

    const first = await sendMonthlyQuotaReminders();
    expect(first.notified).toBe(1);

    const second = await sendMonthlyQuotaReminders();
    expect(second.notified).toBe(0);
  });

  it('skips enrollments without a lineUserId', async () => {
    await setupProgramWithEnrollment();
    const result = await sendMonthlyQuotaReminders();
    expect(result.notified).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: FAIL — new functions not exported.

- [ ] **Step 3: Implement**

Add this import to the top of `src/lib/services/tutoringBookingService.ts` (alongside the existing ones):

```ts
import { pushLineMessage } from './lineService';
```

Append to `src/lib/services/tutoringBookingService.ts`:

```ts
export async function getMonthlyQuotaStatus(
  enrollmentId: string,
  monthKey: string // 'YYYY-MM'
): Promise<{ locked: number; upcoming: number; quota: number }> {
  const enrollment = await prisma.tutoringEnrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    include: { program: { select: { defaultMonthlyQuota: true } } },
  });
  const quota = enrollment.monthlyQuota ?? enrollment.program.defaultMonthlyQuota;
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const todayKey = taipeiDateKey(new Date());

  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollmentId, kind: 'REGULAR', date: { gte: monthStart, lte: monthEnd } },
    select: { date: true, status: true },
  });

  let locked = 0;
  let upcoming = 0;
  for (const b of bookings) {
    const key = utcDateKey(b.date);
    if (key <= todayKey) locked++;
    else if (b.status === 'BOOKED') upcoming++;
  }
  return { locked, upcoming, quota };
}

export interface AvailabilityDay {
  date: string;
  windowId: string;
  windowStartTime: string;
  windowEndTime: string;
  capacity: number;
  slots: { startTime: string; remaining: number }[];
}

export async function listAvailability(enrollmentId: string, days = 14): Promise<AvailabilityDay[]> {
  const enrollment = await prisma.tutoringEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
  const windows = await prisma.tutoringWindow.findMany({ where: { programId: enrollment.programId, active: true } });
  const todayKey = taipeiDateKey(new Date());
  const [ty, tm, td] = todayKey.split('-').map(Number);

  const result: AvailabilityDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(ty, tm - 1, td + i));
    const window = windows.find((w) => w.weekday === d.getUTCDay());
    if (!window) continue;

    const closure = await prisma.tutoringWindowClosure.findUnique({
      where: { windowId_date: { windowId: window.id, date: d } },
    });
    if (closure) continue;

    const existing = await prisma.tutoringBooking.findMany({
      where: { windowId: window.id, date: d, status: { in: ['BOOKED', 'PENDING_ADMIN'] } },
      select: { startTime: true, endTime: true },
    });
    result.push({
      date: utcDateKey(d),
      windowId: window.id,
      windowStartTime: window.startTime,
      windowEndTime: window.endTime,
      capacity: window.capacity,
      slots: buildSlotRemaining(window.startTime, window.endTime, window.capacity, existing),
    });
  }
  return result;
}

export interface StudentBookingRow {
  id: string;
  programName: string;
  date: Date;
  startTime: string;
  endTime: string;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED_LATE' | 'REJECTED';
  canCancelFree: boolean;
  canRequestMakeup: boolean;
}

export async function listBookingsForStudent(studentId: string): Promise<StudentBookingRow[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollment: { studentId } },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      kind: true,
      status: true,
      window: { select: { program: { select: { name: true } } } },
      attendance: { select: { status: true } },
      makeupChild: { select: { id: true } },
    },
    orderBy: { date: 'desc' },
  });
  const todayKey = taipeiDateKey(new Date());
  return bookings.map((b) => {
    const dateKey = utcDateKey(b.date);
    const missed = b.status === 'CANCELLED_LATE' || b.attendance?.status === 'ABSENT';
    return {
      id: b.id,
      programName: b.window.program.name,
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      kind: b.kind as 'REGULAR' | 'MAKEUP',
      status: b.status as StudentBookingRow['status'],
      canCancelFree: b.status === 'BOOKED' && dateKey > todayKey,
      canRequestMakeup: b.kind === 'REGULAR' && missed && !b.makeupChild,
    };
  });
}

export interface OverviewBookingRow {
  id: string;
  studentName: string;
  programName: string;
  windowId: string;
  date: Date;
  startTime: string;
  endTime: string;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED_LATE' | 'REJECTED';
}

export async function listBookingsOverview(date: Date): Promise<OverviewBookingRow[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { date },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      kind: true,
      status: true,
      date: true,
      windowId: true,
      enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
    },
    orderBy: { startTime: 'asc' },
  });
  return bookings.map((b) => ({
    id: b.id,
    studentName: b.enrollment.student.user.name,
    programName: b.window.program.name,
    windowId: b.windowId,
    date: b.date,
    startTime: b.startTime,
    endTime: b.endTime,
    kind: b.kind as 'REGULAR' | 'MAKEUP',
    status: b.status as OverviewBookingRow['status'],
  }));
}

export interface PendingMakeupRow {
  id: string;
  studentName: string;
  programName: string;
  originalDate: Date;
  date: Date;
  startTime: string;
  endTime: string;
}

export async function listPendingTutoringMakeupRequests(): Promise<PendingMakeupRow[]> {
  const rows = await prisma.tutoringBooking.findMany({
    where: { kind: 'MAKEUP', status: 'PENDING_ADMIN' },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      enrollment: { select: { student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
      makeupFor: { select: { date: true } },
    },
    orderBy: { date: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    studentName: r.enrollment.student.user.name,
    programName: r.window.program.name,
    originalDate: r.makeupFor!.date,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
  }));
}

// 每月 20 號由 Vercel Cron 觸發（見 Task 18）；本函式本身不檢查日期，
// 靠 lastQuotaReminderMonth 保證同一學生同一月只提醒一次，可安全重複呼叫。
export async function sendMonthlyQuotaReminders(): Promise<{ notified: number }> {
  const monthKey = taipeiDateKey(new Date()).slice(0, 7);
  const enrollments = await prisma.tutoringEnrollment.findMany({
    where: { active: true, lastQuotaReminderMonth: { not: monthKey } },
    include: {
      program: { select: { name: true } },
      student: { select: { id: true, lineUserId: true, user: { select: { name: true } } } },
    },
  });

  let notified = 0;
  for (const e of enrollments) {
    if (!e.student.lineUserId) continue;
    const { locked, upcoming, quota } = await getMonthlyQuotaStatus(e.id, monthKey);
    if (locked + upcoming >= quota) continue;
    await pushLineMessage(
      e.student.lineUserId,
      `【MUP】${e.student.user.name} 本月「${e.program.name}」還剩 ${quota - locked - upcoming} 堂未預約，記得安排上課時間`
    );
    await prisma.tutoringEnrollment.update({ where: { id: e.id }, data: { lastQuotaReminderMonth: monthKey } });
    notified++;
  }
  return { notified };
}
```

- [ ] **Step 4: Add the deferred enrollment CRUD to `tutoringProgramService.ts`**

Add this import to the top of `src/lib/services/tutoringProgramService.ts`:

```ts
import { getMonthlyQuotaStatus } from './tutoringBookingService';
```

Append to `src/lib/services/tutoringProgramService.ts`:

```ts
export interface CreateEnrollmentInput {
  studentId: string;
  programId: string;
  monthlyQuota?: number;
}

export function createEnrollment(input: CreateEnrollmentInput) {
  return prisma.tutoringEnrollment.create({ data: input });
}

export interface EnrollmentSummary {
  id: string;
  studentId: string;
  studentName: string;
  programId: string;
  programName: string;
  defaultDurationMinutes: number;
  monthlyQuota: number;
  active: boolean;
  locked: number;
  upcoming: number;
}

export async function listEnrollments(studentId?: string): Promise<EnrollmentSummary[]> {
  const enrollments = await prisma.tutoringEnrollment.findMany({
    where: studentId ? { studentId } : {},
    include: {
      student: { select: { user: { select: { name: true } } } },
      program: { select: { name: true, defaultDurationMinutes: true } },
    },
    orderBy: { student: { user: { name: 'asc' } } },
  });
  const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);
  return Promise.all(
    enrollments.map(async (e) => {
      const { locked, upcoming, quota } = await getMonthlyQuotaStatus(e.id, monthKey);
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
      };
    })
  );
}

export interface UpdateEnrollmentInput {
  monthlyQuota?: number | null;
  active?: boolean;
}

export function updateEnrollment(id: string, input: UpdateEnrollmentInput) {
  return prisma.tutoringEnrollment.update({ where: { id }, data: input });
}

export function deleteEnrollment(id: string) {
  return prisma.tutoringEnrollment.delete({ where: { id } });
}
```

- [ ] **Step 5: Write and run the enrollment CRUD test**

Append to `src/lib/services/tutoringProgramService.test.ts` (add `createStudent` to the existing `createTeacher` import line, and add a new import line):

```ts
import { createStudent } from './studentService';
import { createEnrollment, listEnrollments, updateEnrollment, deleteEnrollment } from './tutoringProgramService';
```

```ts
describe('enrollment CRUD', () => {
  it('creates an enrollment and lists it with the program default quota', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const program = await createProgram({ name: '英文個別輔導', defaultMonthlyQuota: 8 });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });

    const list = await listEnrollments();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ studentName: '小明', programName: '英文個別輔導', monthlyQuota: 8, locked: 0, upcoming: 0 });

    const filtered = await listEnrollments(student.id);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(enrollment.id);
  });

  it('overrides monthlyQuota and deactivates, then deletes', async () => {
    const student = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    const program = await createProgram({ name: '數學個別輔導' });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });

    const updated = await updateEnrollment(enrollment.id, { monthlyQuota: 11, active: false });
    expect(updated.monthlyQuota).toBe(11);
    expect(updated.active).toBe(false);

    await deleteEnrollment(enrollment.id);
    expect(await prisma.tutoringEnrollment.findUnique({ where: { id: enrollment.id } })).toBeNull();
  });
});
```

Run:

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts src/lib/services/tutoringProgramService.test.ts
```
Expected: PASS, all tests (Task 6 adds 10 to `tutoringBookingService.test.ts` and 2 to `tutoringProgramService.test.ts`).

- [ ] **Step 6: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts src/lib/services/tutoringProgramService.ts src/lib/services/tutoringProgramService.test.ts && git commit -m "feat: 個別輔導月額度計算、可預約清單、總覽查詢與月中提醒"
```

---

### Task 7: Attendance integration — roster/save/clear + point-name wiring

**Files:**
- Modify: `src/lib/services/attendanceService.ts`
- Modify: `src/lib/services/attendanceService.test.ts`

**Interfaces:**
- Consumes: `getMonthlyQuotaStatus`, `taipeiDateKey` from `./tutoringBookingService`; existing `AttendanceStatusValue`, `SaveAttendanceRecordInput`-style shape (this task defines a parallel `SaveTutoringAttendanceInput` since tutoring keys by `bookingId`, not `studentId`).
- Produces: `getTutoringRoster(windowId: string, date: Date): Promise<TutoringRosterEntry[]>`, `saveTutoringAttendance(markedById: string, records: SaveTutoringAttendanceInput[]): Promise<void>`, `clearTutoringAttendance(bookingIds: string[]): Promise<void>`. Extends `AttendanceSessionType` with `'TUTORING'`. Task 11 (attendance API route) and Task 14 (`AttendanceHub.tsx`) consume these.

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `src/lib/services/attendanceService.test.ts`:

```ts
import { createProgram, createWindow } from './tutoringProgramService';
import { createBooking } from './tutoringBookingService';
import { getTutoringRoster, saveTutoringAttendance, clearTutoringAttendance } from './attendanceService';
```

(the existing `import { ... } from './attendanceService'` line already on line 9 should have `getTutoringRoster, saveTutoringAttendance, clearTutoringAttendance` added to its list instead of a second import line — same for `listAttendanceSessionsForDate` and `listMyAttendance`, already imported there.)

Append these `describe` blocks:

```ts
async function setupTutoringBooking() {
  const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  const date = new Date('2026-08-07'); // Friday
  const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date, startTime: '16:00', endTime: '18:00' });
  return { teacher, student, program, window, enrollment, date, booking };
}

describe('getTutoringRoster / saveTutoringAttendance / clearTutoringAttendance', () => {
  it('lists a booked student with no status yet, then reflects a saved status', async () => {
    const { window, date, booking } = await setupTutoringBooking();

    let roster = await getTutoringRoster(window.id, date);
    expect(roster).toHaveLength(1);
    expect(roster[0].bookingId).toBe(booking.id);
    expect(roster[0].studentName).toBe('小明');
    expect(roster[0].status).toBeNull();
    expect(roster[0].isMakeup).toBe(false);

    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'PRESENT', checkInTime: '16:05' }]);
    roster = await getTutoringRoster(window.id, date);
    expect(roster[0].status).toBe('PRESENT');
    expect(roster[0].checkInTime).toBe('16:05');
  });

  it('clears a saved attendance record', async () => {
    const { window, date, booking } = await setupTutoringBooking();
    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'ABSENT' }]);
    await clearTutoringAttendance([booking.id]);
    const roster = await getTutoringRoster(window.id, date);
    expect(roster[0].status).toBeNull();
  });
});

describe('listAttendanceSessionsForDate with tutoring windows', () => {
  it('includes an open tutoring window on its weekday with correct counts', async () => {
    const { window, date, teacher } = await setupTutoringBooking();
    const sessions = await listAttendanceSessionsForDate(date, teacher.id);
    const tutoring = sessions.find((s) => s.type === 'TUTORING' && s.id === window.id);
    expect(tutoring).toBeDefined();
    expect(tutoring!.totalCount).toBe(1);
    expect(tutoring!.markedCount).toBe(0);
  });

  it('excludes a tutoring window closed on that date', async () => {
    const { window, date } = await setupTutoringBooking();
    await prisma.tutoringWindowClosure.create({ data: { windowId: window.id, date } });
    const sessions = await listAttendanceSessionsForDate(date, null);
    expect(sessions.find((s) => s.type === 'TUTORING' && s.id === window.id)).toBeUndefined();
  });
});

describe('listMyAttendance with tutoring bookings', () => {
  it('includes a tutoring attendance row', async () => {
    const { student, booking } = await setupTutoringBooking();
    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'PRESENT' }]);
    const rows = await listMyAttendance(student.id);
    expect(rows.find((r) => r.type === 'TUTORING')).toMatchObject({ status: 'PRESENT', title: '英文個別輔導' });
  });
});

describe('checkInByStudentNumber with a tutoring booking', () => {
  it('checks the student into their tutoring booking for today', async () => {
    const { student, window } = await setupTutoringBooking();
    await prisma.student.update({ where: { id: student.id }, data: { studentNumber: 'S001' } });
    const result = await checkInByStudentNumber('S001', '2026-08-07', '16:02', 'marker-1');
    expect(result.result).toBe('CHECKED_IN');
    expect(result.sessionTitle).toBe('英文個別輔導');
    const roster = await getTutoringRoster(window.id, new Date('2026-08-07'));
    expect(roster[0].checkInTime).toBe('16:02');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/attendanceService.test.ts
```
Expected: FAIL — `getTutoringRoster` etc. not exported, `'TUTORING'` not a valid `type`.

- [ ] **Step 3: Add the import**

In `src/lib/services/attendanceService.ts`, change line 5-6 from:

```ts
import { determineQualification, getTicketBalance, LOW_TICKET_THRESHOLD, type GoHallQualificationValue } from './goHallTicketService';
import { LOW_CLASS_QUOTA_THRESHOLD } from '@/lib/lowQuota';
```

to:

```ts
import { determineQualification, getTicketBalance, LOW_TICKET_THRESHOLD, type GoHallQualificationValue } from './goHallTicketService';
import { LOW_CLASS_QUOTA_THRESHOLD } from '@/lib/lowQuota';
import { getMonthlyQuotaStatus, taipeiDateKey } from './tutoringBookingService';
```

- [ ] **Step 4: Add `getTutoringRoster` / `saveTutoringAttendance` / `clearTutoringAttendance`**

In `src/lib/services/attendanceService.ts`, immediately after the `clearActivityAttendance` function (ends around line 428, right before `export type AttendanceSessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY';`), insert:

```ts
export interface TutoringRosterEntry {
  bookingId: string;
  studentId: string;
  studentName: string;
  timeLabel: string;
  isMakeup: boolean;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  quotaLabel: string;
}

export async function getTutoringRoster(windowId: string, date: Date): Promise<TutoringRosterEntry[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { windowId, date, status: 'BOOKED' },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      kind: true,
      enrollment: { select: { id: true, studentId: true, student: { select: NAME_SELECT } } },
      attendance: true,
    },
  });
  const monthKey = taipeiDateKey(date);
  const rows = await Promise.all(
    bookings.map(async (b) => {
      const { locked, quota } = await getMonthlyQuotaStatus(b.enrollment.id, monthKey);
      return {
        bookingId: b.id,
        studentId: b.enrollment.studentId,
        studentName: b.enrollment.student.user.name,
        timeLabel: `${b.startTime}-${b.endTime}`,
        isMakeup: b.kind === 'MAKEUP',
        status: (b.attendance?.status as AttendanceStatusValue) ?? null,
        checkInTime: b.attendance?.checkInTime ?? null,
        checkOutTime: b.attendance?.checkOutTime ?? null,
        quotaLabel: `本月已計次 ${locked}／${quota} 堂`,
      };
    })
  );
  return rows.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
}

export interface SaveTutoringAttendanceInput {
  bookingId: string;
  status: AttendanceStatusValue;
  checkInTime?: string | null;
  checkOutTime?: string | null;
}

export async function saveTutoringAttendance(markedById: string, records: SaveTutoringAttendanceInput[]): Promise<void> {
  await prisma.$transaction(
    records.map((r) =>
      prisma.tutoringAttendance.upsert({
        where: { bookingId: r.bookingId },
        create: { bookingId: r.bookingId, status: r.status, checkInTime: r.checkInTime, checkOutTime: r.checkOutTime, markedById },
        update: { status: r.status, checkInTime: r.checkInTime, checkOutTime: r.checkOutTime, markedById },
      })
    )
  );
}

export async function clearTutoringAttendance(bookingIds: string[]): Promise<void> {
  if (bookingIds.length === 0) return;
  await prisma.tutoringAttendance.deleteMany({ where: { bookingId: { in: bookingIds } } });
}
```

- [ ] **Step 5: Extend `AttendanceSessionType` and `listAttendanceSessionsForDate`**

Change:

```ts
export type AttendanceSessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY';
```

to:

```ts
export type AttendanceSessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY' | 'TUTORING';
```

Inside `listAttendanceSessionsForDate`, find the `Promise.all([...])` destructuring:

```ts
  const [classes, oneOnOnes, goHallSessions, activities] = await Promise.all([
```

Change it to also fetch tutoring windows, and change the closing bracket's list accordingly:

```ts
  const [classes, oneOnOnes, goHallSessions, activities, tutoringWindows] = await Promise.all([
    prisma.class.findMany({
      where: {
        weekday,
        ...(teacherId ? { OR: [{ teacherId }, { id: { in: substituteClassIds } }] } : {}),
      },
      select: { id: true, name: true, startTime: true, endTime: true, teacherId: true, _count: { select: { enrollments: true } } },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'ONE_ON_ONE', status: 'APPROVED', slotDate: date, ...(teacherId ? { teacherId } : {}) },
      select: {
        id: true,
        slotStartTime: true,
        slotEndTime: true,
        leaveRequest: { select: { student: { select: NAME_SELECT } } },
      },
    }),
    prisma.goHallSession.findMany({
      where: { date: { gte: dayStart, lt: nextDayStart }, ...(teacherId ? { teacherId } : {}) },
      select: { id: true, startTime: true, endTime: true, _count: { select: { registrations: true } } },
    }),
    prisma.activity.findMany({
      where: { startDate: { lte: date }, endDate: { gte: date }, ...(teacherId ? { teachers: { some: { teacherId } } } : {}) },
      select: { id: true, title: true, _count: { select: { registrations: true } } },
    }),
    prisma.tutoringWindow.findMany({
      where: { weekday, active: true, ...(teacherId ? { teacherId } : {}) },
      select: { id: true, startTime: true, endTime: true, program: { select: { name: true } } },
    }),
  ]);
```

(This replaces the existing 4-item `Promise.all` — the first four entries are unchanged, only the 5th (`tutoringWindows`) and the destructured variable list are new.)

After the existing `const activityRows: AttendanceSessionSummary[] = ...` block (ends right before `return [...classRows, ...oneOnOneRows, ...goHallRows, ...activityRows];`), insert:

```ts
  const openTutoringWindows = [];
  for (const w of tutoringWindows) {
    const closed = await prisma.tutoringWindowClosure.findUnique({ where: { windowId_date: { windowId: w.id, date: dayStart } } });
    if (!closed) openTutoringWindows.push(w);
  }
  const tutoringRows: AttendanceSessionSummary[] = await Promise.all(
    openTutoringWindows.map(async (w) => ({
      type: 'TUTORING' as const,
      id: w.id,
      title: w.program.name,
      timeLabel: `${w.startTime}-${w.endTime}`,
      markedCount: await prisma.tutoringAttendance.count({ where: { booking: { windowId: w.id, date: dayStart } } }),
      totalCount: await prisma.tutoringBooking.count({ where: { windowId: w.id, date: dayStart, status: 'BOOKED' } }),
    }))
  );
```

And change the final return statement from:

```ts
  return [...classRows, ...oneOnOneRows, ...goHallRows, ...activityRows];
```

to:

```ts
  return [...classRows, ...oneOnOneRows, ...goHallRows, ...activityRows, ...tutoringRows];
```

- [ ] **Step 6: Extend `listMyAttendance`**

Inside `listMyAttendance`, change:

```ts
  const [classRows, oneOnOneRows, goHallRows, activityRows] = await Promise.all([
```

to also fetch tutoring attendance, matching the existing four-branch structure:

```ts
  const [classRows, oneOnOneRows, goHallRows, activityRows, tutoringRows] = await Promise.all([
    prisma.classAttendance.findMany({
      where: { studentId },
      select: { id: true, date: true, status: true, checkInTime: true, checkOutTime: true, class: { select: { name: true } } },
    }),
    prisma.oneOnOneAttendance.findMany({
      where: { makeupRequest: { type: 'ONE_ON_ONE', leaveRequest: { studentId } } },
      select: {
        id: true,
        status: true,
        checkInTime: true,
        checkOutTime: true,
        makeupRequest: { select: { slotDate: true, teacher: { select: { user: { select: { name: true } } } } } },
      },
    }),
    prisma.goHallAttendance.findMany({
      where: { studentId },
      select: { id: true, status: true, checkInTime: true, checkOutTime: true, session: { select: { date: true } } },
    }),
    prisma.activityAttendance.findMany({
      where: { studentId },
      select: { id: true, date: true, status: true, checkInTime: true, checkOutTime: true, activity: { select: { title: true } } },
    }),
    prisma.tutoringAttendance.findMany({
      where: { booking: { enrollment: { studentId } } },
      select: {
        id: true,
        status: true,
        checkInTime: true,
        checkOutTime: true,
        booking: { select: { date: true, window: { select: { program: { select: { name: true } } } } } },
      },
    }),
  ]);
```

(Unchanged: the first four entries. New: the 5th, `tutoringRows`.)

Then, inside the `rows: MyAttendanceRow[] = [...]` array literal, after the `...activityRows.map(...)` spread and before the closing `];`, add:

```ts
    ...tutoringRows.map((r) => ({
      id: `tutoring-${r.id}`,
      type: 'TUTORING' as const,
      date: r.booking.date,
      title: r.booking.window.program.name,
      status: r.status as AttendanceStatusValue,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
    })),
```

- [ ] **Step 7: Wire tutoring bookings into self-checkin (`getTodayCandidates` + `applyTutoringAttendance`)**

Immediately after the existing `applyOneOnOneAttendance` function (ends right before `async function getTodayCandidates(`), insert:

```ts
async function applyTutoringAttendance(input: { bookingId: string; timeStr: string; markedById: string }): Promise<'CHECKED_IN' | 'CHECKED_OUT'> {
  const where = { bookingId: input.bookingId };
  const existing = await prisma.tutoringAttendance.findUnique({ where });
  if (!existing || !existing.checkInTime) {
    await prisma.tutoringAttendance.upsert({
      where,
      create: { bookingId: input.bookingId, status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById },
      update: { status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById },
    });
    return 'CHECKED_IN';
  }
  await prisma.tutoringAttendance.update({ where, data: { checkOutTime: input.timeStr, markedById: input.markedById } });
  return 'CHECKED_OUT';
}
```

Inside `getTodayCandidates`, change the `Promise.all` destructuring from:

```ts
  const [enrollments, insertions, oneOnOnes, leaveRequests] = await Promise.all([
```

to fetch tutoring bookings too:

```ts
  const [enrollments, insertions, oneOnOnes, leaveRequests, tutoringBookings] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { studentId, class: { weekday } },
      select: {
        class: {
          select: { id: true, name: true, startTime: true, endTime: true, teacher: { select: { user: { select: { name: true } } } } },
        },
      },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'INSERTION', status: 'APPROVED', targetDate: date, leaveRequest: { studentId } },
      select: {
        id: true,
        targetClass: {
          select: { id: true, name: true, startTime: true, endTime: true, teacher: { select: { user: { select: { name: true } } } } },
        },
      },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'ONE_ON_ONE', status: 'APPROVED', slotDate: date, leaveRequest: { studentId } },
      select: { id: true, slotStartTime: true, slotEndTime: true, teacher: { select: { user: { select: { name: true } } } } },
    }),
    prisma.leaveRequest.findMany({ where: { studentId, date }, select: { classId: true } }),
    prisma.tutoringBooking.findMany({
      where: { date, status: 'BOOKED', enrollment: { studentId } },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        window: { select: { teacher: { select: { user: { select: { name: true } } } }, program: { select: { name: true } } } },
      },
    }),
  ]);
```

(Unchanged: the first four queries. New: the 5th, `tutoringBookings`.)

Immediately after the existing `for (const o of oneOnOnes) { ... }` loop and before `return candidates;`, insert:

```ts
  for (const tb of tutoringBookings) {
    const existing = await prisma.tutoringAttendance.findUnique({ where: { bookingId: tb.id } });
    candidates.push({
      key: `tutoring:${tb.id}`,
      title: tb.window.program.name,
      timeLabel: `${tb.startTime}-${tb.endTime}`,
      teacherName: tb.window.teacher.user.name,
      startMinutes: toMinutes(tb.startTime),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () => applyTutoringAttendance({ bookingId: tb.id, timeStr, markedById }),
    });
  }
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/attendanceService.test.ts
```
Expected: PASS, all existing tests plus 6 new ones.

- [ ] **Step 9: Full local verification**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit && npm run test
```
Expected: both clean — this is the point where every service-layer piece of the module is done and integrated; a red flag here means Task 7's wiring broke an existing session type, not the new one.

- [ ] **Step 10: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts && git commit -m "feat: 個別輔導點名整合（老師點名、自助簽到、我的出席紀錄）"
```

---

### Task 8: `StatusBadge` — add `BOOKED` and `CANCELLED_LATE`

**Files:**
- Modify: `src/components/ui/StatusBadge.tsx`

**Interfaces:**
- Produces: `KnownStatus` now includes `'BOOKED' | 'CANCELLED_LATE'`. Tasks 12/13/16 render `<StatusBadge status={booking.status} />` for tutoring bookings and rely on these two new labels; `'PENDING_ADMIN'` and `'REJECTED'` already exist and are reused as-is.

- [ ] **Step 1: Add the two status values**

In `src/components/ui/StatusBadge.tsx`, change the `KnownStatus` union from:

```ts
export type KnownStatus =
  | 'APPROVED'
  | 'PENDING_ADMIN'
  | 'PENDING_ASSIGNMENT'
  | 'REJECTED'
  | 'ASSIGNED'
  | 'PRESENT'
  | 'LATE'
  | 'LEFT_EARLY'
  | 'ON_LEAVE'
  | 'ABSENT'
  | 'NOT_REGISTERED';
```

to:

```ts
export type KnownStatus =
  | 'APPROVED'
  | 'PENDING_ADMIN'
  | 'PENDING_ASSIGNMENT'
  | 'REJECTED'
  | 'ASSIGNED'
  | 'PRESENT'
  | 'LATE'
  | 'LEFT_EARLY'
  | 'ON_LEAVE'
  | 'ABSENT'
  | 'NOT_REGISTERED'
  | 'BOOKED'
  | 'CANCELLED_LATE';
```

And add two entries to `STATUS_CONFIG`, right after the existing `NOT_REGISTERED` entry:

```ts
  // 個別輔導預約狀態
  BOOKED: { label: '已預約', bg: 'bg-approvedBg', text: 'text-approved' },
  CANCELLED_LATE: { label: '當天取消', bg: 'bg-rejectedBg', text: 'text-rejected' },
```

- [ ] **Step 2: Manually verify**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit
```
Expected: clean (no consumer of `StatusBadge` breaks — this is a pure addition to the union and the config map).

- [ ] **Step 3: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/components/ui/StatusBadge.tsx && git commit -m "feat: StatusBadge 新增已預約／當天取消樣式"
```

---

### Task 9: Admin API routes — programs, windows, closures, enrollments

**Files:**
- Create: `src/app/api/tutoring-programs/route.ts`
- Create: `src/app/api/tutoring-programs/[id]/route.ts`
- Create: `src/app/api/tutoring-windows/route.ts`
- Create: `src/app/api/tutoring-windows/[id]/route.ts`
- Create: `src/app/api/tutoring-window-closures/route.ts`
- Create: `src/app/api/tutoring-window-closures/[id]/route.ts`
- Create: `src/app/api/tutoring-enrollments/route.ts`
- Create: `src/app/api/tutoring-enrollments/[id]/route.ts`

**Interfaces:**
- Consumes: every function from `tutoringProgramService.ts` (Tasks 2 & 6) by exact name.
- Produces: the 8 route files below. Task 15 (admin UI) fetches these exact paths.

All 8 files follow the same guard: `getServerSession(authOptions)` + `session.user.role !== 'ADMIN'` → 403. None of these need a failing-test step — this codebase has no route-level tests (only service-level); correctness is verified by the manual smoke test in Step 2 and end-to-end in Task 15's UI verification.

- [ ] **Step 1: Create all 8 route files**

`src/app/api/tutoring-programs/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createProgram, listPrograms } from '@/lib/services/tutoringProgramService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listPrograms());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const program = await createProgram({
    name: body.name,
    defaultMonthlyQuota: body.defaultMonthlyQuota,
    defaultDurationMinutes: body.defaultDurationMinutes,
  });
  return NextResponse.json(program, { status: 201 });
}
```

`src/app/api/tutoring-programs/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateProgram, deleteProgram } from '@/lib/services/tutoringProgramService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const program = await updateProgram(params.id, body);
  return NextResponse.json(program);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await deleteProgram(params.id);
  return NextResponse.json({ success: true });
}
```

`src/app/api/tutoring-windows/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createWindow } from '@/lib/services/tutoringProgramService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const window = await createWindow({
    programId: body.programId,
    weekday: Number(body.weekday),
    startTime: body.startTime,
    endTime: body.endTime,
    capacity: Number(body.capacity),
    teacherId: body.teacherId,
  });
  return NextResponse.json(window, { status: 201 });
}
```

`src/app/api/tutoring-windows/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateWindow, deleteWindow } from '@/lib/services/tutoringProgramService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const window = await updateWindow(params.id, body);
  return NextResponse.json(window);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await deleteWindow(params.id);
  return NextResponse.json({ success: true });
}
```

`src/app/api/tutoring-window-closures/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { addWindowClosure } from '@/lib/services/tutoringProgramService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { windowId, date } = await req.json();
  const closure = await addWindowClosure(windowId, new Date(date));
  return NextResponse.json(closure, { status: 201 });
}
```

`src/app/api/tutoring-window-closures/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deleteWindowClosure } from '@/lib/services/tutoringProgramService';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await deleteWindowClosure(params.id);
  return NextResponse.json({ success: true });
}
```

`src/app/api/tutoring-enrollments/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createEnrollment, listEnrollments } from '@/lib/services/tutoringProgramService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listEnrollments());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId, programId, monthlyQuota } = await req.json();
  try {
    const enrollment = await createEnrollment({ studentId, programId, monthlyQuota });
    return NextResponse.json(enrollment, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
```

`src/app/api/tutoring-enrollments/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateEnrollment, deleteEnrollment } from '@/lib/services/tutoringProgramService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const enrollment = await updateEnrollment(params.id, body);
  return NextResponse.json(enrollment);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await deleteEnrollment(params.id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Manual smoke test**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit
```
Expected: clean. (Full manual verification of these routes happens in Task 15 once the admin UI can drive them.)

- [ ] **Step 3: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/api/tutoring-programs src/app/api/tutoring-windows src/app/api/tutoring-window-closures src/app/api/tutoring-enrollments && git commit -m "feat: 個別輔導行政端 API（課程／窗口／停開／報名）"
```

---

### Task 10: Student-facing API routes — enrollments/me, availability, bookings, makeup

**Files:**
- Create: `src/app/api/tutoring-enrollments/me/route.ts`
- Create: `src/app/api/tutoring-availability/route.ts`
- Create: `src/app/api/tutoring-bookings/route.ts`
- Create: `src/app/api/tutoring-bookings/[id]/route.ts`
- Create: `src/app/api/tutoring-bookings/[id]/makeup/route.ts`

**Interfaces:**
- Consumes: `listEnrollments` (Task 6) — passing the student's own `studentId`; `listAvailability`, `createBooking`, `cancelBooking`, `requestMakeup`, `listBookingsForStudent` from `tutoringBookingService.ts` (Tasks 4-6).
- Produces: the 5 route files below. Task 12 (student booking page) fetches these exact paths.

- [ ] **Step 1: Create `src/app/api/tutoring-enrollments/me/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listEnrollments } from '@/lib/services/tutoringProgramService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  return NextResponse.json((await listEnrollments(student.id)).filter((e) => e.active));
}
```

- [ ] **Step 2: Create `src/app/api/tutoring-availability/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listAvailability } from '@/lib/services/tutoringBookingService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const enrollmentId = req.nextUrl.searchParams.get('enrollmentId');
  if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId required' }, { status: 400 });

  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const enrollment = await prisma.tutoringEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
  if (enrollment.studentId !== student.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json(await listAvailability(enrollmentId));
}
```

- [ ] **Step 3: Create `src/app/api/tutoring-bookings/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createBooking, listBookingsForStudent } from '@/lib/services/tutoringBookingService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  return NextResponse.json(await listBookingsForStudent(student.id));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  let enrollmentId: string = body.enrollmentId;

  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
    const enrollment = await prisma.tutoringEnrollment.findUniqueOrThrow({ where: { id: body.enrollmentId } });
    if (enrollment.studentId !== student.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    enrollmentId = enrollment.id;
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const booking = await createBooking({
      enrollmentId,
      windowId: body.windowId,
      date: new Date(body.date),
      startTime: body.startTime,
      endTime: body.endTime,
    });
    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'WINDOW_FULL' || message === 'WINDOW_CLOSED' ? 409 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 4: Create `src/app/api/tutoring-bookings/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { cancelBooking, adminCancelBooking } from '@/lib/services/tutoringBookingService';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (session.user.role === 'ADMIN') {
    const body = await req.json().catch(() => ({}));
    await adminCancelBooking(params.id, Boolean(body.countsTowardQuota));
    return NextResponse.json({ success: true });
  }
  if (session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  try {
    await cancelBooking(params.id, student.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'NOT_OWNER' ? 403 : 400 });
  }
}
```

- [ ] **Step 5: Create `src/app/api/tutoring-bookings/[id]/makeup/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requestMakeup } from '@/lib/services/tutoringBookingService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const original = await prisma.tutoringBooking.findUniqueOrThrow({
    where: { id: params.id },
    include: { enrollment: { select: { studentId: true } } },
  });
  if (original.enrollment.studentId !== student.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  try {
    const makeup = await requestMakeup({
      originalBookingId: params.id,
      windowId: body.windowId,
      date: new Date(body.date),
      startTime: body.startTime,
      endTime: body.endTime,
    });
    return NextResponse.json(makeup, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = message === 'WINDOW_FULL' || message === 'WINDOW_CLOSED' || message === 'ALREADY_REQUESTED' ? 409 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 6: Manual smoke test**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 7: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/api/tutoring-enrollments/me src/app/api/tutoring-availability src/app/api/tutoring-bookings && git commit -m "feat: 個別輔導學生端 API（我的報名、可預約時段、預約、取消、補課申請）"
```

---

### Task 11: Admin booking overview, makeup queue, attendance route, walk-in, cron route

**Files:**
- Create: `src/app/api/tutoring-bookings/overview/route.ts`
- Create: `src/app/api/tutoring-bookings/walk-in/route.ts`
- Create: `src/app/api/tutoring-makeup-requests/route.ts`
- Create: `src/app/api/tutoring-makeup-requests/[id]/route.ts`
- Create: `src/app/api/attendance/tutoring/[windowId]/route.ts`
- Create: `src/app/api/cron/tutoring-quota-reminder/route.ts`

**Interfaces:**
- Consumes: `listBookingsOverview`, `createWalkInBooking`, `listPendingTutoringMakeupRequests`, `decideMakeup`, `sendMonthlyQuotaReminders` from `tutoringBookingService.ts`; `getTutoringRoster`, `saveTutoringAttendance`, `clearTutoringAttendance` from `attendanceService.ts` (Task 7).
- Produces: the 6 route files below. Task 14 (`AttendanceHub.tsx`) calls `/api/attendance/tutoring/:windowId`; Task 16 (admin booking overview UI) calls `/api/tutoring-bookings/overview` and `/api/tutoring-bookings/walk-in`; Task 17 (merged makeup queue) calls `/api/tutoring-makeup-requests`; Vercel Cron (Task 18) calls `/api/cron/tutoring-quota-reminder`.

- [ ] **Step 1: Create `src/app/api/tutoring-bookings/overview/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listBookingsOverview } from '@/lib/services/tutoringBookingService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  return NextResponse.json(await listBookingsOverview(new Date(dateParam)));
}
```

- [ ] **Step 2: Create `src/app/api/tutoring-bookings/walk-in/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createWalkInBooking } from '@/lib/services/tutoringBookingService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const booking = await createWalkInBooking({
    enrollmentId: body.enrollmentId,
    windowId: body.windowId,
    date: new Date(body.date),
    startTime: body.startTime,
    endTime: body.endTime,
  });
  return NextResponse.json(booking, { status: 201 });
}
```

- [ ] **Step 3: Create `src/app/api/tutoring-makeup-requests/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listPendingTutoringMakeupRequests } from '@/lib/services/tutoringBookingService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listPendingTutoringMakeupRequests());
}
```

- [ ] **Step 4: Create `src/app/api/tutoring-makeup-requests/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { decideMakeup } from '@/lib/services/tutoringBookingService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { decision } = await req.json();
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }
  await decideMakeup(params.id, decision);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Create `src/app/api/attendance/tutoring/[windowId]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTutoringRoster, saveTutoringAttendance, clearTutoringAttendance } from '@/lib/services/attendanceService';

export async function GET(req: NextRequest, { params }: { params: { windowId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const window = await prisma.tutoringWindow.findUniqueOrThrow({ where: { id: params.windowId } });
    if (window.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  return NextResponse.json(await getTutoringRoster(params.windowId, new Date(dateParam)));
}

export async function POST(req: NextRequest, { params }: { params: { windowId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const window = await prisma.tutoringWindow.findUniqueOrThrow({ where: { id: params.windowId } });
    if (window.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  await saveTutoringAttendance(session.user.id, body.records);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { windowId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const window = await prisma.tutoringWindow.findUniqueOrThrow({ where: { id: params.windowId } });
    if (window.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  await clearTutoringAttendance(body.clear);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 6: Create `src/app/api/cron/tutoring-quota-reminder/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sendMonthlyQuotaReminders } from '@/lib/services/tutoringBookingService';

// Vercel Cron 呼叫時會帶 Authorization: Bearer $CRON_SECRET（見 Task 18 的 vercel.json）。
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const result = await sendMonthlyQuotaReminders();
  return NextResponse.json(result);
}
```

- [ ] **Step 7: Manual smoke test**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 8: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/api/tutoring-bookings/overview src/app/api/tutoring-bookings/walk-in src/app/api/tutoring-makeup-requests src/app/api/attendance/tutoring src/app/api/cron/tutoring-quota-reminder && git commit -m "feat: 個別輔導行政總覽／現場補加／補課審核／點名／月中提醒 API"
```

---

### Task 12: Student booking page `/student/tutoring`

**Files:**
- Create: `src/app/student/tutoring/page.tsx`

**Interfaces:**
- Consumes: `GET /api/tutoring-enrollments/me`, `GET /api/tutoring-availability?enrollmentId=`, `GET /api/tutoring-bookings`, `POST /api/tutoring-bookings`, `DELETE /api/tutoring-bookings/:id`, `POST /api/tutoring-bookings/:id/makeup` (Tasks 10-11); `Card`, `Button`, `Input`, `StatusBadge`, `CollapsibleDataTable`, `useToast`, `useConfirm` from `@/components/ui`; `formatDateWithWeekday` from `@/lib/dateFormat`.
- Produces: the page component. Task 13 links to `/student/tutoring` from the dashboard card.

This page is **fully client-rendered** (`'use client'`, fetches JSON from `/api/*`), mirroring `src/app/student/go-hall/page.tsx` exactly — never a Server Component passing a `columns` array into `CollapsibleDataTable` (see Global Constraints).

- [ ] **Step 1: Implement the page**

Create `src/app/student/tutoring/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface Enrollment {
  id: string;
  programId: string;
  programName: string;
  defaultDurationMinutes: number;
  monthlyQuota: number;
  locked: number;
  upcoming: number;
}

interface AvailabilityDay {
  date: string;
  windowId: string;
  windowStartTime: string;
  windowEndTime: string;
  capacity: number;
  slots: { startTime: string; remaining: number }[];
}

interface BookingRow {
  id: string;
  programName: string;
  date: string;
  startTime: string;
  endTime: string;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED_LATE' | 'REJECTED';
  canCancelFree: boolean;
  canRequestMakeup: boolean;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function StudentTutoringPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>('');
  const [availability, setAvailability] = useState<AvailabilityDay[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [makeupFor, setMakeupFor] = useState<BookingRow | null>(null);

  async function loadEnrollments() {
    const res = await fetch('/api/tutoring-enrollments/me');
    const rows: Enrollment[] = await res.json();
    setEnrollments(rows);
    if (rows.length > 0) setSelectedEnrollmentId((prev) => prev || rows[0].id);
  }

  async function loadBookings() {
    const res = await fetch('/api/tutoring-bookings');
    setBookings(await res.json());
  }

  async function loadAvailability(enrollmentId: string) {
    const res = await fetch(`/api/tutoring-availability?enrollmentId=${enrollmentId}`);
    setAvailability(await res.json());
  }

  useEffect(() => {
    loadEnrollments();
    loadBookings();
  }, []);

  useEffect(() => {
    if (selectedEnrollmentId) loadAvailability(selectedEnrollmentId);
  }, [selectedEnrollmentId]);

  const selectedEnrollment = enrollments.find((e) => e.id === selectedEnrollmentId);

  function openDayForBooking(day: AvailabilityDay) {
    setOpenDay(day.date);
    const firstAvailable = day.slots.find((s) => s.remaining > 0);
    const start = firstAvailable?.startTime ?? day.windowStartTime;
    setStartTime(start);
    setEndTime(addMinutes(start, selectedEnrollment?.defaultDurationMinutes ?? 120));
  }

  async function submitBooking(day: AvailabilityDay) {
    if (!selectedEnrollment) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/tutoring-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollmentId: selectedEnrollment.id, windowId: day.windowId, date: day.date, startTime, endTime }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        showToast(error === 'WINDOW_FULL' ? '這段時間名額已滿，請選別的時間' : '預約失敗，請確認時間範圍');
        return;
      }
      showToast('預約成功');
      setOpenDay(null);
      loadBookings();
      loadAvailability(selectedEnrollment.id);
      loadEnrollments();
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelBooking(row: BookingRow) {
    const message = row.canCancelFree
      ? '確定要取消這筆預約嗎？'
      : '今天取消會計入本月次數，之後可申請補課。確定要取消嗎？';
    if (!(await confirm(message, { danger: !row.canCancelFree }))) return;
    const res = await fetch(`/api/tutoring-bookings/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('取消失敗，請稍後再試');
      return;
    }
    showToast('已取消');
    loadBookings();
    if (selectedEnrollmentId) loadAvailability(selectedEnrollmentId);
    loadEnrollments();
  }

  async function submitMakeup(day: AvailabilityDay) {
    if (!makeupFor) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/tutoring-bookings/${makeupFor.id}/makeup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ windowId: day.windowId, date: day.date, startTime, endTime }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        showToast(error === 'WINDOW_FULL' ? '這段時間名額已滿，請選別的時間' : '申請失敗，請確認時間範圍');
        return;
      }
      showToast('已送出補課申請，待行政核准');
      setMakeupFor(null);
      setOpenDay(null);
      loadBookings();
    } finally {
      setSubmitting(false);
    }
  }

  const bookingColumns: Column<BookingRow>[] = [
    { header: '課程', render: (r) => r.programName },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date) },
    { header: '時間', render: (r) => `${r.startTime}-${r.endTime}` },
    { header: '類型', render: (r) => (r.kind === 'MAKEUP' ? '補課' : '一般') },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
    {
      header: '操作',
      render: (r) => (
        <div className="flex flex-col items-center gap-1">
          {r.status === 'BOOKED' && (
            <Button className="px-3 py-1 text-xs" variant="secondary" onClick={() => cancelBooking(r)}>
              取消
            </Button>
          )}
          {r.canRequestMakeup && (
            <Button className="px-3 py-1 text-xs" onClick={() => setMakeupFor(r)}>
              申請補課
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">個別輔導預約</h1>

      {enrollments.length === 0 ? (
        <Card>
          <p className="text-sm text-inkMuted">目前沒有已報名的個別輔導課程</p>
        </Card>
      ) : (
        <>
          {enrollments.length > 1 && (
            <div className="mb-4 flex gap-2">
              {enrollments.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEnrollmentId(e.id)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    e.id === selectedEnrollmentId ? 'bg-brand text-brandInk' : 'border border-borderStrong text-inkMuted'
                  }`}
                >
                  {e.programName}
                </button>
              ))}
            </div>
          )}

          {selectedEnrollment && (
            <Card className="mb-4">
              <p className="text-sm text-inkMuted">
                {selectedEnrollment.programName}・本月已計次 <b className="text-ink">{selectedEnrollment.locked}</b>／
                {selectedEnrollment.monthlyQuota} 堂
                {selectedEnrollment.upcoming > 0 && <>（另有 {selectedEnrollment.upcoming} 堂已預約未到）</>}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stripe">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.min(100, (selectedEnrollment.locked / selectedEnrollment.monthlyQuota) * 100)}%` }}
                />
              </div>
            </Card>
          )}

          <h2 className="mb-2 font-bold text-ink">未來兩週可預約時段</h2>
          <div className="mb-6 flex flex-col gap-2">
            {availability.length === 0 && (
              <Card>
                <p className="text-sm text-inkMuted">目前沒有開放的時段</p>
              </Card>
            )}
            {availability.map((day) => (
              <Card key={day.date}>
                <button className="flex w-full items-center justify-between" onClick={() => openDayForBooking(day)}>
                  <span className="font-semibold text-ink">{formatDateWithWeekday(day.date)}</span>
                  <span className="text-xs text-inkMuted">
                    {day.windowStartTime}-{day.windowEndTime}
                  </span>
                </button>
                <div className="mt-2 flex flex-wrap gap-1">
                  {day.slots.map((s) => (
                    <span
                      key={s.startTime}
                      title={`${s.startTime}：剩 ${s.remaining} 位`}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        s.remaining === 0 ? 'bg-rejectedBg text-rejected' : 'bg-approvedBg text-approved'
                      }`}
                    >
                      {s.startTime}・{s.remaining}
                    </span>
                  ))}
                </div>

                {openDay === day.date && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-borderSubtle pt-3">
                    <label className="text-xs text-inkMuted">
                      開始
                      <select
                        value={startTime}
                        onChange={(e) => {
                          setStartTime(e.target.value);
                          setEndTime(addMinutes(e.target.value, selectedEnrollment?.defaultDurationMinutes ?? 120));
                        }}
                        className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                      >
                        {day.slots.map((s) => (
                          <option key={s.startTime} value={s.startTime} disabled={s.remaining === 0}>
                            {s.startTime}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-inkMuted">
                      結束
                      <select
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                      >
                        {day.slots
                          .map((s) => s.startTime)
                          .concat(day.windowEndTime)
                          .filter((t) => t > startTime)
                          .map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button loading={submitting} onClick={() => (makeupFor ? submitMakeup(day) : submitBooking(day))}>
                      {makeupFor ? '確定補課時間' : '確定預約'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setOpenDay(null);
                        setMakeupFor(null);
                      }}
                    >
                      取消
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>

          {makeupFor && (
            <Card className="mb-6 border-pending">
              <p className="text-sm text-ink">
                正在為 <b>{formatDateWithWeekday(makeupFor.date)}（{makeupFor.startTime}-{makeupFor.endTime}）</b>
                的缺席選一個補課時間，請在上方點選日期。
              </p>
            </Card>
          )}

          <h2 className="mb-2 font-bold text-ink">我的預約紀錄</h2>
          <Card>
            <CollapsibleDataTable columns={bookingColumns} rows={bookings} keyField={(r) => r.id} maxRows={3} emptyText="目前沒有預約紀錄" />
          </Card>
        </>
      )}
      {ConfirmDialog}
    </>
  );
}
```

- [ ] **Step 2: Manually verify in the browser**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm run dev
```
Then, using an admin session, create a `TutoringProgram`, a `TutoringWindow`, and a `TutoringEnrollment` for the seed student (`student@example.com` / `password123`) via direct `POST` calls or `prisma studio` (Tasks 15-16 build the admin UI for this — until then, seed via `npx prisma studio` or a one-off script). Log in as the student, open `/student/tutoring`, and confirm: the enrollment's quota bar renders, the next-14-days list shows the window's weekday only, clicking a day opens the start/end pickers defaulted to the program's `defaultDurationMinutes`, submitting creates a booking that appears in "我的預約紀錄", and cancelling it works.

- [ ] **Step 3: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/student/tutoring/page.tsx && git commit -m "feat: 學生端個別輔導預約頁"
```

---

### Task 13: Student dashboard — 個別輔導 card

**Files:**
- Modify: `src/app/student/page.tsx`

**Interfaces:**
- Consumes: `listEnrollments` from `@/lib/services/tutoringProgramService` (Task 6).
- Produces: a new card on `/student` linking to `/student/tutoring`.

`src/app/student/page.tsx` is an **async Server Component** (`getServerSession` + direct `prisma` calls). This task only adds plain JSX (text, a progress bar `<div>`, a `<Link>`) — no function is passed as a prop into a Client Component, so this does **not** reintroduce the RSC-boundary bug fixed earlier in this session (see Global Constraints). Contrast with `LeaveHistoryTable`/`CollapsibleDataTable`, which must stay inside the separate Client Component.

- [ ] **Step 1: Fetch the student's tutoring enrollments**

In `src/app/student/page.tsx`, add this import alongside the existing ones:

```ts
import { listEnrollments } from '@/lib/services/tutoringProgramService';
```

Change the `Promise.all` that fetches `leaves, myRegistrations, myClasses, tickets` to also fetch tutoring enrollments:

```ts
  const [leaves, myRegistrations, myClasses, tickets, tutoringEnrollments] = student
    ? await Promise.all([
        listLeaveRequestsForStudent(student.id),
        listRegistrationsForStudent(student.id),
        listStudentEnrolledClasses(student.id),
        getMyTickets(student.id),
        listEnrollments(student.id),
      ])
    : [[], [], [], { balance: 0, activePassEndDate: null }, []];
```

- [ ] **Step 2: Render the card**

Immediately after the closing `</Link>` of the existing "我的集點卡" card block (the one wrapping `/student/points`), and before the `<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">` block (the 三張捷徑卡片), insert — only when there's at least one active enrollment:

```tsx
      {tutoringEnrollments.filter((e) => e.active).length > 0 && (
        <Link href="/student/tutoring">
          <Card className="mb-6 transition-shadow hover:shadow-md">
            <p className="mb-2 text-sm text-inkMuted">個別輔導</p>
            {tutoringEnrollments
              .filter((e) => e.active)
              .map((e, i) => (
                <div key={e.id} className={`flex items-center justify-between gap-3 py-1.5 ${i > 0 ? 'border-t border-borderSubtle' : ''}`}>
                  <span className="text-sm font-semibold text-ink">{e.programName}</span>
                  <span className="text-xs tabular-nums text-inkMuted">
                    本月 <span className="font-semibold text-ink">{e.locked}</span>／{e.monthlyQuota} 堂
                  </span>
                </div>
              ))}
          </Card>
        </Link>
      )}
```

- [ ] **Step 3: Manually verify**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm run dev
```
Log in as the seed student (with a tutoring enrollment created in Task 12's verification step), open `/student`, confirm the "個別輔導" card renders with the correct monthly count and links to `/student/tutoring`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/student/page.tsx && git commit -m "feat: 學生首頁加入個別輔導卡片"
```

---

### Task 14: `AttendanceHub.tsx` — wire in the TUTORING session type

**Files:**
- Modify: `src/components/AttendanceHub.tsx`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/attendance/tutoring/:windowId` (Task 11); `GET /api/attendance/sessions` already returns `TUTORING` rows once Task 7 lands (no change needed there — it's the same endpoint, already wired).
- Produces: teacher/admin point-name UI shows tutoring windows for the selected date, alongside CLASS/ONE_ON_ONE/GO_HALL/ACTIVITY, using the exact same shared `Modal` + `AttendanceRosterEditor` already used by the other three types (no changes to `AttendanceRosterEditor.tsx` — its generic `RosterRow`/`quotaLabel`/`quotaTone` shape already covers this).

- [ ] **Step 1: Add `'TUTORING'` to the type union and labels**

In `src/components/AttendanceHub.tsx`, change:

```ts
type SessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY';
```

to:

```ts
type SessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY' | 'TUTORING';
```

Change:

```ts
const TYPE_LABEL: Record<SessionType, string> = {
  CLASS: '班級',
  ONE_ON_ONE: '一對一補課',
  GO_HALL: '弈廳',
  ACTIVITY: '活動',
};
```

to:

```ts
const TYPE_LABEL: Record<SessionType, string> = {
  CLASS: '班級',
  ONE_ON_ONE: '一對一補課',
  GO_HALL: '弈廳',
  ACTIVITY: '活動',
  TUTORING: '個別輔導',
};
```

- [ ] **Step 2: Add a roster row type and `apiPathFor` branch**

After the existing `interface GoHallRosterApiRow extends SimpleRosterApiRow { ... }` block, add:

```ts
interface TutoringRosterApiRow {
  bookingId: string;
  studentId: string;
  studentName: string;
  timeLabel: string;
  isMakeup: boolean;
  status: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  quotaLabel: string;
}
```

Change `apiPathFor` from:

```ts
function apiPathFor(type: SessionType, id: string) {
  if (type === 'CLASS') return `/api/attendance/class/${id}`;
  if (type === 'ONE_ON_ONE') return `/api/attendance/one-on-one/${id}`;
  if (type === 'GO_HALL') return `/api/attendance/go-hall/${id}`;
  return `/api/attendance/activity/${id}`;
}
```

to:

```ts
function apiPathFor(type: SessionType, id: string) {
  if (type === 'CLASS') return `/api/attendance/class/${id}`;
  if (type === 'ONE_ON_ONE') return `/api/attendance/one-on-one/${id}`;
  if (type === 'GO_HALL') return `/api/attendance/go-hall/${id}`;
  if (type === 'TUTORING') return `/api/attendance/tutoring/${id}`;
  return `/api/attendance/activity/${id}`;
}
```

- [ ] **Step 3: Add the `openSession` branch**

In `openSession`, change the final `else` branch (currently handling `ACTIVITY` as the catch-all) from:

```ts
    } else {
      const res = await fetch(`/api/attendance/activity/${s.id}?date=${date}`);
      const roster = await res.json();
      setRosterRows(
        roster.map((r: SimpleRosterApiRow) => ({
          key: r.studentId,
          studentId: r.studentId,
          studentName: r.studentName,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
        }))
      );
    }
```

to (inserting a `TUTORING` branch before the `ACTIVITY` `else`, and making `ACTIVITY` an explicit `else if`):

```ts
    } else if (s.type === 'TUTORING') {
      const res = await fetch(`/api/attendance/tutoring/${s.id}?date=${date}`);
      const roster = await res.json();
      setRosterRows(
        roster.map((r: TutoringRosterApiRow) => ({
          key: r.bookingId,
          studentId: r.studentId,
          studentName: r.studentName + (r.isMakeup ? '（補課）' : ''),
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          quotaLabel: r.quotaLabel,
        }))
      );
    } else {
      const res = await fetch(`/api/attendance/activity/${s.id}?date=${date}`);
      const roster = await res.json();
      setRosterRows(
        roster.map((r: SimpleRosterApiRow) => ({
          key: r.studentId,
          studentId: r.studentId,
          studentName: r.studentName,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
        }))
      );
    }
```

- [ ] **Step 4: Add the `handleSaveRoster` request-body branches**

In `handleSaveRoster`, the `records.length > 0` block currently builds `body` with a ternary keyed on `opening.type === 'ONE_ON_ONE'` vs. the general case. Change:

```ts
    if (records.length > 0) {
      const body =
        opening.type === 'ONE_ON_ONE'
          ? records[0]
          : {
              date,
              records: records.map((r) => ({
                studentId: r.studentId,
                status: r.status,
                checkInTime: r.checkInTime,
                checkOutTime: r.checkOutTime,
                ...(opening.type === 'CLASS' && r.key !== r.studentId ? { makeupRequestId: r.key } : {}),
              })),
            };
```

to:

```ts
    if (records.length > 0) {
      const body =
        opening.type === 'ONE_ON_ONE'
          ? records[0]
          : opening.type === 'TUTORING'
            ? { records: records.map((r) => ({ bookingId: r.key, status: r.status, checkInTime: r.checkInTime, checkOutTime: r.checkOutTime })) }
            : {
                date,
                records: records.map((r) => ({
                  studentId: r.studentId,
                  status: r.status,
                  checkInTime: r.checkInTime,
                  checkOutTime: r.checkOutTime,
                  ...(opening.type === 'CLASS' && r.key !== r.studentId ? { makeupRequestId: r.key } : {}),
                })),
              };
```

And the `clears.length > 0` block, change:

```ts
    if (clears.length > 0) {
      const body =
        opening.type === 'ONE_ON_ONE'
          ? {}
          : opening.type === 'CLASS'
            ? {
                date,
                clear: clears.map((c) =>
                  c.key !== c.studentId ? { studentId: c.studentId, makeupRequestId: c.key } : { studentId: c.studentId }
                ),
              }
            : opening.type === 'GO_HALL'
              ? { clear: clears.map((c) => c.studentId) }
              : { date, clear: clears.map((c) => c.studentId) };
```

to:

```ts
    if (clears.length > 0) {
      const body =
        opening.type === 'ONE_ON_ONE'
          ? {}
          : opening.type === 'CLASS'
            ? {
                date,
                clear: clears.map((c) =>
                  c.key !== c.studentId ? { studentId: c.studentId, makeupRequestId: c.key } : { studentId: c.studentId }
                ),
              }
            : opening.type === 'GO_HALL' || opening.type === 'TUTORING'
              ? { clear: clears.map((c) => c.key) }
              : { date, clear: clears.map((c) => c.studentId) };
```

(`TUTORING` joins `GO_HALL` in the `{ clear: [...] }`-shaped branch, but uses `c.key` — the `bookingId` — instead of `c.studentId`, since a tutoring attendance row is keyed by booking, not student.)

- [ ] **Step 5: Manually verify**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm run dev
```
Using the tutoring booking created in Task 12's verification, log in as the teacher assigned to that window (or admin), go to 點名 (`/teacher/attendance` or the admin attendance hub), pick the booking's date, confirm a "個別輔導" row appears with the correct time and count, open it, mark the student PRESENT with a check-in time, save, and confirm it persists (re-open the same date/row and the status is still there). Then confirm `/student/tutoring`'s booking list for that student shows the updated status.

- [ ] **Step 6: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/components/AttendanceHub.tsx && git commit -m "feat: 點名主頁整合個別輔導場次"
```

---

### Task 15: Admin UI — `/admin/tutoring` (programs, windows, closures, enrollments)

**Files:**
- Create: `src/app/admin/tutoring/page.tsx`
- Create: `src/app/admin/tutoring/EnrollmentManager.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/tutoring-programs`, `PATCH/DELETE /api/tutoring-programs/:id`, `POST /api/tutoring-windows`, `PATCH/DELETE /api/tutoring-windows/:id`, `POST /api/tutoring-window-closures`, `DELETE /api/tutoring-window-closures/:id` (Task 9); `GET/POST /api/tutoring-enrollments`, `PATCH/DELETE /api/tutoring-enrollments/:id` (Task 9); `GET /api/students`, `GET /api/teachers` (existing).
- Produces: the admin catalog/roster management screen. Task 16 (booking overview) links here for capacity issues; nothing downstream consumes this page's exports (it's a leaf page).

- [ ] **Step 1: Implement `src/app/admin/tutoring/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import EnrollmentManager from './EnrollmentManager';

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

interface WindowRow {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  capacity: number;
  active: boolean;
  teacher: { user: { name: string } };
  closures: { id: string; date: string }[];
}

interface ProgramRow {
  id: string;
  name: string;
  defaultMonthlyQuota: number;
  defaultDurationMinutes: number;
  active: boolean;
  windows: WindowRow[];
}

interface TeacherOption {
  id: string;
  user: { name: string };
}

export default function AdminTutoringPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [newProgramName, setNewProgramName] = useState('');
  const [windowForm, setWindowForm] = useState<Record<string, { weekday: string; startTime: string; endTime: string; capacity: string; teacherId: string }>>({});
  const [closureDate, setClosureDate] = useState<Record<string, string>>({});

  async function load() {
    const [programsRes, teachersRes] = await Promise.all([fetch('/api/tutoring-programs'), fetch('/api/teachers')]);
    setPrograms(await programsRes.json());
    setTeachers(await teachersRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function createProgram() {
    if (!newProgramName.trim()) return;
    const res = await fetch('/api/tutoring-programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newProgramName.trim() }),
    });
    if (!res.ok) {
      showToast('新增失敗');
      return;
    }
    setNewProgramName('');
    showToast('已新增課程');
    load();
  }

  async function toggleProgramActive(program: ProgramRow) {
    await fetch(`/api/tutoring-programs/${program.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !program.active }),
    });
    load();
  }

  async function deleteProgram(program: ProgramRow) {
    if (!(await confirm(`確定要刪除「${program.name}」嗎？此動作無法復原。`, { danger: true }))) return;
    const res = await fetch(`/api/tutoring-programs/${program.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，可能仍有預約紀錄');
      return;
    }
    showToast('已刪除');
    load();
  }

  async function createWindow(programId: string) {
    const form = windowForm[programId];
    if (!form?.startTime || !form?.endTime || !form?.capacity || !form?.teacherId) {
      showToast('請填寫完整的窗口資訊');
      return;
    }
    const res = await fetch('/api/tutoring-windows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        programId,
        weekday: Number(form.weekday || 0),
        startTime: form.startTime,
        endTime: form.endTime,
        capacity: Number(form.capacity),
        teacherId: form.teacherId,
      }),
    });
    if (!res.ok) {
      showToast('新增窗口失敗');
      return;
    }
    setWindowForm((prev) => ({ ...prev, [programId]: { weekday: '0', startTime: '', endTime: '', capacity: '', teacherId: '' } }));
    showToast('已新增窗口');
    load();
  }

  async function toggleWindowActive(window: WindowRow) {
    await fetch(`/api/tutoring-windows/${window.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !window.active }),
    });
    load();
  }

  async function deleteWindow(window: WindowRow) {
    if (!(await confirm('確定要刪除這個窗口嗎？', { danger: true }))) return;
    const res = await fetch(`/api/tutoring-windows/${window.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，可能仍有預約紀錄');
      return;
    }
    showToast('已刪除');
    load();
  }

  async function addClosure(windowId: string) {
    const date = closureDate[windowId];
    if (!date) return;
    const res = await fetch('/api/tutoring-window-closures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ windowId, date }),
    });
    if (!res.ok) {
      showToast('新增停開日失敗');
      return;
    }
    setClosureDate((prev) => ({ ...prev, [windowId]: '' }));
    load();
  }

  async function removeClosure(closureId: string) {
    await fetch(`/api/tutoring-window-closures/${closureId}`, { method: 'DELETE' });
    load();
  }

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">個別輔導管理</h1>

      <Card className="mb-6">
        <p className="mb-2 font-semibold text-ink">新增課程</p>
        <div className="flex gap-2">
          <Input placeholder="課程名稱，例如：英文個別輔導" value={newProgramName} onChange={(e) => setNewProgramName(e.target.value)} className="flex-1" />
          <Button onClick={createProgram}>新增</Button>
        </div>
      </Card>

      {programs.map((program) => (
        <Card key={program.id} className="mb-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="font-semibold text-ink">{program.name}</p>
              <p className="text-xs text-inkMuted">
                每月預設 {program.defaultMonthlyQuota} 堂・單次預設 {program.defaultDurationMinutes} 分鐘
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => toggleProgramActive(program)}>
                {program.active ? '停用' : '啟用'}
              </Button>
              <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => deleteProgram(program)}>
                刪除
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {program.windows.map((window) => (
              <div key={window.id} className="rounded-lg border border-borderSubtle p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-ink">
                    週{WEEKDAY_LABELS[window.weekday]} {window.startTime}-{window.endTime}・容量 {window.capacity}・{window.teacher.user.name}
                    {!window.active && <span className="ml-2 text-xs text-inkMuted">（已停用）</span>}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => toggleWindowActive(window)}>
                      {window.active ? '停用' : '啟用'}
                    </Button>
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => deleteWindow(window)}>
                      刪除
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-inkMuted">停開日：</span>
                  {window.closures.map((c) => (
                    <span key={c.id} className="flex items-center gap-1 rounded-full bg-stripe px-2 py-0.5 text-xs text-inkMuted">
                      {c.date.slice(0, 10)}
                      <button onClick={() => removeClosure(c.id)} className="text-rejected">
                        ✕
                      </button>
                    </span>
                  ))}
                  <Input
                    type="date"
                    value={closureDate[window.id] ?? ''}
                    onChange={(e) => setClosureDate((prev) => ({ ...prev, [window.id]: e.target.value }))}
                    className="w-36 py-1 text-xs"
                  />
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => addClosure(window.id)}>
                    加入停開日
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-borderStrong p-3">
              <label className="text-xs text-inkMuted">
                星期
                <select
                  value={windowForm[program.id]?.weekday ?? '0'}
                  onChange={(e) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...prev[program.id], weekday: e.target.value } }))}
                  className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                >
                  {WEEKDAY_LABELS.map((label, i) => (
                    <option key={i} value={i}>
                      週{label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-inkMuted">
                開始
                <Input
                  type="time"
                  value={windowForm[program.id]?.startTime ?? ''}
                  onChange={(e) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...prev[program.id], startTime: e.target.value } }))}
                  className="mt-1 w-24 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-inkMuted">
                結束
                <Input
                  type="time"
                  value={windowForm[program.id]?.endTime ?? ''}
                  onChange={(e) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...prev[program.id], endTime: e.target.value } }))}
                  className="mt-1 w-24 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-inkMuted">
                容量
                <Input
                  type="number"
                  min={1}
                  value={windowForm[program.id]?.capacity ?? ''}
                  onChange={(e) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...prev[program.id], capacity: e.target.value } }))}
                  className="mt-1 w-20 py-1 text-sm"
                />
              </label>
              <label className="text-xs text-inkMuted">
                老師
                <select
                  value={windowForm[program.id]?.teacherId ?? ''}
                  onChange={(e) => setWindowForm((prev) => ({ ...prev, [program.id]: { ...prev[program.id], teacherId: e.target.value } }))}
                  className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                >
                  <option value="">請選擇</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.user.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button className="px-3 py-1 text-xs" onClick={() => createWindow(program.id)}>
                新增窗口
              </Button>
            </div>
          </div>
        </Card>
      ))}

      <EnrollmentManager />
      {ConfirmDialog}
    </>
  );
}
```

- [ ] **Step 2: Implement `src/app/admin/tutoring/EnrollmentManager.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';

interface EnrollmentRow {
  id: string;
  studentId: string;
  studentName: string;
  programId: string;
  programName: string;
  monthlyQuota: number;
  active: boolean;
  locked: number;
  upcoming: number;
}

interface StudentOption {
  id: string;
  user: { name: string };
}

interface ProgramOption {
  id: string;
  name: string;
}

export default function EnrollmentManager() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [studentId, setStudentId] = useState('');
  const [programId, setProgramId] = useState('');
  const [quotaOverride, setQuotaOverride] = useState<Record<string, string>>({});

  async function load() {
    const [enrollmentsRes, studentsRes, programsRes] = await Promise.all([
      fetch('/api/tutoring-enrollments'),
      fetch('/api/students'),
      fetch('/api/tutoring-programs'),
    ]);
    setEnrollments(await enrollmentsRes.json());
    setStudents(await studentsRes.json());
    setPrograms(await programsRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function createEnrollment() {
    if (!studentId || !programId) {
      showToast('請選擇學生與課程');
      return;
    }
    const res = await fetch('/api/tutoring-enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, programId }),
    });
    if (!res.ok) {
      showToast('新增失敗，該學生可能已報名此課程');
      return;
    }
    setStudentId('');
    setProgramId('');
    showToast('已新增報名');
    load();
  }

  async function saveQuotaOverride(row: EnrollmentRow) {
    const raw = quotaOverride[row.id];
    const monthlyQuota = raw === '' || raw === undefined ? null : Number(raw);
    await fetch(`/api/tutoring-enrollments/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyQuota }),
    });
    showToast('已更新額度');
    load();
  }

  async function toggleActive(row: EnrollmentRow) {
    await fetch(`/api/tutoring-enrollments/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !row.active }),
    });
    load();
  }

  async function removeEnrollment(row: EnrollmentRow) {
    if (!(await confirm(`確定要移除「${row.studentName}」的「${row.programName}」報名嗎？`, { danger: true }))) return;
    const res = await fetch(`/api/tutoring-enrollments/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('刪除失敗，可能仍有預約紀錄');
      return;
    }
    showToast('已移除');
    load();
  }

  const columns: Column<EnrollmentRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName },
    { header: '本月狀態', render: (r) => `已計次 ${r.locked}／${r.monthlyQuota} 堂（另 ${r.upcoming} 堂待到）` },
    {
      header: '額度覆寫',
      render: (r) => (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            placeholder="預設"
            value={quotaOverride[r.id] ?? ''}
            onChange={(e) => setQuotaOverride((prev) => ({ ...prev, [r.id]: e.target.value }))}
            className="w-16 py-1 text-xs"
          />
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => saveQuotaOverride(r)}>
            儲存
          </Button>
        </div>
      ),
    },
    {
      header: '操作',
      render: (r) => (
        <div className="flex gap-2">
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => toggleActive(r)}>
            {r.active ? '停用' : '啟用'}
          </Button>
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => removeEnrollment(r)}>
            移除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <h2 className="mb-2 mt-6 font-bold text-ink">學生報名管理</h2>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-inkMuted">
            學生
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink">
              <option value="">請選擇</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.user.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-inkMuted">
            課程
            <select value={programId} onChange={(e) => setProgramId(e.target.value)} className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink">
              <option value="">請選擇</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={createEnrollment}>新增報名</Button>
        </div>
      </Card>
      <Card>
        <CollapsibleDataTable columns={columns} rows={enrollments} keyField={(r) => r.id} maxRows={3} emptyText="目前沒有學生報名個別輔導" />
      </Card>
      {ConfirmDialog}
    </>
  );
}
```

- [ ] **Step 3: Manually verify**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm run dev
```
Log in as admin, open `/admin/tutoring`: create a program, add a window (weekday/time/capacity/teacher), add and remove a closure date, create a student enrollment, override its monthly quota, toggle active, and delete an enrollment. Confirm each action's toast and that the list refreshes correctly. This replaces the manual `prisma studio` seeding used in Task 12's verification — re-verify `/student/tutoring` still works end-to-end using data created here.

- [ ] **Step 4: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/admin/tutoring && git commit -m "feat: 行政端個別輔導課程／窗口／停開／報名管理頁"
```

---

### Task 16: Admin daily booking overview, walk-in add, cancel, monthly attendance summary + CSV export

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts` (adds `listMonthlyAttendanceSummary`)
- Modify: `src/lib/services/tutoringBookingService.test.ts`
- Create: `src/app/api/tutoring-bookings/monthly-summary/route.ts`
- Create: `src/app/admin/tutoring/bookings/page.tsx`

**Interfaces:**
- Consumes: `listBookingsOverview`, `adminCancelBooking`, `createWalkInBooking` (Tasks 6/4/11 — already have routes from Task 11); `GET /api/tutoring-enrollments`, `GET /api/tutoring-programs` (Task 9).
- Produces: `listMonthlyAttendanceSummary(monthKey: string): Promise<MonthlySummaryRow[]>`; `GET /api/tutoring-bookings/monthly-summary?month=YYYY-MM`; the admin daily-overview page at `/admin/tutoring/bookings`.

- [ ] **Step 1: Write the failing test for `listMonthlyAttendanceSummary`**

Add to the imports at the top of `src/lib/services/tutoringBookingService.test.ts`:

```ts
import { listMonthlyAttendanceSummary } from './tutoringBookingService';
```

Append:

```ts
describe('listMonthlyAttendanceSummary', () => {
  it('buckets locked REGULAR bookings into attended/cancelledLate/absent and counts approved MAKEUP separately', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const past = '2020-08-';
    const attended = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '07'), startTime: '16:00', endTime: '18:00' });
    await prisma.tutoringAttendance.create({ data: { bookingId: attended.id, status: 'PRESENT', markedById: 'marker-1' } });

    const lateCancelled = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '14'), startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(lateCancelled.id, true);

    const absentBooking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '21'), startTime: '16:00', endTime: '18:00' });
    await prisma.tutoringAttendance.create({ data: { bookingId: absentBooking.id, status: 'ABSENT', markedById: 'marker-1' } });

    const makeupOriginal = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(past + '28'), startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(makeupOriginal.id, true);
    const makeup = await requestMakeup({ originalBookingId: makeupOriginal.id, windowId: window.id, date: new Date('2020-09-04'), startTime: '16:00', endTime: '18:00' });
    await decideMakeup(makeup.id, 'APPROVED');

    const augustSummary = await listMonthlyAttendanceSummary('2020-08');
    expect(augustSummary).toHaveLength(1);
    expect(augustSummary[0]).toMatchObject({ studentName: '小明', attended: 1, cancelledLate: 2, absent: 1 });

    const septemberSummary = await listMonthlyAttendanceSummary('2020-09');
    expect(septemberSummary[0].makeup).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: FAIL — `listMonthlyAttendanceSummary` not exported.

- [ ] **Step 3: Implement `listMonthlyAttendanceSummary`**

Append to `src/lib/services/tutoringBookingService.ts`:

```ts
export interface MonthlySummaryRow {
  enrollmentId: string;
  studentName: string;
  programName: string;
  attended: number;
  cancelledLate: number;
  absent: number;
  makeup: number;
}

// 已上／當天取消／缺席／補課 統計，供行政對帳與 CSV 匯出。「已上」= 已鎖定且非取消非缺席的
// REGULAR 預約（含尚未點名的，視為已上——月結報表以「有沒有到場義務」為準，不是點名進度表）。
export async function listMonthlyAttendanceSummary(monthKey: string): Promise<MonthlySummaryRow[]> {
  const [year, month] = monthKey.split('-').map(Number);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const todayKey = taipeiDateKey(new Date());

  const bookings = await prisma.tutoringBooking.findMany({
    where: { date: { gte: monthStart, lte: monthEnd } },
    select: {
      date: true,
      kind: true,
      status: true,
      enrollment: { select: { id: true, student: { select: { user: { select: { name: true } } } } } },
      window: { select: { program: { select: { name: true } } } },
      attendance: { select: { status: true } },
    },
  });

  const byEnrollmentId = new Map<string, MonthlySummaryRow>();
  for (const b of bookings) {
    const key = b.enrollment.id;
    if (!byEnrollmentId.has(key)) {
      byEnrollmentId.set(key, {
        enrollmentId: key,
        studentName: b.enrollment.student.user.name,
        programName: b.window.program.name,
        attended: 0,
        cancelledLate: 0,
        absent: 0,
        makeup: 0,
      });
    }
    const row = byEnrollmentId.get(key)!;
    if (b.kind === 'MAKEUP') {
      if (b.status === 'BOOKED') row.makeup++;
      continue;
    }
    if (utcDateKey(b.date) > todayKey) continue;
    if (b.status === 'CANCELLED_LATE') row.cancelledLate++;
    else if (b.attendance?.status === 'ABSENT') row.absent++;
    else if (b.status === 'BOOKED') row.attended++;
  }
  return Array.from(byEnrollmentId.values()).sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: PASS, all tests including the new one.

- [ ] **Step 5: Create the monthly-summary API route**

Create `src/app/api/tutoring-bookings/monthly-summary/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listMonthlyAttendanceSummary } from '@/lib/services/tutoringBookingService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const month = req.nextUrl.searchParams.get('month');
  if (!month) return NextResponse.json({ error: 'month required' }, { status: 400 });
  return NextResponse.json(await listMonthlyAttendanceSummary(month));
}
```

- [ ] **Step 6: Implement the admin daily-overview page**

Create `src/app/admin/tutoring/bookings/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import StatusBadge from '@/components/ui/StatusBadge';
import { Column } from '@/components/ui/DataTable';
import DataTable from '@/components/ui/DataTable';
import ExportCsvButton from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface OverviewRow {
  id: string;
  studentName: string;
  programName: string;
  windowId: string;
  date: string;
  startTime: string;
  endTime: string;
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED_LATE' | 'REJECTED';
}

interface EnrollmentOption {
  id: string;
  studentName: string;
  programId: string;
  programName: string;
}

interface WindowOption {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  programId: string;
}

interface SummaryRow {
  enrollmentId: string;
  studentName: string;
  programName: string;
  attended: number;
  cancelledLate: number;
  absent: number;
  makeup: number;
}

function todayDateInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AdminTutoringBookingsPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [date, setDate] = useState(todayDateInput());
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [enrollments, setEnrollments] = useState<EnrollmentOption[]>([]);
  const [windows, setWindows] = useState<WindowOption[]>([]);
  const [walkInEnrollmentId, setWalkInEnrollmentId] = useState('');
  const [walkInWindowId, setWalkInWindowId] = useState('');
  const [walkInStart, setWalkInStart] = useState('');
  const [walkInEnd, setWalkInEnd] = useState('');
  const [month, setMonth] = useState(todayDateInput().slice(0, 7));
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  async function loadOverview() {
    const res = await fetch(`/api/tutoring-bookings/overview?date=${date}`);
    setRows(await res.json());
  }

  async function loadOptions() {
    const [enrollmentsRes, programsRes] = await Promise.all([fetch('/api/tutoring-enrollments'), fetch('/api/tutoring-programs')]);
    const enrollmentData = await enrollmentsRes.json();
    setEnrollments(enrollmentData.filter((e: { active: boolean }) => e.active).map((e: any) => ({ id: e.id, studentName: e.studentName, programId: e.programId, programName: e.programName })));
    const programData = await programsRes.json();
    setWindows(programData.flatMap((p: any) => p.windows.map((w: any) => ({ ...w, programId: p.id }))));
  }

  async function loadSummary() {
    const res = await fetch(`/api/tutoring-bookings/monthly-summary?month=${month}`);
    setSummary(await res.json());
  }

  useEffect(() => {
    loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  useEffect(() => {
    loadOptions();
  }, []);

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function cancel(row: OverviewRow, countsTowardQuota: boolean) {
    const message = countsTowardQuota ? '確定要取消並計入這位學生本月次數嗎？' : '確定要取消嗎？此次不計入學生次數。';
    if (!(await confirm(message, { danger: true }))) return;
    await fetch(`/api/tutoring-bookings/${row.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countsTowardQuota }),
    });
    showToast('已取消');
    loadOverview();
  }

  async function addWalkIn() {
    if (!walkInEnrollmentId || !walkInWindowId || !walkInStart || !walkInEnd) {
      showToast('請填寫完整的現場補加資訊');
      return;
    }
    const res = await fetch('/api/tutoring-bookings/walk-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enrollmentId: walkInEnrollmentId, windowId: walkInWindowId, date, startTime: walkInStart, endTime: walkInEnd }),
    });
    if (!res.ok) {
      showToast('新增失敗');
      return;
    }
    showToast('已新增現場預約');
    setWalkInEnrollmentId('');
    setWalkInWindowId('');
    setWalkInStart('');
    setWalkInEnd('');
    loadOverview();
  }

  const columns: Column<OverviewRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName },
    { header: '時間', render: (r) => `${r.startTime}-${r.endTime}` },
    { header: '類型', render: (r) => (r.kind === 'MAKEUP' ? '補課' : '一般') },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
    {
      header: '操作',
      render: (r) =>
        r.status === 'BOOKED' ? (
          <div className="flex flex-col gap-1">
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => cancel(r, false)}>
              取消（不計次）
            </Button>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => cancel(r, true)}>
              取消（計次）
            </Button>
          </div>
        ) : (
          <span className="text-inkMuted">—</span>
        ),
    },
  ];

  const summaryColumns: Column<SummaryRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '課程', render: (r) => r.programName },
    { header: '已上', render: (r) => r.attended },
    { header: '當天取消', render: (r) => r.cancelledLate },
    { header: '缺席', render: (r) => r.absent },
    { header: '補課', render: (r) => r.makeup },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">個別輔導預約總覽</h1>

      <div className="mb-4 flex items-center gap-2">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <Card className="mb-6">
        <DataTable columns={columns} rows={rows} keyField={(r) => r.id} emptyText="這天沒有預約" />
      </Card>

      <Card className="mb-6">
        <p className="mb-2 font-semibold text-ink">現場補加（不檢查容量）</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-inkMuted">
            學生
            <select
              value={walkInEnrollmentId}
              onChange={(e) => setWalkInEnrollmentId(e.target.value)}
              className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
            >
              <option value="">請選擇</option>
              {enrollments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.studentName}・{e.programName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-inkMuted">
            窗口
            <select
              value={walkInWindowId}
              onChange={(e) => setWalkInWindowId(e.target.value)}
              className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
            >
              <option value="">請選擇</option>
              {windows
                .filter((w) => !walkInEnrollmentId || w.programId === enrollments.find((e) => e.id === walkInEnrollmentId)?.programId)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.startTime}-{w.endTime}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-inkMuted">
            開始
            <Input type="time" value={walkInStart} onChange={(e) => setWalkInStart(e.target.value)} className="mt-1 w-24 py-1 text-sm" />
          </label>
          <label className="text-xs text-inkMuted">
            結束
            <Input type="time" value={walkInEnd} onChange={(e) => setWalkInEnd(e.target.value)} className="mt-1 w-24 py-1 text-sm" />
          </label>
          <Button onClick={addWalkIn}>新增</Button>
        </div>
      </Card>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="font-bold text-ink">當月出席總表</h2>
        <div className="flex items-center gap-2">
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <ExportCsvButton
            rows={summary}
            filename={`個別輔導出席總表_${month}`}
            columns={[
              { header: '學生', value: (r) => r.studentName },
              { header: '課程', value: (r) => r.programName },
              { header: '已上', value: (r) => r.attended },
              { header: '當天取消', value: (r) => r.cancelledLate },
              { header: '缺席', value: (r) => r.absent },
              { header: '補課', value: (r) => r.makeup },
            ]}
          />
        </div>
      </div>
      <Card>
        <DataTable columns={summaryColumns} rows={summary} keyField={(r) => r.enrollmentId} emptyText="這個月沒有資料" />
      </Card>
      {ConfirmDialog}
    </>
  );
}
```

- [ ] **Step 7: Manually verify**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm run dev
```
Log in as admin, open `/admin/tutoring/bookings`: confirm the day's bookings from earlier tasks' testing appear, cancel one with each option and confirm the count/no-count behavior via `/student/tutoring`, add a walk-in booking for a full window and confirm it succeeds despite capacity, switch the month picker and confirm the summary table and CSV download reflect the right counts (open the downloaded CSV and check it's not mojibake — UTF-8 BOM, matches the existing `ExportCsvButton` convention already verified elsewhere in this codebase).

- [ ] **Step 8: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts src/app/api/tutoring-bookings/monthly-summary src/app/admin/tutoring/bookings && git commit -m "feat: 行政端個別輔導預約總覽、現場補加、當月出席總表與 CSV 匯出"
```

---

### Task 17: Merge the tutoring makeup queue into `/admin/makeup-requests`

**Files:**
- Modify: `src/app/admin/makeup-requests/page.tsx`

**Interfaces:**
- Consumes: `GET /api/tutoring-makeup-requests`, `PATCH /api/tutoring-makeup-requests/:id` (Task 11); existing `GET /api/makeup-requests/pending`, `PATCH /api/makeup-requests/:id`.
- Produces: one merged "待確認補課申請" table with a source filter, per the design doc's decision to keep the two makeup systems' **data layer separate** and only merge the **admin queue UI** (see the design doc's "補課審核畫面與現有補課申請合併，資料層維持分開" section).

- [ ] **Step 1: Add the `ReactNode` import and the merged-row type**

In `src/app/admin/makeup-requests/page.tsx`, change the import block from:

```ts
'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import ArrangeMakeupForm from './ArrangeMakeupForm';
import LeaveRequestList, { LeaveRequestListHandle } from './LeaveRequestList';
```

to:

```ts
'use client';

import { ReactNode, Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import ArrangeMakeupForm from './ArrangeMakeupForm';
import LeaveRequestList, { LeaveRequestListHandle } from './LeaveRequestList';
```

Change the existing `interface PendingRow { ... }` block (unchanged in place) and add two new interfaces right after it:

```ts
interface TutoringPendingRow {
  id: string;
  studentName: string;
  programName: string;
  originalDate: string;
  date: string;
  startTime: string;
  endTime: string;
}

interface MergedRow {
  key: string;
  source: 'CLASS' | 'TUTORING';
  studentName: string;
  origin: string;
  typeBadge: ReactNode;
  dateLabel: string;
  target: ReactNode;
}
```

- [ ] **Step 2: Fetch both sources and merge**

Change the component's state and `load()` from:

```ts
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const leaveListRef = useRef<LeaveRequestListHandle>(null);

  async function load() {
    try {
      const res = await fetch('/api/makeup-requests/pending');
      setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }
```

to:

```ts
  const [classRows, setClassRows] = useState<PendingRow[]>([]);
  const [tutoringRows, setTutoringRows] = useState<TutoringPendingRow[]>([]);
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'CLASS' | 'TUTORING'>('ALL');
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const leaveListRef = useRef<LeaveRequestListHandle>(null);

  async function load() {
    try {
      const [classRes, tutoringRes] = await Promise.all([
        fetch('/api/makeup-requests/pending'),
        fetch('/api/tutoring-makeup-requests'),
      ]);
      setClassRows(await classRes.json());
      setTutoringRows(await tutoringRes.json());
    } finally {
      setLoading(false);
    }
  }
```

- [ ] **Step 3: Build the merged rows and update `decide()`**

Immediately after `load()`, before the existing `useEffect(() => { load(); }, []);`, add:

```ts
  const mergedRows: MergedRow[] = [
    ...classRows.map((r) => ({
      key: r.id,
      source: 'CLASS' as const,
      studentName: r.leaveRequest.student.user.name,
      origin: r.leaveRequest.class.name,
      typeBadge:
        r.type === 'INSERTION' ? (
          <span className="whitespace-nowrap rounded-full bg-approvedBg px-2.5 py-0.5 text-xs font-bold text-approved">插班</span>
        ) : (
          <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">一對一</span>
        ),
      dateLabel: (() => {
        const d = r.type === 'INSERTION' ? r.targetDate : r.slotDate;
        return d ? formatDateWithWeekday(d) : '-';
      })(),
      target:
        r.type === 'INSERTION' ? (
          <span className="whitespace-nowrap">{r.targetClass?.name}</span>
        ) : (
          <div className="flex flex-col items-center">
            <span className="whitespace-nowrap">{r.teacher?.user.name}</span>
            <span className="whitespace-nowrap">{r.slotStartTime}-{r.slotEndTime}</span>
          </div>
        ),
    })),
    ...tutoringRows.map((r) => ({
      key: r.id,
      source: 'TUTORING' as const,
      studentName: r.studentName,
      origin: `${r.programName}・原 ${formatDateWithWeekday(r.originalDate)}`,
      typeBadge: (
        <span className="whitespace-nowrap rounded-full bg-pendingBg px-2.5 py-0.5 text-xs font-bold text-pending">個別輔導補課</span>
      ),
      dateLabel: formatDateWithWeekday(r.date),
      target: <span className="whitespace-nowrap">{r.startTime}-{r.endTime}</span>,
    })),
  ];
  const visibleRows = sourceFilter === 'ALL' ? mergedRows : mergedRows.filter((r) => r.source === sourceFilter);
```

Change the existing `decide` function from:

```ts
  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    setPendingId(id);
    try {
      await fetch(`/api/makeup-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
      showToast(decision === 'APPROVED' ? '已核准' : '已拒絕');
      load();
      leaveListRef.current?.reload();
    } finally {
      setPendingId(null);
    }
  }
```

to:

```ts
  async function decide(row: MergedRow, decision: 'APPROVED' | 'REJECTED') {
    setPendingId(row.key);
    try {
      const path = row.source === 'CLASS' ? `/api/makeup-requests/${row.key}` : `/api/tutoring-makeup-requests/${row.key}`;
      await fetch(path, { method: 'PATCH', body: JSON.stringify({ decision }) });
      showToast(decision === 'APPROVED' ? '已核准' : '已拒絕');
      load();
      leaveListRef.current?.reload();
    } finally {
      setPendingId(null);
    }
  }
```

- [ ] **Step 4: Replace the `columns` definition and the table's JSX**

Change the existing `const columns: Column<PendingRow>[] = [...]` block entirely to:

```ts
  const columns: Column<MergedRow>[] = [
    { header: '學生', render: (r) => r.studentName },
    { header: '來源／原班級', render: (r) => <span className="whitespace-nowrap">{r.origin}</span> },
    { header: '類型', render: (r) => r.typeBadge },
    { header: '補課日期', render: (r) => <span className="whitespace-nowrap">{r.dateLabel}</span> },
    { header: '目標', render: (r) => r.target },
    { header: '狀態', render: () => <StatusBadge status="PENDING_ADMIN" /> },
    {
      header: '操作',
      render: (r) => (
        <div className="flex gap-2">
          <Button className="px-3 py-1 text-xs" onClick={() => decide(r, 'APPROVED')} loading={pendingId === r.key}>
            核准
          </Button>
          <Button
            variant="secondary"
            className="px-3 py-1 text-xs"
            onClick={() => decide(r, 'REJECTED')}
            loading={pendingId === r.key}
          >
            拒絕
          </Button>
        </div>
      ),
    },
  ];
```

Change the JSX block:

```tsx
      <h2 className="mb-2 font-bold text-ink">待確認補課申請</h2>
      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          keyField={(r) => r.id}
          rowClassName={(r) => (r.id === highlightId ? 'bg-pendingBg' : '')}
          loading={loading}
          emptyText="目前沒有待確認的補課申請"
        />
      </Card>
```

to:

```tsx
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-ink">待確認補課申請</h2>
        <div className="flex gap-2">
          {(['ALL', 'CLASS', 'TUTORING'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setSourceFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                sourceFilter === f ? 'bg-brand text-brandInk' : 'border border-borderStrong text-inkMuted'
              }`}
            >
              {f === 'ALL' ? '全部' : f === 'CLASS' ? '班級補課' : '輔導補課'}
            </button>
          ))}
        </div>
      </div>
      <Card>
        <DataTable
          columns={columns}
          rows={visibleRows}
          keyField={(r) => `${r.source}-${r.key}`}
          rowClassName={(r) => (r.key === highlightId ? 'bg-pendingBg' : '')}
          loading={loading}
          emptyText="目前沒有待確認的補課申請"
        />
      </Card>
```

- [ ] **Step 5: Fix the `highlightId` effect dependency**

The existing effect `useEffect(() => { if (!highlightId || rows.length === 0) return; ... }, [highlightId, rows]);` references the now-renamed `rows` state. Change it to:

```ts
  useEffect(() => {
    if (!highlightId || mergedRows.length === 0) return;
    document.getElementById(highlightId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, mergedRows.length]);
```

- [ ] **Step 6: Manually verify**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx tsc --noEmit && npm run dev
```
Log in as admin, open `/admin/makeup-requests`, submit a tutoring makeup request (via a student flow from Task 12), confirm it shows in the merged table tagged "個別輔導補課", filter by "輔導補課" and "班級補課" to confirm the toggle works, approve it and confirm `/student/tutoring` reflects `BOOKED`. Confirm existing class-based makeup approve/reject still works unchanged.

- [ ] **Step 7: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/admin/makeup-requests/page.tsx && git commit -m "feat: 補課審核佇列合併顯示班級與個別輔導補課申請"
```

---

### Task 18: Vercel Cron — monthly quota reminder on the 20th

**Files:**
- Create: `vercel.json`

**Interfaces:**
- Consumes: `GET /api/cron/tutoring-quota-reminder` (Task 11).
- Produces: a Vercel Cron trigger. This project has no existing `vercel.json`, so this task creates it fresh rather than merging into one.

- [ ] **Step 1: Create `vercel.json`**

Vercel Cron schedules run in UTC. Taipei is UTC+8, so "20th, morning in Taipei" (e.g. 09:00 Taipei) is `01:00 UTC` on the same calendar day:

```json
{
  "crons": [
    {
      "path": "/api/cron/tutoring-quota-reminder",
      "schedule": "0 1 20 * *"
    }
  ]
}
```

- [ ] **Step 2: Set `CRON_SECRET` in Vercel**

This is a one-time manual step (not a code change) — tell the user to run, or run it yourself with their confirmation since it touches the production Vercel project's environment variables:

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npx vercel env add CRON_SECRET production
```
When prompted, enter a random secret (e.g. generate one with `openssl rand -hex 32`). Vercel automatically sends this same value as `Authorization: Bearer <value>` on every cron invocation — no separate wiring needed beyond the route's own check (already implemented in Task 11, Step 6).

- [ ] **Step 3: Manually verify locally**

Cron schedules only fire on Vercel, not locally — verify the route logic directly:

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm run dev
```
```bash
curl -i http://localhost:3000/api/cron/tutoring-quota-reminder -H "Authorization: Bearer wrong-secret"
```
Expected: `403`. Then, with `CRON_SECRET` set in `.env.local` to a known value and the dev server restarted:
```bash
curl -i http://localhost:3000/api/cron/tutoring-quota-reminder -H "Authorization: Bearer <the local CRON_SECRET value>"
```
Expected: `200` with `{"notified": N}`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add vercel.json && git commit -m "feat: 個別輔導月中額度提醒 Vercel Cron（每月20號台北時間上午）"
```

---

### Task 19: Update the student guide (`/guide`) and regenerate the PDF manual

**Files:**
- Modify: `src/app/guide/page.tsx`
- Create (screenshots): `public/manual/m31-tutoring-dashboard-card.png`, `public/manual/m32-tutoring-availability.png`, `public/manual/m33-tutoring-booking-list.png`
- Create (temporary, not committed): `scripts/capture-tutoring-screenshots.mjs`
- Modify: `docs/manual/學生帳號使用手冊.pdf`

**Interfaces:**
- Consumes: the deployed/dev-running UI from Tasks 12-13 (student `/student` and `/student/tutoring` pages) — this task **must run after Tasks 12-13 are merged**, since it screenshots real rendered pages.
- Produces: a new Chapter 9 "個別輔導預約" on the public `/guide` page, and a regenerated PDF. This is the item flagged in project memory (`project_tutoring_module.md`) as required before this feature can be considered shipped.

This mirrors the exact process used for the original guide (see project memory `project_student_guide.md`): Playwright + the system's installed Chrome (`playwright-core` is already in `devDependencies` — no new dependency needed), `locale: 'zh-TW'`, `timezoneId: 'Asia/Taipei'`, viewport 375×812 at `deviceScaleFactor: 2`, driving the real seed account (`student@example.com` / `password123`), a red outline injected via `page.evaluate` to highlight the tapped element, and PIL to crop trailing whitespace and quantize to 256 colors before saving into `public/manual/`. The prior capture script no longer exists (it lived in a since-cleared session scratchpad, per project memory) — this task rewrites it from scratch; that is expected, not a gap.

- [ ] **Step 1: Confirm the dev server is running the latest merged code**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git log --oneline -1 && git status --porcelain
```
Expected: on `main`, clean, with Task 12-18's commits present. (Per the lesson already recorded in project memory: a stale dev server produces outdated screenshots — restart `npm run dev` fresh right before capturing, don't reuse a long-running one.)

- [ ] **Step 2: Seed a tutoring enrollment for the screenshot account**

Use the admin UI built in Task 15 (`/admin/tutoring`) to: create a program named "英文個別輔導", add a window (e.g. 週五 16:00-21:00, capacity 8, any teacher), and enroll `student@example.com`'s student record into it. This gives the screenshot flow real data to show (an empty state screenshots poorly).

- [ ] **Step 3: Write the capture script**

Create `scripts/capture-tutoring-screenshots.mjs`:

```js
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE_URL = 'http://localhost:3000';
const OUT_DIR = 'public/manual';

async function highlightAndShoot(page, selector, outPath) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.outline = '3px solid #e11d48';
  }, selector);
  await page.screenshot({ path: outPath });
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.outline = '';
  }, selector);
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}/login`);
  await page.getByPlaceholder('帳號').fill('student@example.com');
  await page.getByPlaceholder('密碼').fill('password123');
  await page.getByRole('button', { name: '登入' }).click();
  await page.waitForURL(`${BASE_URL}/`);

  // m31: dashboard tutoring card
  await page.goto(`${BASE_URL}/student`);
  await page.waitForSelector('text=個別輔導');
  await highlightAndShoot(page, 'text=個別輔導', `${OUT_DIR}/m31-tutoring-dashboard-card.png`);

  // m32: availability + time picker open
  await page.goto(`${BASE_URL}/student/tutoring`);
  await page.waitForSelector('text=未來兩週可預約時段');
  await page.locator('button:has-text("16:00-21:00")').first().click();
  await page.waitForSelector('text=確定預約');
  await page.screenshot({ path: `${OUT_DIR}/m32-tutoring-availability.png` });

  // m33: my bookings list
  await page.locator('button:has-text("取消")').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForSelector('text=我的預約紀錄');
  await page.screenshot({ path: `${OUT_DIR}/m33-tutoring-booking-list.png` });

  await browser.close();

  for (const name of ['m31-tutoring-dashboard-card.png', 'm32-tutoring-availability.png', 'm33-tutoring-booking-list.png']) {
    execFileSync('python3', [
      '-c',
      `
from PIL import Image
img = Image.open("${OUT_DIR}/${name}")
img = img.convert('P', palette=Image.ADAPTIVE, colors=256)
img.save("${OUT_DIR}/${name}")
`,
    ]);
  }
}

main();
```

Run it against a freshly-started dev server:

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm run dev &
sleep 3
node scripts/capture-tutoring-screenshots.mjs
```

Inspect the three PNGs in `public/manual/` — if a selector didn't match the real rendered DOM (e.g. the window's actual time label differs from `"16:00-21:00"`), adjust the script's selector to match the real button/text on the page and re-run. Once satisfied:

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && rm scripts/capture-tutoring-screenshots.mjs
```
(This script is a one-off capture tool, not part of the shipped app — matching the precedent that the prior guide's capture script was never committed either.)

- [ ] **Step 4: Add Chapter 9 to `/guide`**

In `src/app/guide/page.tsx`, immediately after the closing `</Chapter>` of the existing `Chapter no="8" title="活動專區"` block and before the closing `</main>`, insert:

```tsx
        <Chapter no="9" title="個別輔導預約">
          <Step no="1" title="從首頁進入" img="m31-tutoring-dashboard-card.png" imgAlt="首頁個別輔導卡片">
            如果您有報名英文或數學個別輔導，首頁會多一張<b className="text-ink">個別輔導</b>卡片，顯示本月已上堂數；點卡片進入預約頁面。
          </Step>
          <Step no="2" title="挑日期與時間" img="m32-tutoring-availability.png" imgAlt="選擇預約日期與時間">
            預約頁列出未來兩週可預約的日子，每天旁邊的小標籤是各時段<b className="text-ink">剩餘名額</b>（紅色代表已滿）。點日期展開後選開始與結束時間，按「確定預約」即可，
            <b className="text-ink">不需要經過行政審核</b>。
          </Step>
          <Step no="3" title="我的預約紀錄" img="m33-tutoring-booking-list.png" imgAlt="我的預約紀錄表格">
            這裡列出所有預約紀錄與狀態。<b className="text-ink">前一天 23:59 前</b>都可以直接按「取消」，不計入次數；如果是<b className="text-ink">當天才取消或沒來</b>，會計入本月次數，事後可以按「申請補課」另約時間，待行政核准。
          </Step>
          <Tip title="本月次數怎麼算？">
            每月 1 號重新歸零，「已計次」是當天已到、當天取消、或缺席的預約堂數；申請補課核准後不會重複計次。若快到月底還有很多堂沒約，系統會透過
            LINE 提醒您。
          </Tip>
        </Chapter>
```

- [ ] **Step 5: Manually verify the guide page**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && npm run dev
```
Open `http://localhost:3000/guide` (no login required — it's public), expand Chapter 9, confirm all three images load and the copy reads correctly, in both light and dark mode (per this codebase's dark-mode convention).

- [ ] **Step 6: Regenerate the PDF**

The PDF is a printable rendering of the same `/guide` page (single source of truth — no separate content to maintain). Force every `<details>` open and print via Playwright:

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && node -e "
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/guide', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => (d.open = true)));
  await page.pdf({ path: 'docs/manual/學生帳號使用手冊.pdf', format: 'A4', printBackground: true, margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } });
  await browser.close();
})();
"
```

Open the resulting PDF and confirm: all 9 chapters are present and expanded, the new Chapter 9 content and its 3 screenshots render correctly, and page count/layout is reasonable (no broken page breaks mid-image — if there are, add `style={{ breakInside: 'avoid' }}` to the `Chapter`/`Step` wrapper `<div>`s in `page.tsx` and re-run this step).

- [ ] **Step 7: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ" && git add src/app/guide/page.tsx public/manual/m31-tutoring-dashboard-card.png public/manual/m32-tutoring-availability.png public/manual/m33-tutoring-booking-list.png docs/manual/學生帳號使用手冊.pdf && git commit -m "docs: 使用教學新增個別輔導預約章節，重產 PDF 手冊"
```

This is the final task — once committed and pushed, the feature (from schema through UI, attendance integration, cron reminder, and documentation) is complete per the design doc's "上線步驟".
