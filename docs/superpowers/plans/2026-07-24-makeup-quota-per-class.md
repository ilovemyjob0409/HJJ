# 補課名額改為依班級獨立計算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scope the existing quarterly makeup-quota rule (2 combined requests, 1 of which may be one-on-one) from "per student across all classes" to "per student per class" — each class a student is enrolled in gets its own independent quota.

**Architecture:** The scoping key changes from `studentId` alone to `(studentId, classId)` everywhere quota is counted, using the `classId` of the **leave request being made up** (not an insertion's target class). This is a signature change to the existing shared `getQuotaCounts` helper and its three callers — no new files, no schema changes, no frontend changes (the frontend already re-fetches quota per selected leave record; scoping it server-side is transparent to it).

**Tech Stack:** Same as before — Prisma/Postgres service layer, Vitest.

## Global Constraints

- Quota scoping key: `(studentId, classId)`, where `classId` is the `classId` of the **leave request** the makeup is for — for insertion, this is *not* the same as `targetClassId`.
- Quota-counting statuses: only `PENDING_ADMIN` and `APPROVED` count (unchanged).
- Total quarterly quota: 2; one-on-one sub-quota: 1, inside the total (unchanged numbers — only the scoping changes).
- No schema changes (`LeaveRequest.classId` already exists).
- No frontend changes required — `src/app/student/makeup-request/page.tsx` is out of scope for this plan.
- Spec reference: `docs/superpowers/specs/2026-07-24-makeup-quota-per-class-design.md`

---

### Task 1: Scope quota counting to `(studentId, classId)`

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts`
- Modify: `src/app/api/makeup-requests/route.ts`
- Test: `src/lib/services/makeupRequestService.test.ts`

**Interfaces:**
- Changes: `getMakeupQuotaStatus(studentId: string)` → `getMakeupQuotaStatus(studentId: string, classId: string): Promise<MakeupQuotaStatus>` (return shape `{ insertionRemaining, oneOnOneRemaining }` unchanged)
- Changes (internal, not exported): `getQuotaCounts(client, studentId, start, end)` → `getQuotaCounts(client, studentId, classId, start, end): Promise<{ totalUsed: number; oneOnOneUsed: number }>`
- No change to `CreateInsertionInput` or `CreateOneOnOneInput` — both `createInsertionMakeupRequestTx` and `createOneOnOneMakeupRequestTx` already have (or will look up) the leave record inside their transaction, so `classId` is derived internally, not added to either public input type.

- [ ] **Step 1: Write the failing test for per-class independence**

Add this test to `src/lib/services/makeupRequestService.test.ts`, inside the existing `describe('getMakeupQuotaStatus', ...)` block (after the `'releases quota back after a one-on-one request is rejected'` test):

```ts
  it('tracks quota independently per class', async () => {
    const { teacher, student, classA, classB, leave } = await setup();
    await enrollStudent(classB.id, student.id);

    // Use up classA's total quota (2) with two insertions.
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeaveA = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeaveA.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });

    const classAQuota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(classAQuota).toEqual({ insertionRemaining: 0, oneOnOneRemaining: 0 });

    // classB is a different class for the same student — must be unaffected.
    const classBQuota = await getMakeupQuotaStatus(student.id, classB.id);
    expect(classBQuota).toEqual({ insertionRemaining: 2, oneOnOneRemaining: 1 });

    // A makeup request against classB's own leave must succeed even though classA is exhausted.
    const classBLeave = await createLeaveRequest({ studentId: student.id, classId: classB.id, date: new Date(2026, 6, 28), reason: '事假' });
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: classBLeave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date(2026, 6, 15),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });
    expect(makeup.status).toBe('PENDING_ADMIN');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts -t "tracks quota independently per class"`
Expected: FAIL — `getMakeupQuotaStatus` currently takes only one argument (`studentId`); calling it with a second `classId` argument is accepted by JS at runtime (extra args are ignored) but the function's *behavior* ignores `classId` entirely, so `classAQuota` and `classBQuota` will be computed identically (both reflecting the student's combined usage across both classes) — the assertion `expect(classBQuota).toEqual({ insertionRemaining: 2, oneOnOneRemaining: 1 })` fails because `classBQuota` will actually be `{ insertionRemaining: 0, oneOnOneRemaining: 0 }` (classA's usage bleeding into classB).

- [ ] **Step 3: Update `getQuotaCounts` and `getMakeupQuotaStatus` to scope by classId**

In `src/lib/services/makeupRequestService.ts`, replace the `getQuotaCounts` function (current lines 22-42):

```ts
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
```

with:

```ts
async function getQuotaCounts(client: ClientType, studentId: string, classId: string, start: Date, end: Date) {
  const [totalUsed, oneOnOneUsed] = await Promise.all([
    client.makeupRequest.count({
      where: {
        type: { in: ['INSERTION', 'ONE_ON_ONE'] },
        status: { in: ['PENDING_ADMIN', 'APPROVED'] },
        leaveRequest: { studentId, classId },
        createdAt: { gte: start, lte: end },
      },
    }),
    client.makeupRequest.count({
      where: {
        type: 'ONE_ON_ONE',
        status: { in: ['PENDING_ADMIN', 'APPROVED'] },
        leaveRequest: { studentId, classId },
        createdAt: { gte: start, lte: end },
      },
    }),
  ]);
  return { totalUsed, oneOnOneUsed };
}
```

Then replace `getMakeupQuotaStatus` (current lines 44-52):

```ts
export async function getMakeupQuotaStatus(studentId: string): Promise<MakeupQuotaStatus> {
  const { start, end } = getQuarterRange(new Date());
  const { totalUsed, oneOnOneUsed } = await getQuotaCounts(prisma, studentId, start, end);

  const totalRemaining = Math.max(0, TOTAL_QUARTER_LIMIT - totalUsed);
  const oneOnOneRemaining = Math.min(Math.max(0, ONE_ON_ONE_QUARTER_LIMIT - oneOnOneUsed), totalRemaining);

  return { insertionRemaining: totalRemaining, oneOnOneRemaining };
}
```

with:

```ts
export async function getMakeupQuotaStatus(studentId: string, classId: string): Promise<MakeupQuotaStatus> {
  const { start, end } = getQuarterRange(new Date());
  const { totalUsed, oneOnOneUsed } = await getQuotaCounts(prisma, studentId, classId, start, end);

  const totalRemaining = Math.max(0, TOTAL_QUARTER_LIMIT - totalUsed);
  const oneOnOneRemaining = Math.min(Math.max(0, ONE_ON_ONE_QUARTER_LIMIT - oneOnOneUsed), totalRemaining);

  return { insertionRemaining: totalRemaining, oneOnOneRemaining };
}
```

- [ ] **Step 4: Update the two write-path callers of `getQuotaCounts`**

In `createInsertionMakeupRequestTx` (current lines 64-84), the existing leave lookup already selects `studentId`; add `classId` to the same `select` and pass it through:

```ts
function createInsertionMakeupRequestTx(input: CreateInsertionInput) {
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUniqueOrThrow({
      where: { id: input.leaveRequestId },
      select: { studentId: true },
    });
    const { start, end } = getQuarterRange(new Date());
    const { totalUsed } = await getQuotaCounts(tx, leave.studentId, start, end);
    if (totalUsed >= TOTAL_QUARTER_LIMIT) throw new Error('QUOTA_EXCEEDED');
```

becomes:

```ts
function createInsertionMakeupRequestTx(input: CreateInsertionInput) {
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUniqueOrThrow({
      where: { id: input.leaveRequestId },
      select: { studentId: true, classId: true },
    });
    const { start, end } = getQuarterRange(new Date());
    const { totalUsed } = await getQuotaCounts(tx, leave.studentId, leave.classId, start, end);
    if (totalUsed >= TOTAL_QUARTER_LIMIT) throw new Error('QUOTA_EXCEEDED');
```

(the rest of the function is unchanged).

In `createOneOnOneMakeupRequestTx` (current lines 100-106), there is currently no leave lookup at all — it only uses `input.studentId`. Add a leave lookup for `classId` before the quota check:

```ts
function createOneOnOneMakeupRequestTx(input: CreateOneOnOneInput) {
  return prisma.$transaction(async (tx) => {
    const { start, end } = getQuarterRange(new Date());
    const { totalUsed, oneOnOneUsed } = await getQuotaCounts(tx, input.studentId, start, end);
    if (oneOnOneUsed >= ONE_ON_ONE_QUARTER_LIMIT || totalUsed >= TOTAL_QUARTER_LIMIT) {
      throw new Error('QUOTA_EXCEEDED');
    }
```

becomes:

```ts
function createOneOnOneMakeupRequestTx(input: CreateOneOnOneInput) {
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUniqueOrThrow({
      where: { id: input.leaveRequestId },
      select: { classId: true },
    });
    const { start, end } = getQuarterRange(new Date());
    const { totalUsed, oneOnOneUsed } = await getQuotaCounts(tx, input.studentId, leave.classId, start, end);
    if (oneOnOneUsed >= ONE_ON_ONE_QUARTER_LIMIT || totalUsed >= TOTAL_QUARTER_LIMIT) {
      throw new Error('QUOTA_EXCEEDED');
    }
```

(the rest of the function — availability check, slot conflict check, create — is unchanged).

- [ ] **Step 5: Update the four existing test call sites in `getMakeupQuotaStatus`'s describe block to pass `classId`**

In `src/lib/services/makeupRequestService.test.ts`, update these four calls (all currently `getMakeupQuotaStatus(student.id)`) to pass the class the test's leave record belongs to — `classA.id` in every case, since `setup()`'s `leave` is always against `classA`:

1. `'returns full quota when nothing has been used this quarter'` (currently destructures `const { student } = await setup();`) — change to `const { student, classA } = await setup();` and the call to `getMakeupQuotaStatus(student.id, classA.id)`.
2. `'reduces both remaining counts after a one-on-one request'` (currently `const { teacher, student, leave } = await setup();`) — change to `const { teacher, student, classA, leave } = await setup();` and the call to `getMakeupQuotaStatus(student.id, classA.id)`.
3. `'reduces insertion remaining to zero and keeps one-on-one at zero after two insertions'` — already destructures `classA`; just change the call to `getMakeupQuotaStatus(student.id, classA.id)`.
4. `'releases quota back after a one-on-one request is rejected'` (currently `const { teacher, student, leave } = await setup();`) — change to `const { teacher, student, classA, leave } = await setup();` and the call to `getMakeupQuotaStatus(student.id, classA.id)`.

- [ ] **Step 6: Run the new test to verify it passes**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts -t "tracks quota independently per class"`
Expected: PASS

- [ ] **Step 7: Update the API route's call site**

In `src/app/api/makeup-requests/route.ts`, replace (current lines 37-38):

```ts
  const eligibleClasses = await listClassesBySubjectAndLevel(leave.class.subject, leave.class.level, leave.classId);
  const quota = await getMakeupQuotaStatus(student.id);
```

with:

```ts
  const eligibleClasses = await listClassesBySubjectAndLevel(leave.class.subject, leave.class.level, leave.classId);
  const quota = await getMakeupQuotaStatus(student.id, leave.classId);
```

- [ ] **Step 8: Run the full service test file to confirm everything passes**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: PASS — all tests, including the four updated `getMakeupQuotaStatus` tests (their assertions don't change, only the call sites gain a `classId` argument, and since every test in this file only ever uses `classA` for its student's leave, the numeric expectations are unaffected by the new scoping) and the new per-class independence test.

- [ ] **Step 9: Run `leaveRequestService.test.ts` (a cross-file caller of `createInsertionMakeupRequest`) and `npx tsc --noEmit`**

Run: `npx vitest run src/lib/services/leaveRequestService.test.ts`
Expected: PASS (this file doesn't call `getMakeupQuotaStatus` and `createInsertionMakeupRequest`'s public signature is unchanged, so it should be unaffected)

Run: `npx tsc --noEmit`
Expected: no output, exit code 0

- [ ] **Step 10: Commit**

```bash
git add src/lib/services/makeupRequestService.ts src/lib/services/makeupRequestService.test.ts src/app/api/makeup-requests/route.ts
git commit -m "Scope makeup quota per class instead of per student"
```
