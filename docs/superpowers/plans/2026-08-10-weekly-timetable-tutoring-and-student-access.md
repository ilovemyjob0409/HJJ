# 週課表加入個別輔導時段＋開放學生端瀏覽 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show individual-tutoring (個別輔導) weekly time slots alongside regular classes on the existing weekly timetable, and let student accounts view the same full-school timetable (currently admin-only).

**Architecture:** A new shared read endpoint (`GET /api/timetable`) exposes a privacy-safe projection of classes and active tutoring windows to any authenticated role. The timetable's grid-rendering logic is extracted out of the admin-only `TimetableModal` into a standalone `WeeklyTimetableGrid` component that self-fetches from the new endpoint; `TimetableModal` becomes a thin `<Modal>` wrapper (title, color-legend, admin-only color-picker panel) around it, and a new `/student/timetable` page wraps the same component in a plain `<Card>` with no color-picker and no click handler.

**Tech Stack:** Next.js 14 (App Router, route handlers, client components), Prisma + PostgreSQL, Vitest (service/route tests), Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-weekly-timetable-tutoring-and-student-access-design.md` — follow it for anything not covered by a task below.
- `GET /api/timetable` is readable by ANY authenticated session (ADMIN/TEACHER/STUDENT) — 401 only when there's no session at all. Same relaxation applies to `GET /api/subject-colors`; its `POST` stays ADMIN-only.
- `listClassesForTimetable()` must never select or return `enrollments` — this endpoint is reachable by every student, and enrollment data (other students' names, session counts) must not leak through it.
- `/api/classes` and `/api/tutoring-programs` (and their existing role-based branching) are not modified by this plan.
- Individual-tutoring cards on the grid: colored using the same subject-color system (program name treated as the color key), no level accent bar, never clickable (no `onClick`, not wrapped in a `<button>`).
- Reuse existing UI components/utilities exactly as already used elsewhere (`Card`, `Modal`, `Button`, `stripWeekday`/`levelColor`/`MORANDI_PALETTE`/`UNSET_SUBJECT_COLOR` from `@/lib/timetable`, `WEEKDAY_LABELS` from `@/lib/dateFormat`) — no new styling primitives.
- `WeeklyTimetableGrid` renders its own branded "poster" look — confirmed with the user via mockups (see Task 3): the whole grid area (header + weekday pills + day columns) sits on a `bg-brand` (gold) background, a logo image (`public/hjj-logo.png`, already added — a real black-on-transparent PNG of the school's actual logo, background already removed, do not regenerate or replace it) plus the literal text "台中大雅分校" are centered above the grid, weekday pills are inverted to `bg-brandInk`/`text-brand` (dark pill, gold text — the opposite of the pill styling used elsewhere in this codebase, e.g. `TimetableModal`'s own legend), and every day column uses a fixed cream background (`#FFF6E6`) instead of the alternating-stripe treatment used before. This applies identically to both the admin (`TimetableModal`) and student (`/student/timetable`) surfaces, since both render the same shared component. "台中大雅分校" is a hardcoded string (no branch/location data model exists in this codebase) — not sourced from settings or the database.
- This codebase has no component-test convention (only `src/**/*.test.ts` service/route tests run under Vitest). Do not add `.test.tsx` files; verify frontend tasks by running the dev server and checking in the browser.
- `npx tsc --noEmit` and `npm test` must stay clean after every task.

---

### Task 1: Backend — `timetableService.ts` + `GET /api/timetable`

**Files:**
- Create: `src/lib/services/timetableService.ts`
- Test: `src/lib/services/timetableService.test.ts`
- Create: `src/app/api/timetable/route.ts`
- Test: `src/app/api/timetable/route.test.ts`

**Interfaces:**
- Consumes: `createTeacher` (`@/lib/services/teacherService`), `createClass` (`@/lib/services/classService`), `createProgram`/`createWindow`/`updateProgram`/`updateWindow` (`@/lib/services/tutoringProgramService`) — all pre-existing, only used by this task's tests.
- Produces: `listClassesForTimetable(): Promise<{id, name, subject, level, weekday, startTime, endTime, teacher: {user: {name}}}[]>` and `listTutoringSlotsForTimetable(): Promise<TutoringSlotForTimetable[]>` where `TutoringSlotForTimetable = {id, programName, weekday, startTime, endTime, teacher: {user: {name}}}`. `GET /api/timetable` returns `{classes, tutoringSlots}` using both. Task 3's `WeeklyTimetableGrid.tsx` fetches this route and consumes exactly this shape.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/services/timetableService.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createTeacher } from './teacherService';
import { createClass } from './classService';
import { createProgram, createWindow, updateProgram, updateWindow } from './tutoringProgramService';
import { listClassesForTimetable, listTutoringSlotsForTimetable } from './timetableService';

describe('listClassesForTimetable', () => {
  it('returns class schedule fields without enrollments', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'timetable-chen@example.com', password: 'x', subjects: '數學' });
    await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const classes = await listClassesForTimetable();
    expect(classes).toHaveLength(1);
    expect(classes[0]).toMatchObject({
      name: '數學A班',
      subject: '數學',
      level: '國一',
      weekday: 1,
      startTime: '19:00',
      endTime: '21:00',
      teacher: { user: { name: '陳老師' } },
    });
    expect(classes[0]).not.toHaveProperty('enrollments');
  });
});

describe('listTutoringSlotsForTimetable', () => {
  it('flattens active windows under active programs with the program name attached', async () => {
    const teacher = await createTeacher({ name: '王老師', email: 'timetable-wang1@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: 'MPM' });
    const window = await createWindow({ programId: program.id, weekday: 3, startTime: '16:00', endTime: '18:00', capacity: 8, teacherId: teacher.id });

    const slots = await listTutoringSlotsForTimetable();
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      id: window.id,
      programName: 'MPM',
      weekday: 3,
      startTime: '16:00',
      endTime: '18:00',
      teacher: { user: { name: '王老師' } },
    });
  });

  it('excludes windows under an inactive program', async () => {
    const teacher = await createTeacher({ name: '王老師', email: 'timetable-wang2@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '普拉斯' });
    await createWindow({ programId: program.id, weekday: 2, startTime: '16:00', endTime: '18:00', capacity: 8, teacherId: teacher.id });
    await updateProgram(program.id, { active: false });

    expect(await listTutoringSlotsForTimetable()).toEqual([]);
  });

  it('excludes an inactive window under an active program', async () => {
    const teacher = await createTeacher({ name: '王老師', email: 'timetable-wang3@example.com', password: 'x', subjects: '英文' });
    const program = await createProgram({ name: 'MPM' });
    const window = await createWindow({ programId: program.id, weekday: 2, startTime: '16:00', endTime: '18:00', capacity: 8, teacherId: teacher.id });
    await updateWindow(window.id, { active: false });

    expect(await listTutoringSlotsForTimetable()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/timetableService.test.ts`
Expected: FAIL — cannot find module `./timetableService`

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/services/timetableService.ts`:

```ts
import { prisma } from '@/lib/db';

export function listClassesForTimetable() {
  return prisma.class.findMany({
    select: {
      id: true,
      name: true,
      subject: true,
      level: true,
      weekday: true,
      startTime: true,
      endTime: true,
      teacher: { select: { user: { select: { name: true } } } },
    },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
}

export interface TutoringSlotForTimetable {
  id: string;
  programName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
}

export async function listTutoringSlotsForTimetable(): Promise<TutoringSlotForTimetable[]> {
  const programs = await prisma.tutoringProgram.findMany({
    where: { active: true },
    select: {
      name: true,
      windows: {
        where: { active: true },
        select: {
          id: true,
          weekday: true,
          startTime: true,
          endTime: true,
          teacher: { select: { user: { select: { name: true } } } },
        },
      },
    },
  });
  return programs.flatMap((p) => p.windows.map((w) => ({ ...w, programName: p.name })));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/timetableService.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing route test**

Create `src/app/api/timetable/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { createTeacher } from '@/lib/services/teacherService';
import { createClass } from '@/lib/services/classService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asTeacher = () => sessionMock.mockResolvedValue({ user: { id: 'teacher-1', role: 'TEACHER' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/timetable', () => {
  it('401 when not logged in', async () => {
    asAnon();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 with classes and tutoringSlots for ADMIN', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'timetable-route-chen@example.com', password: 'x', subjects: '數學' });
    await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    asAdmin();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.classes).toHaveLength(1);
    expect(body.tutoringSlots).toEqual([]);
  });

  it('200 for TEACHER', async () => {
    asTeacher();
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('200 for STUDENT', async () => {
    asStudent();
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/app/api/timetable/route.test.ts`
Expected: FAIL — cannot find module `./route`

- [ ] **Step 7: Write the minimal implementation**

Create `src/app/api/timetable/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listClassesForTimetable, listTutoringSlotsForTimetable } from '@/lib/services/timetableService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const [classes, tutoringSlots] = await Promise.all([listClassesForTimetable(), listTutoringSlotsForTimetable()]);
  return NextResponse.json({ classes, tutoringSlots });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/app/api/timetable/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add src/lib/services/timetableService.ts src/lib/services/timetableService.test.ts src/app/api/timetable/route.ts src/app/api/timetable/route.test.ts
git commit -m "feat(timetable): add shared timetable service and GET /api/timetable"
```

---

### Task 2: Backend — widen `GET /api/subject-colors` to any authenticated role

**Files:**
- Modify: `src/app/api/subject-colors/route.ts`
- Test: `src/app/api/subject-colors/route.test.ts` (new — no test file exists for this route yet)

**Interfaces:**
- Consumes: `listSubjectColors`/`setSubjectColor` (`@/lib/services/subjectColorService`, unchanged).
- Produces: `GET` now returns 200 for any authenticated session (ADMIN/TEACHER/STUDENT), 401 with no session. `POST` unchanged (403 for non-ADMIN). Task 3's `TimetableModal` (still ADMIN-only page) and Task 4's student page both call this `GET`.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/subject-colors/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET, POST } from './route';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asTeacher = () => sessionMock.mockResolvedValue({ user: { id: 'teacher-1', role: 'TEACHER' } });
const asStudent = () => sessionMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
const asAnon = () => sessionMock.mockResolvedValue(null);

describe('GET /api/subject-colors', () => {
  it('401 when not logged in', async () => {
    asAnon();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 for ADMIN', async () => {
    asAdmin();
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('200 for TEACHER', async () => {
    asTeacher();
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('200 for STUDENT', async () => {
    asStudent();
    const res = await GET();
    expect(res.status).toBe(200);
  });
});

describe('POST /api/subject-colors', () => {
  it('403 for non-ADMIN', async () => {
    asStudent();
    const req = new NextRequest('http://x/api/subject-colors', {
      method: 'POST',
      body: JSON.stringify({ subject: '數學', color: '#123456' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('200 for ADMIN, saves the color', async () => {
    asAdmin();
    const req = new NextRequest('http://x/api/subject-colors', {
      method: 'POST',
      body: JSON.stringify({ subject: '數學', color: '#123456' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ subject: '數學', color: '#123456' });
  });
});
```

- [ ] **Step 2: Run tests to verify the GET ones fail**

Run: `npx vitest run src/app/api/subject-colors/route.test.ts`
Expected: FAIL — the three GET cases for ADMIN/TEACHER/STUDENT expect 200 but the current code returns 403 for TEACHER/STUDENT (and 403, not 401, for anonymous)

- [ ] **Step 3: Update the implementation**

Replace the full contents of `src/app/api/subject-colors/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listSubjectColors, setSubjectColor } from '@/lib/services/subjectColorService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await listSubjectColors());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { subject, color } = await req.json();
  if (typeof subject !== 'string' || !subject || typeof color !== 'string' || !color) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  return NextResponse.json(await setSubjectColor(subject, color));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/subject-colors/route.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/subject-colors/route.ts src/app/api/subject-colors/route.test.ts
git commit -m "feat(timetable): let any authenticated role read subject colors"
```

---

### Task 3: Frontend — extract `WeeklyTimetableGrid`, slim down `TimetableModal`

**Files:**
- Create: `src/components/timetable/WeeklyTimetableGrid.tsx`
- Modify: `src/app/admin/classes/TimetableModal.tsx` (full rewrite)
- Modify: `src/app/admin/classes/page.tsx`
- Already present (added by the controller ahead of this task, not something to create): `public/hjj-logo.png` — the school's actual logo, background already removed and recolored to black, ready to reference as `<img src="/hjj-logo.png">`.

**Interfaces:**
- Consumes: `GET /api/timetable` from Task 1 (shape `{classes, tutoringSlots}`). `stripWeekday`/`levelColor`/`UNSET_SUBJECT_COLOR`/`MORANDI_PALETTE` from `@/lib/timetable` (unchanged). `WEEKDAY_LABELS` from `@/lib/dateFormat` (unchanged).
- Produces: `WeeklyTimetableGrid({ colors: Record<string,string>, onClassClick?: (id: string) => void, onSubjectsChange?: (subjects: string[]) => void })` — a default export. Task 4's student page imports and uses this component directly (with neither optional prop).

No automated test (no component-test convention); verify manually in Step 3.

- [ ] **Step 1: Create `WeeklyTimetableGrid.tsx`**

Create `src/components/timetable/WeeklyTimetableGrid.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { stripWeekday, levelColor, UNSET_SUBJECT_COLOR } from '@/lib/timetable';
import { WEEKDAY_LABELS } from '@/lib/dateFormat';

interface TimetableClass {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
}

interface TutoringSlot {
  id: string;
  programName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
}

type DayCard = { kind: 'class'; data: TimetableClass } | { kind: 'tutoring'; data: TutoringSlot };

interface WeeklyTimetableGridProps {
  colors: Record<string, string>;
  onClassClick?: (id: string) => void;
  onSubjectsChange?: (subjects: string[]) => void;
}

export default function WeeklyTimetableGrid({ colors, onClassClick, onSubjectsChange }: WeeklyTimetableGridProps) {
  const [classes, setClasses] = useState<TimetableClass[]>([]);
  const [tutoringSlots, setTutoringSlots] = useState<TutoringSlot[]>([]);

  useEffect(() => {
    fetch('/api/timetable')
      .then((res) => res.json())
      .then((data: { classes: TimetableClass[]; tutoringSlots: TutoringSlot[] }) => {
        setClasses(data.classes);
        setTutoringSlots(data.tutoringSlots);
      });
  }, []);

  const subjects = useMemo(
    () => Array.from(new Set([...classes.map((c) => c.subject), ...tutoringSlots.map((t) => t.programName)])),
    [classes, tutoringSlots]
  );

  useEffect(() => {
    onSubjectsChange?.(subjects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects]);

  const byDay = useMemo(() => {
    const days: DayCard[][] = Array.from({ length: 7 }, () => []);
    for (const c of classes) days[c.weekday].push({ kind: 'class', data: c });
    for (const t of tutoringSlots) days[t.weekday].push({ kind: 'tutoring', data: t });
    for (const day of days) day.sort((a, b) => a.data.startTime.localeCompare(b.data.startTime));
    return days;
  }, [classes, tutoringSlots]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[840px] rounded-xl bg-brand p-5">
        <div className="mb-4 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hjj-logo.png" alt="黑嘉嘉圍棋" className="mb-1.5 h-14 w-auto" />
          <p className="text-sm font-bold text-brandInk">台中大雅分校</p>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="flex justify-center pb-1">
              <span className="flex h-6 min-w-[40px] items-center justify-center rounded-full bg-brandInk px-2.5 text-xs font-bold text-brand">
                {w}
              </span>
            </div>
          ))}
          {byDay.map((day, d) => (
            <div key={d} className="flex min-h-[90px] flex-col gap-1.5 rounded-lg bg-[#FFF6E6] p-1.5">
              {day.length === 0 ? (
                <p className="pt-3 text-center text-xs text-[#b89a5c]">無課程</p>
              ) : (
                day.map((card) => {
                  if (card.kind === 'tutoring') {
                    return (
                      <div
                        key={card.data.id}
                        className="overflow-hidden rounded-md py-1.5 pl-2 pr-2 text-left"
                        style={{ background: colors[card.data.programName] ?? UNSET_SUBJECT_COLOR }}
                      >
                        <p className="text-xs font-bold text-brandInk">{card.data.programName}</p>
                        <p className="mt-0.5 text-[11px] text-brandInk/80">
                          {card.data.startTime}-{card.data.endTime}
                        </p>
                        <p className="text-[10px] text-brandInk/60">{card.data.teacher.user.name}</p>
                      </div>
                    );
                  }
                  const content = (
                    <>
                      <span
                        className="absolute bottom-0 right-0 top-0 w-2.5"
                        style={{ background: levelColor(card.data.level) }}
                      />
                      <p className="text-xs font-bold text-brandInk">{stripWeekday(card.data.name)}</p>
                      <p className="mt-0.5 text-[11px] text-brandInk/80">
                        {card.data.startTime}-{card.data.endTime}
                      </p>
                      <p className="text-[10px] text-brandInk/60">
                        {card.data.teacher.user.name}・{card.data.level}
                      </p>
                    </>
                  );
                  const cardClassName = 'relative overflow-hidden rounded-md py-1.5 pl-2 pr-4 text-left';
                  const cardStyle = { background: colors[card.data.subject] ?? UNSET_SUBJECT_COLOR };
                  return onClassClick ? (
                    <button
                      key={card.data.id}
                      type="button"
                      onClick={() => onClassClick(card.data.id)}
                      className={`${cardClassName} transition-[filter] hover:brightness-110`}
                      style={cardStyle}
                    >
                      {content}
                    </button>
                  ) : (
                    <div key={card.data.id} className={cardClassName} style={cardStyle}>
                      {content}
                    </div>
                  );
                })
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Note this task's version of `stripWeekday`/`levelColor`/`UNSET_SUBJECT_COLOR` imports and the `TimetableClass`/`TutoringSlot`/`DayCard`/`WeeklyTimetableGridProps` types/state/effects above this return statement are unchanged from the original extraction — only the JSX inside `return (...)` changed (gold poster wrapper, logo + branch-name header, inverted weekday pill colors, fixed cream day-column background). `bg-stripe` is no longer used anywhere in this file.

- [ ] **Step 2: Replace the full contents of `TimetableModal.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import WeeklyTimetableGrid from '@/components/timetable/WeeklyTimetableGrid';
import { UNSET_SUBJECT_COLOR, MORANDI_PALETTE } from '@/lib/timetable';

interface TimetableModalProps {
  open: boolean;
  onClose: () => void;
  onClassClick?: (id: string) => void;
}

export default function TimetableModal({ open, onClose, onClassClick }: TimetableModalProps) {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [subjects, setSubjects] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/subject-colors')
      .then((res) => res.json())
      .then((rows: { subject: string; color: string }[]) => {
        setColors(Object.fromEntries(rows.map((r) => [r.subject, r.color])));
      });
  }, [open]);

  async function handleColorChange(subject: string, color: string) {
    setColors((prev) => ({ ...prev, [subject]: color }));
    await fetch('/api/subject-colors', { method: 'POST', body: JSON.stringify({ subject, color }) });
  }

  return (
    <Modal open={open} onClose={onClose} title="週課表" maxWidthClassName="max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink">
          {subjects.map((subject) => (
            <span key={subject} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: colors[subject] ?? UNSET_SUBJECT_COLOR }}
              />
              {subject}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brandInk hover:bg-brandDark"
        >
          色塊調整
        </button>
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: panelOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="mb-3 rounded-lg bg-stripe p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold text-ink">科目顏色</span>
              <button
                type="button"
                className="text-xs text-inkMuted hover:underline"
                onClick={() => setPanelOpen(false)}
              >
                收合
              </button>
            </div>
            {subjects.map((subject) => (
              <div key={subject} className="flex flex-wrap items-center gap-2 py-1.5 text-sm text-ink">
                <span className="w-20 font-medium">{subject}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {MORANDI_PALETTE.map((color) => {
                    const selected = colors[subject] === color;
                    return (
                      <button
                        key={color}
                        type="button"
                        aria-label={`${subject}：${color}`}
                        onClick={() => handleColorChange(subject, color)}
                        className={`h-6 w-6 rounded-md transition-[transform,box-shadow] ${
                          selected ? 'scale-110 ring-2 ring-ink ring-offset-1' : 'hover:scale-110'
                        }`}
                        style={{ background: color }}
                      />
                    );
                  })}
                </div>
                {!colors[subject] && (
                  <span className="rounded-full bg-pendingBg px-2 py-0.5 text-xs text-pending">尚未設定</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <WeeklyTimetableGrid colors={colors} onClassClick={onClassClick} onSubjectsChange={setSubjects} />
    </Modal>
  );
}
```

- [ ] **Step 3: Update the call site in `page.tsx`**

In `src/app/admin/classes/page.tsx`, find:

```tsx
      <TimetableModal
        open={showTimetable}
        onClose={() => setShowTimetable(false)}
        classes={classes}
        onClassClick={(id) => {
          const c = classes.find((cls) => cls.id === id);
          if (!c) return;
          setShowTimetable(false);
          openEdit(c);
        }}
      />
```

Replace with (drops the now-removed `classes` prop; `onClassClick` is unchanged since it still needs the page's own full `classes` state to open the edit modal):

```tsx
      <TimetableModal
        open={showTimetable}
        onClose={() => setShowTimetable(false)}
        onClassClick={(id) => {
          const c = classes.find((cls) => cls.id === id);
          if (!c) return;
          setShowTimetable(false);
          openEdit(c);
        }}
      />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Manually verify in the browser**

```bash
npm run dev
```

Log in as admin, go to `/admin/classes`, click 週課表:
- Confirm the grid area renders on a gold (`bg-brand`) background with rounded corners, the school logo (`/hjj-logo.png`) and "台中大雅分校" text centered above the grid, and weekday pills are dark with gold text (inverted from the legend/color-picker pills above, which stay as they were).
- Confirm every day column has the same cream background, not the old alternating-stripe treatment.
- Confirm regular class cards still look correct (subject color from the Morandi palette, level accent bar on the right, clickable — clicking closes the timetable and opens 編輯班級 for that class).
- Confirm individual-tutoring time slots (e.g. any windows you've set up under `/admin/tutoring`) now appear in their correct weekday column: colored (using the program name as the color key), no accent bar, and clicking them does nothing.
- Confirm the 科目顏色 legend at the top (outside the gold poster area, in the Modal's normal chrome) lists both class subjects and tutoring program names, with no duplicates.
- Click 色塊調整, confirm it lists every subject (class subjects + tutoring program names), pick a new color for a tutoring program name, confirm it immediately re-colors that program's cards on the grid below, and confirm it's saved (`GET /api/subject-colors` reflects it, e.g. by closing and reopening the modal).
- Confirm the class list/table and the 新增班級/編輯班級 flows on `/admin/classes` still work unaffected (the page's own `classes` state is untouched by this change).

- [ ] **Step 7: Commit**

```bash
git add src/components/timetable/WeeklyTimetableGrid.tsx src/app/admin/classes/TimetableModal.tsx src/app/admin/classes/page.tsx
git commit -m "refactor(timetable): extract WeeklyTimetableGrid, add tutoring slots to 週課表"
```

---

### Task 4: Frontend — student-facing `/student/timetable` page + nav link

**Files:**
- Create: `src/app/student/timetable/page.tsx`
- Modify: `src/components/ui/AppShell.tsx`

**Interfaces:**
- Consumes: `WeeklyTimetableGrid` from Task 3 (`src/components/timetable/WeeklyTimetableGrid.tsx`), `GET /api/subject-colors` from Task 2 (now readable by STUDENT), `Card` from `@/components/ui/Card` (unchanged).
- Produces: nothing consumed by a later task (this is the last task).

No automated test (no component-test convention); verify manually in Step 3.

- [ ] **Step 1: Create the student page**

Create `src/app/student/timetable/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import WeeklyTimetableGrid from '@/components/timetable/WeeklyTimetableGrid';

export default function StudentTimetablePage() {
  const [colors, setColors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/subject-colors')
      .then((res) => res.json())
      .then((rows: { subject: string; color: string }[]) => {
        setColors(Object.fromEntries(rows.map((r) => [r.subject, r.color])));
      });
  }, []);

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">週課表</h1>
      <Card>
        <WeeklyTimetableGrid colors={colors} />
      </Card>
    </>
  );
}
```

- [ ] **Step 2: Add the nav link**

In `src/components/ui/AppShell.tsx`, find the `STUDENT` array inside `NAV_LINKS`:

```tsx
  STUDENT: [
    { href: '/student', label: '首頁', exact: true },
    { href: '/student/leave-request', label: '請假申請' },
    { href: '/student/makeup-request', label: '補課申請' },
    { href: '/student/tutoring', label: '個別輔導' },
    { href: '/student/go-hall', label: '弈廳' },
    { href: '/student/attendance', label: '我的出席紀錄' },
    { href: '/student/points', label: '集點卡' },
    { href: '/student/activities', label: '活動專區' },
    { href: '/student/faq', label: '常見問題' },
  ],
```

Replace with (adds the new link right after 個別輔導):

```tsx
  STUDENT: [
    { href: '/student', label: '首頁', exact: true },
    { href: '/student/leave-request', label: '請假申請' },
    { href: '/student/makeup-request', label: '補課申請' },
    { href: '/student/tutoring', label: '個別輔導' },
    { href: '/student/timetable', label: '週課表' },
    { href: '/student/go-hall', label: '弈廳' },
    { href: '/student/attendance', label: '我的出席紀錄' },
    { href: '/student/points', label: '集點卡' },
    { href: '/student/activities', label: '活動專區' },
    { href: '/student/faq', label: '常見問題' },
  ],
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Manually verify in the browser**

```bash
npm run dev
```

Log in as a student, confirm 週課表 appears in the nav bar (right after 個別輔導), click it:
- Confirm the same gold poster look as the admin view (logo, "台中大雅分校", inverted weekday pills, cream day columns) and the same grid content (full school — every class and every active tutoring slot), with the same colors.
- Confirm there is no 色塊調整 button and no color-picker panel anywhere on the page.
- Confirm no card (class or tutoring) responds to a click.
- Confirm the rest of the student nav/pages are unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/app/student/timetable/page.tsx src/components/ui/AppShell.tsx
git commit -m "feat(timetable): add student-facing weekly timetable page"
```
