# 櫃檯報到選課畫面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the kiosk check-in's 60-minute time-window matching with a candidate-count rule (0 incomplete → `NO_SESSION`, 1 → auto-resolve with no window, 2+ → a new selection screen), and redesign the kiosk page to the approved "card-forward" visual direction.

**Architecture:** All matching logic lives in `src/lib/services/attendanceService.ts`. A new internal `getTodayCandidates` helper (extracted from the current inline query block) is shared by the existing `checkInByStudentNumber` (rewritten) and a new `resolveCheckIn` export, so both the initial scan and the post-selection confirm reuse the exact same candidate computation — no server-side session/ticket state. `applyClassAttendance`/`applyOneOnOneAttendance` are untouched. One new API route (`/api/attendance/checkin/resolve`) forwards to `resolveCheckIn`. The kiosk page (`src/app/admin/attendance/checkin/page.tsx`) gains a third screen state (`picker`) alongside the existing idle/result states, using only existing design tokens and animation classes.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma 7 (`@prisma/adapter-pg`), Vitest against the real test database, Tailwind.

## Global Constraints

- Candidate resolution rule (spec section "比對邏輯"): partition today's candidates into incomplete (missing check-in or check-out) vs completed (both filled). 0 incomplete → `NO_SESSION`. 1 incomplete → auto-resolve immediately, no time window at all. 2+ incomplete → return `CHOOSE_SESSION` with the full incomplete list; nothing is written until the user picks.
- No time-window check anywhere in the new logic — remove `CHECKIN_WINDOW_MINUTES` entirely.
- An already-checked-in (open) candidate no longer automatically wins over an unstarted one — if both exist, that's 2 incomplete, so it goes to `CHOOSE_SESSION` too (documented behavior change, user-approved).
- `resolveCheckIn` is stateless: re-derive the student from `code`, recompute today's incomplete candidates, and only act if the given `key` is still among them; otherwise return `NO_SESSION`.
- Candidate `key` is an opaque string the frontend never parses, just round-trips: `class:{classId}` for a home-enrolled class, `insertion:{makeupRequestId}` for an insertion makeup, `oneonone:{makeupRequestId}` for a one-on-one makeup.
- Each `CHOOSE_SESSION` candidate carries: `key`, `title`, `timeLabel` (`"HH:mm-HH:mm"`), `teacherName` (string or `null`), `pendingAction` (`'CHECK_IN'` if not yet checked in, `'CHECK_OUT'` if checked in but not out). Candidates are sorted by session start time ascending.
- UI reuses only existing tokens/classes — no new CSS keyframes. Screen-state transitions (idle/result/picker) get `.animate-fade-in` (existing class in `src/app/globals.css`); no continuous/pulsing icon animation.
- Picker screen auto-reverts to idle after 15s of inactivity; terminal results keep the existing 4s auto-clear. A fresh scan while the picker is showing restarts the flow (overwrites pending state, doesn't queue). Candidate buttons disable immediately after the first tap.
- Visual direction: centered card (`bg-card`, `rounded-2xl`, `border-borderSubtle`, `shadow-md`) on the plain page background — the "B·卡片式" direction approved with the user via mockup. Status colors reuse existing tokens exactly as `StatusBadge` already does: `bg-approvedBg`/`text-approved` for success and "待簽退", `bg-rejectedBg`/`text-rejected` for errors, `bg-pendingBg`/`text-pending` for "待簽到".
- Project convention (unchanged): zero API route test files, zero page/component test files — verify with `npx tsc --noEmit`, `npx eslint`, and manual browser verification. Service-layer functions get real Vitest coverage against the real test database (`npm test`, no mocks).
- Never run `npx prisma migrate` — this project has no `prisma/migrations` folder. This plan makes no schema changes, so this constraint is informational only.

---

### Task 1: Rewrite check-in matching logic, add `resolveCheckIn`, rewrite tests

**Files:**
- Modify: `src/lib/services/attendanceService.ts:525-714` (everything from `export interface CheckInResult` to end of file)
- Modify: `src/lib/services/attendanceService.test.ts:8` (import line) and `:437-622` (the entire `describe('checkInByStudentNumber', ...)` block through end of file)

**Interfaces:**
- Consumes: `applyClassAttendance(input: { classId, studentId, date, timeStr, markedById, makeupRequestId? }): Promise<'CHECKED_IN' | 'CHECKED_OUT'>` and `applyOneOnOneAttendance(input: { makeupRequestId, timeStr, markedById }): Promise<'CHECKED_IN' | 'CHECKED_OUT'>` — both already defined earlier in the same file (lines 547-596), unchanged.
- Produces: `export interface CheckInCandidateOption { key: string; title: string; timeLabel: string; teacherName: string | null; pendingAction: 'CHECK_IN' | 'CHECK_OUT' }`, `export interface CheckInResult { result: 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CHOOSE_SESSION'; studentName?: string; sessionTitle?: string; time?: string; candidates?: CheckInCandidateOption[] }`, `export async function checkInByStudentNumber(code: string, dateStr: string, timeStr: string, markedById: string): Promise<CheckInResult>` (signature unchanged), `export async function resolveCheckIn(code: string, dateStr: string, timeStr: string, markedById: string, key: string): Promise<CheckInResult>` (new). Task 2's API routes call both by these exact names and signatures.

- [ ] **Step 1: Replace the `describe('checkInByStudentNumber', ...)` test block**

First update the import line at the top of the test file (line 8) to add `resolveCheckIn`:

```ts
import { getClassRoster, saveClassAttendance, clearClassAttendance, getClassEnrollmentQuota, getOneOnOneAttendance, saveOneOnOneAttendance, clearOneOnOneAttendance, getGoHallRoster, saveGoHallAttendance, clearGoHallAttendance, getActivityRoster, saveActivityAttendance, clearActivityAttendance, listAttendanceSessionsForDate, checkInByStudentNumber, resolveCheckIn } from './attendanceService';
```

Then delete everything from line 437 (`describe('checkInByStudentNumber', () => {`) to the end of the file (line 622, the final `});`) and replace it with:

```ts
describe('checkInByStudentNumber / resolveCheckIn', () => {
  async function setupStudentWithNumber(studentNumber: string, email: string) {
    const student = await createStudent({ name: '小明', email, password: 'x' });
    await prisma.student.update({ where: { id: student.id }, data: { studentNumber } });
    return student;
  }

  it('returns NOT_FOUND when no student has that number', async () => {
    const result = await checkInByStudentNumber('unknown-code', '2026-08-04', '19:00', 'marker-1');
    expect(result).toEqual({ result: 'NOT_FOUND' });
  });

  it('checks in to the only class today even hours before it starts', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen1@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S001', 'checkin-ming1@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const result = await checkInByStudentNumber('S001', '2026-08-04', '10:00', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '數學A班', time: '10:00' });
    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record?.status).toBe('PRESENT');
    expect(record?.checkInTime).toBe('10:00');
  });

  it('checks out an open session even hours after it ends', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen2@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S002', 'checkin-ming2@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await checkInByStudentNumber('S002', '2026-08-04', '18:55', 'marker-1');

    const result = await checkInByStudentNumber('S002', '2026-08-04', '23:30', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_OUT', studentName: '小明', sessionTitle: '數學A班', time: '23:30' });
    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record?.checkInTime).toBe('18:55');
    expect(record?.checkOutTime).toBe('23:30');
  });

  it('returns NO_SESSION once the only class today is fully checked in and out', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen3@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S003', 'checkin-ming3@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await checkInByStudentNumber('S003', '2026-08-04', '18:55', 'marker-1');
    await checkInByStudentNumber('S003', '2026-08-04', '21:05', 'marker-1');

    const result = await checkInByStudentNumber('S003', '2026-08-04', '21:10', 'marker-1');

    expect(result).toEqual({ result: 'NO_SESSION' });
    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record?.checkOutTime).toBe('21:05');
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

    const result = await checkInByStudentNumber('S004', '2026-08-04', '10:00', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '週二進階班', time: '10:00' });
    const record = await prisma.classAttendance.findUnique({ where: { makeupRequestId: makeup.id } });
    expect(record?.studentId).toBe(student.id);
    expect(record?.checkInTime).toBe('10:00');
  });

  it('checks in and out via an approved one-on-one makeup slot today, both well outside the old 60-minute window', async () => {
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

    const checkIn = await checkInByStudentNumber('S005', '2026-08-04', '13:00', 'marker-1');
    expect(checkIn).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '一對一補課', time: '13:00' });

    const checkOut = await checkInByStudentNumber('S005', '2026-08-04', '18:00', 'marker-1');
    expect(checkOut.result).toBe('CHECKED_OUT');
    expect(checkOut.time).toBe('18:00');

    const record = await prisma.oneOnOneAttendance.findUnique({ where: { makeupRequestId: makeup.id } });
    expect(record?.checkInTime).toBe('13:00');
    expect(record?.checkOutTime).toBe('18:00');
  });

  it('returns CHOOSE_SESSION with both candidates sorted by start time when two classes are both not yet checked in', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'checkin-chen6@example.com', password: 'x', subjects: '數學' });
    const teacherB = await createTeacher({ name: '王老師', email: 'checkin-wang6@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S006', 'checkin-ming6@example.com');
    const classA = await createClass({ name: 'A班', subject: '數學', level: '國一', teacherId: teacherA.id, weekday: 2, startTime: '19:30', endTime: '21:00' });
    const classB = await createClass({ name: 'B班', subject: '數學', level: '國一', teacherId: teacherB.id, weekday: 2, startTime: '14:00', endTime: '15:30' });
    await enrollStudent(classA.id, student.id);
    await enrollStudent(classB.id, student.id);

    const result = await checkInByStudentNumber('S006', '2026-08-04', '10:00', 'marker-1');

    expect(result).toEqual({
      result: 'CHOOSE_SESSION',
      studentName: '小明',
      candidates: [
        { key: `class:${classB.id}`, title: 'B班', timeLabel: '14:00-15:30', teacherName: '王老師', pendingAction: 'CHECK_IN' },
        { key: `class:${classA.id}`, title: 'A班', timeLabel: '19:30-21:00', teacherName: '陳老師', pendingAction: 'CHECK_IN' },
      ],
    });
    const countA = await prisma.classAttendance.count({ where: { classId: classA.id, studentId: student.id } });
    const countB = await prisma.classAttendance.count({ where: { classId: classB.id, studentId: student.id } });
    expect(countA).toBe(0);
    expect(countB).toBe(0);
  });

  it('resolveCheckIn checks the chosen candidate in and leaves the other untouched', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen7@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S007', 'checkin-ming7@example.com');
    const classA = await createClass({ name: 'A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '20:00' });
    const classB = await createClass({ name: 'B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:30', endTime: '20:30' });
    await enrollStudent(classA.id, student.id);
    await enrollStudent(classB.id, student.id);

    const result = await resolveCheckIn('S007', '2026-08-04', '19:20', 'marker-1', `class:${classB.id}`);

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: 'B班', time: '19:20' });
    const recordA = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: classA.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(recordA).toBeNull();
  });

  it("resolveCheckIn falls back to NO_SESSION when the chosen key is no longer among today's incomplete candidates", async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen8@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S008', 'checkin-ming8@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const result = await resolveCheckIn('S008', '2026-08-04', '19:00', 'marker-1', 'class:not-a-real-class-id');

    expect(result).toEqual({ result: 'NO_SESSION' });
  });

  it('walks a student through two classes in one day: choose, check in, choose again to check out, then resolves the remaining class alone', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen9@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S009', 'checkin-ming9@example.com');
    const morningClass = await createClass({ name: '早班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '09:00', endTime: '11:00' });
    const eveningClass = await createClass({ name: '晚班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '20:00' });
    await enrollStudent(morningClass.id, student.id);
    await enrollStudent(eveningClass.id, student.id);

    const firstScan = await checkInByStudentNumber('S009', '2026-08-04', '09:00', 'marker-1');
    expect(firstScan.result).toBe('CHOOSE_SESSION');
    expect(firstScan.candidates?.map((c) => c.key)).toEqual([`class:${morningClass.id}`, `class:${eveningClass.id}`]);

    const morningIn = await resolveCheckIn('S009', '2026-08-04', '09:00', 'marker-1', `class:${morningClass.id}`);
    expect(morningIn).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '早班', time: '09:00' });

    const secondScan = await checkInByStudentNumber('S009', '2026-08-04', '11:05', 'marker-1');
    expect(secondScan.result).toBe('CHOOSE_SESSION');
    expect(secondScan.candidates).toEqual([
      { key: `class:${morningClass.id}`, title: '早班', timeLabel: '09:00-11:00', teacherName: '陳老師', pendingAction: 'CHECK_OUT' },
      { key: `class:${eveningClass.id}`, title: '晚班', timeLabel: '19:00-20:00', teacherName: '陳老師', pendingAction: 'CHECK_IN' },
    ]);

    const morningOut = await resolveCheckIn('S009', '2026-08-04', '11:05', 'marker-1', `class:${morningClass.id}`);
    expect(morningOut.result).toBe('CHECKED_OUT');

    const thirdScan = await checkInByStudentNumber('S009', '2026-08-04', '18:55', 'marker-1');
    expect(thirdScan).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '晚班', time: '18:55' });

    const morningRecord = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: morningClass.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(morningRecord?.checkInTime).toBe('09:00');
    expect(morningRecord?.checkOutTime).toBe('11:05');
  });

  it('excludes a class the student has an approved leave request for today', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen10@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S010', 'checkin-ming10@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date('2026-08-04'), reason: '感冒' });

    const result = await checkInByStudentNumber('S010', '2026-08-04', '18:55', 'marker-1');

    expect(result).toEqual({ result: 'NO_SESSION' });
    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL — `resolveCheckIn` is not exported yet, and the existing `checkInByStudentNumber` still returns the old window-based results (e.g. the "hours before it starts" test gets `NO_SESSION` instead of `CHECKED_IN`).

- [ ] **Step 3: Replace the production code**

In `src/lib/services/attendanceService.ts`, delete everything from line 525 (`export interface CheckInResult {`) to the end of the file (line 714) and replace it with:

```ts
export interface CheckInCandidateOption {
  key: string;
  title: string;
  timeLabel: string;
  teacherName: string | null;
  pendingAction: 'CHECK_IN' | 'CHECK_OUT';
}

export interface CheckInResult {
  result: 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CHOOSE_SESSION';
  studentName?: string;
  sessionTitle?: string;
  time?: string;
  candidates?: CheckInCandidateOption[];
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

interface CheckInCandidate {
  key: string;
  title: string;
  timeLabel: string;
  teacherName: string | null;
  startMinutes: number;
  checkInTime: string | null;
  checkOutTime: string | null;
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

async function getTodayCandidates(
  studentId: string,
  date: Date,
  timeStr: string,
  markedById: string
): Promise<CheckInCandidate[]> {
  const weekday = date.getDay();

  const [enrollments, insertions, oneOnOnes, leaveRequests] = await Promise.all([
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
  ]);

  const excludedClassIds = new Set(leaveRequests.map((l) => l.classId));
  const candidates: CheckInCandidate[] = [];

  for (const e of enrollments) {
    const cls = e.class;
    if (excludedClassIds.has(cls.id)) continue;
    const existing = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId, date } },
    });
    candidates.push({
      key: `class:${cls.id}`,
      title: cls.name,
      timeLabel: `${cls.startTime}-${cls.endTime}`,
      teacherName: cls.teacher.user.name,
      startMinutes: toMinutes(cls.startTime),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () => applyClassAttendance({ classId: cls.id, studentId, date, timeStr, markedById }),
    });
  }

  const enrolledClassIds = new Set(enrollments.map((e) => e.class.id));
  for (const ins of insertions) {
    if (!ins.targetClass || enrolledClassIds.has(ins.targetClass.id) || excludedClassIds.has(ins.targetClass.id)) continue;
    const cls = ins.targetClass;
    const existing = await prisma.classAttendance.findUnique({ where: { makeupRequestId: ins.id } });
    candidates.push({
      key: `insertion:${ins.id}`,
      title: cls.name,
      timeLabel: `${cls.startTime}-${cls.endTime}`,
      teacherName: cls.teacher.user.name,
      startMinutes: toMinutes(cls.startTime),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () =>
        applyClassAttendance({ classId: cls.id, studentId, date, timeStr, markedById, makeupRequestId: ins.id }),
    });
  }

  for (const o of oneOnOnes) {
    const existing = await prisma.oneOnOneAttendance.findUnique({ where: { makeupRequestId: o.id } });
    candidates.push({
      key: `oneonone:${o.id}`,
      title: '一對一補課',
      timeLabel: `${o.slotStartTime}-${o.slotEndTime}`,
      teacherName: o.teacher?.user.name ?? null,
      startMinutes: toMinutes(o.slotStartTime!),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () => applyOneOnOneAttendance({ makeupRequestId: o.id, timeStr, markedById }),
    });
  }

  return candidates;
}

function toCandidateOption(c: CheckInCandidate): CheckInCandidateOption {
  return {
    key: c.key,
    title: c.title,
    timeLabel: c.timeLabel,
    teacherName: c.teacherName,
    pendingAction: c.checkInTime ? 'CHECK_OUT' : 'CHECK_IN',
  };
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
  const candidates = await getTodayCandidates(student.id, date, timeStr, markedById);
  const incomplete = candidates.filter((c) => !(c.checkInTime && c.checkOutTime));

  if (incomplete.length === 0) return { result: 'NO_SESSION' };

  if (incomplete.length === 1) {
    const match = incomplete[0];
    const action = await match.apply();
    return { result: action, studentName: student.user.name, sessionTitle: match.title, time: timeStr };
  }

  incomplete.sort((a, b) => a.startMinutes - b.startMinutes);
  return {
    result: 'CHOOSE_SESSION',
    studentName: student.user.name,
    candidates: incomplete.map(toCandidateOption),
  };
}

export async function resolveCheckIn(
  code: string,
  dateStr: string,
  timeStr: string,
  markedById: string,
  key: string
): Promise<CheckInResult> {
  const student = await prisma.student.findUnique({
    where: { studentNumber: code },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!student) return { result: 'NOT_FOUND' };

  const date = new Date(dateStr);
  const candidates = await getTodayCandidates(student.id, date, timeStr, markedById);
  const incomplete = candidates.filter((c) => !(c.checkInTime && c.checkOutTime));
  const match = incomplete.find((c) => c.key === key);
  if (!match) return { result: 'NO_SESSION' };

  const action = await match.apply();
  return { result: action, studentName: student.user.name, sessionTitle: match.title, time: timeStr };
}
```

Note: `applyClassAttendance` and `applyOneOnOneAttendance` are reproduced verbatim above (unchanged) because the whole block from line 525 onward is being replaced wholesale — do not hand-edit around them.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: all tests pass, including the 11 in the rewritten `checkInByStudentNumber / resolveCheckIn` block.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npm test`
Expected: no new failures. (If `activityImageService.test.ts`, `activityService.test.ts`, `makeupRequestService.test.ts`, or `src/app/api/activities/[id]/images/route.test.ts` fail, that's a pre-existing shared-test-DB flakiness issue unrelated to this change — rerun once to confirm before treating it as a real regression.)

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "feat: replace kiosk check-in time window with candidate-count matching

Checking in no longer depends on a 60-minute window around class start —
a student can arrive hours early or leave hours late as long as they're
the only unresolved candidate that day. When two or more of today's
classes are still incomplete, checkInByStudentNumber now returns
CHOOSE_SESSION instead of guessing; the new resolveCheckIn applies the
chosen one after re-validating it's still a legitimate candidate."
```

---

### Task 2: Add the `/api/attendance/checkin/resolve` route

**Files:**
- Create: `src/app/api/attendance/checkin/resolve/route.ts`

**Interfaces:**
- Consumes: `resolveCheckIn(code: string, dateStr: string, timeStr: string, markedById: string, key: string): Promise<CheckInResult>` from Task 1.
- Produces: `POST /api/attendance/checkin/resolve` accepting `{ code, date, time, key }`, returning the same JSON shape as `POST /api/attendance/checkin` (a `CheckInResult`). Task 3's page calls this exact path and body shape.

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { resolveCheckIn } from '@/lib/services/attendanceService';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { code, date, time, key } = await req.json();
  const result = await resolveCheckIn(code, date, time, session.user.id, key);
  return NextResponse.json(result);
}
```

This mirrors `src/app/api/attendance/checkin/route.ts` exactly (same auth check, same request/response shape) — that existing route needs no changes; `CheckInResult` already covers `CHOOSE_SESSION` from Task 1, and the route just forwards whatever `checkInByStudentNumber` returns.

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/attendance/checkin/resolve/route.ts`
Expected: no errors.

Per project convention there is no route test file for this — functional verification happens end-to-end through the browser in Task 3, which exercises this exact endpoint via the picker UI.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/attendance/checkin/resolve/route.ts
git commit -m "feat: add POST /api/attendance/checkin/resolve endpoint"
```

---

### Task 3: Redesign the kiosk page with the picker screen

**Files:**
- Modify: `src/app/admin/attendance/checkin/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `POST /api/attendance/checkin` (unchanged path, response may now include `result: 'CHOOSE_SESSION'` and `candidates`) and `POST /api/attendance/checkin/resolve` from Task 2 (`{ code, date, time, key }` → `CheckInResult`-shaped JSON).
- Produces: the page itself; nothing else depends on it.

- [ ] **Step 1: Replace the page**

Replace the entire contents of `src/app/admin/attendance/checkin/page.tsx` with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { todayDateInput } from '@/components/AttendanceHub';

type CheckInResultKind = 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CHOOSE_SESSION' | 'ERROR';

interface CandidateOption {
  key: string;
  title: string;
  timeLabel: string;
  teacherName: string | null;
  pendingAction: 'CHECK_IN' | 'CHECK_OUT';
}

interface CheckInResponse {
  result: CheckInResultKind;
  studentName?: string;
  sessionTitle?: string;
  time?: string;
  candidates?: CandidateOption[];
}

type ScreenState =
  | { kind: 'idle' }
  | { kind: 'result'; response: CheckInResponse }
  | { kind: 'picker'; code: string; studentName?: string; candidates: CandidateOption[] };

function nowTimeInput() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function resultTitle(r: CheckInResponse): string {
  if (r.result === 'CHECKED_IN') return `${r.studentName} 已簽到 ${r.time}`;
  if (r.result === 'CHECKED_OUT') return `${r.studentName} 已簽退 ${r.time}`;
  if (r.result === 'NOT_FOUND') return '查無此學號';
  if (r.result === 'ERROR') return '系統發生錯誤';
  return '找不到可報到的課程';
}

function resultSubtitle(r: CheckInResponse): string {
  if (r.result === 'CHECKED_IN' || r.result === 'CHECKED_OUT') return r.sessionTitle ?? '';
  if (r.result === 'ERROR') return '請洽行政人員（可能需要重新登入）';
  return '請洽行政人員';
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 6v12M11 6v12" />
    </svg>
  );
}

export default function CheckinKioskPage() {
  const [code, setCode] = useState('');
  const [screen, setScreen] = useState<ScreenState>({ kind: 'idle' });
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function focusInput() {
    inputRef.current?.focus();
  }

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => {
    focusInput();
    return clearTimer;
  }, []);

  function showResult(response: CheckInResponse) {
    clearTimer();
    setScreen({ kind: 'result', response });
    timerRef.current = setTimeout(() => setScreen({ kind: 'idle' }), 4000);
  }

  async function submitCode(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setCode('');
    clearTimer();
    setResolvingKey(null);
    try {
      const res = await fetch('/api/attendance/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed, date: todayDateInput(), time: nowTimeInput() }),
      });
      if (!res.ok) {
        showResult({ result: 'ERROR' });
        return;
      }
      const data: CheckInResponse = await res.json();
      if (data.result === 'CHOOSE_SESSION' && data.candidates) {
        setScreen({ kind: 'picker', code: trimmed, studentName: data.studentName, candidates: data.candidates });
        timerRef.current = setTimeout(() => setScreen({ kind: 'idle' }), 15000);
      } else {
        showResult(data);
      }
    } catch {
      showResult({ result: 'ERROR' });
    }
  }

  async function resolveCandidate(pickerCode: string, key: string) {
    if (resolvingKey) return;
    setResolvingKey(key);
    try {
      const res = await fetch('/api/attendance/checkin/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pickerCode, date: todayDateInput(), time: nowTimeInput(), key }),
      });
      if (!res.ok) {
        showResult({ result: 'ERROR' });
        return;
      }
      const data: CheckInResponse = await res.json();
      showResult(data);
    } catch {
      showResult({ result: 'ERROR' });
    } finally {
      setResolvingKey(null);
    }
  }

  const isOkResult = screen.kind === 'result' && (screen.response.result === 'CHECKED_IN' || screen.response.result === 'CHECKED_OUT');

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-4">
      <input
        ref={inputRef}
        aria-label="學生證掃描"
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
      />

      <div
        key={screen.kind}
        className="animate-fade-in flex w-full max-w-md flex-col items-center rounded-2xl border border-borderSubtle bg-card p-10 text-center shadow-md"
      >
        <div className="mb-4 text-xs font-extrabold tracking-widest text-brand">MUP</div>

        {screen.kind === 'idle' && (
          <>
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brandInk">
              <ScanIcon />
            </div>
            <p className="text-xl font-semibold text-ink">請將學生證放在掃描器前</p>
            <p className="mt-1 text-sm text-inkMuted">掃描後會自動判斷今天的課程</p>
          </>
        )}

        {screen.kind === 'result' && (
          <>
            <div
              className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full ${
                isOkResult ? 'bg-approvedBg text-approved' : 'bg-rejectedBg text-rejected'
              }`}
            >
              {isOkResult ? <CheckIcon /> : <XIcon />}
            </div>
            <p className={`text-xl font-semibold ${isOkResult ? 'text-approved' : 'text-rejected'}`}>{resultTitle(screen.response)}</p>
            <p className="mt-1 text-sm text-inkMuted">{resultSubtitle(screen.response)}</p>
          </>
        )}

        {screen.kind === 'picker' && (
          <>
            <p className="text-lg font-bold text-ink">{screen.studentName}，請選一堂課</p>
            <p className="mb-4 mt-1 text-xs text-inkMuted">15 秒內未選擇將自動返回待機畫面</p>
            <div className="flex w-full flex-col gap-2">
              {screen.candidates.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  disabled={resolvingKey !== null}
                  onClick={() => resolveCandidate(screen.code, c.key)}
                  className="flex items-center justify-between rounded-xl border border-borderSubtle bg-background px-4 py-3 text-left transition-colors hover:bg-stripe disabled:opacity-50"
                >
                  <span>
                    <span className="block text-sm font-bold text-ink">{c.title}</span>
                    <span className="block text-xs text-inkMuted">{c.timeLabel}</span>
                    {c.teacherName && <span className="block text-xs text-inkMuted">{c.teacherName}</span>}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${
                      c.pendingAction === 'CHECK_IN' ? 'bg-pendingBg text-pending' : 'bg-approvedBg text-approved'
                    }`}
                  >
                    {c.pendingAction === 'CHECK_IN' ? '待簽到' : '待簽退'}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check, lint, and build**

Run: `npx tsc --noEmit && npx eslint src/app/admin/attendance/checkin/page.tsx`
Expected: no errors.

Run: `rm -rf .next && npm run build`
Expected: `✓ Compiled successfully`, no ESLint failures (this project's build fails on lint errors).

- [ ] **Step 3: Manual browser verification**

Start the dev server (`preview_start` with the `HJJ dev server` launch config) and log in as `admin@example.com` / `password123`.

Use direct `fetch` calls from the browser console (same pattern as verifying the attendance roster editor earlier) to set up test data, since this needs specific same-weekday classes:

1. **Single-candidate auto check-in (no window):** temporarily enroll a student in one class scheduled today, via `POST /api/classes/{classId}/enrollments` with `{ studentId }`. Navigate to `/admin/attendance/checkin`. Type the student's `studentNumber` into the page (the hidden input is focused — use `computer` `type` then `key` Enter, or set the student's `studentNumber` via `PATCH /api/students/{id}` first if not already set) and confirm the result screen shows `✓`-style green "已簽到" with the class name, even though the current time is far from the class's start time.
2. **Multi-candidate picker:** enroll the same student in a second class also scheduled today. Scan again — confirm the picker screen appears with both classes listed, each showing name/time/teacher and a "待簽到" tag, sorted by start time. Tap one — confirm it resolves to the green success screen and the other class's row is untouched (re-open `/admin/attendance` and check its roster shows no status yet).
3. **Error path:** scan an unknown code (type random characters, Enter) — confirm the red "查無此學號" screen appears.
4. **Theme check:** toggle light/dark mode (top-right icon) and confirm the card, icons, and tags remain legible in both.
5. Clean up: remove the temporary enrollments via `DELETE /api/classes/{classId}/enrollments` with `{ studentId }`, and delete any `ClassAttendance` rows created during the test via direct `psql` `DELETE`, so the seed data is left as found.

Take a screenshot of the idle, picker, and success states for the record.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/attendance/checkin/page.tsx
git commit -m "feat: redesign check-in kiosk with card layout and session picker

Adds a third screen state alongside idle/result: when a scan returns
CHOOSE_SESSION, the kiosk shows each of today's remaining classes with
its time, teacher, and whether this scan would check in or check out,
and resolves via the new /api/attendance/checkin/resolve endpoint."
```
