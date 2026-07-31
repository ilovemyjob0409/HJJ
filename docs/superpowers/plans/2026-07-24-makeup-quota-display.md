# 補課名額規則調整與剩餘次數顯示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the makeup-class quota rule from "one-on-one limited to once per quarter" to "2 combined makeup requests per quarter (insertion + one-on-one), with one-on-one further capped at 1 within that total," and show each student their live remaining counts (with the exhausted option disabled) on the makeup-request page.

**Architecture:** All quota math lives in one new read-only function in the existing service layer (`getMakeupQuotaStatus`), reused by both the write-path quota checks (inside the existing serializable transactions) and the new read-path the GET route exposes to the frontend. No schema changes.

**Tech Stack:** Next.js API routes, Prisma (Postgres), Vitest for service tests. No component-test framework exists in this repo — the frontend task is verified manually via the dev server per existing project convention.

## Global Constraints

- Quarter boundaries: natural calendar quarters (Q1 Jan-Mar … Q4 Oct-Dec), via existing `getQuarterRange()` in `src/lib/quarter.ts` — do not reimplement.
- Quota-counting statuses: only `PENDING_ADMIN` and `APPROVED` count against quota; `REJECTED` does not.
- Total quarterly quota: 2 (insertion + one-on-one combined).
- One-on-one sub-quota: 1, and it is *inside* the total 2, not additive.
- Reuse the existing `QUOTA_EXCEEDED` error string/error code for every quota rejection (frontend already maps it to a Chinese message) — do not invent new error codes.
- Frontend exhausted-option copy is exactly: `請洽櫃檯了解補課規範`
- Frontend remaining-count copy is exactly: `剩餘 X 次` (X = the number)
- Spec reference: `docs/superpowers/specs/2026-07-24-makeup-quota-display-design.md`

---

### Task 1: `getMakeupQuotaStatus` + total-quota check on one-on-one creation

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts:1-88`
- Test: `src/lib/services/makeupRequestService.test.ts`

**Interfaces:**
- Produces: `TOTAL_QUARTER_LIMIT: number` (=2), `ONE_ON_ONE_QUARTER_LIMIT: number` (=1), exported constants from `makeupRequestService.ts`
- Produces: `getMakeupQuotaStatus(studentId: string): Promise<{ insertionRemaining: number; oneOnOneRemaining: number }>`, exported from `makeupRequestService.ts`
- Produces: an internal (not exported) helper `getQuotaCounts(client, studentId, start, end): Promise<{ totalUsed: number; oneOnOneUsed: number }>` that Task 2 also calls — see Step 3 for its exact signature, matching the `ClientType` pattern already used in `src/lib/services/availabilityService.ts` (`type ClientType = typeof prisma | Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>`) so it works with both the plain `prisma` client and a `tx` transaction client.
- Consumes: existing `prisma` from `@/lib/db`, `getQuarterRange` from `@/lib/quarter`

- [ ] **Step 1: Write the failing tests for `getMakeupQuotaStatus`**

Add to `src/lib/services/makeupRequestService.test.ts`, add the import and a new `describe` block. Update the top import line:

```ts
import {
  createInsertionMakeupRequest,
  createOneOnOneMakeupRequest,
  listPendingMakeupRequests,
  decideMakeupRequest,
  listInsertionsForTeacherClasses,
  getMakeupQuotaStatus,
} from './makeupRequestService';
```

Add this new describe block right after the closing `});` of the `describe('createOneOnOneMakeupRequest', ...)` block (currently ending at line 208, i.e. insert before `describe('listPendingMakeupRequests / decideMakeupRequest', ...)`):

```ts
describe('getMakeupQuotaStatus', () => {
  it('returns full quota when nothing has been used this quarter', async () => {
    const { student } = await setup();
    const quota = await getMakeupQuotaStatus(student.id);
    expect(quota).toEqual({ insertionRemaining: 2, oneOnOneRemaining: 1 });
  });

  it('reduces both remaining counts after a one-on-one request', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date(2026, 6, 15),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    const quota = await getMakeupQuotaStatus(student.id);
    expect(quota).toEqual({ insertionRemaining: 1, oneOnOneRemaining: 0 });
  });

  it('reduces insertion remaining to zero and keeps one-on-one at zero after two insertions', async () => {
    const { student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });

    const quota = await getMakeupQuotaStatus(student.id);
    expect(quota).toEqual({ insertionRemaining: 0, oneOnOneRemaining: 0 });
  });
});
```

This test file does not currently import `createLeaveRequest` — add it to the existing import block at the top:

```ts
import { createLeaveRequest } from './leaveRequestService';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts -t "getMakeupQuotaStatus"`
Expected: FAIL — `getMakeupQuotaStatus is not a function` (or import error)

- [ ] **Step 3: Implement the shared quota-counting helper, the constants, and `getMakeupQuotaStatus`**

In `src/lib/services/makeupRequestService.ts`, add after the imports (after line 6):

```ts
export const TOTAL_QUARTER_LIMIT = 2;
export const ONE_ON_ONE_QUARTER_LIMIT = 1;

export interface MakeupQuotaStatus {
  insertionRemaining: number;
  oneOnOneRemaining: number;
}

type ClientType = typeof prisma | Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;

// Shared by getMakeupQuotaStatus (read-only snapshot for display) and the
// write-path quota checks in createOneOnOneMakeupRequestTx /
// createInsertionMakeupRequestTx (which pass their `tx` client so the count
// is read inside the same serializable transaction as the check-then-act).
async function getQuotaCounts(client: ClientType, studentId: string, start: Date, end: Date) {
  const [totalUsed, oneOnOneUsed] = await Promise.all([
    client.makeupRequest.count({
      where: {
        type: { in: ['INSERTION', 'ONE_ON_ONE'] },
        status: { in: ['PENDING_ADMIN', 'APPROVED'] },
        leaveRequest: { studentId },
        createdAt: { gte: start, lte: end },
      },
    }),
    client.makeupRequest.count({
      where: {
        type: 'ONE_ON_ONE',
        status: { in: ['PENDING_ADMIN', 'APPROVED'] },
        leaveRequest: { studentId },
        createdAt: { gte: start, lte: end },
      },
    }),
  ]);
  return { totalUsed, oneOnOneUsed };
}

export async function getMakeupQuotaStatus(studentId: string): Promise<MakeupQuotaStatus> {
  const { start, end } = getQuarterRange(new Date());
  const { totalUsed, oneOnOneUsed } = await getQuotaCounts(prisma, studentId, start, end);

  const totalRemaining = Math.max(0, TOTAL_QUARTER_LIMIT - totalUsed);
  const oneOnOneRemaining = Math.min(Math.max(0, ONE_ON_ONE_QUARTER_LIMIT - oneOnOneUsed), totalRemaining);

  return { insertionRemaining: totalRemaining, oneOnOneRemaining };
}
```

- [ ] **Step 4: Run tests to verify the new tests pass**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts -t "getMakeupQuotaStatus"`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for the total-quota check on one-on-one creation**

Add this test inside the existing `describe('createOneOnOneMakeupRequest', ...)` block, after the existing `'throws QUOTA_EXCEEDED when student already has a pending/approved one-on-one request this quarter'` test (after line 136, before the concurrency tests):

```ts
  it('throws QUOTA_EXCEEDED when the total quarterly quota (2) is already used by insertions alone', async () => {
    const { teacher, student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });

    const thirdLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 30), reason: '事假' });

    await expect(
      createOneOnOneMakeupRequest({
        leaveRequestId: thirdLeave.id,
        studentId: student.id,
        teacherId: teacher.id,
        slotDate: new Date(2026, 6, 15),
        slotStartTime: '16:00',
        slotEndTime: '17:00',
      })
    ).rejects.toThrow('QUOTA_EXCEEDED');
  });
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts -t "total quarterly quota"`
Expected: FAIL — request resolves instead of rejecting (current code only checks the one-on-one-specific count, which is 0 here)

- [ ] **Step 7: Update `createOneOnOneMakeupRequestTx` to enforce both the sub-quota and the total quota**

In `src/lib/services/makeupRequestService.ts`, replace the quota-check block inside `createOneOnOneMakeupRequestTx` (current lines 42-51):

```ts
    const { start, end } = getQuarterRange(new Date());
    const quotaUsed = await tx.makeupRequest.count({
      where: {
        type: 'ONE_ON_ONE',
        status: { in: ['PENDING_ADMIN', 'APPROVED'] },
        leaveRequest: { studentId: input.studentId },
        createdAt: { gte: start, lte: end },
      },
    });
    if (quotaUsed > 0) throw new Error('QUOTA_EXCEEDED');
```

with:

```ts
    const { start, end } = getQuarterRange(new Date());
    const { totalUsed, oneOnOneUsed } = await getQuotaCounts(tx, input.studentId, start, end);
    if (oneOnOneUsed >= ONE_ON_ONE_QUARTER_LIMIT || totalUsed >= TOTAL_QUARTER_LIMIT) {
      throw new Error('QUOTA_EXCEEDED');
    }
```

- [ ] **Step 8: Run the full service test file to confirm the new test passes and nothing regressed**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: PASS — all tests in the file, including the pre-existing `'throws QUOTA_EXCEEDED when student already has a pending/approved one-on-one request this quarter'` and the two concurrency tests

- [ ] **Step 9: Commit**

```bash
git add src/lib/services/makeupRequestService.ts src/lib/services/makeupRequestService.test.ts
git commit -m "Add getMakeupQuotaStatus and enforce combined quarterly quota on one-on-one requests"
```

---

### Task 2: Total-quota check on insertion creation

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts` (the `createInsertionMakeupRequest` function, currently lines 8-24)
- Test: `src/lib/services/makeupRequestService.test.ts`

**Interfaces:**
- Consumes: `TOTAL_QUARTER_LIMIT`, `getQuarterRange`, `runSerializableWithRetry`, and the internal `getQuotaCounts(client, studentId, start, end)` helper (all already in scope/defined in this file after Task 1 — `getQuotaCounts` returns `{ totalUsed: number; oneOnOneUsed: number }`; this task only needs `totalUsed`)
- Produces: `createInsertionMakeupRequest(input: CreateInsertionInput): Promise<MakeupRequest>` — same exported name, same parameter shape (`CreateInsertionInput` is **not** changed — no `studentId` field is added; the function derives it internally from `input.leaveRequestId`), now backed by a serializable transaction instead of a bare `prisma.makeupRequest.create`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('createInsertionMakeupRequest', ...)` block in `src/lib/services/makeupRequestService.test.ts` (after the existing single test, around line 46):

```ts
  it('throws QUOTA_EXCEEDED when the student already has 2 requests this quarter', async () => {
    const { student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });

    const thirdLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 30), reason: '事假' });

    await expect(
      createInsertionMakeupRequest({ leaveRequestId: thirdLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 7, 1) })
    ).rejects.toThrow('QUOTA_EXCEEDED');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts -t "already has 2 requests"`
Expected: FAIL — request resolves instead of rejecting (insertion creation currently has no quota check at all)

- [ ] **Step 3: Wrap `createInsertionMakeupRequest` in a quota-checked transaction**

In `src/lib/services/makeupRequestService.ts`, replace the current `createInsertionMakeupRequest` function (lines 14-24):

```ts
export function createInsertionMakeupRequest(input: CreateInsertionInput) {
  return prisma.makeupRequest.create({
    data: {
      leaveRequestId: input.leaveRequestId,
      type: 'INSERTION',
      status: 'PENDING_ADMIN',
      targetClassId: input.targetClassId,
      targetDate: input.targetDate,
    },
  });
}
```

with:

```ts
export function createInsertionMakeupRequest(input: CreateInsertionInput) {
  return runSerializableWithRetry(() => createInsertionMakeupRequestTx(input));
}

function createInsertionMakeupRequestTx(input: CreateInsertionInput) {
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUniqueOrThrow({
      where: { id: input.leaveRequestId },
      select: { studentId: true },
    });
    const { start, end } = getQuarterRange(new Date());
    const { totalUsed } = await getQuotaCounts(tx, leave.studentId, start, end);
    if (totalUsed >= TOTAL_QUARTER_LIMIT) throw new Error('QUOTA_EXCEEDED');

    return tx.makeupRequest.create({
      data: {
        leaveRequestId: input.leaveRequestId,
        type: 'INSERTION',
        status: 'PENDING_ADMIN',
        targetClassId: input.targetClassId,
        targetDate: input.targetDate,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
```

- [ ] **Step 4: Run the full service test file to confirm the new test passes and nothing regressed**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: PASS — all tests, including the pre-existing `'creates a PENDING_ADMIN insertion request'` test and `listInsertionsForTeacherClasses` (both call `createInsertionMakeupRequest` and expect normal, non-quota-limited creation to keep working)

- [ ] **Step 5: Run the `leaveRequestService` test file, which also calls `createInsertionMakeupRequest`**

Run: `npx vitest run src/lib/services/leaveRequestService.test.ts`
Expected: PASS — confirms the now-async, transaction-backed `createInsertionMakeupRequest` still works from this other caller without any changes to that test file

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/makeupRequestService.ts src/lib/services/makeupRequestService.test.ts
git commit -m "Enforce combined quarterly quota on insertion makeup requests"
```

---

### Task 3: Expose quota via the API and show it on the student makeup-request page

**Files:**
- Modify: `src/app/api/makeup-requests/route.ts:1-39` (GET handler)
- Modify: `src/app/student/makeup-request/page.tsx`

**Interfaces:**
- Consumes: `getMakeupQuotaStatus(studentId: string): Promise<{ insertionRemaining: number; oneOnOneRemaining: number }>` from Task 1
- Produces: GET `/api/makeup-requests?leaveRequestId=...` response shape becomes `{ eligibleClasses: ClassOption[]; quota: { insertionRemaining: number; oneOnOneRemaining: number } }`

No automated test for this task — this repo has no API-route or React-component test infrastructure (confirmed: `find src/app/api -name "*.test.ts"` returns nothing). Task 1 and 2 already cover the underlying quota math and enforcement with service tests. This task is verified manually against the running dev server (steps below).

- [ ] **Step 1: Add quota to the GET response**

In `src/app/api/makeup-requests/route.ts`, add the import (alongside the existing service imports, line 7):

```ts
import { createInsertionMakeupRequest, createOneOnOneMakeupRequest, getMakeupQuotaStatus } from '@/lib/services/makeupRequestService';
```

Replace the final two lines of the `GET` function (currently lines 37-38):

```ts
  const eligibleClasses = await listClassesBySubjectAndLevel(leave.class.subject, leave.class.level, leave.classId);
  return NextResponse.json({ eligibleClasses });
```

with:

```ts
  const eligibleClasses = await listClassesBySubjectAndLevel(leave.class.subject, leave.class.level, leave.classId);
  const quota = await getMakeupQuotaStatus(student.id);
  return NextResponse.json({ eligibleClasses, quota });
```

- [ ] **Step 2: Add quota state and fetch it alongside `eligibleClasses`**

In `src/app/student/makeup-request/page.tsx`, add a `Quota` interface near the other interfaces (after `AvailabilityWindow`, around line 38):

```ts
interface Quota {
  insertionRemaining: number;
  oneOnOneRemaining: number;
}
```

Add the state (alongside the existing `useState` calls, after `const [message, setMessage] = useState('');` at line 47):

```ts
  const [quota, setQuota] = useState<Quota | null>(null);
```

Update the `eligibleClasses` fetch effect (currently lines 57-62) to also capture `quota`:

```ts
  useEffect(() => {
    if (!selectedLeaveId) return;
    fetch(`/api/makeup-requests?leaveRequestId=${selectedLeaveId}`)
      .then((r) => r.json())
      .then((data) => {
        setEligibleClasses(data.eligibleClasses);
        setQuota(data.quota);
      });
  }, [selectedLeaveId]);
```

- [ ] **Step 3: Auto-switch away from an already-exhausted default selection**

Add this effect right after the one from Step 2, so a student whose default `makeupType` (`'INSERTION'`) is already at 0 gets moved to the type that still has quota:

```ts
  useEffect(() => {
    if (!quota) return;
    if (makeupType === 'INSERTION' && quota.insertionRemaining === 0 && quota.oneOnOneRemaining > 0) {
      setMakeupType('ONE_ON_ONE');
    } else if (makeupType === 'ONE_ON_ONE' && quota.oneOnOneRemaining === 0 && quota.insertionRemaining > 0) {
      setMakeupType('INSERTION');
    }
  }, [quota, makeupType]);
```

- [ ] **Step 4: Show remaining counts and disable exhausted options**

Replace the radio-button block (currently lines 130-137):

```jsx
          <div className="mb-4 flex gap-4 text-sm text-ink">
            <label className="flex items-center gap-1">
              <input type="radio" checked={makeupType === 'INSERTION'} onChange={() => setMakeupType('INSERTION')} /> 插班補課
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={makeupType === 'ONE_ON_ONE'} onChange={() => setMakeupType('ONE_ON_ONE')} /> 一對一補課
            </label>
          </div>
```

with:

```jsx
          <div className="mb-4 flex gap-6 text-sm text-ink">
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={makeupType === 'INSERTION'}
                  disabled={quota?.insertionRemaining === 0}
                  onChange={() => setMakeupType('INSERTION')}
                />
                插班補課
              </span>
              {quota && (
                <span className="text-xs text-inkMuted">
                  {quota.insertionRemaining > 0 ? `剩餘 ${quota.insertionRemaining} 次` : '請洽櫃檯了解補課規範'}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={makeupType === 'ONE_ON_ONE'}
                  disabled={quota?.oneOnOneRemaining === 0}
                  onChange={() => setMakeupType('ONE_ON_ONE')}
                />
                一對一補課
              </span>
              {quota && (
                <span className="text-xs text-inkMuted">
                  {quota.oneOnOneRemaining > 0 ? `剩餘 ${quota.oneOnOneRemaining} 次` : '請洽櫃檯了解補課規範'}
                </span>
              )}
            </label>
          </div>
```

- [ ] **Step 5: Manual verification against the dev server**

Start the dev server (Postgres must already be running locally — confirm with `pg_isready -h localhost -p 5432`):

```bash
npm run dev
```

Use the seeded student account `student@example.com` / `password123` (from `prisma/seed.ts`; run `npm run seed` first if the test/dev DB is empty). The seeded student is enrolled in `數學A班` (Monday) and the seeded teacher has one-on-one availability Wednesday 16:00-18:00.

In the browser:
1. Log in as the student, go to 申請補課.
2. Create 2 leave requests (via 我的請假/請假申請) for `數學A班` on two different dates, then come back to 申請補課 and select the first leave record without a makeup yet.
   - Expected: both 插班補課 and 一對一補課 show `剩餘 2 次` / `剩餘 1 次` respectively, neither disabled.
3. Submit an 一對一補課 request for that first leave record (pick a Wednesday date within 16:00-18:00).
   - Expected: success message; quota now used once for one-on-one.
4. Select the second leave record.
   - Expected: 插班補課 shows `剩餘 1 次` (still enabled); 一對一補課 shows `請洽櫃檯了解補課規範` and its radio is disabled, and since it was not the currently-selected type this doesn't trigger the auto-switch.
5. Create a third leave request, submit an 插班補課 request against it (any eligible class).
   - Expected: success; total now at 2/2 used this quarter.
6. Create a fourth leave request and select it.
   - Expected: both 插班補課 and 一對一補課 show `請洽櫃檯了解補課規範` and both radios are disabled.
7. Check the browser console and network tab for errors during all of the above (no errors expected).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/makeup-requests/route.ts src/app/student/makeup-request/page.tsx
git commit -m "Show remaining makeup quota and disable exhausted options on the student request page"
```
