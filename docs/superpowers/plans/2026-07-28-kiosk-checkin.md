# 櫃檯自助報到（條碼掃描）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student scan their existing student-ID barcode at a front-desk computer and have the system automatically figure out which of today's class/one-on-one sessions they're checking into (or out of), with zero admin interaction needed per scan.

**Architecture:** Add a `studentNumber` column to `Student` (the barcode's content). A new service function `checkInByStudentNumber` looks up the student, gathers today's candidate sessions (enrolled classes on today's weekday, approved insertion makeups targeting today, approved one-on-one makeups slotted today), picks the one whose start time is closest to the scan time (within a 60-minute window), and marks it present (first scan) or fills in a check-out time (any later scan). A new admin-only API route exposes this, and a new full-screen kiosk page keeps a hidden input permanently focused so a barcode scanner (which types like a keyboard, ending with Enter) works without the operator selecting anything.

**Tech Stack:** Same as the rest of the app — Next.js 14 (App Router) + TypeScript, Prisma 7 + Postgres (`prisma db push`, no migration files — see Global Constraints), next-auth, Tailwind, Vitest (real Postgres test DB via `test:dbpush`, no mocking).

## Global Constraints

- This project has no `prisma/migrations` folder — schema changes are applied with `npx prisma db push` against the dev DB and `npm run test:dbpush` against the test DB (`tutoring_makeup_system_test`). Never run `prisma migrate`.
- API routes do inline `getServerSession` + role checks (no shared middleware) — copy the exact pattern from `src/app/api/attendance/sessions/route.ts`.
- No comments unless they explain a non-obvious WHY (this codebase's established convention).
- This codebase has zero API-route test files and zero `*.test.tsx` component/page test files — those tasks are verified by `npx tsc --noEmit` + `npx eslint` + manual browser check, not automated tests. Service-layer functions (`src/lib/services/*.ts`) do get real Vitest coverage against the test DB.
- `checkInTime`/`checkOutTime` are free-text `String?` columns (e.g. `"18:55"`) — no Date/time type, no validation, matching every other attendance table in this codebase.
- The **60-minute matching window** and **"any scan after check-in overwrites check-out time"** behavior are both explicit product decisions from the approved design doc ([`docs/superpowers/specs/2026-07-28-kiosk-checkin-design.md`](../specs/2026-07-28-kiosk-checkin-design.md)) — do not soften or add extra states.
- Scope is 班級課 + 一對一補課 only. 弈廳/活動 are explicitly out of scope for this plan.

**Note on one spec deviation:** the design doc asks for the kiosk page to have no top navigation bar. This app's `src/app/admin/layout.tsx` wraps every `/admin/*` route (including the new kiosk page) in the shared `AppShell` nav automatically — there is no per-page opt-out without restructuring routing, which isn't worth it for this feature. Task 7 keeps the standard nav; the existing "點名" tab already serves as the way back, so the extra explicit "返回" link from the spec is dropped as redundant.

---

### Task 1: Schema — add `studentNumber` to `Student`

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Student.studentNumber: string | null`, unique. Task 2 and Task 4 read/write it.

- [ ] **Step 1: Add the field**

In `prisma/schema.prisma`, find `model Student` (currently):

```prisma
model Student {
  id                    String                 @id @default(cuid())
  userId                String                 @unique
  user                  User                   @relation(fields: [userId], references: [id])
  parentPhone           String?
  enrollments           ClassEnrollment[]
  leaveRequests         LeaveRequest[]
  goHallRegistrations   GoHallRegistration[]
  activityRegistrations ActivityRegistration[]
  classAttendances    ClassAttendance[]
  goHallAttendances   GoHallAttendance[]
  activityAttendances ActivityAttendance[]
}
```

Replace with:

```prisma
model Student {
  id                    String                 @id @default(cuid())
  userId                String                 @unique
  user                  User                   @relation(fields: [userId], references: [id])
  parentPhone           String?
  studentNumber         String?                @unique
  enrollments           ClassEnrollment[]
  leaveRequests         LeaveRequest[]
  goHallRegistrations   GoHallRegistration[]
  activityRegistrations ActivityRegistration[]
  classAttendances    ClassAttendance[]
  goHallAttendances   GoHallAttendance[]
  activityAttendances ActivityAttendance[]
}
```

- [ ] **Step 2: Push the schema to the dev DB**

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.` and a regenerated `@prisma/client`.

- [ ] **Step 3: Push the schema to the test DB**

Run: `npm run test:dbpush`
Expected: same success output, targeting `tutoring_makeup_system_test`.

- [ ] **Step 4: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: no errors (nothing references the new field yet, this just confirms the client regenerated cleanly).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat: add unique studentNumber column to Student for barcode check-in

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `attendanceService` — `checkInByStudentNumber`

**Files:**
- Modify: `src/lib/services/attendanceService.ts`
- Modify: `src/lib/services/attendanceService.test.ts`

**Interfaces:**
- Consumes: nothing new (existing `prisma` import; existing `AttendanceStatusValue` type already in this file).
- Produces: `interface CheckInResult { result: 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT'; studentName?: string; sessionTitle?: string; time?: string }` and `checkInByStudentNumber(code: string, dateStr: string, timeStr: string, markedById: string): Promise<CheckInResult>`. Task 3's API route is the only consumer.
- `dateStr` is a `"YYYY-MM-DD"` string (parsed the same way every other date-taking function in this file already does: `new Date(dateStr)`); `timeStr` is a `"HH:mm"` string. Both come from the *client's* local clock (Task 7 computes them in the browser) — this function never calls `new Date()` itself, so it stays deterministic and testable and avoids any server-timezone mismatch.

- [ ] **Step 1: Write the failing tests**

Add to the end of `src/lib/services/attendanceService.test.ts` (the file already imports `createTeacher`, `createStudent`, `createClass`, `enrollStudent`, `createLeaveRequest`, `createInsertionMakeupRequest`, `decideMakeupRequest`, `createOneOnOneMakeupRequest` — add `checkInByStudentNumber` to the existing import from `./attendanceService` on line 8):

```ts
import { getClassRoster, saveClassAttendance, getClassEnrollmentQuota, getOneOnOneAttendance, saveOneOnOneAttendance, getGoHallRoster, saveGoHallAttendance, getActivityRoster, saveActivityAttendance, listAttendanceSessionsForDate, checkInByStudentNumber } from './attendanceService';
```

Then append this new `describe` block at the end of the file:

```ts
describe('checkInByStudentNumber', () => {
  async function setupStudentWithNumber(studentNumber: string, email: string) {
    const student = await createStudent({ name: '小明', email, password: 'x' });
    await prisma.student.update({ where: { id: student.id }, data: { studentNumber } });
    return student;
  }

  it('returns NOT_FOUND when no student has that number', async () => {
    const result = await checkInByStudentNumber('unknown-code', '2026-08-04', '19:00', 'marker-1');
    expect(result).toEqual({ result: 'NOT_FOUND' });
  });

  it('checks in to a regular class scheduled today, within the time window', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen1@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S001', 'checkin-ming1@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const result = await checkInByStudentNumber('S001', '2026-08-04', '18:55', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '數學A班', time: '18:55' });
    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record?.status).toBe('PRESENT');
    expect(record?.checkInTime).toBe('18:55');
  });

  it('checks out on a second scan, and overwrites checkOutTime on every later scan', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen2@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S002', 'checkin-ming2@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await checkInByStudentNumber('S002', '2026-08-04', '18:55', 'marker-1');

    const secondScan = await checkInByStudentNumber('S002', '2026-08-04', '20:50', 'marker-1');
    expect(secondScan.result).toBe('CHECKED_OUT');
    expect(secondScan.time).toBe('20:50');

    const thirdScan = await checkInByStudentNumber('S002', '2026-08-04', '20:55', 'marker-1');
    expect(thirdScan.result).toBe('CHECKED_OUT');
    expect(thirdScan.time).toBe('20:55');

    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record?.checkInTime).toBe('18:55');
    expect(record?.checkOutTime).toBe('20:55');
  });

  it('returns NO_SESSION when the only class today is outside the 60-minute window', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen3@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S003', 'checkin-ming3@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const result = await checkInByStudentNumber('S003', '2026-08-04', '10:00', 'marker-1');

    expect(result).toEqual({ result: 'NO_SESSION' });
  });

  it('checks in via an approved insertion makeup targeting a class the student is not otherwise enrolled in', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen4@example.com', password: 'x', subjects: '圍棋' });
    const student = await setupStudentWithNumber('S004', 'checkin-ming4@example.com');
    const homeClass = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    const targetClass = await createClass({ name: '週二進階班', subject: '圍棋', level: '進階', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(homeClass.id, student.id);
    const leave = await createLeaveRequest({ studentId: student.id, classId: homeClass.id, date: new Date('2026-08-04'), reason: '調課' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: new Date('2026-08-04') });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    const result = await checkInByStudentNumber('S004', '2026-08-04', '18:55', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '週二進階班', time: '18:55' });
    const record = await prisma.classAttendance.findUnique({ where: { makeupRequestId: makeup.id } });
    expect(record?.studentId).toBe(student.id);
    expect(record?.checkInTime).toBe('18:55');
  });

  it('checks in and out via an approved one-on-one makeup slot today', async () => {
    const availabilityTeacher = await createTeacher({ name: '林老師', email: 'checkin-lin@example.com', password: 'x', subjects: '圍棋' });
    await prisma.teacherAvailability.create({ data: { teacherId: availabilityTeacher.id, weekday: 2, startTime: '14:00', endTime: '18:00' } });
    const homeTeacher = await createTeacher({ name: '陳老師', email: 'checkin-chen5@example.com', password: 'x', subjects: '圍棋' });
    const student = await setupStudentWithNumber('S005', 'checkin-ming5@example.com');
    const homeClass = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: homeTeacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(homeClass.id, student.id);
    const leave = await createLeaveRequest({ studentId: student.id, classId: homeClass.id, date: new Date('2026-08-04'), reason: '請假' });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: availabilityTeacher.id,
      slotDate: new Date('2026-08-04'),
      slotStartTime: '15:00',
      slotEndTime: '16:00',
    });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    const checkIn = await checkInByStudentNumber('S005', '2026-08-04', '14:55', 'marker-1');
    expect(checkIn).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '一對一補課', time: '14:55' });

    const checkOut = await checkInByStudentNumber('S005', '2026-08-04', '15:58', 'marker-1');
    expect(checkOut.result).toBe('CHECKED_OUT');

    const record = await prisma.oneOnOneAttendance.findUnique({ where: { makeupRequestId: makeup.id } });
    expect(record?.checkInTime).toBe('14:55');
    expect(record?.checkOutTime).toBe('15:58');
  });

  it('picks the nearer of two candidate classes when both are within the window', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen6@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S006', 'checkin-ming6@example.com');
    const classA = await createClass({ name: 'A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '20:00' });
    const classB = await createClass({ name: 'B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:30', endTime: '20:30' });
    await enrollStudent(classA.id, student.id);
    await enrollStudent(classB.id, student.id);

    const result = await checkInByStudentNumber('S006', '2026-08-04', '19:20', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: 'B班', time: '19:20' });
    const recordA = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: classA.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(recordA).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL — `checkInByStudentNumber` doesn't exist yet (import error / undefined function).

- [ ] **Step 3: Write the implementation**

In `src/lib/services/attendanceService.ts`, add this at the end of the file:

```ts
export interface CheckInResult {
  result: 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT';
  studentName?: string;
  sessionTitle?: string;
  time?: string;
}

const CHECKIN_WINDOW_MINUTES = 60;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

interface CheckInCandidate {
  diffMinutes: number;
  title: string;
  apply: () => Promise<'CHECKED_IN' | 'CHECKED_OUT'>;
}

async function applyClassAttendance(input: {
  classId: string;
  studentId: string;
  date: Date;
  timeStr: string;
  markedById: string;
  makeupRequestId?: string;
}): Promise<'CHECKED_IN' | 'CHECKED_OUT'> {
  const where = input.makeupRequestId
    ? { makeupRequestId: input.makeupRequestId }
    : { classId_studentId_date: { classId: input.classId, studentId: input.studentId, date: input.date } };
  const existing = await prisma.classAttendance.findUnique({ where });
  if (!existing || !existing.checkInTime) {
    await prisma.classAttendance.upsert({
      where,
      create: {
        classId: input.classId,
        studentId: input.studentId,
        date: input.date,
        status: 'PRESENT',
        checkInTime: input.timeStr,
        makeupRequestId: input.makeupRequestId,
        markedById: input.markedById,
      },
      update: { status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById },
    });
    return 'CHECKED_IN';
  }
  await prisma.classAttendance.update({ where, data: { checkOutTime: input.timeStr, markedById: input.markedById } });
  return 'CHECKED_OUT';
}

async function applyOneOnOneAttendance(input: {
  makeupRequestId: string;
  timeStr: string;
  markedById: string;
}): Promise<'CHECKED_IN' | 'CHECKED_OUT'> {
  const where = { makeupRequestId: input.makeupRequestId };
  const existing = await prisma.oneOnOneAttendance.findUnique({ where });
  if (!existing || !existing.checkInTime) {
    await prisma.oneOnOneAttendance.upsert({
      where,
      create: { makeupRequestId: input.makeupRequestId, status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById },
      update: { status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById },
    });
    return 'CHECKED_IN';
  }
  await prisma.oneOnOneAttendance.update({ where, data: { checkOutTime: input.timeStr, markedById: input.markedById } });
  return 'CHECKED_OUT';
}

export async function checkInByStudentNumber(
  code: string,
  dateStr: string,
  timeStr: string,
  markedById: string
): Promise<CheckInResult> {
  const student = await prisma.student.findUnique({
    where: { studentNumber: code },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!student) return { result: 'NOT_FOUND' };

  const date = new Date(dateStr);
  const weekday = date.getDay();
  const nowMinutes = toMinutes(timeStr);

  const [enrollments, insertions, oneOnOnes] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { studentId: student.id, class: { weekday } },
      select: { class: { select: { id: true, name: true, startTime: true } } },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'INSERTION', status: 'APPROVED', targetDate: date, leaveRequest: { studentId: student.id } },
      select: { id: true, targetClass: { select: { id: true, name: true, startTime: true } } },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'ONE_ON_ONE', status: 'APPROVED', slotDate: date, leaveRequest: { studentId: student.id } },
      select: { id: true, slotStartTime: true },
    }),
  ]);

  const candidates: CheckInCandidate[] = [];

  for (const e of enrollments) {
    const cls = e.class;
    candidates.push({
      diffMinutes: Math.abs(nowMinutes - toMinutes(cls.startTime)),
      title: cls.name,
      apply: () => applyClassAttendance({ classId: cls.id, studentId: student.id, date, timeStr, markedById }),
    });
  }

  for (const ins of insertions) {
    if (!ins.targetClass) continue;
    const cls = ins.targetClass;
    candidates.push({
      diffMinutes: Math.abs(nowMinutes - toMinutes(cls.startTime)),
      title: cls.name,
      apply: () =>
        applyClassAttendance({ classId: cls.id, studentId: student.id, date, timeStr, markedById, makeupRequestId: ins.id }),
    });
  }

  for (const o of oneOnOnes) {
    candidates.push({
      diffMinutes: Math.abs(nowMinutes - toMinutes(o.slotStartTime!)),
      title: '一對一補課',
      apply: () => applyOneOnOneAttendance({ makeupRequestId: o.id, timeStr, markedById }),
    });
  }

  const withinWindow = candidates.filter((c) => c.diffMinutes <= CHECKIN_WINDOW_MINUTES);
  if (withinWindow.length === 0) return { result: 'NO_SESSION' };
  withinWindow.sort((a, b) => a.diffMinutes - b.diffMinutes);
  const match = withinWindow[0];

  const action = await match.apply();
  return { result: action, studentName: student.user.name, sessionTitle: match.title, time: timeStr };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: PASS — all tests in the file green (pre-existing ones plus the 7 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "$(cat <<'EOF'
feat: add checkInByStudentNumber for barcode-driven attendance matching

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: API route — `POST /api/attendance/checkin`

**Files:**
- Create: `src/app/api/attendance/checkin/route.ts`

**Interfaces:**
- Consumes: `checkInByStudentNumber(code, dateStr, timeStr, markedById)` from `@/lib/services/attendanceService` (Task 2).
- Produces: `POST /api/attendance/checkin` — body `{ code: string; date: string; time: string }` → the `CheckInResult` JSON, unchanged. Task 7's kiosk page is the only caller.

This task has no automated test — this codebase has zero API route test files anywhere (established convention). Verified by `npx tsc --noEmit` and Task 7's manual browser check.

- [ ] **Step 1: Write the route**

Create `src/app/api/attendance/checkin/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkInByStudentNumber } from '@/lib/services/attendanceService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { code, date, time } = await req.json();
  const result = await checkInByStudentNumber(code, date, time, session.user.id);
  return NextResponse.json(result);
}
```

- [ ] **Step 2: Verify with a type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/attendance/checkin/route.ts
git commit -m "$(cat <<'EOF'
feat: add POST /api/attendance/checkin route for kiosk check-in

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `studentService` — `studentNumber` on create/update/list

**Files:**
- Modify: `src/lib/services/studentService.ts`
- Modify: `src/lib/services/studentService.test.ts`

**Interfaces:**
- Produces: `CreateStudentInput.studentNumber?: string`, `UpdateStudentInput.studentNumber?: string`; `createStudent`/`updateStudent`/`listStudents` all now include `studentNumber: string | null` on their returned student shape. Task 6 (admin/students UI) reads/writes this field. Task 5 (routes) relies on `createStudent` throwing a `P2002` whose `meta.target` includes `studentNumber` when it's a duplicate.
- **Behavior change:** `createStudent` now wraps its `User` + `Student` creation in a single `prisma.$transaction` (it previously did two separate calls). This is required because adding a new unique constraint (`studentNumber`) makes the second call newly able to fail — without a transaction, a duplicate `studentNumber` would leave an orphaned `User` row with no matching `Student`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/services/studentService.test.ts`, add a new `it` inside the existing `describe('createStudent', ...)` block (after the last existing test, before the closing `});` at what's currently line 55):

```ts
  it('stores and returns the student number', async () => {
    const student = await createStudent({ name: '小華', email: 'sn-hua@example.com', password: 'secret123', studentNumber: 'S100' });
    expect(student.studentNumber).toBe('S100');
  });

  it('rejects a second student with the same student number', async () => {
    await createStudent({ name: '小華', email: 'sn-hua2@example.com', password: 'secret123', studentNumber: 'S101' });

    await expect(
      createStudent({ name: '小明', email: 'sn-ming2@example.com', password: 'secret123', studentNumber: 'S101' })
    ).rejects.toThrow();
    expect(await prisma.user.findUnique({ where: { email: 'sn-ming2@example.com' } })).toBeNull();
  });
```

Add a new `it` inside the existing `describe('updateStudent', ...)` block (after the last existing test, before its closing `});`):

```ts
  it('updates the student number', async () => {
    const student = await createStudent({ name: '小華', email: 'sn-update-hua@example.com', password: 'secret123' });

    const updated = await updateStudent(student.id, { studentNumber: 'S200' });

    expect(updated.studentNumber).toBe('S200');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/studentService.test.ts`
Expected: FAIL — `studentNumber` is not a recognized field on `CreateStudentInput`/`UpdateStudentInput` (TypeScript error) and isn't written/returned yet.

- [ ] **Step 3: Write the implementation**

In `src/lib/services/studentService.ts`, replace the top of the file (imports through `updateStudent`, currently lines 1-69) with:

```ts
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { getClassEnrollmentQuota } from './attendanceService';

export interface CreateStudentInput {
  name: string;
  email: string;
  password?: string;
  parentPhone?: string;
  studentNumber?: string;
}

const DEFAULT_PASSWORD = '12345678';

export interface UpdateStudentInput {
  name?: string;
  email?: string;
  password?: string;
  parentPhone?: string;
  studentNumber?: string;
}

const SAFE_USER_SELECT = { name: true, email: true } as const;
const STUDENT_SELECT = { id: true, parentPhone: true, studentNumber: true, user: { select: SAFE_USER_SELECT } } as const;

export async function createStudent(input: CreateStudentInput) {
  const hashed = await bcrypt.hash(input.password || DEFAULT_PASSWORD, 10);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: input.name, email: input.email.trim().toLowerCase(), password: hashed, role: 'STUDENT' },
    });
    return tx.student.create({
      data: { userId: user.id, parentPhone: input.parentPhone, studentNumber: input.studentNumber },
      select: STUDENT_SELECT,
    });
  });
}

export async function listStudents() {
  const students = await prisma.student.findMany({
    select: {
      id: true,
      parentPhone: true,
      studentNumber: true,
      user: { select: SAFE_USER_SELECT },
      enrollments: { select: { classId: true } },
    },
    orderBy: { user: { name: 'asc' } },
  });
  return Promise.all(
    students.map(async (s) => ({
      ...s,
      enrollments: await Promise.all(
        s.enrollments.map(async (e) => ({ classId: e.classId, ...(await getClassEnrollmentQuota(e.classId, s.id)) }))
      ),
    }))
  );
}

export async function updateStudent(id: string, input: UpdateStudentInput) {
  const student = await prisma.student.findUniqueOrThrow({ where: { id } });
  const hashedPassword = input.password ? await bcrypt.hash(input.password, 10) : undefined;

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: student.userId },
      data: { name: input.name, email: input.email?.trim().toLowerCase(), password: hashedPassword },
    });
    return tx.student.update({
      where: { id },
      data: { parentPhone: input.parentPhone, studentNumber: input.studentNumber },
      select: STUDENT_SELECT,
    });
  });
}
```

(`deleteStudent` below this, currently starting at line 71, is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/studentService.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/studentService.ts src/lib/services/studentService.test.ts
git commit -m "$(cat <<'EOF'
feat: add studentNumber to student create/update/list, make createStudent atomic

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Student API routes — distinguish `STUDENT_NUMBER_TAKEN` from `EMAIL_TAKEN`

**Files:**
- Modify: `src/app/api/students/route.ts`
- Modify: `src/app/api/students/[id]/route.ts`

**Interfaces:**
- Consumes: `createStudent`/`updateStudent` (Task 4) now throwing `P2002` for either `email` or `studentNumber` conflicts.
- Produces: `POST /api/students` and `PATCH /api/students/:id` now return `{ error: 'STUDENT_NUMBER_TAKEN' }` (409) when the conflict is on `studentNumber`, and keep returning `{ error: 'EMAIL_TAKEN' }` (409) for every other `P2002` (preserves existing behavior as the fallback). Task 6 (UI) reads `data.error` to choose the message.

This task has no automated test — matches Task 4 of the quota-management plan's precedent (zero API route test files). Verified by `npx tsc --noEmit` and Task 6's manual browser check.

- [ ] **Step 1: Update both routes' error handling**

In `src/app/api/students/route.ts`, replace the `catch` block in `POST` (currently):

```ts
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 });
    }
    throw err;
  }
```

with:

```ts
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = Array.isArray(err.meta?.target) ? (err.meta.target as string[]) : [];
      const error = target.includes('studentNumber') ? 'STUDENT_NUMBER_TAKEN' : 'EMAIL_TAKEN';
      return NextResponse.json({ error }, { status: 409 });
    }
    throw err;
  }
```

Apply the exact same replacement to the `catch` block in `PATCH` in `src/app/api/students/[id]/route.ts` (currently identical code).

- [ ] **Step 2: Verify with a type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/students/route.ts src/app/api/students/\[id\]/route.ts
git commit -m "$(cat <<'EOF'
fix: distinguish duplicate student number from duplicate email in student routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `/admin/students` — 學號 input field

**Files:**
- Modify: `src/app/admin/students/page.tsx`

**Interfaces:**
- Consumes: `GET /api/students` (now returns `studentNumber`, Task 4), `POST /api/students` / `PATCH /api/students/:id` (now accept `studentNumber` in the body and may return `STUDENT_NUMBER_TAKEN`, Tasks 4-5).
- Produces: no new exports — leaf page component.

No automated test — pure UI page, matches this codebase's zero-`*.test.tsx` convention. Verified manually in the browser in Step 4.

- [ ] **Step 1: Add `studentNumber` to the `StudentRow` interface and both form state objects**

In `src/app/admin/students/page.tsx`, update `interface StudentRow` (currently):

```ts
interface StudentRow {
  id: string;
  parentPhone: string | null;
  user: { name: string; email: string };
  enrollments: EnrollmentQuota[];
}
```

to:

```ts
interface StudentRow {
  id: string;
  parentPhone: string | null;
  studentNumber: string | null;
  user: { name: string; email: string };
  enrollments: EnrollmentQuota[];
}
```

Update the `form` state (currently `useState({ name: '', email: '', password: '', parentPhone: '' })`) to:

```ts
  const [form, setForm] = useState({ name: '', email: '', password: '', parentPhone: '', studentNumber: '' });
```

Update the `editForm` state (currently `useState({ name: '', email: '', password: '', parentPhone: '' })`) to:

```ts
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', parentPhone: '', studentNumber: '' });
```

- [ ] **Step 2: Pre-fill `studentNumber` when opening the edit modal**

In `openEdit`, the line `setEditForm({ name: s.user.name, email: s.user.email, password: '', parentPhone: s.parentPhone ?? '' });` becomes:

```ts
    setEditForm({ name: s.user.name, email: s.user.email, password: '', parentPhone: s.parentPhone ?? '', studentNumber: s.studentNumber ?? '' });
```

- [ ] **Step 3: Add the input and the new error message, in both forms**

In the add-student form (`handleSubmit`'s `<form>`), add a new `<Input>` right after the existing 家長電話 input:

```tsx
            <Input placeholder="家長電話" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
            <Input placeholder="學號" value={form.studentNumber} onChange={(e) => setForm({ ...form, studentNumber: e.target.value })} />
```

Update `handleSubmit`'s error branch (currently `setFormError(data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : \`錯誤：${data.error}\`);`) to:

```ts
        setFormError(
          data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : data.error === 'STUDENT_NUMBER_TAKEN' ? '此學號已被使用' : `錯誤：${data.error}`
        );
```

In the edit modal's `<form>`, add the same input right after its 家長電話 input:

```tsx
          <Input
            placeholder="家長電話"
            value={editForm.parentPhone}
            onChange={(e) => setEditForm({ ...editForm, parentPhone: e.target.value })}
          />
          <Input
            placeholder="學號"
            value={editForm.studentNumber}
            onChange={(e) => setEditForm({ ...editForm, studentNumber: e.target.value })}
          />
```

Update `handleEditSubmit`'s error branch (same current code as the add form's) with the same three-way ternary as above, assigning to `setEditError` instead of `setFormError`.

- [ ] **Step 4: Verify manually in the browser**

Run: `npm run dev`, log in as admin, open `http://localhost:3000/admin/students`.

Check:
- 新增學生 and 編輯學生 both show a "學號" text input alongside 家長電話.
- Setting a student number, saving, then reopening that student's edit modal shows the same value pre-filled.
- Creating a second student with the same student number shows "此學號已被使用" and does not create a duplicate.
- Creating a second student with the same email (different student number) still shows "此帳號已被使用" (the fallback still works).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/students/page.tsx
git commit -m "$(cat <<'EOF'
feat: add 學號 input to admin student add/edit forms

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Kiosk page — `/admin/attendance/checkin`

**Files:**
- Create: `src/app/admin/attendance/checkin/page.tsx`
- Modify: `src/app/admin/attendance/page.tsx`

**Interfaces:**
- Consumes: `POST /api/attendance/checkin` (Task 3) — body `{ code, date, time }`, response `CheckInResult` (Task 2's shape, JSON-serialized).
- Consumes: `todayDateInput` (already exported from `@/components/AttendanceHub`).
- Produces: no new exports — leaf page component plus one new button on the existing attendance page.

No automated test — pure UI page. Verified manually in the browser in Step 3.

- [ ] **Step 1: Create the kiosk page**

Create `src/app/admin/attendance/checkin/page.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { todayDateInput } from '@/components/AttendanceHub';

type CheckInResultKind = 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT';

interface CheckInResponse {
  result: CheckInResultKind;
  studentName?: string;
  sessionTitle?: string;
  time?: string;
}

function nowTimeInput() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const RESULT_STYLE: Record<CheckInResultKind, string> = {
  CHECKED_IN: 'text-approved',
  CHECKED_OUT: 'text-assigned',
  NOT_FOUND: 'text-rejected',
  NO_SESSION: 'text-rejected',
};

function resultMessage(r: CheckInResponse): string {
  if (r.result === 'CHECKED_IN') return `✓ ${r.studentName} 已簽到 ${r.time} — ${r.sessionTitle}`;
  if (r.result === 'CHECKED_OUT') return `✓ ${r.studentName} 已簽退 ${r.time} — ${r.sessionTitle}`;
  if (r.result === 'NOT_FOUND') return '查無此學號，請洽行政人員';
  return '找不到可報到的課程，請洽行政人員';
}

export default function CheckinKioskPage() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<CheckInResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function focusInput() {
    inputRef.current?.focus();
  }

  useEffect(() => {
    focusInput();
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  async function submitCode(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setCode('');
    const res = await fetch('/api/attendance/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: trimmed, date: todayDateInput(), time: nowTimeInput() }),
    });
    const data: CheckInResponse = await res.json();
    setResult(data);
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    clearTimerRef.current = setTimeout(() => setResult(null), 4000);
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
      <input
        ref={inputRef}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onBlur={() => setTimeout(focusInput, 0)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submitCode(code);
          }
        }}
        className="absolute h-px w-px opacity-0"
        aria-hidden
      />
      {result ? (
        <p className={`text-4xl font-bold ${RESULT_STYLE[result.result]}`}>{resultMessage(result)}</p>
      ) : (
        <p className="text-3xl text-inkMuted">請將學生證放在掃描器前</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the entry button on `/admin/attendance`**

In `src/app/admin/attendance/page.tsx`, add the import at the top (alongside the existing ones):

```ts
import Link from 'next/link';
```

Replace the tab-buttons row (currently):

```tsx
      <div className="mb-4 flex gap-2">
        <Button variant={tab === 'roll' ? 'primary' : 'secondary'} onClick={() => setTab('roll')}>
          點名總覽
        </Button>
        <Button variant={tab === 'stats' ? 'primary' : 'secondary'} onClick={() => setTab('stats')}>
          統計
        </Button>
      </div>
```

with:

```tsx
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant={tab === 'roll' ? 'primary' : 'secondary'} onClick={() => setTab('roll')}>
          點名總覽
        </Button>
        <Button variant={tab === 'stats' ? 'primary' : 'secondary'} onClick={() => setTab('stats')}>
          統計
        </Button>
        <Link href="/admin/attendance/checkin" className="ml-auto">
          <Button variant="secondary">櫃檯報到模式</Button>
        </Link>
      </div>
```

- [ ] **Step 3: Verify manually in the browser**

Run: `npm run dev`. First, register a test student's number: log in as admin, open `/admin/students`, edit a student who's enrolled in a class scheduled today, set their 學號 to e.g. `TEST001`, save.

Then:
- Open `/admin/attendance`, click "櫃檯報到模式" — lands on `/admin/attendance/checkin`, showing "請將學生證放在掃描器前", nothing focused visibly but no field needs clicking.
- Without clicking anything, type `TEST001` then press Enter (simulating a scanner) — confirm the big green "已簽到" message appears with the right class name and current time.
- Wait ~4 seconds — message fades back to the idle prompt.
- Type the same code and press Enter again — confirm it now shows the blue "已簽退" message.
- Type an unregistered code and press Enter — confirm the red "查無此學號" message.
- Reopen `/admin/attendance`'s 點名總覽 for that class/today and confirm the roster shows the student as 出席 with the check-in/out times set by the kiosk scans.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/attendance/checkin/page.tsx src/app/admin/attendance/page.tsx
git commit -m "$(cat <<'EOF'
feat: add front-desk barcode check-in kiosk page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
