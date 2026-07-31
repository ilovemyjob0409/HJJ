# Shared Test-DB Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the intermittent FK-constraint `npm test` failures by replacing every test file's hand-maintained `beforeEach` cleanup sweep with one canonical, dynamically-computed, FK-safe reset utility wired into `vitest.setup.ts`.

**Architecture:** A new `resetDb()` helper in `src/lib/testUtils/resetDb.ts` queries Postgres' `pg_tables` catalog for every table in the `public` schema at call time and issues a single `TRUNCATE TABLE ... CASCADE` statement covering all of them. Because it's computed from the live schema rather than a hand-written list, it can never go stale as models are added (e.g. by the in-flight LINE-notifications branch) — the exact failure mode that caused this bug. `vitest.setup.ts` registers one global `beforeEach` that calls it, so every test in every file starts from a guaranteed-empty database regardless of which file ran before it. Every service/route test file's local `beforeEach` deleteMany sweep (and the one-off `afterAll` residue-cleanup in `activityService.test.ts`) is deleted, since the global hook now provides a stronger guarantee than any of them did individually.

**Tech Stack:** Vitest, Prisma 7 (`@prisma/adapter-pg`), Postgres (local, `tutoring_makeup_system_test` database).

## Global Constraints

- Root cause (confirmed 2026-07-30 via direct `psql` inspection): `vitest.config.ts` sets `fileParallelism: false`, so all `src/**/*.test.ts` files share one physical Postgres database sequentially in one process. `vitest.setup.ts` only ever set `DATABASE_URL`; there was no global teardown, so leftover rows from whichever file's last test ran persisted into the next file, and each file's own hand-written `beforeEach` sweep only cleared the tables *it* knew about — not the tables a *later* file would need cleared.
- `vitest.setup.ts` currently does `process.env.DATABASE_URL = '...tutoring_makeup_system_test'` as its only top-level statement, with **no imports**. This is load-bearing: `src/lib/db.ts` reads `process.env.DATABASE_URL` at module top-level (`createPrismaClient()` runs at import time), and ES module `import` evaluation always runs before the importing module's own top-level statements — regardless of textual order. If `vitest.setup.ts` statically imports anything that transitively imports `@/lib/db`, that import chain would evaluate `db.ts` (and thus read `DATABASE_URL`) *before* the override assignment runs, silently pointing tests at the wrong database (or crashing on `new URL('')` if unset). **Every task below that touches `vitest.setup.ts` must use a dynamic `await import(...)` inside the hook callback, never a static top-level import of anything that reaches `@/lib/db`.**
- Table list must be the full FK-ordered union already present across every file's existing `beforeEach`/`afterAll` (see Task 3's file list) — but the implementation deliberately does not hand-maintain this list; it queries it live so no schema change can make it go stale again. Do not hand-write a table array anywhere in this plan.
- `TRUNCATE ... CASCADE` on the union of every table in the same statement is FK-order-independent by construction — do not attempt to reintroduce a manually FK-ordered delete sequence.
- Global hook is `beforeEach`, not `afterEach`: this preserves the existing contract every test file already relies on (DB is empty when a test body starts, including the very first test of the very first file — `db push --accept-data-loss` does not clear row data, only schema), and it leaves a failing test's leftover rows in place until the *next* test runs, which is what made `psql` inspection possible during this bug's original diagnosis. Do not switch this to `afterEach`.
- Do not touch anything under the `line-notifications` worktree/branch — this fix targets `main` only and must stay mergeable independently of that feature work.

---

## File Structure Overview

```
src/
  lib/
    testUtils/
      resetDb.ts          # NEW — dynamic pg_tables query + single TRUNCATE ... CASCADE
      resetDb.test.ts      # NEW — verifies cross-FK rows are gone after resetDb()
vitest.setup.ts             # MODIFIED — adds global beforeEach calling resetDb() via dynamic import
src/lib/services/*.test.ts (13 files) # MODIFIED — delete local beforeEach deleteMany sweeps
src/app/api/activities/[id]/images/route.test.ts # MODIFIED — delete deleteMany calls, keep sessionMock.mockReset()
```

---

### Task 1: Create the canonical `resetDb()` utility

**Files:**
- Create: `src/lib/testUtils/resetDb.ts`
- Test: `src/lib/testUtils/resetDb.test.ts`

**Interfaces:**
- Produces: `resetDb(): Promise<void>` — truncates every table in the `public` schema (CASCADE), for later tasks to call from `vitest.setup.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/testUtils/resetDb.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { resetDb } from './resetDb';

describe('resetDb', () => {
  it('empties tables linked by foreign keys without throwing FK violations', async () => {
    const user = await prisma.user.create({
      data: { email: 'reset-test@example.com', password: 'x', name: '測試', role: 'TEACHER' },
    });
    const teacher = await prisma.teacher.create({
      data: { userId: user.id, subjects: '數學' },
    });
    await prisma.class.create({
      data: { name: '測試班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' },
    });

    await resetDb();

    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.teacher.count()).toBe(0);
    expect(await prisma.class.count()).toBe(0);
  });

  it('is safe to call when the tables are already empty', async () => {
    await resetDb();
    await expect(resetDb()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:dbpush && npx vitest run src/lib/testUtils/resetDb.test.ts`
Expected: FAIL — `Cannot find module './resetDb'` (file doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/testUtils/resetDb.ts
import { prisma } from '@/lib/db';

export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  if (tables.length === 0) return;

  const identifiers = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${identifiers} CASCADE`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/testUtils/resetDb.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/testUtils/resetDb.ts src/lib/testUtils/resetDb.test.ts
git commit -m "test: add canonical FK-safe resetDb() utility"
```

---

### Task 2: Wire `resetDb()` into a global `beforeEach`

**Files:**
- Modify: `vitest.setup.ts`

**Interfaces:**
- Consumes: `resetDb(): Promise<void>` from Task 1, imported dynamically (see Global Constraints — static import would break `DATABASE_URL` ordering).

- [ ] **Step 1: Replace the file contents**

```typescript
// vitest.setup.ts
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/tutoring_makeup_system_test';

import { beforeEach } from 'vitest';

beforeEach(async () => {
  const { resetDb } = await import('@/lib/testUtils/resetDb');
  await resetDb();
});
```

- [ ] **Step 2: Run the full suite once to confirm the setup file itself doesn't break anything**

Run: `npm test`
Expected: All currently-passing tests still pass (individual files still also run their own now-redundant `beforeEach` sweeps at this point — that's fine, harmless double cleanup, removed in Task 3). This step is only checking the setup file loads and connects correctly, not fixing flakiness yet.

- [ ] **Step 3: Commit**

```bash
git add vitest.setup.ts
git commit -m "test: reset DB globally before every test via resetDb()"
```

---

### Task 3: Remove every ad-hoc `beforeEach`/`afterAll` sweep

**Files (delete the listed block from each; keep everything else in the file unchanged):**

- Modify: `src/lib/services/activityImageService.test.ts` — delete lines 29-37 (`beforeEach` block, 9 `deleteMany` calls)
- Modify: `src/lib/services/activityService.test.ts` — delete lines 29-46 (`beforeEach` block, 16 calls) **and** delete lines 429-442 (the `afterAll` residue-cleanup block + its explanatory comment — no longer needed, the global `beforeEach` makes per-file residue irrelevant)
- Modify: `src/lib/services/attendanceService.test.ts` — delete lines 12-33 (`beforeEach` block, 20 calls)
- Modify: `src/lib/services/availabilityService.test.ts` — delete lines 6-18 (`beforeEach` block, 11 calls)
- Modify: `src/lib/services/classService.test.ts` — delete lines 19-35 (`beforeEach` block, 15 calls)
- Modify: `src/lib/services/faqService.test.ts` — delete lines 5-8 (`beforeEach` block, 1 call)
- Modify: `src/lib/services/goHallService.test.ts` — delete lines 18-30 (`beforeEach` block, 11 calls)
- Modify: `src/lib/services/leaveRequestService.test.ts` — delete lines 9-21 (`beforeEach` block, 11 calls)
- Modify: `src/lib/services/makeupRequestService.test.ts` — delete lines 17-30 (`beforeEach` block, 11 calls) — this removes the file's pre-existing `Class`-before-`ClassAttendance` ordering bug for free, since there's no longer a local sweep to order
- Modify: `src/lib/services/studentService.test.ts` — delete lines 10-26 (`beforeEach` block, 15 calls)
- Modify: `src/lib/services/subjectColorService.test.ts` — delete lines 5-8 (`beforeEach` block, 1 call)
- Modify: `src/lib/services/substituteRequestService.test.ts` — delete lines 12-24 (`beforeEach` block, 11 calls)
- Modify: `src/lib/services/teacherService.test.ts` — delete lines 7-19 (`beforeEach` block, 11 calls)
- Modify: `src/lib/services/userService.test.ts` — delete lines 5-17 (`beforeEach` block, 11 calls)
- Modify: `src/app/api/activities/[id]/images/route.test.ts` — in the `beforeEach` block at lines 34-44, delete only the 7 `deleteMany` lines (35-42); **keep** `sessionMock.mockReset();` and keep the `beforeEach` wrapper itself, since it still does non-DB setup

**For every file above:** after deleting its `beforeEach`/`afterAll` block, if `beforeEach` (or `afterAll`) is no longer referenced anywhere else in that file, remove it from that file's `import { ... } from 'vitest'` line too (unused-import cleanup). Every file in this list except the API route file loses `beforeEach` entirely from its imports; `activityService.test.ts` loses `afterAll` but keeps `beforeEach` (still used, now empty-bodied — actually delete the whole now-empty `beforeEach` per the line range above, so it loses both); the API route file keeps `beforeEach` (still used for `sessionMock.mockReset()`).

- [ ] **Step 1: Apply all deletions listed above**

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors (confirms no orphaned imports or unused variables were left behind)

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: All tests pass, run in whatever the natural file order is

- [ ] **Step 4: Commit**

```bash
git add src/lib/services/*.test.ts "src/app/api/activities/[id]/images/route.test.ts"
git commit -m "test: remove ad-hoc per-file DB cleanup sweeps, rely on global resetDb()"
```

---

### Task 4: Verify the flakiness is actually gone

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite 5 times in a row**

Run:
```bash
for i in 1 2 3 4 5; do echo "=== run $i ==="; npm test || break; done
```
Expected: All 5 runs pass with 0 FK-constraint failures. If any run fails, stop and diagnose — do not re-run hoping it passes (that's exactly the flakiness this plan exists to remove).

- [ ] **Step 2: Run a subset combination known to previously fail, to confirm it's specifically fixed**

Run: `npx vitest run src/lib/services/attendanceService.test.ts src/lib/services/makeupRequestService.test.ts`
Expected: PASS — this is the `ClassAttendance`-before-`Class` ordering combination documented as broken in project memory; the global `beforeEach` must handle it regardless of order since it computes the table list dynamically instead of relying on either file's own list.

- [ ] **Step 3: No commit needed** — this task only confirms Tasks 1-3 worked. If it fails, return to Task 3 and re-check the deletions rather than adding a new workaround here.

---

## Self-Review Notes

- **Spec coverage:** Task 1 = canonical utility (spec step 2-3), Task 2 = wiring (spec step 3, "single afterEach (or afterAll)" — implemented as `beforeEach` instead; see Global Constraints for why, no behavior gap since either hook gives every test a clean DB, and `beforeEach` additionally covers the very-first-test-of-the-run case without a second hook), Task 3 = migration (spec step 3), Task 4 = repeated-run verification (spec step 5). Spec step 1 (grep enumeration) was already performed during planning and is captured in Task 3's file list and this plan's Global Constraints.
- **Placeholder scan:** no TBD/TODO markers; every step has real code or an exact line range.
- **Type consistency:** `resetDb(): Promise<void>` — same signature used in Task 1's test, Task 2's dynamic import call site.
