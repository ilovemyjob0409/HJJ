# Tutoring Window Attendance Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins and teachers a per-window (`TutoringWindow`) attendance history overview for individual tutoring, grouped by student — the tutoring-side equivalent of the class attendance overview shipped in `docs/superpowers/plans/2026-08-13-class-attendance-overview.md`.

**Architecture:** A new service function `getTutoringWindowAttendanceOverview(windowId)` reads `TutoringBooking` (LEFT JOIN `TutoringAttendance`, 1:1) grouped by student. A new API route exposes it with ADMIN/TEACHER(-of-this-window) permission. A shared React component renders it (collapsed-by-default per-student cards, reusing `StatusBadge`). Two thin page wrappers (admin, teacher) mount that component. Teachers get a new home-page section listing their own windows, since teachers currently have zero tutoring UI.

**Tech Stack:** Next.js App Router, Prisma/Postgres, Vitest, Tailwind. Matches the patterns already used in `src/lib/services/attendanceService.ts` (`getClassAttendanceOverview`) and `src/components/ClassAttendanceOverview.tsx`.

## Global Constraints

- Unit of the overview is `TutoringWindow`, not `TutoringProgram` (see design doc §"單位與範圍").
- TEACHER may view a window only if `window.teacherId === me.id || window.teacherId2 === me.id`; ADMIN may view any window; all other roles (including unauthenticated) get 403.
- Future-dated bookings are **not** excluded — a student booking ahead is a real, meaningful action, unlike the class version's pre-written `NOT_REGISTERED` rows. They sort to the top (newest-first).
- A student with **zero bookings** on the window does not appear in the overview at all — the query starts from `TutoringBooking`, not from `TutoringEnrollment`.
- Each row's status badge is `attendanceStatus ?? bookingStatus`, rendered via the existing `StatusBadge` component (`src/components/ui/StatusBadge.tsx`), which already has label/color config for `PRESENT/LATE/LEFT_EARLY/ON_LEAVE/ABSENT/NOT_REGISTERED/BOOKED/CANCELLED/CANCELLED_LATE/PENDING_ADMIN/REJECTED`. Do not invent new label strings.
- No new React component test files (`.test.tsx`) — this codebase's convention is service-layer and API-route tests only; page/component changes are verified live in the browser (see each UI task's verification step).
- Never use `git add -A` or `git add .`; stage exact file paths.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/services/attendanceService.ts` | Add `getTutoringWindowAttendanceOverview` + its two exported interfaces (modify) |
| `src/lib/services/attendanceService.test.ts` | Tests for the above (modify) |
| `src/app/api/tutoring-windows/[id]/attendance-overview/route.ts` | New API route (create) |
| `src/app/api/tutoring-windows/[id]/attendance-overview/route.test.ts` | Tests for the route (create) |
| `src/components/TutoringWindowAttendanceOverview.tsx` | Shared display component (create) |
| `src/app/admin/tutoring/windows/[id]/attendance/page.tsx` | Thin admin wrapper page (create) |
| `src/app/admin/tutoring/page.tsx` | Add "查看出缺勤" entry button per window row (modify) |
| `src/lib/services/tutoringProgramService.ts` | Add `listWindowsForTeacher` (modify) |
| `src/lib/services/tutoringProgramService.test.ts` | Tests for the above (modify) |
| `src/components/TeacherTutoringWindowList.tsx` | Teacher's "my windows" card list (create) |
| `src/app/teacher/tutoring/windows/[id]/attendance/page.tsx` | Thin teacher wrapper page (create) |
| `src/app/teacher/page.tsx` | Add "我的個別輔導時段" section (modify) |

---

### Task 1: `getTutoringWindowAttendanceOverview` service function

**Files:**
- Modify: `src/lib/services/attendanceService.ts` (append after `getClassAttendanceOverview`, currently the last export in the file)
- Test: `src/lib/services/attendanceService.test.ts` (append a new `describe` block after the existing `describe('getClassAttendanceOverview', ...)` block; add missing imports)

**Interfaces:**
- Consumes: `prisma` (already imported in this file), `AttendanceStatusValue` (already declared in this file), `NAME_SELECT` (already declared in this file, line 12).
- Produces:
  ```ts
  export interface TutoringWindowOverviewRecord {
    date: Date;
    attendanceStatus: AttendanceStatusValue | null;
    bookingStatus: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
    checkInTime: string | null;
    checkOutTime: string | null;
    isMakeup: boolean;
  }
  export interface TutoringWindowOverviewStudent {
    studentId: string;
    studentName: string;
    records: TutoringWindowOverviewRecord[];
  }
  export async function getTutoringWindowAttendanceOverview(windowId: string): Promise<TutoringWindowOverviewStudent[]>
  ```
  Task 2 imports `getTutoringWindowAttendanceOverview` and both interfaces are consumed structurally (not imported by name) by Task 3's component.

- [ ] **Step 1: Write the failing tests**

Open `src/lib/services/attendanceService.test.ts`. Add `createEnrollment` to the existing `tutoringProgramService` import, and `adminCancelBooking, decideMakeup` to the existing `tutoringBookingService` import, and `getTutoringWindowAttendanceOverview` to the existing `attendanceService` import list. The three existing import lines are:

```ts
import { getClassRoster, saveClassAttendance, clearClassAttendance, getClassEnrollmentQuota, getClassAttendanceLedger, getOneOnOneAttendance, saveOneOnOneAttendance, clearOneOnOneAttendance, getGoHallRoster, saveGoHallAttendance, clearGoHallAttendance, getActivityRoster, saveActivityAttendance, clearActivityAttendance, listAttendanceSessionsForDate, checkInByStudentNumber, resolveCheckIn, listClassQuotaSummaries, getTutoringRoster, saveTutoringAttendance, clearTutoringAttendance, getClassAttendanceOverview } from './attendanceService';
...
import { createProgram, createWindow } from './tutoringProgramService';
import { createBooking } from './tutoringBookingService';
```

Change them to:

```ts
import { getClassRoster, saveClassAttendance, clearClassAttendance, getClassEnrollmentQuota, getClassAttendanceLedger, getOneOnOneAttendance, saveOneOnOneAttendance, clearOneOnOneAttendance, getGoHallRoster, saveGoHallAttendance, clearGoHallAttendance, getActivityRoster, saveActivityAttendance, clearActivityAttendance, listAttendanceSessionsForDate, checkInByStudentNumber, resolveCheckIn, listClassQuotaSummaries, getTutoringRoster, saveTutoringAttendance, clearTutoringAttendance, getClassAttendanceOverview, getTutoringWindowAttendanceOverview } from './attendanceService';
...
import { createProgram, createWindow, createEnrollment } from './tutoringProgramService';
import { createBooking, adminCancelBooking, decideMakeup } from './tutoringBookingService';
```

Then append this new block at the end of the file (after the closing `});` of `describe('getClassAttendanceOverview', ...)`):

```ts
describe('getTutoringWindowAttendanceOverview', () => {
  async function setup() {
    const teacher = await createTeacher({ name: '米奇老師', email: `tw-overview-mickey-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({
      programId: program.id, weekday: 5, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id,
    });
    const studentA = await createStudent({ name: '小明', email: `tw-overview-ming-${Date.now()}@example.com`, password: 'x' });
    const enrollmentA = await createEnrollment({ studentId: studentA.id, programId: program.id });
    return { teacher, program, window, studentA, enrollmentA };
  }

  it('reflects a marked attendance status, check-in/out times, and isMakeup for a REGULAR booking', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const booking = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'PRESENT', checkInTime: '17:00', checkOutTime: '19:00' }]);

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toEqual([
      { date: new Date(Date.UTC(2020, 0, 3)), attendanceStatus: 'PRESENT', bookingStatus: 'BOOKED', checkInTime: '17:00', checkOutTime: '19:00', isMakeup: false },
    ]);
  });

  it('reflects an ON_LEAVE attendance status', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const booking = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'ON_LEAVE', checkInTime: null, checkOutTime: null }]);

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records[0].attendanceStatus).toBe('ON_LEAVE');
  });

  it('has attendanceStatus null for a BOOKED booking with no attendance marked yet, whether the date is past or future', async () => {
    const { window, studentA, enrollmentA } = await setup();
    await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2099, 0, 2)) });

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toHaveLength(2);
    expect(row.records.every((r) => r.attendanceStatus === null && r.bookingStatus === 'BOOKED')).toBe(true);
  });

  it('reflects a CANCELLED booking', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const booking = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await adminCancelBooking(booking.id, false);

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records[0]).toMatchObject({ bookingStatus: 'CANCELLED', attendanceStatus: null });
  });

  it('reflects a CANCELLED_LATE booking', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const booking = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await adminCancelBooking(booking.id, true);

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records[0]).toMatchObject({ bookingStatus: 'CANCELLED_LATE' });
  });

  it('marks a pending makeup booking as isMakeup with bookingStatus PENDING_ADMIN', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const original = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await createBooking({
      enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 10)), kind: 'MAKEUP', makeupForId: original.id,
    });

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    const record = row.records.find((r) => r.date.getTime() === new Date(Date.UTC(2020, 0, 10)).getTime())!;
    expect(record).toMatchObject({ isMakeup: true, bookingStatus: 'PENDING_ADMIN' });
  });

  it('reflects a rejected makeup booking', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const original = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    const makeup = await createBooking({
      enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 10)), kind: 'MAKEUP', makeupForId: original.id,
    });
    await decideMakeup(makeup.id, 'REJECTED');

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    const record = row.records.find((r) => r.date.getTime() === new Date(Date.UTC(2020, 0, 10)).getTime())!;
    expect(record).toMatchObject({ isMakeup: true, bookingStatus: 'REJECTED' });
  });

  it("groups records by student and sorts each student's records newest first, including future dates at the top", async () => {
    const { window, program, studentA, enrollmentA } = await setup();
    const studentB = await createStudent({ name: '呂昕曄', email: `tw-overview-lu-${Date.now()}@example.com`, password: 'x' });
    const enrollmentB = await createEnrollment({ studentId: studentB.id, programId: program.id });

    await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 17)) });
    await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2099, 0, 2)) });
    await createBooking({ enrollmentId: enrollmentB.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 10)) });

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    expect(overview).toHaveLength(2);
    const rowA = overview.find((s) => s.studentId === studentA.id)!;
    expect(rowA.records.map((r) => r.date)).toEqual([
      new Date(Date.UTC(2099, 0, 2)),
      new Date(Date.UTC(2020, 0, 17)),
      new Date(Date.UTC(2020, 0, 3)),
    ]);
    const rowB = overview.find((s) => s.studentId === studentB.id)!;
    expect(rowB.records).toHaveLength(1);
  });

  it('returns an empty array for a window with no bookings', async () => {
    const { window } = await setup();
    const overview = await getTutoringWindowAttendanceOverview(window.id);
    expect(overview).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL — `getTutoringWindowAttendanceOverview is not a function` (or a TypeScript error if run through `tsc`; either way, do not proceed until you've confirmed the tests fail for the right reason — missing implementation, not a typo in the test).

- [ ] **Step 3: Implement**

Append to `src/lib/services/attendanceService.ts`, after the closing `}` of `getClassAttendanceOverview` (the last function in the file):

```ts

export interface TutoringWindowOverviewRecord {
  date: Date;
  attendanceStatus: AttendanceStatusValue | null;
  bookingStatus: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
  checkInTime: string | null;
  checkOutTime: string | null;
  isMakeup: boolean;
}

export interface TutoringWindowOverviewStudent {
  studentId: string;
  studentName: string;
  records: TutoringWindowOverviewRecord[];
}

// 個別輔導時段出缺勤總表（依學生分組）：TutoringBooking 與 TutoringAttendance
// 是 1:1，不用像 getClassAttendanceOverview 那樣合併兩個獨立來源。不排除未來
// 日期——學生提前預約未來場次是真實、有意義的行為，不是預寫的髒資料。沒有
// 任何 booking 的學生不會出現在總表裡（這裡是從 booking 查起，不是從
// TutoringEnrollment 查起）。
export async function getTutoringWindowAttendanceOverview(windowId: string): Promise<TutoringWindowOverviewStudent[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { windowId },
    select: {
      date: true,
      status: true,
      kind: true,
      attendance: { select: { status: true, checkInTime: true, checkOutTime: true } },
      enrollment: { select: { studentId: true, student: { select: NAME_SELECT } } },
    },
  });

  const byStudent = new Map<string, { studentName: string; records: TutoringWindowOverviewRecord[] }>();
  for (const b of bookings) {
    const studentId = b.enrollment.studentId;
    let bucket = byStudent.get(studentId);
    if (!bucket) {
      bucket = { studentName: b.enrollment.student.user.name, records: [] };
      byStudent.set(studentId, bucket);
    }
    bucket.records.push({
      date: b.date,
      attendanceStatus: (b.attendance?.status as AttendanceStatusValue) ?? null,
      bookingStatus: b.status as TutoringWindowOverviewRecord['bookingStatus'],
      checkInTime: b.attendance?.checkInTime ?? null,
      checkOutTime: b.attendance?.checkOutTime ?? null,
      isMakeup: b.kind === 'MAKEUP',
    });
  }

  return Array.from(byStudent.entries()).map(([studentId, v]) => ({
    studentId,
    studentName: v.studentName,
    records: v.records.sort((a, b) => b.date.getTime() - a.date.getTime()),
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: PASS, all tests in the file (existing + 9 new).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "feat(tutoring): add getTutoringWindowAttendanceOverview (whole-window history grouped by student)"
```

---

### Task 2: `GET /api/tutoring-windows/[id]/attendance-overview` API route

**Files:**
- Create: `src/app/api/tutoring-windows/[id]/attendance-overview/route.ts`
- Test: `src/app/api/tutoring-windows/[id]/attendance-overview/route.test.ts`

**Interfaces:**
- Consumes: `getTutoringWindowAttendanceOverview(windowId: string): Promise<TutoringWindowOverviewStudent[]>` from Task 1 (`@/lib/services/attendanceService`); `taipeiDateKey(date: Date): string` from `@/lib/services/tutoringBookingService` (already exists).
- Produces: `GET` handler returning `{ window: { id, weekday, startTime, endTime, programName, teacherName, teacherName2: string | null }, todayKey: string, students: TutoringWindowOverviewStudent[] }`. Task 3's component consumes this exact response shape (including `todayKey`, used for the "N 筆待點名" hint without doing client-side timezone math).

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/tutoring-windows/[id]/attendance-overview/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow, createEnrollment } from '@/lib/services/tutoringProgramService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'STUDENT' } });

async function setup() {
  const teacher = await createTeacher({ name: '米奇老師', email: `tw-overview-route-mickey-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const teacher2 = await createTeacher({ name: '甜甜圈老師', email: `tw-overview-route-donut-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({
    programId: program.id, weekday: 5, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id, teacherId2: teacher2.id,
  });
  const student = await createStudent({ name: '小明', email: `tw-overview-route-ming-${Date.now()}@example.com`, password: 'x' });
  await createEnrollment({ studentId: student.id, programId: program.id });
  return { teacher, teacher2, program, window, student };
}

describe('GET /api/tutoring-windows/[id]/attendance-overview', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('403 for a STUDENT', async () => {
    asStudent();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('404 when the window does not exist (admin)', async () => {
    asAdmin();
    const res = await GET({} as never, { params: { id: 'nonexistent-window-id' } });
    expect(res.status).toBe(404);
  });

  it('403 for a TEACHER who is neither the main nor the second teacher of this window', async () => {
    const { window } = await setup();
    const other = await createTeacher({ name: '林老師', email: `tw-overview-route-lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: other.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'TEACHER' } });

    const res = await GET({} as never, { params: { id: window.id } });
    expect(res.status).toBe(403);
  });

  it("200 with window info and students for the window's main TEACHER", async () => {
    const { teacher, window } = await setup();
    const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'TEACHER' } });

    const res = await GET({} as never, { params: { id: window.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.window).toMatchObject({
      id: window.id, weekday: 5, startTime: '17:00', endTime: '19:00', programName: '英文個別輔導', teacherName: '米奇老師', teacherName2: '甜甜圈老師',
    });
    expect(typeof body.todayKey).toBe('string');
    expect(body.students).toEqual([]);
  });

  it("200 for the window's second TEACHER", async () => {
    const { teacher2, window } = await setup();
    const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: teacher2.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'TEACHER' } });

    const res = await GET({} as never, { params: { id: window.id } });
    expect(res.status).toBe(200);
  });

  it('200 for ADMIN on any window', async () => {
    const { window } = await setup();
    asAdmin();
    const res = await GET({} as never, { params: { id: window.id } });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/tutoring-windows/[id]/attendance-overview/route.test.ts`
Expected: FAIL — the file `./route` does not exist yet.

- [ ] **Step 3: Implement**

Create `src/app/api/tutoring-windows/[id]/attendance-overview/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTutoringWindowAttendanceOverview } from '@/lib/services/attendanceService';
import { taipeiDateKey } from '@/lib/services/tutoringBookingService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role !== 'ADMIN' && session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const window = await prisma.tutoringWindow.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      weekday: true,
      startTime: true,
      endTime: true,
      teacherId: true,
      teacherId2: true,
      program: { select: { name: true } },
      teacher: { select: { user: { select: { name: true } } } },
      teacher2: { select: { user: { select: { name: true } } } },
    },
  });
  if (!window) return NextResponse.json({ error: 'WINDOW_NOT_FOUND' }, { status: 404 });

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    if (window.teacherId !== teacher.id && window.teacherId2 !== teacher.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const students = await getTutoringWindowAttendanceOverview(window.id);
  return NextResponse.json({
    window: {
      id: window.id,
      weekday: window.weekday,
      startTime: window.startTime,
      endTime: window.endTime,
      programName: window.program.name,
      teacherName: window.teacher.user.name,
      teacherName2: window.teacher2?.user.name ?? null,
    },
    todayKey: taipeiDateKey(new Date()),
    students,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/tutoring-windows/[id]/attendance-overview/route.test.ts`
Expected: PASS, all 7 tests.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/tutoring-windows/[id]/attendance-overview/route.ts src/app/api/tutoring-windows/[id]/attendance-overview/route.test.ts`
Expected: no output from either command.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/tutoring-windows/[id]/attendance-overview/route.ts src/app/api/tutoring-windows/[id]/attendance-overview/route.test.ts
git commit -m "feat(tutoring): add GET /api/tutoring-windows/[id]/attendance-overview"
```

---

### Task 3: `TutoringWindowAttendanceOverview` shared component

**Files:**
- Create: `src/components/TutoringWindowAttendanceOverview.tsx`

**Interfaces:**
- Consumes: `GET /api/tutoring-windows/[id]/attendance-overview` (Task 2) via `fetch`, response shape `{ window: { id, weekday, startTime, endTime, programName, teacherName, teacherName2: string | null }, todayKey: string, students: { studentId, studentName, records: { date, attendanceStatus, bookingStatus, checkInTime, checkOutTime, isMakeup }[] }[] }`. `WEEKDAY_LABELS`, `formatDateWithWeekday` from `@/lib/dateFormat`. `Card` (`@/components/ui/Card`), `StatusBadge` (`@/components/ui/StatusBadge`).
- Produces: `export default function TutoringWindowAttendanceOverview({ windowId, backHref, backLabel }: { windowId: string; backHref: string; backLabel: string })`. Consumed by Task 4 and Task 6's page wrappers with the same three props `ClassAttendanceOverview` already uses (`classId` renamed to `windowId`).

No test file for this task — it is a page-level display component; verify manually in the browser as part of Task 4 and Task 6 (which render it against real data).

- [ ] **Step 1: Implement**

Create `src/components/TutoringWindowAttendanceOverview.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import { WEEKDAY_LABELS, formatDateWithWeekday } from '@/lib/dateFormat';

interface OverviewRecord {
  date: string;
  attendanceStatus: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED' | null;
  bookingStatus: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
  checkInTime: string | null;
  checkOutTime: string | null;
  isMakeup: boolean;
}

interface OverviewStudent {
  studentId: string;
  studentName: string;
  records: OverviewRecord[];
}

interface OverviewResponse {
  window: {
    id: string;
    weekday: number;
    startTime: string;
    endTime: string;
    programName: string;
    teacherName: string;
    teacherName2: string | null;
  };
  todayKey: string;
  students: OverviewStudent[];
}

// 個別輔導時段出缺勤總表：依學生分組，每個學生區塊預設收合，比照
// ClassAttendanceOverview.tsx 的慣例。跟班級版不同的地方：狀態只有一欄
// （這裡的補課本身就是同一張表裡的另一筆 booking，用「類型」欄的補課標籤
// 標示即可，不需要另一欄「補課狀態」），而且不排除未來日期（學生提前預約
// 是有意義的行為，不是預寫的髒資料）。「N 筆待點名」的過去/未來判斷用伺服器
// 算好的 todayKey 字串比較，不在前端用瀏覽器本機時間做時區換算。
export default function TutoringWindowAttendanceOverview({
  windowId,
  backHref,
  backLabel,
}: {
  windowId: string;
  backHref: string;
  backLabel: string;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tutoring-windows/${windowId}/attendance-overview`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [windowId]);

  return (
    <>
      <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-inkMuted transition-colors hover:text-ink">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        {backLabel}
      </Link>
      {loading ? (
        <p className="text-sm text-inkMuted">載入中…</p>
      ) : !data ? (
        <p className="text-sm text-inkMuted">找不到時段或沒有權限查看</p>
      ) : (
        <>
          <h1 className="mb-1 text-xl font-bold text-ink">
            {data.window.programName}・週{WEEKDAY_LABELS[data.window.weekday]} {data.window.startTime}-{data.window.endTime}・出缺勤總表
          </h1>
          <p className="mb-4 text-sm text-inkMuted">{[data.window.teacherName, data.window.teacherName2].filter(Boolean).join('／')}</p>
          {data.students.length === 0 ? (
            <p className="text-sm text-inkMuted">目前沒有預約紀錄</p>
          ) : (
            data.students.map((s) => {
              const pendingCount = s.records.filter(
                (r) => r.bookingStatus === 'BOOKED' && r.attendanceStatus === null && r.date.slice(0, 10) <= data.todayKey
              ).length;
              return (
                <Card key={s.studentId} className="mb-3">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <span className="text-inkMuted transition-transform group-open:rotate-180">▾</span>
                        {s.studentName}
                      </span>
                      {pendingCount > 0 && <span className="text-xs text-pending">{pendingCount} 筆待點名</span>}
                    </summary>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="text-xs text-inkMuted">
                            <th className="pb-2 pr-2 font-normal">日期</th>
                            <th className="pb-2 pr-2 font-normal">狀態</th>
                            <th className="pb-2 font-normal">類型</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.records.map((r, i) => (
                            <tr key={i} className="border-t border-borderSubtle">
                              <td className="py-2 pr-2 text-ink">{formatDateWithWeekday(r.date)}</td>
                              <td className="py-2 pr-2">
                                <StatusBadge status={r.attendanceStatus ?? r.bookingStatus} />
                              </td>
                              <td className="py-2 text-inkMuted">{r.isMakeup ? '補課' : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </Card>
              );
            })
          )}
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/TutoringWindowAttendanceOverview.tsx`
Expected: no output from either command.

- [ ] **Step 3: Commit**

```bash
git add src/components/TutoringWindowAttendanceOverview.tsx
git commit -m "feat(tutoring): add TutoringWindowAttendanceOverview shared component"
```

---

### Task 4: Admin entry point (page + button)

**Files:**
- Create: `src/app/admin/tutoring/windows/[id]/attendance/page.tsx`
- Modify: `src/app/admin/tutoring/page.tsx`

**Interfaces:**
- Consumes: `TutoringWindowAttendanceOverview` component (Task 3), exact props `{ windowId, backHref, backLabel }`.

- [ ] **Step 1: Create the thin wrapper page**

Create `src/app/admin/tutoring/windows/[id]/attendance/page.tsx`:

```tsx
import TutoringWindowAttendanceOverview from '@/components/TutoringWindowAttendanceOverview';

export default function AdminTutoringWindowAttendancePage({ params }: { params: { id: string } }) {
  return <TutoringWindowAttendanceOverview windowId={params.id} backHref="/admin/tutoring" backLabel="返回個別輔導管理" />;
}
```

- [ ] **Step 2: Add the entry button to the window row**

Open `src/app/admin/tutoring/page.tsx`. Find this block (the non-editing branch of `program.windows.map`):

```tsx
                ) : (
                  <div key={window.id} className="rounded-lg border border-borderSubtle p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-ink">
                        週{WEEKDAY_LABELS[window.weekday]} {window.startTime}-{window.endTime}・容量 {window.capacity}・
                        {[window.teacher.user.name, window.teacher2?.user.name].filter(Boolean).join('／')}
                        {!window.active && <span className="ml-2 text-xs text-inkMuted">（已停用）</span>}
                      </span>
                      <div className="flex gap-2">
                        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => startEditWindow(window)}>
                          編輯
                        </Button>
```

Replace the `<div className="flex gap-2">` line and the `編輯` button with:

```tsx
                      <div className="flex gap-2">
                        <Link
                          href={`/admin/tutoring/windows/${window.id}/attendance`}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-borderStrong bg-card px-2 py-1 text-xs font-semibold text-ink transition-colors hover:bg-stripe"
                        >
                          查看出缺勤
                        </Link>
                        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => startEditWindow(window)}>
                          編輯
                        </Button>
```

(`Link` is already imported at the top of this file — it is used for the "查看每日預約總覽 →" link. Leave the rest of the row — `停用`/`啟用`, `刪除`, the closure-date controls — untouched.)

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/admin/tutoring/page.tsx src/app/admin/tutoring/windows/[id]/attendance/page.tsx`
Expected: no output from either command.

- [ ] **Step 4: Verify live in the browser**

Start the dev server if not already running, log in as an admin (`admin@example.com` / `password123` in the seeded dev DB), navigate to `/admin/tutoring`. Confirm:
- Each window row now shows a "查看出缺勤" button alongside "編輯"/"停用"/"刪除".
- Clicking it navigates to `/admin/tutoring/windows/<id>/attendance` and renders the window's program/weekday/time/teacher header without a console error.
- The "返回個別輔導管理" link goes back to `/admin/tutoring`.
- The existing "編輯"/"停用"/"刪除" buttons on that same row still work unaffected (click 編輯, confirm the inline edit form still opens).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/tutoring/windows/[id]/attendance/page.tsx src/app/admin/tutoring/page.tsx
git commit -m "feat(tutoring): admin entry point for tutoring window attendance overview"
```

---

### Task 5: `listWindowsForTeacher` service function

**Files:**
- Modify: `src/lib/services/tutoringProgramService.ts`
- Test: `src/lib/services/tutoringProgramService.test.ts`

**Interfaces:**
- Consumes: `prisma` (already imported in this file).
- Produces:
  ```ts
  export interface TeacherTutoringWindowSummary {
    id: string;
    programName: string;
    weekday: number;
    startTime: string;
    endTime: string;
  }
  export async function listWindowsForTeacher(teacherId: string): Promise<TeacherTutoringWindowSummary[]>
  ```
  Task 6's `TeacherTutoringWindowList` component and `src/app/teacher/page.tsx` consume this exact shape.

- [ ] **Step 1: Write the failing tests**

Open `src/lib/services/tutoringProgramService.test.ts`. Add `listWindowsForTeacher` to the existing import line:

```ts
import { createEnrollment, listEnrollments, updateEnrollment, deleteEnrollment, getWindowInfo } from './tutoringProgramService';
```

becomes:

```ts
import { createEnrollment, listEnrollments, updateEnrollment, deleteEnrollment, getWindowInfo, listWindowsForTeacher } from './tutoringProgramService';
```

Append this block at the end of the file:

```ts

describe('listWindowsForTeacher', () => {
  it('returns only the windows where the teacher is the main or second teacher, with program name', async () => {
    const teacher = await createTeacher({ name: '米奇老師', email: `list-windows-mickey-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const other = await createTeacher({ name: '林老師', email: `list-windows-lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const mainWindow = await createWindow({ programId: program.id, weekday: 1, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id });
    const secondWindow = await createWindow({
      programId: program.id, weekday: 2, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: other.id, teacherId2: teacher.id,
    });
    await createWindow({ programId: program.id, weekday: 3, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: other.id });

    const list = await listWindowsForTeacher(teacher.id);
    expect(list.map((w) => w.id).sort()).toEqual([mainWindow.id, secondWindow.id].sort());
    expect(list.find((w) => w.id === mainWindow.id)).toMatchObject({ programName: '英文個別輔導', weekday: 1, startTime: '17:00', endTime: '19:00' });
  });

  it('returns an empty array for a teacher with no windows', async () => {
    const teacher = await createTeacher({ name: '甜甜圈老師', email: `list-windows-donut-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const list = await listWindowsForTeacher(teacher.id);
    expect(list).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/tutoringProgramService.test.ts`
Expected: FAIL — `listWindowsForTeacher is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/services/tutoringProgramService.ts` (end of file):

```ts

export interface TeacherTutoringWindowSummary {
  id: string;
  programName: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export async function listWindowsForTeacher(teacherId: string): Promise<TeacherTutoringWindowSummary[]> {
  const windows = await prisma.tutoringWindow.findMany({
    where: { OR: [{ teacherId }, { teacherId2: teacherId }] },
    select: { id: true, weekday: true, startTime: true, endTime: true, program: { select: { name: true } } },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
  return windows.map((w) => ({ id: w.id, programName: w.program.name, weekday: w.weekday, startTime: w.startTime, endTime: w.endTime }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/tutoringProgramService.test.ts`
Expected: PASS, all tests in the file (existing + 2 new).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/tutoringProgramService.ts src/lib/services/tutoringProgramService.test.ts
git commit -m "feat(tutoring): add listWindowsForTeacher"
```

---

### Task 6: Teacher entry point (home-page section + page)

**Files:**
- Create: `src/components/TeacherTutoringWindowList.tsx`
- Create: `src/app/teacher/tutoring/windows/[id]/attendance/page.tsx`
- Modify: `src/app/teacher/page.tsx`

**Interfaces:**
- Consumes: `listWindowsForTeacher(teacherId: string): Promise<TeacherTutoringWindowSummary[]>` (Task 5); `TutoringWindowAttendanceOverview` component (Task 3).

- [ ] **Step 1: Create the card-list component**

Create `src/components/TeacherTutoringWindowList.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';
import type { TeacherTutoringWindowSummary } from '@/lib/services/tutoringProgramService';

export default function TeacherTutoringWindowList({ windows }: { windows: TeacherTutoringWindowSummary[] }) {
  const router = useRouter();

  const columns: Column<TeacherTutoringWindowSummary>[] = [
    { header: '課程', render: (w) => w.programName },
    { header: '時段', render: (w) => `週${WEEKDAY_LABELS[w.weekday]} ${w.startTime}-${w.endTime}` },
  ];

  return (
    <Card className="mb-6">
      {windows.length === 0 ? (
        <p className="text-sm text-inkMuted">目前沒有個別輔導時段</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={windows}
            keyField={(w) => w.id}
            onRowClick={(w) => router.push(`/teacher/tutoring/windows/${w.id}/attendance`)}
            rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          />
          <p className="mt-2 text-xs text-inkMuted">點任一列查看該時段出缺勤總表</p>
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Create the thin wrapper page**

Create `src/app/teacher/tutoring/windows/[id]/attendance/page.tsx`:

```tsx
import TutoringWindowAttendanceOverview from '@/components/TutoringWindowAttendanceOverview';

export default function TeacherTutoringWindowAttendancePage({ params }: { params: { id: string } }) {
  return <TutoringWindowAttendanceOverview windowId={params.id} backHref="/teacher" backLabel="返回首頁" />;
}
```

- [ ] **Step 3: Wire into the teacher home page**

Open `src/app/teacher/page.tsx`. Add two imports near the top, alongside the existing service/component imports:

```ts
import { listWindowsForTeacher } from '@/lib/services/tutoringProgramService';
import TeacherTutoringWindowList from '@/components/TeacherTutoringWindowList';
```

Find this block:

```ts
  const [substitutes, oneOnOnes, leaves, insertions, goHallSessions, teacherClasses] = teacher
    ? await Promise.all([
        listAssignedSubstituteRequestsForTeacher(teacher.id),
        listAssignedOneOnOneForTeacher(teacher.id),
        listLeaveRequestsForTeacherClasses(teacher.id),
        listInsertionsForTeacherClasses(teacher.id),
        listSessionsForTeacher(teacher.id),
        listClassesForTeacher(teacher.id),
      ])
    : [[], [], [], [], [], []];
```

Replace it with:

```ts
  const [substitutes, oneOnOnes, leaves, insertions, goHallSessions, teacherClasses, tutoringWindows] = teacher
    ? await Promise.all([
        listAssignedSubstituteRequestsForTeacher(teacher.id),
        listAssignedOneOnOneForTeacher(teacher.id),
        listLeaveRequestsForTeacherClasses(teacher.id),
        listInsertionsForTeacherClasses(teacher.id),
        listSessionsForTeacher(teacher.id),
        listClassesForTeacher(teacher.id),
        listWindowsForTeacher(teacher.id),
      ])
    : [[], [], [], [], [], [], []];
```

Find this block:

```tsx
      <h2 className="mb-2 font-bold text-ink">我的帶班班級</h2>
      <TeacherClassList classes={teacherClasses} />

      <h2 className="mb-2 font-bold text-ink">被指派代課／一對一補課</h2>
```

Replace it with:

```tsx
      <h2 className="mb-2 font-bold text-ink">我的帶班班級</h2>
      <TeacherClassList classes={teacherClasses} />

      <h2 className="mb-2 font-bold text-ink">我的個別輔導時段</h2>
      <TeacherTutoringWindowList windows={tutoringWindows} />

      <h2 className="mb-2 font-bold text-ink">被指派代課／一對一補課</h2>
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/TeacherTutoringWindowList.tsx src/app/teacher/tutoring/windows/[id]/attendance/page.tsx src/app/teacher/page.tsx`
Expected: no output from either command.

- [ ] **Step 5: Verify live in the browser**

Log in as `admin@example.com` / `password123`, go to `/admin/tutoring`, and check whether 王老師 (`teacher@example.com`, the seeded TEACHER account) already owns a window (main or second teacher on any listed window). If not, create one: 新增課程 (or reuse an existing program), then 新增窗口 assigning 王老師 as the teacher.

Then log out, log in as `teacher@example.com` / `password123`, go to `/teacher` (the home page). Confirm:
- A new "我的個別輔導時段" section appears below "我的帶班班級", listing 王老師's window(s) with course name and weekday/time.
- Clicking a row navigates to `/teacher/tutoring/windows/<id>/attendance` and renders without a console error.
- The "返回首頁" link goes back to `/teacher`.
- Log in as a different teacher (e.g. `米奇老師`'s account, if you know its seeded email — otherwise any teacher who does NOT own the window you just created/checked) and confirm that teacher's "我的個別輔導時段" section does not include 王老師's window.

- [ ] **Step 6: Commit**

```bash
git add src/components/TeacherTutoringWindowList.tsx src/app/teacher/tutoring/windows/[id]/attendance/page.tsx src/app/teacher/page.tsx
git commit -m "feat(tutoring): teacher entry point for tutoring window attendance overview"
```

---

### Final: full suite + whole-branch review

After Task 6, run the full test suite once (`npx vitest run`) and confirm the count only grew (no regressions), then follow `superpowers:subagent-driven-development`'s final whole-branch review step before pushing, same as the class attendance overview plan.

## Self-Review

**Spec coverage:** Every section of `docs/superpowers/specs/2026-08-14-tutoring-window-attendance-overview-design.md` maps to a task — 資料層→Task 1, API→Task 2, 畫面→Task 3, 行政入口→Task 4, 老師入口→Task 5+6. The design doc's "不做的事" items are deliberately absent from every task (no program-level view, no point-in-time editing, no makeup cross-linking).

**Placeholder scan:** none found — every step has complete code, no "TBD"/"add appropriate handling".

**Type consistency:** `TutoringWindowOverviewRecord`/`TutoringWindowOverviewStudent` (Task 1) match the component's local `OverviewRecord`/`OverviewStudent`/`OverviewResponse` interfaces (Task 3) field-for-field, including the `bookingStatus` literal union and `todayKey` (added to the API response in Task 2 specifically because Task 3 needs it — cross-checked both step's code blocks to confirm the field name and type match: `todayKey: string` in both). `TeacherTutoringWindowSummary` (Task 5) matches the props consumed by `TeacherTutoringWindowList` (Task 6) exactly (`id, programName, weekday, startTime, endTime`).
