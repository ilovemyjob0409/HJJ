# Class Attendance Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a teacher see their whole class's attendance history (grouped by student, including pending-makeup status), and let admin see the same view for any class.

**Architecture:** One new backend merge query (`ClassAttendance` ∪ `LeaveRequest` ∪ `MakeupRequest`, scoped to one class, grouped by student) behind a role-checked API route, rendered by one shared React component mounted at two thin role-specific page routes. No schema changes.

**Tech Stack:** Next.js App Router, Prisma, Vitest. Existing app conventions: `StatusBadge`, `Card`, native `<details>`/`<summary>` for collapse (see `src/app/admin/tutoring/page.tsx`), `formatDateWithWeekday`/`WEEKDAY_LABELS` from `@/lib/dateFormat`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-class-attendance-overview-design.md`.
- Teacher scope is **only classes where `class.teacherId` equals their own teacher id** — do NOT reuse `teacherCanAccessClass` (that helper also allows substitute-taught classes, which is explicitly out of scope here).
- No new `MakeupStatus`/`AttendanceStatus` enum values. "Pending makeup" (請假 with no `MakeupRequest` yet) is represented as `makeup: null` on an `ON_LEAVE` record, not a new status string.
- Don't enumerate theoretical class calendar dates — only show dates that have an actual `ClassAttendance` or `LeaveRequest` row.
- This project has zero React component tests (`find src -name "*.test.tsx"` → 0 results). Service-layer and API-route logic gets Vitest tests; frontend pages get manual browser verification steps in this plan instead.
- Run `npm run test:dbpush` once before running any test task if you haven't already synced the test DB schema this session (no schema changes in this plan, so this is only needed if your test DB is stale from a previous session).

---

### Task 1: `getClassAttendanceOverview` service function

**Files:**
- Modify: `src/lib/services/attendanceService.ts`
- Test: `src/lib/services/attendanceService.test.ts`

**Interfaces:**
- Produces: `ClassAttendanceOverviewMakeup`, `ClassAttendanceOverviewRecord`, `ClassAttendanceOverviewStudent` interfaces and `getClassAttendanceOverview(classId: string): Promise<ClassAttendanceOverviewStudent[]>`, all exported from `src/lib/services/attendanceService.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/services/attendanceService.test.ts` (append near the end of the file, after the last `describe` block). Add these imports to the existing import lines at the top of the file:

```ts
import { createInsertionMakeupRequest, createOneOnOneMakeupRequest, decideMakeupRequest } from './makeupRequestService';
import { setTeacherAvailability } from './availabilityService';
```

(If `createInsertionMakeupRequest`/`createOneOnOneMakeupRequest`/`decideMakeupRequest` are already imported elsewhere in the file, merge into the existing import statement instead of duplicating.)

Add `getClassAttendanceOverview` to the existing `attendanceService` import list (the big destructured import near the top of the file that already lists `getClassRoster, saveClassAttendance, ...`).

Then append:

```ts
describe('getClassAttendanceOverview', () => {
  async function setup() {
    const teacher = await createTeacher({ name: '陳老師', email: `overview-chen-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const cls = await createClass({ name: '週三基礎2A', subject: '圍棋', level: '基礎2', teacherId: teacher.id, weekday: 3, startTime: '17:10', endTime: '18:40' });
    const studentA = await createStudent({ name: '小明', email: `overview-ming-${Date.now()}@example.com`, password: 'x' });
    const studentB = await createStudent({ name: '呂昕曄', email: `overview-lu-${Date.now()}@example.com`, password: 'x' });
    await enrollStudent(cls.id, studentA.id);
    await enrollStudent(cls.id, studentB.id);
    return { teacher, cls, studentA, studentB };
  }

  it('lists a plain attendance record with no makeup info', async () => {
    const { cls, studentA } = await setup();
    const date = new Date('2026-07-01');
    await saveClassAttendance(cls.id, date, 'marker-1', [
      { studentId: studentA.id, status: 'PRESENT', checkInTime: '17:10', checkOutTime: '18:40' },
    ]);

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toEqual([{ date, status: 'PRESENT', checkInTime: '17:10', checkOutTime: '18:40', makeup: null }]);
  });

  it('shows a leave with no makeup request yet as ON_LEAVE with makeup: null', async () => {
    const { cls, studentA } = await setup();
    await createLeaveRequest({ studentId: studentA.id, classId: cls.id, date: new Date('2026-07-01'), reason: '事假' });

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toEqual([
      { date: new Date('2026-07-01'), status: 'ON_LEAVE', checkInTime: null, checkOutTime: null, makeup: null },
    ]);
  });

  it('shows an approved insertion makeup with a descriptive label', async () => {
    const { cls, studentA, teacher } = await setup();
    const targetClass = await createClass({
      name: '週一基礎2A', subject: '圍棋', level: '基礎2', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '20:30',
    });
    const leave = await createLeaveRequest({ studentId: studentA.id, classId: cls.id, date: new Date('2026-07-01'), reason: '事假' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: new Date('2026-07-06') });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toHaveLength(1);
    expect(row.records[0].status).toBe('ON_LEAVE');
    expect(row.records[0].makeup).toEqual({ status: 'APPROVED', type: 'INSERTION', label: '補到 2026/7/6（一） 週一基礎2A' });
  });

  it('shows a pending one-on-one makeup with teacher and time', async () => {
    const { cls, studentA, teacher } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    const leave = await createLeaveRequest({ studentId: studentA.id, classId: cls.id, date: new Date('2026-07-01'), reason: '事假' });
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id, studentId: studentA.id, teacherId: teacher.id, slotDate: new Date('2026-07-08'), slotStartTime: '16:00',
    });

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records[0].makeup).toEqual({ status: 'PENDING_ADMIN', type: 'ONE_ON_ONE', label: '陳老師 一對一 2026/7/8（三） 16:00-16:40' });
  });

  it('shows an absence without leave as ABSENT with no makeup', async () => {
    const { cls, studentA } = await setup();
    await saveClassAttendance(cls.id, new Date('2026-07-01'), 'marker-1', [{ studentId: studentA.id, status: 'ABSENT' }]);

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records[0]).toMatchObject({ status: 'ABSENT', makeup: null });
  });

  it('groups records by student and sorts each student\'s records newest first', async () => {
    const { cls, studentA, studentB } = await setup();
    await saveClassAttendance(cls.id, new Date('2026-07-01'), 'marker-1', [{ studentId: studentA.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-07-15'), 'marker-1', [{ studentId: studentA.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-07-08'), 'marker-1', [{ studentId: studentB.id, status: 'PRESENT' }]);

    const overview = await getClassAttendanceOverview(cls.id);
    expect(overview.map((s) => s.studentId).sort()).toEqual([studentA.id, studentB.id].sort());

    const rowA = overview.find((s) => s.studentId === studentA.id)!;
    expect(rowA.records.map((r) => r.date)).toEqual([new Date('2026-07-15'), new Date('2026-07-01')]);

    const rowB = overview.find((s) => s.studentId === studentB.id)!;
    expect(rowB.records).toHaveLength(1);
  });

  it('includes historical records for a student no longer enrolled in the class', async () => {
    const { cls, studentA } = await setup();
    await saveClassAttendance(cls.id, new Date('2026-07-01'), 'marker-1', [{ studentId: studentA.id, status: 'PRESENT' }]);
    await prisma.classEnrollment.delete({ where: { studentId_classId: { studentId: studentA.id, classId: cls.id } } });

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id);
    expect(row?.studentName).toBe('小明');
    expect(row?.records).toHaveLength(1);
  });

  it('returns an empty array for a class with no students', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: `overview-empty-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const cls = await createClass({ name: '空班', subject: '圍棋', level: '基礎1', teacherId: teacher.id, weekday: 3, startTime: '17:10', endTime: '18:40' });
    expect(await getClassAttendanceOverview(cls.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/attendanceService.test.ts -t "getClassAttendanceOverview"`
Expected: FAIL with `getClassAttendanceOverview is not a function` (or a TypeScript error if run through `tsc` first — either way, it must not compile/pass yet).

- [ ] **Step 3: Write the implementation**

Add this import near the top of `src/lib/services/attendanceService.ts` (merge with existing imports, don't duplicate the `import { prisma }` line):

```ts
import { formatDateWithWeekday } from '@/lib/dateFormat';
```

Append this to the end of `src/lib/services/attendanceService.ts`:

```ts
export interface ClassAttendanceOverviewMakeup {
  status: 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED';
  type: 'INSERTION' | 'ONE_ON_ONE';
  label: string;
}

export interface ClassAttendanceOverviewRecord {
  date: Date;
  status: AttendanceStatusValue;
  checkInTime: string | null;
  checkOutTime: string | null;
  makeup: ClassAttendanceOverviewMakeup | null;
}

export interface ClassAttendanceOverviewStudent {
  studentId: string;
  studentName: string;
  records: ClassAttendanceOverviewRecord[];
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// 整班出缺勤總表（依學生分組，含補課狀態）：合併 ClassAttendance（點名紀錄）
// 與 LeaveRequest（請假，本身不會自動產生點名紀錄，是分開的表）＋其
// MakeupRequest。只列有紀錄的日期，不枚舉理論上課日。曾經在班但已退班的
// 學生，只要還有歷史點名/請假紀錄，一樣列出（不因為 ClassEnrollment 被刪
// 就把歷史藏起來）。
export async function getClassAttendanceOverview(classId: string): Promise<ClassAttendanceOverviewStudent[]> {
  const [enrollments, attendances, leaves] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { classId },
      select: { studentId: true, student: { select: NAME_SELECT } },
      orderBy: { student: { user: { name: 'asc' } } },
    }),
    prisma.classAttendance.findMany({
      where: { classId },
      select: {
        studentId: true,
        student: { select: NAME_SELECT },
        date: true,
        status: true,
        checkInTime: true,
        checkOutTime: true,
      },
    }),
    prisma.leaveRequest.findMany({
      where: { classId },
      select: {
        studentId: true,
        student: { select: NAME_SELECT },
        date: true,
        makeupRequest: {
          select: {
            status: true,
            type: true,
            targetDate: true,
            targetClass: { select: { name: true } },
            teacher: { select: { user: { select: { name: true } } } },
            slotDate: true,
            slotStartTime: true,
            slotEndTime: true,
          },
        },
      },
    }),
  ]);

  const byStudent = new Map<string, { studentName: string; records: Map<string, ClassAttendanceOverviewRecord> }>();
  function bucketFor(studentId: string, studentName: string) {
    let bucket = byStudent.get(studentId);
    if (!bucket) {
      bucket = { studentName, records: new Map() };
      byStudent.set(studentId, bucket);
    }
    return bucket;
  }

  for (const e of enrollments) bucketFor(e.studentId, e.student.user.name);

  for (const l of leaves) {
    const bucket = bucketFor(l.studentId, l.student.user.name);
    let makeup: ClassAttendanceOverviewMakeup | null = null;
    if (l.makeupRequest) {
      const m = l.makeupRequest;
      const label =
        m.type === 'INSERTION'
          ? `補到 ${formatDateWithWeekday(m.targetDate!)} ${m.targetClass?.name ?? ''}`
          : `${m.teacher?.user.name ?? ''} 一對一 ${formatDateWithWeekday(m.slotDate!)} ${m.slotStartTime}-${m.slotEndTime}`;
      makeup = { status: m.status, type: m.type, label };
    }
    bucket.records.set(toDateKey(l.date), { date: l.date, status: 'ON_LEAVE', checkInTime: null, checkOutTime: null, makeup });
  }

  for (const a of attendances) {
    const bucket = bucketFor(a.studentId, a.student.user.name);
    const key = toDateKey(a.date);
    const existing = bucket.records.get(key);
    bucket.records.set(key, {
      date: a.date,
      status: a.status as AttendanceStatusValue,
      checkInTime: a.checkInTime,
      checkOutTime: a.checkOutTime,
      makeup: existing?.makeup ?? null,
    });
  }

  return Array.from(byStudent.entries()).map(([studentId, v]) => ({
    studentId,
    studentName: v.studentName,
    records: Array.from(v.records.values()).sort((a, b) => b.date.getTime() - a.date.getTime()),
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: all tests in the file PASS (this runs the whole file, not just the new block, to catch regressions from the new import/interface additions).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "feat(attendance): add getClassAttendanceOverview (whole-class history grouped by student, with makeup status)"
```

---

### Task 2: API route `GET /api/classes/[id]/attendance-overview`

**Files:**
- Create: `src/app/api/classes/[id]/attendance-overview/route.ts`
- Test: `src/app/api/classes/[id]/attendance-overview/route.test.ts`

**Interfaces:**
- Consumes: `getClassAttendanceOverview(classId: string): Promise<ClassAttendanceOverviewStudent[]>` from Task 1.
- Produces: `GET` handler returning `{ class: { id, name, subject, level, weekday, startTime, endTime, teacherName }, students: ClassAttendanceOverviewStudent[] }` as JSON. Response shape consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/classes/[id]/attendance-overview/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createClass, enrollStudent } from '@/lib/services/classService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'u', role: 'STUDENT' } });

async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: `overview-route-chen-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const cls = await createClass({ name: '週三基礎2A', subject: '圍棋', level: '基礎2', teacherId: teacher.id, weekday: 3, startTime: '17:10', endTime: '18:40' });
  const student = await createStudent({ name: '小明', email: `overview-route-ming-${Date.now()}@example.com`, password: 'x' });
  await enrollStudent(cls.id, student.id);
  return { teacher, cls, student };
}

describe('GET /api/classes/[id]/attendance-overview', () => {
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

  it('404 when the class does not exist (admin)', async () => {
    asAdmin();
    const res = await GET({} as never, { params: { id: 'nonexistent-class-id' } });
    expect(res.status).toBe(404);
  });

  it('403 for a TEACHER who does not teach this class', async () => {
    const { cls } = await setup();
    const other = await createTeacher({ name: '林老師', email: `overview-route-lin-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: other.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'TEACHER' } });

    const res = await GET({} as never, { params: { id: cls.id } });
    expect(res.status).toBe(403);
  });

  it("200 with class info and students for the class's own TEACHER", async () => {
    const { teacher, cls, student } = await setup();
    const { userId } = await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } });
    sessionMock.mockResolvedValue({ user: { id: userId, role: 'TEACHER' } });

    const res = await GET({} as never, { params: { id: cls.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.class).toMatchObject({ id: cls.id, name: '週三基礎2A', subject: '圍棋', level: '基礎2', weekday: 3, teacherName: '陳老師' });
    expect(body.students).toEqual([{ studentId: student.id, studentName: '小明', records: [] }]);
  });

  it('200 for ADMIN on any class', async () => {
    const { cls } = await setup();
    asAdmin();
    const res = await GET({} as never, { params: { id: cls.id } });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/classes/[id]/attendance-overview/route.test.ts`
Expected: FAIL (`./route` module not found, since the route file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/app/api/classes/[id]/attendance-overview/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getClassAttendanceOverview } from '@/lib/services/attendanceService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role !== 'ADMIN' && session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cls = await prisma.class.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      subject: true,
      level: true,
      weekday: true,
      startTime: true,
      endTime: true,
      teacherId: true,
      teacher: { select: { user: { select: { name: true } } } },
    },
  });
  if (!cls) return NextResponse.json({ error: 'CLASS_NOT_FOUND' }, { status: 404 });

  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    if (cls.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const students = await getClassAttendanceOverview(cls.id);
  return NextResponse.json({
    class: {
      id: cls.id,
      name: cls.name,
      subject: cls.subject,
      level: cls.level,
      weekday: cls.weekday,
      startTime: cls.startTime,
      endTime: cls.endTime,
      teacherName: cls.teacher.user.name,
    },
    students,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/classes/[id]/attendance-overview/route.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Type-check, lint, and commit**

Run: `npx tsc --noEmit && npx eslint src/app/api/classes/[id]/attendance-overview/route.ts`
Expected: no errors.

```bash
git add src/app/api/classes/[id]/attendance-overview/route.ts src/app/api/classes/[id]/attendance-overview/route.test.ts
git commit -m "feat(attendance): add GET /api/classes/[id]/attendance-overview (admin any class, teacher own class only)"
```

---

### Task 3: Shared frontend component `ClassAttendanceOverview`

**Files:**
- Create: `src/components/ClassAttendanceOverview.tsx`

**Interfaces:**
- Consumes: `GET /api/classes/[id]/attendance-overview` response shape from Task 2 (`{ class: {...}, students: ClassAttendanceOverviewStudent[] }`).
- Produces: `export default function ClassAttendanceOverview({ classId, backHref, backLabel }: { classId: string; backHref: string; backLabel: string })`, consumed by Tasks 4 and 5.

- [ ] **Step 1: Write the component**

Create `src/components/ClassAttendanceOverview.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import { WEEKDAY_LABELS, formatDateWithWeekday } from '@/lib/dateFormat';

interface OverviewMakeup {
  status: 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED';
  type: 'INSERTION' | 'ONE_ON_ONE';
  label: string;
}

interface OverviewRecord {
  date: string;
  status: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED';
  checkInTime: string | null;
  checkOutTime: string | null;
  makeup: OverviewMakeup | null;
}

interface OverviewStudent {
  studentId: string;
  studentName: string;
  records: OverviewRecord[];
}

interface OverviewResponse {
  class: {
    id: string;
    name: string;
    subject: string;
    level: string;
    weekday: number;
    startTime: string;
    endTime: string;
    teacherName: string;
  };
  students: OverviewStudent[];
}

// 整班出缺勤總表：依學生分組，每個學生區塊預設收合（比照
// src/app/admin/tutoring/page.tsx 的 <details className="group"> 慣例），
// 點開才看到完整表格。老師／行政共用同一個元件，權限與範圍差異都在 API
// 層（見 /api/classes/[id]/attendance-overview），這裡只負責顯示。
export default function ClassAttendanceOverview({
  classId,
  backHref,
  backLabel,
}: {
  classId: string;
  backHref: string;
  backLabel: string;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/classes/${classId}/attendance-overview`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [classId]);

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
        <p className="text-sm text-inkMuted">找不到班級或沒有權限查看</p>
      ) : (
        <>
          <h1 className="mb-1 text-xl font-bold text-ink">{data.class.name}・出缺勤總表</h1>
          <p className="mb-4 text-sm text-inkMuted">
            {data.class.subject}・{data.class.level}｜週{WEEKDAY_LABELS[data.class.weekday]} {data.class.startTime}-{data.class.endTime}｜
            {data.class.teacherName}
          </p>
          {data.students.length === 0 ? (
            <p className="text-sm text-inkMuted">目前沒有學生</p>
          ) : (
            data.students.map((s) => {
              const pendingCount = s.records.filter((r) => r.status === 'ON_LEAVE' && r.makeup === null).length;
              return (
                <Card key={s.studentId} className="mb-3">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <span className="text-inkMuted transition-transform group-open:rotate-180">▾</span>
                        {s.studentName}
                      </span>
                      {pendingCount > 0 && <span className="text-xs text-pending">{pendingCount} 筆待安排補課</span>}
                    </summary>
                    {s.records.length === 0 ? (
                      <p className="mt-3 text-sm text-inkMuted">尚無紀錄</p>
                    ) : (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="text-xs text-inkMuted">
                              <th className="pb-2 pr-2 font-normal">日期</th>
                              <th className="pb-2 pr-2 font-normal">狀態</th>
                              <th className="pb-2 font-normal">補課狀態</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.records.map((r) => (
                              <tr key={r.date} className="border-t border-borderSubtle">
                                <td className="py-2 pr-2 text-ink">{formatDateWithWeekday(r.date)}</td>
                                <td className="py-2 pr-2">
                                  <StatusBadge status={r.status} />
                                </td>
                                <td className="py-2">
                                  {r.status !== 'ON_LEAVE' ? (
                                    <span className="text-inkMuted">—</span>
                                  ) : r.makeup === null ? (
                                    <span className="text-inkMuted">尚未安排</span>
                                  ) : r.makeup.status === 'APPROVED' ? (
                                    <span className="text-approved">已核准・{r.makeup.label}</span>
                                  ) : (
                                    <StatusBadge status={r.makeup.status} />
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
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

Run: `npx tsc --noEmit && npx eslint src/components/ClassAttendanceOverview.tsx`
Expected: no errors. (This component has no automated test — this project has zero `.test.tsx` files; it gets manually verified once mounted in Tasks 4 and 5.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ClassAttendanceOverview.tsx
git commit -m "feat(attendance): add shared ClassAttendanceOverview component (per-student collapsed sections)"
```

---

### Task 4: Teacher page + entry point

**Files:**
- Create: `src/app/teacher/classes/[id]/attendance/page.tsx`
- Modify: `src/components/TeacherClassList.tsx`

**Interfaces:**
- Consumes: `ClassAttendanceOverview` from Task 3.

- [ ] **Step 1: Create the teacher page**

Create `src/app/teacher/classes/[id]/attendance/page.tsx`:

```tsx
import ClassAttendanceOverview from '@/components/ClassAttendanceOverview';

export default function TeacherClassAttendancePage({ params }: { params: { id: string } }) {
  return <ClassAttendanceOverview classId={params.id} backHref="/teacher" backLabel="返回首頁" />;
}
```

(`/teacher/*` is already role-gated to `TEACHER` by `src/middleware.ts`'s `matcher: ['/admin/:path*', '/teacher/:path*', '/student/:path*']` — no middleware change needed. The API route from Task 2 additionally checks that this specific teacher owns this specific class.)

- [ ] **Step 2: Add the entry point in `TeacherClassList.tsx`**

In `src/components/TeacherClassList.tsx`, add this import near the top (with the other imports):

```tsx
import Link from 'next/link';
```

Then find this block (the modal body, after the low-quota warnings):

```tsx
            {lowQuota.length > 0 && (
              <div className="mt-3 flex flex-col gap-1">
                {lowQuota.map((s) => (
                  <p key={s.studentId} className="text-sm text-pending">
                    ⚠ {s.name} 剩 {s.remaining} 堂
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>
```

Replace it with (adds a link right after the low-quota block, still inside the `{viewing && (...)}` fragment):

```tsx
            {lowQuota.length > 0 && (
              <div className="mt-3 flex flex-col gap-1">
                {lowQuota.map((s) => (
                  <p key={s.studentId} className="text-sm text-pending">
                    ⚠ {s.name} 剩 {s.remaining} 堂
                  </p>
                ))}
              </div>
            )}
            <Link href={`/teacher/classes/${viewing.id}/attendance`} className="mt-3 inline-block text-sm text-brandDark hover:underline">
              查看出缺勤 →
            </Link>
          </>
        )}
      </Modal>
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/teacher/classes/[id]/attendance/page.tsx src/components/TeacherClassList.tsx`
Expected: no errors.

- [ ] **Step 4: Manual browser verification**

1. Start the dev server (`mcp__Claude_Browser__preview_start` with the project's configured dev server name, or `npm run dev` if working outside this tool).
2. Log in as a TEACHER who owns at least one class with some attendance/leave history (seed data already has classes with history from earlier sessions — pick any teacher associated with a populated class).
3. Go to `/teacher`, find "我的帶班班級", click a class row to open the "學生名單" modal.
4. Confirm a "查看出缺勤 →" link appears below the student list / low-quota section.
5. Click it. Confirm it navigates to `/teacher/classes/<id>/attendance` and shows: class name + subject/level/weekday/time/teacher header, one collapsed section per student.
6. Click a student's row to expand it. Confirm the table shows date/status/makeup-status columns, newest date first.
7. If any student has an `ON_LEAVE` row with no makeup arranged, confirm it shows "尚未安排" and the collapsed summary line shows a "N 筆待安排補課" hint.
8. Log in as a DIFFERENT teacher who does NOT teach that class, manually navigate to the same `/teacher/classes/<id>/attendance` URL. Confirm it shows "找不到班級或沒有權限查看" (the API returned 403, `data` stayed `null`).

- [ ] **Step 5: Commit**

```bash
git add src/app/teacher/classes/[id]/attendance/page.tsx src/components/TeacherClassList.tsx
git commit -m "feat(attendance): teacher can view their own class's full attendance overview"
```

---

### Task 5: Admin page + entry point

**Files:**
- Create: `src/app/admin/classes/[id]/attendance/page.tsx`
- Modify: `src/app/admin/classes/page.tsx`

**Interfaces:**
- Consumes: `ClassAttendanceOverview` from Task 3.

- [ ] **Step 1: Create the admin page**

Create `src/app/admin/classes/[id]/attendance/page.tsx`:

```tsx
import ClassAttendanceOverview from '@/components/ClassAttendanceOverview';

export default function AdminClassAttendancePage({ params }: { params: { id: string } }) {
  return <ClassAttendanceOverview classId={params.id} backHref="/admin/classes" backLabel="返回班級名單" />;
}
```

- [ ] **Step 2: Add the entry point in `src/app/admin/classes/page.tsx`**

Add this import near the top (with the other imports):

```tsx
import { withStopPropagation } from '@/components/ui/stopPropagation';
```

Find the `操作` column definition:

```tsx
    {
      header: '操作',
      render: (c) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(c)}>
          編輯
        </button>
      ),
    },
```

Replace it with:

```tsx
    {
      header: '操作',
      render: (c) => (
        <div className="flex gap-3">
          <button className="text-brandDark hover:underline" onClick={() => openEdit(c)}>
            編輯
          </button>
          <button
            className="text-brandDark hover:underline"
            onClick={withStopPropagation(() => router.push(`/admin/classes/${c.id}/attendance`))}
          >
            出缺勤
          </button>
        </div>
      ),
    },
```

(`router` is already defined at the top of this component via `const router = useRouter();` — confirmed present in the existing file. `withStopPropagation` is needed because the table row itself has `onRowClick={openEdit}`; without it, clicking "出缺勤" would also fire `openEdit` and both actions would race.)

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/admin/classes/[id]/attendance/page.tsx src/app/admin/classes/page.tsx`
Expected: no errors.

- [ ] **Step 4: Manual browser verification**

1. Log in as ADMIN.
2. Go to `/admin/classes`. Confirm each row's "操作" column now shows "編輯" and "出缺勤" side by side.
3. Click "出缺勤" on a class with history. Confirm it navigates to `/admin/classes/<id>/attendance` (not the edit modal) and renders the same page layout verified in Task 4.
4. Click "編輯" on the same row still opens the edit modal as before (regression check — this button's behavior must be unchanged).
5. From the attendance page, click "返回班級名單" and confirm it returns to `/admin/classes`.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (no regressions from the whole plan).

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/classes/[id]/attendance/page.tsx src/app/admin/classes/page.tsx
git commit -m "feat(attendance): admin can view any class's full attendance overview"
```
