# 行政直接幫學生預約個別輔導 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin directly book (and makeup-book) individual tutoring sessions for a student through the same capacity-checked calendar flow students already use, replacing the capacity-bypassing "現場補加" walk-in add.

**Architecture:** Extract the calendar/slot-picking UI currently embedded in the student tutoring page into a shared `TutoringBookingCalendar` component. Reuse it on both `/student/tutoring` (pure refactor, no behavior change) and the new "新增預約" card on `/admin/tutoring/bookings`. Two existing student-only API routes (`GET /api/tutoring-availability`, `POST /api/tutoring-bookings/[id]/makeup`) get extended to also accept `ADMIN`; a new admin-only route lists a student's makeup-eligible missed sessions. The walk-in code path is deleted once nothing references it.

**Tech Stack:** Next.js 14 (App Router, route handlers), React (client components), Prisma + PostgreSQL, Vitest (service-layer and route-layer tests), Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-08-admin-tutoring-booking-design.md` — follow it for anything not covered by a task below.
- No capacity-bypassing path may remain for admin's *new* booking flow — the walk-in removal in Task 7 must leave zero references (`grep -r "walk-in\|walkIn\|createWalkInBooking"` returns nothing under `src/`).
- Reuse existing UI components/utilities exactly as they're already used elsewhere in this codebase (`Card`, `Button`, `Input`, `DataTable`, `StatusBadge`, `useToast`, `useConfirm`, `formatDateWithWeekday`, `WEEKDAY_LABELS`) — do not introduce new styling primitives.
- This codebase has no component-test convention (only `src/**/*.test.ts` service/route tests run under Vitest). Do not add `.test.tsx` files; verify frontend tasks by running the dev server and checking in the browser.
- Every task's tests run via `npx vitest run <path>`; the full suite (`npm test`) must stay green after the final task.

---

### Task 1: Service — `listMissedBookingsForEnrollment`

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts` (add function after `listBookingsForStudent`, currently ending at line 394)
- Test: `src/lib/services/tutoringBookingService.test.ts`

**Interfaces:**
- Produces: `listMissedBookingsForEnrollment(enrollmentId: string): Promise<MissedBookingRow[]>` where `MissedBookingRow = { id: string; date: Date; startTime: string; endTime: string }`. Task 2's route calls this.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/services/tutoringBookingService.test.ts`. First, add `listMissedBookingsForEnrollment` to the existing import block that already pulls in `getMonthlyQuotaStatus, listAvailability, listBookingsForStudent, ...` (around line 18):

```ts
import { getMonthlyQuotaStatus, listAvailability, listBookingsForStudent, listBookingsOverview, listPendingTutoringMakeupRequests, sendMonthlyQuotaReminders } from './tutoringBookingService';
import { listMissedBookingsForEnrollment } from './tutoringBookingService';
```

Then add this new `describe` block right after the existing `describe('listBookingsForStudent', ...)` block:

```ts
describe('listMissedBookingsForEnrollment', () => {
  it('returns only missed REGULAR bookings without an existing makeup child, scoped to the given enrollment', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();

    const missed = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07'), startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(missed.id, true); // CANCELLED_LATE, eligible

    const alreadyRequested = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-14'), startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(alreadyRequested.id, true);
    await requestMakeup({ originalBookingId: alreadyRequested.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });

    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-21'), startTime: '16:00', endTime: '18:00' }); // BOOKED, not missed

    const otherStudent = await createStudent({ name: '小華', email: `hua-${Date.now()}@example.com`, password: 'x' });
    const otherEnrollment = await prisma.tutoringEnrollment.create({ data: { programId: enrollment.programId, studentId: otherStudent.id } });
    const otherMissed = await createBooking({ enrollmentId: otherEnrollment.id, windowId: window.id, date: new Date('2020-08-28'), startTime: '16:00', endTime: '18:00' });
    await adminCancelBooking(otherMissed.id, true);

    const rows = await listMissedBookingsForEnrollment(enrollment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(missed.id);
  });

  it('returns an empty array when there are no missed bookings', async () => {
    const { enrollment } = await setupProgramWithEnrollment();
    expect(await listMissedBookingsForEnrollment(enrollment.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/services/tutoringBookingService.test.ts -t "listMissedBookingsForEnrollment"`
Expected: FAIL with `listMissedBookingsForEnrollment is not a function` (or similar import error)

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/services/tutoringBookingService.ts` immediately after the closing brace of `listBookingsForStudent` (after line 394):

```ts
export interface MissedBookingRow {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
}

export async function listMissedBookingsForEnrollment(enrollmentId: string): Promise<MissedBookingRow[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollmentId, kind: 'REGULAR' },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      status: true,
      attendance: { select: { status: true } },
      makeupChild: { select: { id: true } },
    },
    orderBy: { date: 'desc' },
  });
  return bookings
    .filter((b) => (b.status === 'CANCELLED_LATE' || b.attendance?.status === 'ABSENT') && !b.makeupChild)
    .map((b) => ({ id: b.id, date: b.date, startTime: b.startTime, endTime: b.endTime }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/services/tutoringBookingService.test.ts -t "listMissedBookingsForEnrollment"`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts
git commit -m "feat(tutoring): add listMissedBookingsForEnrollment service function"
```

---

### Task 2: Route — `GET /api/tutoring-bookings/makeup-eligible`

**Files:**
- Create: `src/app/api/tutoring-bookings/makeup-eligible/route.ts`
- Test: `src/app/api/tutoring-bookings/makeup-eligible/route.test.ts`

**Interfaces:**
- Consumes: `listMissedBookingsForEnrollment(enrollmentId)` from Task 1.
- Produces: `GET` handler admin can call as `/api/tutoring-bookings/makeup-eligible?enrollmentId=X`. Task 6's admin UI calls this.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/tutoring-bookings/makeup-eligible/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow } from '@/lib/services/tutoringProgramService';
import { createBooking, adminCancelBooking } from '@/lib/services/tutoringBookingService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'STUDENT' } });

async function setup() {
  const teacher = await createTeacher({ name: '林老師', email: `lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: `ming-${Date.now()}@example.com`, password: 'x' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  const missed = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07'), startTime: '16:00', endTime: '18:00' });
  await adminCancelBooking(missed.id, true);
  return { enrollment, missed };
}

describe('GET /api/tutoring-bookings/makeup-eligible', () => {
  it('403 for non-admin', async () => {
    asStudent();
    const res = await GET(new NextRequest('http://x/api/tutoring-bookings/makeup-eligible?enrollmentId=whatever'));
    expect(res.status).toBe(403);
  });

  it('400 when enrollmentId is missing', async () => {
    asAdmin();
    const res = await GET(new NextRequest('http://x/api/tutoring-bookings/makeup-eligible'));
    expect(res.status).toBe(400);
  });

  it('200 with the missed bookings for the given enrollment', async () => {
    asAdmin();
    const { enrollment, missed } = await setup();
    const res = await GET(new NextRequest(`http://x/api/tutoring-bookings/makeup-eligible?enrollmentId=${enrollment.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(missed.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/tutoring-bookings/makeup-eligible/route.test.ts`
Expected: FAIL — cannot find module `./route`

- [ ] **Step 3: Write minimal implementation**

Create `src/app/api/tutoring-bookings/makeup-eligible/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listMissedBookingsForEnrollment } from '@/lib/services/tutoringBookingService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const enrollmentId = req.nextUrl.searchParams.get('enrollmentId');
  if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId required' }, { status: 400 });
  return NextResponse.json(await listMissedBookingsForEnrollment(enrollmentId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/tutoring-bookings/makeup-eligible/route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tutoring-bookings/makeup-eligible/
git commit -m "feat(tutoring): add admin-only makeup-eligible bookings route"
```

---

### Task 3: Route — allow ADMIN on `GET /api/tutoring-availability`

**Files:**
- Modify: `src/app/api/tutoring-availability/route.ts`
- Test: `src/app/api/tutoring-availability/route.test.ts`

**Interfaces:**
- Consumes: `listAvailability`, `daysRemainingInTaipeiMonth`, `daysRemainingThroughNextTaipeiMonth` (unchanged, already imported in this file).
- Produces: `GET` now returns 200 for `ADMIN` on any `enrollmentId` (no ownership check), keeps existing `STUDENT` behavior. Task 5's shared calendar component relies on this for the admin-mode path.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/tutoring-availability/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow } from '@/lib/services/tutoringProgramService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asStudent = (userId: string) => sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

async function setup() {
  const teacher = await createTeacher({ name: '林老師', email: `lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: `ming-${Date.now()}@example.com`, password: 'x' });
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  const program = await createProgram({ name: '英文個別輔導' });
  await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  return { studentUserId: userId, enrollment };
}

describe('GET /api/tutoring-availability', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET(new NextRequest('http://x/api/tutoring-availability?enrollmentId=whatever'));
    expect(res.status).toBe(403);
  });

  it('400 when enrollmentId is missing', async () => {
    asAdmin();
    const res = await GET(new NextRequest('http://x/api/tutoring-availability'));
    expect(res.status).toBe(400);
  });

  it('200 for ADMIN querying any enrollment, no ownership check', async () => {
    asAdmin();
    const { enrollment } = await setup();
    const res = await GET(new NextRequest(`http://x/api/tutoring-availability?enrollmentId=${enrollment.id}`));
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('404 for ADMIN querying a nonexistent enrollment', async () => {
    asAdmin();
    const res = await GET(new NextRequest('http://x/api/tutoring-availability?enrollmentId=nonexistent'));
    expect(res.status).toBe(404);
  });

  it('403 when a STUDENT queries an enrollment that is not their own', async () => {
    const { enrollment } = await setup();
    const otherStudent = await createStudent({ name: '小華', email: `hua-${Date.now()}@example.com`, password: 'x' });
    const { userId: otherUserId } = await prisma.student.findUniqueOrThrow({ where: { id: otherStudent.id }, select: { userId: true } });
    asStudent(otherUserId);
    const res = await GET(new NextRequest(`http://x/api/tutoring-availability?enrollmentId=${enrollment.id}`));
    expect(res.status).toBe(403);
  });

  it('200 when a STUDENT queries their own enrollment', async () => {
    const { studentUserId, enrollment } = await setup();
    asStudent(studentUserId);
    const res = await GET(new NextRequest(`http://x/api/tutoring-availability?enrollmentId=${enrollment.id}`));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/tutoring-availability/route.test.ts`
Expected: FAIL — the "200 for ADMIN" and "404 for ADMIN" cases get 403 from the current `session.user.role !== 'STUDENT'` check

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/app/api/tutoring-availability/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listAvailability, daysRemainingInTaipeiMonth, daysRemainingThroughNextTaipeiMonth } from '@/lib/services/tutoringBookingService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'STUDENT' && session.user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const enrollmentId = req.nextUrl.searchParams.get('enrollmentId');
  if (!enrollmentId) return NextResponse.json({ error: 'enrollmentId required' }, { status: 400 });

  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
    const enrollment = await prisma.tutoringEnrollment.findUnique({ where: { id: enrollmentId } });
    if (!enrollment) return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
    if (enrollment.studentId !== student.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const months = req.nextUrl.searchParams.get('months') === '2' ? 2 : 1;
  const days = months === 2 ? daysRemainingThroughNextTaipeiMonth(new Date()) : daysRemainingInTaipeiMonth(new Date());
  try {
    return NextResponse.json(await listAvailability(enrollmentId, days));
  } catch (err) {
    if (err instanceof Error && err.message === 'ENROLLMENT_NOT_FOUND') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/tutoring-availability/route.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tutoring-availability/route.ts src/app/api/tutoring-availability/route.test.ts
git commit -m "feat(tutoring): let ADMIN query availability for any enrollment"
```

---

### Task 4: Route — allow ADMIN on `POST /api/tutoring-bookings/[id]/makeup`, auto-approve

**Files:**
- Modify: `src/app/api/tutoring-bookings/[id]/makeup/route.ts`
- Test: `src/app/api/tutoring-bookings/[id]/makeup/route.test.ts`

**Interfaces:**
- Consumes: `requestMakeup`, `decideMakeup` from `@/lib/services/tutoringBookingService` (both already exist).
- Produces: `POST` now returns 201 for `ADMIN` with the created booking already `BOOKED` (skips the `PENDING_ADMIN` queue); `STUDENT` behavior unchanged. Task 5's shared calendar component posts here for `mode === 'makeup'`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/tutoring-bookings/[id]/makeup/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/db';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { POST } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow } from '@/lib/services/tutoringProgramService';
import { createBooking, adminCancelBooking } from '@/lib/services/tutoringBookingService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asStudent = (userId: string) => sessionMock.mockResolvedValue({ user: { id: userId, role: 'STUDENT' } });

// 2026-08-07 is a Friday (weekday 5), matching the fixture window below.
const FRIDAY = new Date('2026-08-07');

async function setupMissedBooking(capacity = 8) {
  const teacher = await createTeacher({ name: '林老師', email: `lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: `ming-${Date.now()}@example.com`, password: 'x' });
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { userId: true } });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  const original = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07'), startTime: '16:00', endTime: '18:00' });
  await adminCancelBooking(original.id, true); // CANCELLED_LATE, eligible for makeup
  return { studentUserId: userId, window, enrollment, original };
}

function postBody(windowId: string) {
  return new Request('http://x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ windowId, date: '2026-08-07', startTime: '16:00', endTime: '18:00' }),
  });
}

describe('POST /api/tutoring-bookings/[id]/makeup', () => {
  it('ADMIN: creates the makeup booking already BOOKED, skipping the approval queue', async () => {
    const { window, original } = await setupMissedBooking();
    asAdmin();
    const res = await POST(postBody(window.id), { params: { id: original.id } });
    expect(res.status).toBe(201);
    const body = await res.json();
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.status).toBe('BOOKED');
    expect(row.kind).toBe('MAKEUP');
  });

  it('STUDENT owner: still lands PENDING_ADMIN awaiting approval', async () => {
    const { studentUserId, window, original } = await setupMissedBooking();
    asStudent(studentUserId);
    const res = await POST(postBody(window.id), { params: { id: original.id } });
    expect(res.status).toBe(201);
    const body = await res.json();
    const row = await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: body.id } });
    expect(row.status).toBe('PENDING_ADMIN');
  });

  it('STUDENT non-owner: 403', async () => {
    const { window, original } = await setupMissedBooking();
    const otherStudent = await createStudent({ name: '小華', email: `hua-${Date.now()}@example.com`, password: 'x' });
    const { userId: otherUserId } = await prisma.student.findUniqueOrThrow({ where: { id: otherStudent.id }, select: { userId: true } });
    asStudent(otherUserId);
    const res = await POST(postBody(window.id), { params: { id: original.id } });
    expect(res.status).toBe(403);
  });

  it('ADMIN: WINDOW_FULL surfaces as 409 without auto-approving', async () => {
    const { window, enrollment, original } = await setupMissedBooking(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });

    asAdmin();
    const res = await POST(postBody(window.id), { params: { id: original.id } });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/api/tutoring-bookings/[id]/makeup/route.test.ts"`
Expected: FAIL — the ADMIN cases get 403 from the current `session.user.role !== 'STUDENT'` check

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `src/app/api/tutoring-bookings/[id]/makeup/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { requestMakeup, decideMakeup } from '@/lib/services/tutoringBookingService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'STUDENT' && session.user.role !== 'ADMIN')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const original = await prisma.tutoringBooking.findUnique({
    where: { id: params.id },
    include: { enrollment: { select: { studentId: true } } },
  });
  if (!original) return NextResponse.json({ error: 'BOOKING_NOT_FOUND' }, { status: 404 });

  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
    if (original.enrollment.studentId !== student.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body.windowId || !body.date || !body.startTime || !body.endTime) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  try {
    const makeup = await requestMakeup({
      originalBookingId: params.id,
      windowId: body.windowId,
      date: new Date(body.date),
      startTime: body.startTime,
      endTime: body.endTime,
    });
    if (session.user.role === 'ADMIN') {
      await decideMakeup(makeup.id, 'APPROVED');
    }
    return NextResponse.json(makeup, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status =
      message === 'WINDOW_FULL' || message === 'WINDOW_CLOSED' || message === 'ALREADY_REQUESTED'
        ? 409
        : message === 'WINDOW_NOT_FOUND' || message === 'ENROLLMENT_NOT_FOUND'
          ? 404
          : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/api/tutoring-bookings/[id]/makeup/route.test.ts"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/tutoring-bookings/[id]/makeup/route.ts" "src/app/api/tutoring-bookings/[id]/makeup/route.test.ts"
git commit -m "feat(tutoring): let ADMIN create a makeup booking that auto-approves"
```

---

### Task 5: Extract shared `TutoringBookingCalendar` component, refactor student page

**Files:**
- Create: `src/components/tutoring/TutoringBookingCalendar.tsx`
- Modify: `src/app/student/tutoring/page.tsx` (full rewrite)

**Interfaces:**
- Produces: `export default function TutoringBookingCalendar(props: TutoringBookingCalendarProps)` and `export interface AvailabilityDay { date: string; windowId: string; windowStartTime: string; windowEndTime: string; capacity: number; slots: { startTime: string; remaining: number }[] }`, where:
  ```ts
  interface TutoringBookingCalendarProps {
    enrollmentId: string;
    defaultDurationMinutes: number;
    mode: 'regular' | 'makeup';
    makeupForBookingId?: string; // required when mode === 'makeup'
    successMessage?: string;     // overrides the default post-submit toast text
    onCancel?: () => void;       // called (in addition to closing the open day panel) when the user clicks 取消
    onBooked: () => void;        // called after a successful submit, once the toast has been shown
  }
  ```
  Task 6 (admin UI) imports and uses this component.

This is a pure refactor of `/student/tutoring` — no behavior changes for students. There is no automated test for this task (no component-test convention in this codebase); verification is manual via the dev server in Step 4.

- [ ] **Step 1: Create the shared component**

Create `src/components/tutoring/TutoringBookingCalendar.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';

export interface AvailabilityDay {
  date: string;
  windowId: string;
  windowStartTime: string;
  windowEndTime: string;
  capacity: number;
  slots: { startTime: string; remaining: number }[];
}

interface MonthCell {
  day: number;
  dateKey: string;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function buildMonthCells(year: number, month: number): MonthCell[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: MonthCell[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateKey: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  }
  return cells;
}

interface TutoringBookingCalendarProps {
  enrollmentId: string;
  defaultDurationMinutes: number;
  mode: 'regular' | 'makeup';
  makeupForBookingId?: string;
  successMessage?: string;
  onCancel?: () => void;
  onBooked: () => void;
}

export default function TutoringBookingCalendar({
  enrollmentId,
  defaultDurationMinutes,
  mode,
  makeupForBookingId,
  successMessage,
  onCancel,
  onBooked,
}: TutoringBookingCalendarProps) {
  const { showToast } = useToast();
  const [availability, setAvailability] = useState<AvailabilityDay[]>([]);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  async function loadAvailability() {
    const months = mode === 'makeup' ? 2 : 1;
    const res = await fetch(`/api/tutoring-availability?enrollmentId=${enrollmentId}&months=${months}`);
    setAvailability(await res.json());
  }

  useEffect(() => {
    loadAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentId, mode]);

  const now = new Date();
  const calendarYear = now.getFullYear();
  const calendarMonth = now.getMonth() + 1;
  const availabilityByDate = new Map(availability.map((day) => [day.date, day]));
  const openDayData = openDay ? availabilityByDate.get(openDay) : undefined;

  const nextMonthDate = new Date(Date.UTC(calendarYear, calendarMonth, 1));
  const nextCalendarYear = nextMonthDate.getUTCFullYear();
  const nextCalendarMonth = nextMonthDate.getUTCMonth() + 1;

  function renderMonthGrid(year: number, month: number) {
    const cells = buildMonthCells(year, month);
    const leadingBlanks = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return (
      <div className="mb-4" key={`${year}-${month}`}>
        <p className="mb-3 text-center font-semibold text-ink">
          {year}年{month}月
        </p>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-inkMuted">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <span key={`blank-${year}-${month}-${i}`} />
          ))}
          {cells.map((cell) => {
            const day = availabilityByDate.get(cell.dateKey);
            return (
              <button
                key={cell.dateKey}
                disabled={!day}
                onClick={() => day && openDayForBooking(day)}
                className={`rounded-lg py-2 text-sm ${
                  openDay === cell.dateKey
                    ? 'bg-brand font-semibold text-brandInk'
                    : day
                      ? 'bg-approvedBg font-semibold text-approved'
                      : 'text-inkMuted opacity-50'
                }`}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function openDayForBooking(day: AvailabilityDay) {
    setOpenDay(day.date);
    const firstAvailable = day.slots.find((s) => s.remaining > 0);
    const start = firstAvailable?.startTime ?? day.windowStartTime;
    setStartTime(start);
    setEndTime(addMinutes(start, defaultDurationMinutes));
  }

  async function submit(day: AvailabilityDay) {
    setSubmitting(true);
    try {
      const url = mode === 'makeup' ? `/api/tutoring-bookings/${makeupForBookingId}/makeup` : '/api/tutoring-bookings';
      const body =
        mode === 'makeup'
          ? { windowId: day.windowId, date: day.date, startTime, endTime }
          : { enrollmentId, windowId: day.windowId, date: day.date, startTime, endTime };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error } = await res.json();
        showToast(
          error === 'WINDOW_FULL'
            ? '這段時間名額已滿，請選別的時間'
            : mode === 'makeup'
              ? '申請失敗，請確認時間範圍'
              : '預約失敗，請確認時間範圍'
        );
        return;
      }
      showToast(successMessage ?? (mode === 'makeup' ? '已送出補課申請，待行政核准' : '預約成功'));
      setOpenDay(null);
      onBooked();
      loadAvailability();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {renderMonthGrid(calendarYear, calendarMonth)}
      {mode === 'makeup' && renderMonthGrid(nextCalendarYear, nextCalendarMonth)}

      {openDayData && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-borderSubtle pt-3">
          <label className="text-xs text-inkMuted">
            開始
            <select
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                setEndTime(addMinutes(e.target.value, defaultDurationMinutes));
              }}
              className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
            >
              {openDayData.slots.map((s) => (
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
              {openDayData.slots
                .map((s) => s.startTime)
                .concat(openDayData.windowEndTime)
                .filter((t) => t > startTime)
                .map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
            </select>
          </label>
          <Button loading={submitting} onClick={() => submit(openDayData)}>
            {mode === 'makeup' ? '確定補課時間' : '確定預約'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setOpenDay(null);
              onCancel?.();
            }}
          >
            取消
          </Button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Rewrite the student page to use it**

Replace the full contents of `src/app/student/tutoring/page.tsx` with:

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
import TutoringBookingCalendar from '@/components/tutoring/TutoringBookingCalendar';

interface Enrollment {
  id: string;
  programId: string;
  programName: string;
  defaultDurationMinutes: number;
  monthlyQuota: number;
  locked: number;
  upcoming: number;
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

export default function StudentTutoringPage() {
  const { showToast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>('');
  const [bookings, setBookings] = useState<BookingRow[]>([]);
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

  useEffect(() => {
    loadEnrollments();
    loadBookings();
  }, []);

  const selectedEnrollment = enrollments.find((e) => e.id === selectedEnrollmentId);

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
    loadEnrollments();
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

          <h2 className="mb-2 font-bold text-ink">{makeupFor ? '本月及下月可預約時段' : '本月可預約時段'}</h2>
          <Card className="mb-6">
            {selectedEnrollment && (
              <TutoringBookingCalendar
                enrollmentId={selectedEnrollment.id}
                defaultDurationMinutes={selectedEnrollment.defaultDurationMinutes}
                mode={makeupFor ? 'makeup' : 'regular'}
                makeupForBookingId={makeupFor?.id}
                onCancel={() => setMakeupFor(null)}
                onBooked={() => {
                  loadBookings();
                  if (!makeupFor) loadEnrollments();
                  setMakeupFor(null);
                }}
              />
            )}
          </Card>

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

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

Run: `npx vitest run`
Expected: PASS (all existing tests, unaffected by this frontend-only change)

- [ ] **Step 4: Manually verify in the browser**

```bash
npm run dev
```

Log in as the seed student account, go to `/student/tutoring`:
- Confirm the month calendar renders, clicking a highlighted day opens the start/end time pickers, and "確定預約" still books successfully (toast "預約成功", booking appears in "我的預約紀錄").
- Click "申請補課" on a cancelled/absent booking, confirm the calendar switches to showing two months and "確定補課時間" submits with toast "已送出補課申請，待行政核准".
- Click "取消" in the open-day panel while in makeup mode, confirm it closes the panel and exits makeup mode (the "正在為...選一個補課時間" banner disappears).

- [ ] **Step 5: Commit**

```bash
git add src/components/tutoring/TutoringBookingCalendar.tsx src/app/student/tutoring/page.tsx
git commit -m "refactor(tutoring): extract TutoringBookingCalendar shared component"
```

---

### Task 6: Admin bookings page — replace 現場補加 with 新增預約 (regular + makeup)

**Files:**
- Modify: `src/app/admin/tutoring/bookings/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `TutoringBookingCalendar` from Task 5; `GET /api/tutoring-bookings/makeup-eligible` from Task 2; `GET /api/tutoring-availability` (ADMIN-capable) from Task 3; `POST /api/tutoring-bookings/[id]/makeup` (ADMIN-capable) from Task 4; existing `GET /api/tutoring-enrollments` (already returns `defaultDurationMinutes` per `EnrollmentSummary` in `src/lib/services/tutoringProgramService.ts:161-166` — just needs to be added to this page's local interface).

No automated test (no component-test convention); verify manually in Step 2.

- [ ] **Step 1: Rewrite the page**

Replace the full contents of `src/app/admin/tutoring/bookings/page.tsx` with:

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
import TutoringBookingCalendar from '@/components/tutoring/TutoringBookingCalendar';

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
  defaultDurationMinutes: number;
}

interface EnrollmentApiRow {
  id: string;
  active: boolean;
  studentName: string;
  programId: string;
  programName: string;
  defaultDurationMinutes: number;
}

interface MissedBookingOption {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
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
  const [newBookingEnrollmentId, setNewBookingEnrollmentId] = useState('');
  const [newBookingKind, setNewBookingKind] = useState<'regular' | 'makeup'>('regular');
  const [missedBookings, setMissedBookings] = useState<MissedBookingOption[]>([]);
  const [makeupOriginalId, setMakeupOriginalId] = useState('');
  const [month, setMonth] = useState(todayDateInput().slice(0, 7));
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  async function loadOverview() {
    const res = await fetch(`/api/tutoring-bookings/overview?date=${date}`);
    setRows(await res.json());
  }

  async function loadOptions() {
    const res = await fetch('/api/tutoring-enrollments');
    const enrollmentData: EnrollmentApiRow[] = await res.json();
    setEnrollments(
      enrollmentData
        .filter((e) => e.active)
        .map((e) => ({
          id: e.id,
          studentName: e.studentName,
          programId: e.programId,
          programName: e.programName,
          defaultDurationMinutes: e.defaultDurationMinutes,
        }))
    );
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

  useEffect(() => {
    if (newBookingKind !== 'makeup' || !newBookingEnrollmentId) {
      setMissedBookings([]);
      setMakeupOriginalId('');
      return;
    }
    setMakeupOriginalId('');
    fetch(`/api/tutoring-bookings/makeup-eligible?enrollmentId=${newBookingEnrollmentId}`)
      .then((res) => res.json())
      .then(setMissedBookings);
  }, [newBookingEnrollmentId, newBookingKind]);

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

  const newBookingEnrollment = enrollments.find((e) => e.id === newBookingEnrollmentId);

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
        <p className="mb-2 font-semibold text-ink">新增預約</p>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-inkMuted">
            學生
            <select
              value={newBookingEnrollmentId}
              onChange={(e) => setNewBookingEnrollmentId(e.target.value)}
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
            類型
            <select
              value={newBookingKind}
              onChange={(e) => setNewBookingKind(e.target.value as 'regular' | 'makeup')}
              className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
            >
              <option value="regular">一般</option>
              <option value="makeup">補課</option>
            </select>
          </label>
          {newBookingKind === 'makeup' && (
            <label className="text-xs text-inkMuted">
              要補的缺席紀錄
              <select
                value={makeupOriginalId}
                onChange={(e) => setMakeupOriginalId(e.target.value)}
                className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
              >
                <option value="">請選擇</option>
                {missedBookings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {formatDateWithWeekday(b.date)}・{b.startTime}-{b.endTime}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {!newBookingEnrollmentId && <p className="text-sm text-inkMuted">請先選擇學生</p>}
        {newBookingEnrollmentId && newBookingKind === 'makeup' && missedBookings.length === 0 && (
          <p className="text-sm text-inkMuted">這位學生目前沒有可補課的紀錄</p>
        )}
        {newBookingEnrollment && (newBookingKind === 'regular' || makeupOriginalId) && (
          <TutoringBookingCalendar
            key={`${newBookingEnrollmentId}-${newBookingKind}-${makeupOriginalId}`}
            enrollmentId={newBookingEnrollment.id}
            defaultDurationMinutes={newBookingEnrollment.defaultDurationMinutes}
            mode={newBookingKind}
            makeupForBookingId={newBookingKind === 'makeup' ? makeupOriginalId : undefined}
            successMessage={newBookingKind === 'makeup' ? '已建立補課預約' : '已新增預約'}
            onBooked={loadOverview}
          />
        )}
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

- [ ] **Step 2: Manually verify in the browser**

```bash
npm run dev
```

Log in as an admin account, go to `/admin/tutoring/bookings`:
- With no student selected, confirm "請先選擇學生" shows and no calendar renders.
- Pick a student with an active enrollment, type "一般": confirm the calendar renders, clicking a day and submitting shows toast "已新增預約" and the new row appears in the overview table for that date (switch the date picker if needed).
- Switch type to "補課" for a student with no missed sessions: confirm "這位學生目前沒有可補課的紀錄" shows, no calendar.
- Pick a student who has a `CANCELLED_LATE` booking (cancel one via "取消（計次）" on an existing booking first if needed, or use the seed data), switch to "補課": confirm the "要補的缺席紀錄" dropdown lists it, selecting it renders a two-month calendar, and submitting shows toast "已建立補課預約" — then confirm in the overview table the new row's 狀態 is `BOOKED` (not pending), unlike a student-submitted makeup request.
- Confirm capacity is still enforced: pick a fully-booked slot and confirm the "這段時間名額已滿，請選別的時間" toast appears instead of a booking being created.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/tutoring/bookings/page.tsx
git commit -m "feat(tutoring): admin can book/makeup directly via capacity-checked calendar"
```

---

### Task 7: Remove the walk-in backend (now unreferenced)

**Files:**
- Delete: `src/app/api/tutoring-bookings/walk-in/route.ts`
- Modify: `src/lib/services/tutoringBookingService.ts` (remove `createWalkInBooking`)
- Modify: `src/lib/services/tutoringBookingService.test.ts` (remove its tests and import)

**Interfaces:** None — this task only removes code. Task 6 already stopped calling `/api/tutoring-bookings/walk-in`, so this is safe.

- [ ] **Step 1: Confirm nothing still references walk-in**

Run: `grep -rn "walk-in\|walkIn\|createWalkInBooking" src/`
Expected: only hits inside `src/app/api/tutoring-bookings/walk-in/route.ts`, `src/lib/services/tutoringBookingService.ts`, and `src/lib/services/tutoringBookingService.test.ts` — the three files this task removes/edits.

- [ ] **Step 2: Delete the route**

```bash
rm -rf "src/app/api/tutoring-bookings/walk-in"
```

- [ ] **Step 3: Remove the service function**

In `src/lib/services/tutoringBookingService.ts`, delete this block (the comment line immediately above `createWalkInBooking` through its closing brace):

```ts
// 老師／行政現場補加：教室現場人數由老師目視判斷，系統不做容量檢查。
export async function createWalkInBooking(input: {
  enrollmentId: string;
  windowId: string;
  date: Date;
  startTime: string;
  endTime: string;
}): Promise<{ id: string }> {
  try {
    return await prisma.tutoringBooking.create({
      data: { ...input, kind: 'REGULAR', status: 'BOOKED' },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2003' || err.code === 'P2025')) {
      // A bad enrollmentId/windowId surfaces as a foreign key violation whose
      // message names the failing constraint (e.g. `TutoringBooking_enrollmentId_fkey`);
      // use that to report which caller-supplied id was invalid.
      if (err.message.includes('enrollmentId')) throw new Error('ENROLLMENT_NOT_FOUND');
      if (err.message.includes('windowId')) throw new Error('WINDOW_NOT_FOUND');
    }
    throw err;
  }
}
```

- [ ] **Step 4: Remove its tests**

In `src/lib/services/tutoringBookingService.test.ts`:

1. Change the import line (currently `import { createBooking, createWalkInBooking, cancelBooking, adminCancelBooking, requestMakeup, decideMakeup } from './tutoringBookingService';`) to drop `createWalkInBooking`:

```ts
import { createBooking, cancelBooking, adminCancelBooking, requestMakeup, decideMakeup } from './tutoringBookingService';
```

2. Delete the entire `describe('createWalkInBooking', ...)` block:

```ts
describe('createWalkInBooking', () => {
  it('creates a BOOKED booking without checking capacity', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment(1);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    const walkIn = await createWalkInBooking({ enrollmentId: enrollment.id, windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' });
    expect(await prisma.tutoringBooking.count({ where: { windowId: window.id, date: FRIDAY } })).toBe(2);
    expect((await prisma.tutoringBooking.findUniqueOrThrow({ where: { id: walkIn.id } })).status).toBe('BOOKED');
  });

  it('rejects with ENROLLMENT_NOT_FOUND for a nonexistent enrollment id', async () => {
    const { window } = await setupProgramWithEnrollment();
    await expect(
      createWalkInBooking({ enrollmentId: 'nonexistent-enrollment-id', windowId: window.id, date: FRIDAY, startTime: '16:00', endTime: '18:00' })
    ).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });

  it('rejects with WINDOW_NOT_FOUND for a nonexistent window id', async () => {
    const { enrollment } = await setupProgramWithEnrollment();
    await expect(
      createWalkInBooking({ enrollmentId: enrollment.id, windowId: 'nonexistent-window-id', date: FRIDAY, startTime: '16:00', endTime: '18:00' })
    ).rejects.toThrow('WINDOW_NOT_FOUND');
  });
});
```

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (walk-in tests gone, everything else still green)

- [ ] **Step 6: Confirm no leftover references and no unused import**

Run: `grep -rn "walk-in\|walkIn\|createWalkInBooking" src/`
Expected: no output.

Also check `Prisma` is still used elsewhere in `tutoringBookingService.ts` (it is — `Prisma.TransactionIsolationLevel` in `createBooking` and `Prisma.PrismaClientKnownRequestError` in `cancelBooking`/`adminCancelBooking`), so its import doesn't need touching.

- [ ] **Step 7: Commit**

```bash
git add -A src/app/api/tutoring-bookings/walk-in src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts
git commit -m "chore(tutoring): remove capacity-bypassing walk-in booking path"
```

---

### Task 8: Back link on `/admin/tutoring/bookings`

**Files:**
- Modify: `src/app/admin/tutoring/bookings/page.tsx`

- [ ] **Step 1: Add the `Link` import**

In `src/app/admin/tutoring/bookings/page.tsx`, add `Link` to the imports (right after the `'use client'` line, before `Card`):

```ts
import Link from 'next/link';
```

- [ ] **Step 2: Add the back link above the heading**

Find this line (the page heading):

```tsx
      <h1 className="mb-4 text-xl font-bold text-ink">個別輔導預約總覽</h1>
```

Replace it with:

```tsx
      <Link
        href="/admin/tutoring"
        className="mb-2 inline-flex items-center gap-1 text-sm text-inkMuted transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        返回個別輔導管理
      </Link>
      <h1 className="mb-4 text-xl font-bold text-ink">個別輔導預約總覽</h1>
```

- [ ] **Step 3: Manually verify in the browser**

```bash
npm run dev
```

Go to `/admin/tutoring/bookings`, confirm the "← 返回個別輔導管理" link renders above the heading and clicking it navigates to `/admin/tutoring`.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/tutoring/bookings/page.tsx
git commit -m "feat(tutoring): add back link from bookings overview to program management"
```

---

### Task 9: Default-collapse program cards on `/admin/tutoring`

**Files:**
- Modify: `src/app/admin/tutoring/page.tsx:312`

- [ ] **Step 1: Remove the `open` attribute**

In `src/app/admin/tutoring/page.tsx`, find:

```tsx
          <details className="group" open>
```

Replace it with:

```tsx
          <details className="group">
```

- [ ] **Step 2: Manually verify in the browser**

```bash
npm run dev
```

Go to `/admin/tutoring`:
- Confirm every program card (existing and newly created via "新增課程") renders collapsed by default.
- Click a card's header to confirm it still expands/collapses normally.
- Confirm "停用"/"刪除" buttons on the collapsed card header still work without expanding the card (they call `withStopPropagation`, unaffected by this change).

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/tutoring/page.tsx
git commit -m "feat(tutoring): collapse program cards by default"
```

---

## Final Verification

- [ ] Run `npm test` (full suite, includes `prisma db push` against the test DB) and confirm everything passes.
- [ ] Run `grep -rn "walk-in\|walkIn\|createWalkInBooking" src/` and confirm no output.
- [ ] Manually re-walk the three flows end-to-end in the browser: student regular booking, student makeup request, admin regular + makeup booking, admin back link, admin program card default-collapse.
