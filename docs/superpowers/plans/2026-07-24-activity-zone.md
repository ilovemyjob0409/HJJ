# Activity Zone (活動專區) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new, independent Activity Zone feature (camps/lectures/competitions/observation classes) with admin creation + roster management, teacher read-only roster view, and student browse/register/cancel — mirroring the existing Go Hall (弈廳) feature's architecture exactly, without touching Go Hall itself.

**Architecture:** Two new Prisma models (`Activity`, `ActivityRegistration`) independent of `GoHallSession`/`GoHallRegistration`. A service layer (`activityService.ts`) mirroring `goHallService.ts`'s function shapes 1:1. Four Next.js API routes following the existing `getServerSession` + role-check guard pattern. Three role-scoped pages (`/admin/activities`, `/teacher/activities`, `/student/activities`) reusing the existing `Card`/`Button`/`Input`/`Select`/`DataTable`/`Modal`/`Toast` UI kit and the collapse-toggle create-form pattern already used on `/admin/students`.

**Tech Stack:** Next.js 14.2 (App Router, plain `{ params: { id: string } }` route handlers — no async params), Prisma 7 with the `pg` driver adapter, PostgreSQL, NextAuth (`getServerSession`), Vitest for service-layer tests, Tailwind for styling.

## Global Constraints

- This is a new, independent feature. Do not modify `GoHallSession`, `GoHallRegistration`, `goHallService.ts`, any `go-hall-*` route, or any `/admin|teacher|student/go-hall` page.
- No update/edit path for an existing activity — create + delete only (matches Go Hall precedent). Do not build an edit form or `PATCH` route.
- No cover images or file uploads — text-only fields.
- No dashboard summary widgets — the three list pages are the only surfaces.
- No visibility scoping by class/subject — every student sees every open activity.
- No waitlists, payment/fee handling, recurring activities, or notifications.
- All dates render via the existing `formatDateWithWeekday` helper (`src/lib/dateFormat.ts`) — `日期（星期）`, e.g. `2026/8/1（六）`. Never reimplement this formatting.
- Student-facing rosters use the existing `maskName` helper (`src/lib/maskName.ts`) — no new masking logic.
- Concurrency-sensitive registration writes use `runSerializableWithRetry` (`src/lib/transaction.ts`) wrapping a `Prisma.TransactionIsolationLevel.Serializable` transaction — the same pattern as `registerForSession`.
- API routes in this codebase are not unit-tested (confirmed: zero `*.test.ts` files under `src/app/api`) — only service-layer functions get Vitest coverage. API routes and UI pages are verified manually via the dev server (Task 15).
- Run `npm run test` (service-layer suite) and `npx tsc --noEmit` after every task that touches TypeScript source, before committing.

---

### Task 1: Prisma schema — `Activity` / `ActivityRegistration` data model

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `ActivityCategory` enum (`CAMP` | `LECTURE` | `COMPETITION` | `OBSERVATION`), `Activity` model, `ActivityRegistration` model — consumed by every later task via `@prisma/client`.

- [ ] **Step 1: Add the back-relation field to `model Teacher`**

In `prisma/schema.prisma`, find:

```prisma
model Teacher {
  id                          String                @id @default(cuid())
  userId                      String                @unique
  user                        User                  @relation(fields: [userId], references: [id])
  subjects                    String
  phone                       String?
  classes                     Class[]
  availabilities              TeacherAvailability[]
  oneOnOneMakeups             MakeupRequest[]       @relation("OneOnOneTeacher")
  substituteRequestsOriginal  SubstituteRequest[]   @relation("OriginalTeacher")
  substituteRequestsAssigned  SubstituteRequest[]   @relation("SubstituteTeacher")
  goHallSessions              GoHallSession[]
}
```

Replace with:

```prisma
model Teacher {
  id                          String                @id @default(cuid())
  userId                      String                @unique
  user                        User                  @relation(fields: [userId], references: [id])
  subjects                    String
  phone                       String?
  classes                     Class[]
  availabilities              TeacherAvailability[]
  oneOnOneMakeups             MakeupRequest[]       @relation("OneOnOneTeacher")
  substituteRequestsOriginal  SubstituteRequest[]   @relation("OriginalTeacher")
  substituteRequestsAssigned  SubstituteRequest[]   @relation("SubstituteTeacher")
  goHallSessions              GoHallSession[]
  activities                  Activity[]
}
```

- [ ] **Step 2: Add the back-relation field to `model Student`**

Find:

```prisma
model Student {
  id            String            @id @default(cuid())
  userId        String            @unique
  user          User              @relation(fields: [userId], references: [id])
  parentPhone   String?
  enrollments   ClassEnrollment[]
  leaveRequests LeaveRequest[]
  goHallRegistrations GoHallRegistration[]
}
```

Replace with:

```prisma
model Student {
  id            String            @id @default(cuid())
  userId        String            @unique
  user          User              @relation(fields: [userId], references: [id])
  parentPhone   String?
  enrollments   ClassEnrollment[]
  leaveRequests LeaveRequest[]
  goHallRegistrations GoHallRegistration[]
  activityRegistrations ActivityRegistration[]
}
```

- [ ] **Step 3: Append the new enum and models**

At the end of `prisma/schema.prisma` (after the `model SubjectColor { ... }` block), append:

```prisma
enum ActivityCategory {
  CAMP // 營隊
  LECTURE // 講座
  COMPETITION // 比賽
  OBSERVATION // 觀摩課
}

model Activity {
  id            String                  @id @default(cuid())
  title         String
  description   String
  category      ActivityCategory
  location      String?
  startDate     DateTime
  endDate       DateTime
  capacity      Int
  teacherId     String?
  teacher       Teacher?                @relation(fields: [teacherId], references: [id])
  registrations ActivityRegistration[]
  createdAt     DateTime                @default(now())
}

model ActivityRegistration {
  id         String   @id @default(cuid())
  activityId String
  activity   Activity @relation(fields: [activityId], references: [id])
  studentId  String
  student    Student  @relation(fields: [studentId], references: [id])
  createdAt  DateTime @default(now())

  @@unique([activityId, studentId])
}
```

- [ ] **Step 4: Format and validate the schema**

Run: `npx prisma format`
Expected: command exits 0, no error output, `prisma/schema.prisma` reformatted in place (column alignment only, no content change).

- [ ] **Step 5: Push schema to the test database**

Run: `npm run test:dbpush`
Expected: `🚀  Your database is now in sync with your Prisma schema.` with no errors, exit code 0.

- [ ] **Step 6: Push schema to the dev database and regenerate the client**

Run: `npx prisma db push && npx prisma generate`
Expected: both commands succeed with no errors; `@prisma/client` now exports `ActivityCategory`, and `prisma.activity` / `prisma.activityRegistration` are available.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add Activity and ActivityRegistration data model"
```

---

### Task 2: Display helpers — `formatActivityDateRange` + `ACTIVITY_CATEGORY_LABELS`

**Files:**
- Create: `src/lib/activityDateRange.ts`
- Test: `src/lib/activityDateRange.test.ts`
- Create: `src/lib/activityCategory.ts`
- Test: `src/lib/activityCategory.test.ts`

**Interfaces:**
- Consumes: `formatDateWithWeekday(date: Date | string, locale?: string): string` from `src/lib/dateFormat.ts` (existing).
- Produces: `formatActivityDateRange(startDate: Date | string, endDate: Date | string, locale?: string): string`; `ACTIVITY_CATEGORIES: readonly ['CAMP', 'LECTURE', 'COMPETITION', 'OBSERVATION']`; `ActivityCategoryValue` type; `ACTIVITY_CATEGORY_LABELS: Record<ActivityCategoryValue, string>` — consumed by Tasks 12–14 (UI pages).

- [ ] **Step 1: Write the failing test for `formatActivityDateRange`**

Create `src/lib/activityDateRange.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatActivityDateRange } from './activityDateRange';

describe('formatActivityDateRange', () => {
  it('renders a single-day activity as one formatted date', () => {
    const day = new Date(2026, 7, 1);
    expect(formatActivityDateRange(day, day, 'zh-TW')).toBe('2026/8/1（六）');
  });

  it('renders a multi-day activity as start ~ end, each side individually formatted', () => {
    const start = new Date(2026, 7, 15);
    const end = new Date(2026, 7, 17);
    expect(formatActivityDateRange(start, end, 'zh-TW')).toBe('2026/8/15（六） ~ 2026/8/17（一）');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/activityDateRange.test.ts`
Expected: FAIL — `Cannot find module './activityDateRange'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/activityDateRange.ts`:

```ts
import { formatDateWithWeekday } from './dateFormat';

export function formatActivityDateRange(startDate: Date | string, endDate: Date | string, locale?: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startStr = formatDateWithWeekday(start, locale);
  if (start.toDateString() === end.toDateString()) return startStr;
  return `${startStr} ~ ${formatDateWithWeekday(end, locale)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/activityDateRange.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for the category labels**

Create `src/lib/activityCategory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_LABELS } from './activityCategory';

describe('ACTIVITY_CATEGORY_LABELS', () => {
  it('has a Chinese label for every category in ACTIVITY_CATEGORIES', () => {
    for (const category of ACTIVITY_CATEGORIES) {
      expect(ACTIVITY_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });

  it('maps each category to its expected label', () => {
    expect(ACTIVITY_CATEGORY_LABELS.CAMP).toBe('營隊');
    expect(ACTIVITY_CATEGORY_LABELS.LECTURE).toBe('講座');
    expect(ACTIVITY_CATEGORY_LABELS.COMPETITION).toBe('比賽');
    expect(ACTIVITY_CATEGORY_LABELS.OBSERVATION).toBe('觀摩課');
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/lib/activityCategory.test.ts`
Expected: FAIL — `Cannot find module './activityCategory'`.

- [ ] **Step 7: Write the minimal implementation**

Create `src/lib/activityCategory.ts`:

```ts
export const ACTIVITY_CATEGORIES = ['CAMP', 'LECTURE', 'COMPETITION', 'OBSERVATION'] as const;

export type ActivityCategoryValue = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategoryValue, string> = {
  CAMP: '營隊',
  LECTURE: '講座',
  COMPETITION: '比賽',
  OBSERVATION: '觀摩課',
};
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/lib/activityCategory.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/activityDateRange.ts src/lib/activityDateRange.test.ts src/lib/activityCategory.ts src/lib/activityCategory.test.ts
git commit -m "feat: add activity date-range and category label helpers"
```

---

### Task 3: `activityService` — `createActivity` + `listAllActivities`

**Files:**
- Create: `src/lib/services/activityService.ts`
- Create: `src/lib/services/activityService.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; `createTeacher` from `./teacherService`; `createStudent` from `./studentService`.
- Produces: `CreateActivityInput` interface; `createActivity(input: CreateActivityInput)`; `listAllActivities()` returning rows shaped `{ id, title, description, category, location, startDate, endDate, capacity, teacher: { user: { name } } | null, registrations: { id, studentId, student: { user: { name } } }[], _count: { registrations } }` — consumed by Task 4 onward and by the admin API route (Task 8) and admin UI (Task 12).

- [ ] **Step 1: Write the failing test**

Create `src/lib/services/activityService.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createActivity, listAllActivities } from './activityService';

beforeEach(async () => {
  await prisma.activityRegistration.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.goHallRegistration.deleteMany();
  await prisma.goHallSession.deleteMany();
  await prisma.substituteRequest.deleteMany();
  await prisma.makeupRequest.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

describe('createActivity / listAllActivities', () => {
  it('creates an activity and lists activities soonest-startDate-first with registration count and roster', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });

    await createActivity({
      title: '暑期營隊',
      description: '為期三天的暑期營隊',
      category: 'CAMP',
      location: '活動中心',
      startDate: new Date(2026, 7, 15),
      endDate: new Date(2026, 7, 17),
      capacity: 20,
      teacherId: teacher.id,
    });
    await createActivity({
      title: '棋藝講座',
      description: '一日講座',
      category: 'LECTURE',
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 30,
    });

    const activities = await listAllActivities();
    expect(activities).toHaveLength(2);
    expect(activities[0].title).toBe('棋藝講座');
    expect(activities[1].title).toBe('暑期營隊');
    expect(activities[1].teacher?.user.name).toBe('陳老師');
    expect(activities[0].teacher).toBeNull();
    expect(activities[0]._count.registrations).toBe(0);
    expect(activities[0].registrations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: FAIL — `Cannot find module './activityService'`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/services/activityService.ts`:

```ts
import { prisma } from '@/lib/db';
import { ActivityCategory } from '@prisma/client';

// Activity rosters are sent to STUDENT-role requesters (with names masked)
// as well as ADMIN/TEACHER (real names) — email must not be selected here
// or it would leak unmasked in the student-facing response.
const NAME_ONLY_SELECT = { name: true } as const;

const ACTIVITY_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  location: true,
  startDate: true,
  endDate: true,
  capacity: true,
  teacher: { select: { user: { select: NAME_ONLY_SELECT } } },
  registrations: {
    select: {
      id: true,
      studentId: true,
      student: { select: { user: { select: NAME_ONLY_SELECT } } },
    },
  },
  _count: { select: { registrations: true } },
} as const;

export interface CreateActivityInput {
  title: string;
  description: string;
  category: ActivityCategory;
  location?: string;
  startDate: Date;
  endDate: Date;
  capacity: number;
  teacherId?: string;
}

export function createActivity(input: CreateActivityInput) {
  return prisma.activity.create({
    data: {
      title: input.title,
      description: input.description,
      category: input.category,
      location: input.location,
      startDate: input.startDate,
      endDate: input.endDate,
      capacity: input.capacity,
      teacherId: input.teacherId,
    },
  });
}

export function listAllActivities() {
  return prisma.activity.findMany({
    select: ACTIVITY_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/activityService.ts src/lib/services/activityService.test.ts
git commit -m "feat: add createActivity and listAllActivities"
```

---

### Task 4: `activityService` — `listActivitiesForTeacher` + `listOpenActivitiesForStudent`

**Files:**
- Modify: `src/lib/services/activityService.ts`
- Modify: `src/lib/services/activityService.test.ts`

**Interfaces:**
- Produces: `listActivitiesForTeacher(teacherId: string)` (same row shape as `listAllActivities`); `listOpenActivitiesForStudent()` returning rows shaped `{ id, title, description, category, location, startDate, endDate, capacity, teacher: { user: { name } } | null, _count: { registrations } }` (no `registrations` array) — consumed by the teacher/student API routes (Task 8) and pages (Tasks 13–14).

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/activityService.test.ts` (add the import names, then the two new `describe` blocks at the end of the file):

Change the import line:

```ts
import { createActivity, listAllActivities } from './activityService';
```

to:

```ts
import { createActivity, listAllActivities, listActivitiesForTeacher, listOpenActivitiesForStudent } from './activityService';
```

Append at the end of the file:

```ts
describe('listActivitiesForTeacher', () => {
  it('returns only activities assigned to the given teacher', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const teacherB = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    await createActivity({
      title: 'A 活動',
      description: 'a',
      category: 'CAMP',
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 10,
      teacherId: teacherA.id,
    });
    await createActivity({
      title: 'B 活動',
      description: 'b',
      category: 'CAMP',
      startDate: new Date(2026, 7, 2),
      endDate: new Date(2026, 7, 2),
      capacity: 10,
      teacherId: teacherB.id,
    });

    const results = await listActivitiesForTeacher(teacherA.id);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('A 活動');
  });
});

describe('listOpenActivitiesForStudent', () => {
  it('excludes an activity whose endDate is in the past and includes one ending today or later', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await createActivity({ title: '已結束活動', description: 'x', category: 'CAMP', startDate: yesterday, endDate: yesterday, capacity: 10 });
    await createActivity({ title: '進行中活動', description: 'x', category: 'CAMP', startDate: tomorrow, endDate: tomorrow, capacity: 10 });

    const results = await listOpenActivitiesForStudent();
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('進行中活動');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: FAIL — `listActivitiesForTeacher` / `listOpenActivitiesForStudent` are not exported.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/services/activityService.ts`, after the `ACTIVITY_LIST_SELECT` constant, add:

```ts
const ACTIVITY_STUDENT_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  location: true,
  startDate: true,
  endDate: true,
  capacity: true,
  teacher: { select: { user: { select: NAME_ONLY_SELECT } } },
  _count: { select: { registrations: true } },
} as const;
```

After `listAllActivities`, add:

```ts
export function listActivitiesForTeacher(teacherId: string) {
  return prisma.activity.findMany({
    where: { teacherId },
    select: ACTIVITY_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
}

export function listOpenActivitiesForStudent() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return prisma.activity.findMany({
    where: { endDate: { gte: today } },
    select: ACTIVITY_STUDENT_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/activityService.ts src/lib/services/activityService.test.ts
git commit -m "feat: add listActivitiesForTeacher and listOpenActivitiesForStudent"
```

---

### Task 5: `activityService` — `registerForActivity` (with concurrency test)

**Files:**
- Modify: `src/lib/services/activityService.ts`
- Modify: `src/lib/services/activityService.test.ts`

**Interfaces:**
- Consumes: `runSerializableWithRetry` from `@/lib/transaction`; `Prisma.TransactionIsolationLevel` from `@prisma/client`.
- Produces: `registerForActivity(activityId: string, studentId: string): Promise<ActivityRegistration>`, throwing `Error('ACTIVITY_FULL')` at capacity — consumed by the registration API route (Task 10).

- [ ] **Step 1: Write the failing tests**

Change the import line in `src/lib/services/activityService.test.ts`:

```ts
import { createActivity, listAllActivities, listActivitiesForTeacher, listOpenActivitiesForStudent } from './activityService';
```

to:

```ts
import {
  createActivity,
  listAllActivities,
  listActivitiesForTeacher,
  listOpenActivitiesForStudent,
  registerForActivity,
} from './activityService';
```

Append at the end of the file:

```ts
describe('registerForActivity', () => {
  it('creates a registration when under capacity', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8 });
    const activity = await prisma.activity.findFirstOrThrow();

    const registration = await registerForActivity(activity.id, student.id);
    expect(registration.activityId).toBe(activity.id);
    expect(registration.studentId).toBe(student.id);
  });

  it('throws ACTIVITY_FULL once capacity is reached', async () => {
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 1 });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, studentA.id);

    await expect(registerForActivity(activity.id, studentB.id)).rejects.toThrow('ACTIVITY_FULL');
  });

  it('allows only one of two concurrent registrations to succeed when capacity is 1', async () => {
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 1 });
    const activity = await prisma.activity.findFirstOrThrow();

    const results = await Promise.allSettled([registerForActivity(activity.id, studentA.id), registerForActivity(activity.id, studentB.id)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toBe('ACTIVITY_FULL');

    const count = await prisma.activityRegistration.count({ where: { activityId: activity.id } });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: FAIL — `registerForActivity` is not exported.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/services/activityService.ts`, update the imports at the top of the file:

```ts
import { prisma } from '@/lib/db';
import { ActivityCategory, Prisma } from '@prisma/client';
import { runSerializableWithRetry } from '@/lib/transaction';
```

At the end of the file, add:

```ts
export async function registerForActivity(activityId: string, studentId: string) {
  return runSerializableWithRetry(() => registerForActivityTx(activityId, studentId));
}

function registerForActivityTx(activityId: string, studentId: string) {
  return prisma.$transaction(
    async (tx) => {
      const activity = await tx.activity.findUniqueOrThrow({ where: { id: activityId } });
      const count = await tx.activityRegistration.count({ where: { activityId } });
      if (count >= activity.capacity) throw new Error('ACTIVITY_FULL');
      return tx.activityRegistration.create({ data: { activityId, studentId } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/activityService.ts src/lib/services/activityService.test.ts
git commit -m "feat: add registerForActivity with serializable capacity check"
```

---

### Task 6: `activityService` — `cancelRegistration` + `adminRemoveRegistration`

**Files:**
- Modify: `src/lib/services/activityService.ts`
- Modify: `src/lib/services/activityService.test.ts`

**Interfaces:**
- Produces: `cancelRegistration(id: string, studentId: string)`, throwing `Error('NOT_OWNER')` on mismatch; `adminRemoveRegistration(id: string)` — consumed by the registration `[id]` API route (Task 10).

- [ ] **Step 1: Write the failing tests**

Change the import line to add the two new names:

```ts
import {
  createActivity,
  listAllActivities,
  listActivitiesForTeacher,
  listOpenActivitiesForStudent,
  registerForActivity,
  cancelRegistration,
  adminRemoveRegistration,
} from './activityService';
```

Append at the end of the file:

```ts
describe('cancelRegistration', () => {
  it('deletes the registration when the student owns it', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8 });
    const activity = await prisma.activity.findFirstOrThrow();
    const registration = await registerForActivity(activity.id, student.id);

    await cancelRegistration(registration.id, student.id);

    const remaining = await prisma.activityRegistration.count();
    expect(remaining).toBe(0);
  });

  it('throws NOT_OWNER when a different student tries to cancel it', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8 });
    const activity = await prisma.activity.findFirstOrThrow();
    const registration = await registerForActivity(activity.id, student.id);

    await expect(cancelRegistration(registration.id, otherStudent.id)).rejects.toThrow('NOT_OWNER');
  });
});

describe('adminRemoveRegistration', () => {
  it('deletes the registration regardless of owner', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8 });
    const activity = await prisma.activity.findFirstOrThrow();
    const registration = await registerForActivity(activity.id, student.id);

    await adminRemoveRegistration(registration.id);

    const remaining = await prisma.activityRegistration.count();
    expect(remaining).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: FAIL — `cancelRegistration` / `adminRemoveRegistration` are not exported.

- [ ] **Step 3: Write the minimal implementation**

At the end of `src/lib/services/activityService.ts`, add:

```ts
export async function cancelRegistration(id: string, studentId: string) {
  const registration = await prisma.activityRegistration.findUniqueOrThrow({ where: { id } });
  if (registration.studentId !== studentId) throw new Error('NOT_OWNER');
  await prisma.activityRegistration.delete({ where: { id } });
}

export async function adminRemoveRegistration(id: string) {
  await prisma.activityRegistration.delete({ where: { id } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/activityService.ts src/lib/services/activityService.test.ts
git commit -m "feat: add cancelRegistration and adminRemoveRegistration"
```

---

### Task 7: `activityService` — `deleteActivity` + `listRegistrationsForStudent` + `getActivityDetail`

**Files:**
- Modify: `src/lib/services/activityService.ts`
- Modify: `src/lib/services/activityService.test.ts`

**Interfaces:**
- Produces: `deleteActivity(id: string)` (deletes registrations then the activity inside a transaction — no `onDelete: Cascade`); `listRegistrationsForStudent(studentId: string)` returning `{ id, activity: <ACTIVITY_STUDENT_LIST_SELECT shape> }[]`; `getActivityDetail(id: string)` returning the same shape as one `listAllActivities` row — consumed by the API routes in Tasks 8–10 and by the student page (Task 14).

- [ ] **Step 1: Write the failing tests**

Change the import line to add the three new names:

```ts
import {
  createActivity,
  listAllActivities,
  listActivitiesForTeacher,
  listOpenActivitiesForStudent,
  registerForActivity,
  cancelRegistration,
  adminRemoveRegistration,
  deleteActivity,
  listRegistrationsForStudent,
  getActivityDetail,
} from './activityService';
```

Append at the end of the file:

```ts
describe('deleteActivity', () => {
  it('removes the activity along with its registrations, leaving no orphaned row', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8 });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, student.id);

    await deleteActivity(activity.id);

    const remainingActivities = await prisma.activity.count();
    const remainingRegistrations = await prisma.activityRegistration.count();
    expect(remainingActivities).toBe(0);
    expect(remainingRegistrations).toBe(0);
  });
});

describe('listRegistrationsForStudent', () => {
  it("returns only the given student's registrations, with activity details", async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8 });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, student.id);
    await registerForActivity(activity.id, otherStudent.id);

    const results = await listRegistrationsForStudent(student.id);
    expect(results).toHaveLength(1);
    expect(results[0].activity.id).toBe(activity.id);
    expect(results[0].activity.title).toBe('營隊');
  });
});

describe('getActivityDetail', () => {
  it('returns activity info with the full (unmasked) roster', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '王大明', email: 'wang@example.com', password: 'x' });
    await createActivity({
      title: '營隊',
      description: 'x',
      category: 'CAMP',
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 8,
      teacherId: teacher.id,
    });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, student.id);

    const detail = await getActivityDetail(activity.id);
    expect(detail.teacher?.user.name).toBe('陳老師');
    expect(detail.registrations).toHaveLength(1);
    expect(detail.registrations[0].student.user.name).toBe('王大明');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: FAIL — `deleteActivity` / `listRegistrationsForStudent` / `getActivityDetail` are not exported.

- [ ] **Step 3: Write the minimal implementation**

At the end of `src/lib/services/activityService.ts`, add:

```ts
export async function deleteActivity(id: string) {
  await prisma.$transaction([
    prisma.activityRegistration.deleteMany({ where: { activityId: id } }),
    prisma.activity.delete({ where: { id } }),
  ]);
}

export function listRegistrationsForStudent(studentId: string) {
  return prisma.activityRegistration.findMany({
    where: { studentId },
    select: {
      id: true,
      activity: { select: ACTIVITY_STUDENT_LIST_SELECT },
    },
    orderBy: { activity: { startDate: 'desc' } },
  });
}

export function getActivityDetail(id: string) {
  return prisma.activity.findUniqueOrThrow({
    where: { id },
    select: ACTIVITY_LIST_SELECT,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the full test suite to confirm no regressions**

Run: `npm run test`
Expected: all suites pass, including the untouched `goHallService.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/activityService.ts src/lib/services/activityService.test.ts
git commit -m "feat: add deleteActivity, listRegistrationsForStudent, getActivityDetail"
```

---

### Task 8: API route — `GET /api/activities`, `POST /api/activities`

**Files:**
- Create: `src/app/api/activities/route.ts`

**Interfaces:**
- Consumes: `createActivity`, `listAllActivities`, `listActivitiesForTeacher`, `listOpenActivitiesForStudent` from `@/lib/services/activityService`; `authOptions` from `@/lib/auth`; `prisma` from `@/lib/db`.
- Produces: `GET` (role-aware list), `POST` (ADMIN-only create, 201) — consumed by all three UI pages (Tasks 12–14).

- [ ] **Step 1: Write the implementation**

Create `src/app/api/activities/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createActivity, listAllActivities, listActivitiesForTeacher, listOpenActivitiesForStudent } from '@/lib/services/activityService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (session.user.role === 'ADMIN') {
    return NextResponse.json(await listAllActivities());
  }
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    return NextResponse.json(await listActivitiesForTeacher(teacher.id));
  }
  return NextResponse.json(await listOpenActivitiesForStudent());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const created = await createActivity({
    title: body.title,
    description: body.description,
    category: body.category,
    location: body.location || undefined,
    startDate: new Date(body.startDate),
    endDate: new Date(body.endDate),
    capacity: Number(body.capacity),
    teacherId: body.teacherId || undefined,
  });
  return NextResponse.json(created, { status: 201 });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/activities/route.ts
git commit -m "feat: add GET/POST /api/activities"
```

---

### Task 9: API route — `GET /api/activities/[id]`, `DELETE /api/activities/[id]`

**Files:**
- Create: `src/app/api/activities/[id]/route.ts`

**Interfaces:**
- Consumes: `getActivityDetail`, `deleteActivity` from `@/lib/services/activityService`; `maskName` from `@/lib/maskName`.
- Produces: `GET` (role-aware roster masking — STUDENT gets masked names, everyone else gets real names, matching the `go-hall-sessions/[id]` precedent), `DELETE` (ADMIN-only) — consumed by the student roster modal (Task 14) and the admin delete flow (Task 12).

- [ ] **Step 1: Write the implementation**

Create `src/app/api/activities/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { maskName } from '@/lib/maskName';
import { getActivityDetail, deleteActivity } from '@/lib/services/activityService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const detail = await getActivityDetail(params.id);
  if (session.user.role !== 'STUDENT') {
    return NextResponse.json(detail);
  }

  return NextResponse.json({
    ...detail,
    registrations: detail.registrations.map((r) => ({
      ...r,
      student: { user: { ...r.student.user, name: maskName(r.student.user.name) } },
    })),
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await deleteActivity(params.id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/activities/[id]/route.ts
git commit -m "feat: add GET/DELETE /api/activities/[id]"
```

---

### Task 10: API routes — `/api/activity-registrations` + `/api/activity-registrations/[id]`

**Files:**
- Create: `src/app/api/activity-registrations/route.ts`
- Create: `src/app/api/activity-registrations/[id]/route.ts`

**Interfaces:**
- Consumes: `registerForActivity`, `listRegistrationsForStudent`, `cancelRegistration`, `adminRemoveRegistration` from `@/lib/services/activityService`.
- Produces: `GET /api/activity-registrations` (STUDENT-only, own history), `POST /api/activity-registrations` (STUDENT-only, 409 on `ACTIVITY_FULL`), `DELETE /api/activity-registrations/[id]` (STUDENT ownership-checked, or ADMIN unchecked) — consumed by the student page (Task 14) and the admin roster modal (Task 12).

- [ ] **Step 1: Write `route.ts`**

Create `src/app/api/activity-registrations/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { registerForActivity, listRegistrationsForStudent } from '@/lib/services/activityService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  return NextResponse.json(await listRegistrationsForStudent(student.id));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const { activityId } = await req.json();
  try {
    const registration = await registerForActivity(activityId, student.id);
    return NextResponse.json(registration, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
```

- [ ] **Step 2: Write `[id]/route.ts`**

Create `src/app/api/activity-registrations/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { cancelRegistration, adminRemoveRegistration } from '@/lib/services/activityService';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (session.user.role === 'ADMIN') {
    await adminRemoveRegistration(params.id);
    return NextResponse.json({ success: true });
  }
  if (session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  try {
    await cancelRegistration(params.id, student.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'NOT_OWNER' ? 403 : 400 });
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/activity-registrations/route.ts src/app/api/activity-registrations/[id]/route.ts
git commit -m "feat: add activity-registrations API routes"
```

---

### Task 11: Nav — add 活動專區 to `AppShell.tsx`

**Files:**
- Modify: `src/components/ui/AppShell.tsx`

**Interfaces:**
- Produces: three new `NAV_LINKS` entries pointing at `/admin/activities`, `/teacher/activities`, `/student/activities` — consumed visually once Tasks 12–14 create those pages.

- [ ] **Step 1: Add the nav entries**

In `src/components/ui/AppShell.tsx`, find:

```tsx
const NAV_LINKS: Record<Role, { href: string; label: string }[]> = {
  ADMIN: [
    { href: '/admin/teachers', label: '老師名單' },
    { href: '/admin/students', label: '學生名單' },
    { href: '/admin/classes', label: '班級名單' },
    { href: '/admin/makeup-requests', label: '補課申請' },
    { href: '/admin/substitute-requests', label: '代課安排' },
    { href: '/admin/go-hall', label: '弈廳' },
  ],
  TEACHER: [
    { href: '/teacher/leave-request', label: '請假/調課申請' },
    { href: '/teacher/availability', label: '設定可補課時段' },
  ],
  STUDENT: [
    { href: '/student/leave-request', label: '請假申請' },
    { href: '/student/makeup-request', label: '補課申請' },
    { href: '/student/go-hall', label: '弈廳' },
  ],
};
```

Replace with:

```tsx
const NAV_LINKS: Record<Role, { href: string; label: string }[]> = {
  ADMIN: [
    { href: '/admin/teachers', label: '老師名單' },
    { href: '/admin/students', label: '學生名單' },
    { href: '/admin/classes', label: '班級名單' },
    { href: '/admin/makeup-requests', label: '補課申請' },
    { href: '/admin/substitute-requests', label: '代課安排' },
    { href: '/admin/go-hall', label: '弈廳' },
    { href: '/admin/activities', label: '活動專區' },
  ],
  TEACHER: [
    { href: '/teacher/leave-request', label: '請假/調課申請' },
    { href: '/teacher/availability', label: '設定可補課時段' },
    { href: '/teacher/activities', label: '活動專區' },
  ],
  STUDENT: [
    { href: '/student/leave-request', label: '請假申請' },
    { href: '/student/makeup-request', label: '補課申請' },
    { href: '/student/go-hall', label: '弈廳' },
    { href: '/student/activities', label: '活動專區' },
  ],
};
```

Note: `TEACHER`'s `NAV_LINKS` did not previously include a `弈廳` entry (teachers reach `/teacher/go-hall` another way) — do not add one; only add `/teacher/activities` as specified.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/AppShell.tsx
git commit -m "feat: add 活動專區 nav entry for all three roles"
```

---

### Task 12: UI — Admin `/admin/activities`

**Files:**
- Create: `src/app/admin/activities/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/activities`, `GET /api/teachers`, `DELETE /api/activities/[id]`, `DELETE /api/activity-registrations/[id]`; `formatActivityDateRange` from `@/lib/activityDateRange`; `ACTIVITY_CATEGORIES`, `ACTIVITY_CATEGORY_LABELS`, `ActivityCategoryValue` from `@/lib/activityCategory`; `Card`, `Button`, `Input`, `Select`, `DataTable`, `Modal`, `useToast` from `@/components/ui/*`.
- Produces: the `/admin/activities` route (auto-wrapped by `src/app/admin/layout.tsx`'s existing `<AppShell role="ADMIN">`, no new layout file needed).

- [ ] **Step 1: Write the page**

Create `src/app/admin/activities/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_LABELS, ActivityCategoryValue } from '@/lib/activityCategory';

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface RosterEntry {
  id: string;
  studentId: string;
  student: { user: { name: string } };
}

interface ActivityRow {
  id: string;
  title: string;
  description: string;
  category: ActivityCategoryValue;
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teacher: { user: { name: string } } | null;
  registrations: RosterEntry[];
  _count: { registrations: number };
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function AdminActivitiesPage() {
  const { showToast } = useToast();
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: ACTIVITY_CATEGORIES[0] as ActivityCategoryValue,
    location: '',
    startDate: '',
    endDate: '',
    capacity: '20',
    teacherId: '',
  });
  const [viewing, setViewing] = useState<ActivityRow | null>(null);

  async function load() {
    const [activitiesRes, teachersRes] = await Promise.all([fetch('/api/activities'), fetch('/api/teachers')]);
    setActivities(await activitiesRes.json());
    setTeachers(await teachersRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/activities', {
      method: 'POST',
      body: JSON.stringify({ ...form, capacity: Number(form.capacity), teacherId: form.teacherId || undefined }),
    });
    setForm({ title: '', description: '', category: ACTIVITY_CATEGORIES[0], location: '', startDate: '', endDate: '', capacity: '20', teacherId: '' });
    setShowAddForm(false);
    showToast('已新增活動');
    load();
  }

  async function handleDeleteActivity() {
    if (!viewing) return;
    const confirmMessage =
      viewing.registrations.length > 0
        ? `已有 ${viewing.registrations.length} 人報名，刪除將一併取消他們的報名，確定嗎？`
        : '確定要刪除此活動嗎？';
    if (!confirm(confirmMessage)) return;
    await fetch(`/api/activities/${viewing.id}`, { method: 'DELETE' });
    setViewing(null);
    showToast('已刪除');
    load();
  }

  async function handleRemoveRegistration(registrationId: string) {
    await fetch(`/api/activity-registrations/${registrationId}`, { method: 'DELETE' });
    showToast('已移除');
    const res = await fetch('/api/activities');
    const updated: ActivityRow[] = await res.json();
    setActivities(updated);
    setViewing((prev) => (prev ? (updated.find((a) => a.id === prev.id) ?? null) : null));
  }

  const columns: Column<ActivityRow>[] = [
    { header: '標題', render: (a) => a.title },
    { header: '分類', render: (a) => ACTIVITY_CATEGORY_LABELS[a.category] },
    { header: '日期區間', render: (a) => formatActivityDateRange(a.startDate, a.endDate, 'zh-TW') },
    { header: '老師', render: (a) => a.teacher?.user.name ?? '-' },
    { header: '人數', render: (a) => `${a._count.registrations}/${a.capacity}` },
    { header: '狀態', render: (a) => (new Date(a.endDate) < startOfToday() ? '已結束' : '進行中') },
    {
      header: '操作',
      render: (a) => (
        <button className="text-brandDark hover:underline" onClick={() => setViewing(a)}>
          查看名單
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">活動專區管理</h1>

      {!showAddForm ? (
        <Button className="mb-6" onClick={() => setShowAddForm(true)}>
          ＋ 新增活動
        </Button>
      ) : (
        <Card className="mb-6 max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增活動</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input placeholder="標題" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <textarea
              placeholder="描述"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25"
              rows={3}
              required
            />
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ActivityCategoryValue })}>
              {ACTIVITY_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {ACTIVITY_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
            <Input placeholder="地點（選填）" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
            <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            <Input
              type="number"
              min="1"
              placeholder="人數上限"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              required
            />
            <Select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })}>
              <option value="">不指派帶領老師</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.user.name}
                </option>
              ))}
            </Select>
            <Button type="submit">新增</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={activities}
          keyField={(a) => a.id}
          onRowClick={(a) => setViewing(a)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="活動名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {ACTIVITY_CATEGORY_LABELS[viewing.category]} · {formatActivityDateRange(viewing.startDate, viewing.endDate, 'zh-TW')} ·{' '}
              {viewing.teacher?.user.name ?? '無指派老師'} · {viewing.registrations.length}/{viewing.capacity}
            </p>
            {viewing.registrations.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生報名</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {viewing.registrations.map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-sm text-ink">
                    {r.student.user.name}
                    <button type="button" className="text-rejected hover:underline" onClick={() => handleRemoveRegistration(r.id)}>
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="mt-2 text-left text-sm text-rejected hover:underline" onClick={handleDeleteActivity}>
              刪除此活動
            </button>
          </div>
        )}
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/activities/page.tsx
git commit -m "feat: add admin activity zone management page"
```

---

### Task 13: UI — Teacher `/teacher/activities`

**Files:**
- Create: `src/app/teacher/activities/page.tsx`

**Interfaces:**
- Consumes: `GET /api/activities` (server returns `listActivitiesForTeacher` shape for a TEACHER session); `formatActivityDateRange`; `ACTIVITY_CATEGORY_LABELS`, `ActivityCategoryValue`; `Card`, `DataTable`, `Modal`.
- Produces: the `/teacher/activities` route (auto-wrapped by `src/app/teacher/layout.tsx`'s `<AppShell role="TEACHER">`).

- [ ] **Step 1: Write the page**

Create `src/app/teacher/activities/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import { ACTIVITY_CATEGORY_LABELS, ActivityCategoryValue } from '@/lib/activityCategory';

interface RosterEntry {
  id: string;
  studentId: string;
  student: { user: { name: string } };
}

interface ActivityRow {
  id: string;
  title: string;
  description: string;
  category: ActivityCategoryValue;
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teacher: { user: { name: string } } | null;
  registrations: RosterEntry[];
  _count: { registrations: number };
}

export default function TeacherActivitiesPage() {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [viewing, setViewing] = useState<ActivityRow | null>(null);

  useEffect(() => {
    fetch('/api/activities')
      .then((res) => res.json())
      .then(setActivities);
  }, []);

  const columns: Column<ActivityRow>[] = [
    { header: '標題', render: (a) => a.title },
    { header: '分類', render: (a) => ACTIVITY_CATEGORY_LABELS[a.category] },
    { header: '日期區間', render: (a) => formatActivityDateRange(a.startDate, a.endDate, 'zh-TW') },
    { header: '人數', render: (a) => `${a._count.registrations}/${a.capacity}` },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">帶領的活動</h1>
      <Card>
        <DataTable
          columns={columns}
          rows={activities}
          keyField={(a) => a.id}
          onRowClick={(a) => setViewing(a)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="活動名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {ACTIVITY_CATEGORY_LABELS[viewing.category]} · {formatActivityDateRange(viewing.startDate, viewing.endDate, 'zh-TW')} ·{' '}
              {viewing.registrations.length}/{viewing.capacity}
            </p>
            {viewing.registrations.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生報名</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {viewing.registrations.map((r) => (
                  <li key={r.id} className="text-sm text-ink">
                    {r.student.user.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/teacher/activities/page.tsx
git commit -m "feat: add teacher activity zone read-only page"
```

---

### Task 14: UI — Student `/student/activities`

**Files:**
- Create: `src/app/student/activities/page.tsx`

**Interfaces:**
- Consumes: `GET /api/activities` (STUDENT session → `listOpenActivitiesForStudent` shape, no `registrations` array), `GET/POST /api/activity-registrations`, `DELETE /api/activity-registrations/[id]`, `GET /api/activities/[id]` (masked roster); `formatActivityDateRange`; `ACTIVITY_CATEGORY_LABELS`, `ActivityCategoryValue`; `Card`, `Button`, `DataTable`, `Modal`, `useToast`.
- Produces: the `/student/activities` route (auto-wrapped by `src/app/student/layout.tsx`'s `<AppShell role="STUDENT">`).

- [ ] **Step 1: Write the page**

Create `src/app/student/activities/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import { ACTIVITY_CATEGORY_LABELS, ActivityCategoryValue } from '@/lib/activityCategory';

interface ActivityStudentRow {
  id: string;
  title: string;
  description: string;
  category: ActivityCategoryValue;
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teacher: { user: { name: string } } | null;
  _count: { registrations: number };
}

interface RegistrationRow {
  id: string;
  activity: ActivityStudentRow;
}

interface RosterEntry {
  id: string;
  studentId: string;
  student: { user: { name: string } };
}

interface ActivityDetail extends ActivityStudentRow {
  registrations: RosterEntry[];
}

export default function StudentActivitiesPage() {
  const { showToast } = useToast();
  const [openActivities, setOpenActivities] = useState<ActivityStudentRow[]>([]);
  const [myRegistrations, setMyRegistrations] = useState<RegistrationRow[]>([]);
  const [viewing, setViewing] = useState<ActivityDetail | null>(null);

  async function load() {
    const [activitiesRes, myRes] = await Promise.all([fetch('/api/activities'), fetch('/api/activity-registrations')]);
    setOpenActivities(await activitiesRes.json());
    setMyRegistrations(await myRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRegister(activityId: string) {
    if (!confirm('確定要報名這個活動嗎？')) return;
    const res = await fetch('/api/activity-registrations', { method: 'POST', body: JSON.stringify({ activityId }) });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error === 'ACTIVITY_FULL' ? '這個活動已經額滿了' : `錯誤：${data.error}`);
      return;
    }
    showToast('已報名');
    load();
  }

  async function handleCancel(registrationId: string) {
    if (!confirm('確定要取消這個活動的報名嗎？')) return;
    await fetch(`/api/activity-registrations/${registrationId}`, { method: 'DELETE' });
    showToast('已取消');
    load();
  }

  async function openRoster(activityId: string) {
    const res = await fetch(`/api/activities/${activityId}`);
    setViewing(await res.json());
  }

  const openColumns: Column<ActivityStudentRow>[] = [
    { header: '標題', render: (a) => a.title },
    { header: '分類', render: (a) => ACTIVITY_CATEGORY_LABELS[a.category] },
    { header: '日期區間', render: (a) => formatActivityDateRange(a.startDate, a.endDate, 'zh-TW') },
    { header: '地點', render: (a) => a.location ?? '-' },
    { header: '老師', render: (a) => a.teacher?.user.name ?? '-' },
    { header: '剩餘名額', render: (a) => Math.max(a.capacity - a._count.registrations, 0) },
    {
      header: '操作',
      render: (a) => (
        <Button className="px-3 py-1 text-xs" disabled={a._count.registrations >= a.capacity} onClick={() => handleRegister(a.id)}>
          {a._count.registrations >= a.capacity ? '已額滿' : '報名'}
        </Button>
      ),
    },
  ];

  const myColumns: Column<RegistrationRow>[] = [
    { header: '標題', render: (r) => r.activity.title },
    { header: '分類', render: (r) => ACTIVITY_CATEGORY_LABELS[r.activity.category] },
    { header: '日期區間', render: (r) => formatActivityDateRange(r.activity.startDate, r.activity.endDate, 'zh-TW') },
    {
      header: '操作',
      render: (r) => (
        <button type="button" className="text-rejected hover:underline" onClick={() => handleCancel(r.id)}>
          取消
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">活動專區</h1>

      <h2 className="mb-2 font-bold text-ink">活動列表</h2>
      <Card className="mb-6">
        <DataTable columns={openColumns} rows={openActivities} keyField={(a) => a.id} />
      </Card>

      <h2 className="mb-2 font-bold text-ink">我的報名紀錄</h2>
      <Card>
        <DataTable
          columns={myColumns}
          rows={myRegistrations}
          keyField={(r) => r.id}
          onRowClick={(r) => openRoster(r.activity.id)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title="活動名單">
        {viewing && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-inkMuted">
              {ACTIVITY_CATEGORY_LABELS[viewing.category]} · {formatActivityDateRange(viewing.startDate, viewing.endDate, 'zh-TW')} ·{' '}
              {viewing.teacher?.user.name ?? '無指派老師'}
            </p>
            {viewing.registrations.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生報名</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {viewing.registrations.map((r) => (
                  <li key={r.id} className="text-sm text-ink">
                    {r.student.user.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/student/activities/page.tsx
git commit -m "feat: add student activity zone browse/register/cancel page"
```

---

### Task 15: Manual verification pass

**Files:** none (browser verification only).

- [ ] **Step 1: Run the full automated suite one more time**

Run: `npm run test && npx tsc --noEmit`
Expected: all tests pass, zero type errors.

- [ ] **Step 2: Start the dev database and app**

Run: `docker-compose up -d && npm run dev`
Expected: Postgres reachable on `localhost:5432`; Next.js dev server on `http://localhost:3000`.

- [ ] **Step 3: Seed if the dev database is empty**

Run: `npm run seed`
Expected: `Seed complete: { admin: 'admin@example.com', teacher: 'teacher@example.com', student: 'student@example.com' }` — all three accounts use password `password123`.

- [ ] **Step 4: Admin flow**

In the browser: log in as `admin@example.com` / `password123`. Confirm a `活動專區` nav pill appears and navigates to `/admin/activities`. Click `＋ 新增活動`, fill in 標題/描述/分類/起始日期/結束日期/人數上限, optionally pick a 帶領老師, submit. Confirm the new row appears in the table with the correct 分類 label and `日期區間` formatted as `YYYY/M/D（星期）`. Click the row to open the roster modal; confirm it shows `0/<capacity>` and "尚無學生報名". Close the modal.

- [ ] **Step 5: Student registration flow**

Log out, log in as `student@example.com` / `password123`. Navigate to `/student/activities`. Confirm the activity created in Step 4 appears in 活動列表 with the correct 剩餘名額. Click 報名, confirm the browser `confirm()` dialog reads "確定要報名這個活動嗎？", accept it. Confirm a toast shows "已報名" and the activity now appears in 我的報名紀錄. Click that row; confirm the roster modal shows the student's own name masked (first + last character only, e.g. `小O` for a 2-character name) — this proves the `GET /api/activities/[id]` masking branch works.

- [ ] **Step 6: Teacher flow (only if a teacher was assigned in Step 4)**

If the activity in Step 4 was assigned to `teacher@example.com`: log out, log in as that teacher. Navigate to `/teacher/activities`. Confirm the activity appears with no 操作 column and no create/delete controls. Click the row; confirm the roster modal shows the real (unmasked) student name and has no 移除 action.

- [ ] **Step 7: Admin capacity and delete flow**

Log back in as admin. Open the activity's roster modal; confirm the registration count now shows `1/<capacity>` and the student's real name is listed. Click 移除 next to the student; confirm the toast "已移除" and the roster empties back to "尚無學生報名". Click 刪除此活動; confirm the browser `confirm()` reads "確定要刪除此活動嗎？" (no registrations left), accept, and confirm the row disappears from the table.

- [ ] **Step 8: Capacity-full guard**

Create a second activity with 人數上限 = 1. As the student, register for it — confirm success and that the 操作 button now reads "已額滿" and is disabled once `_count.registrations` reaches capacity (verify by reloading the page as the same student). Attempt a second registration is blocked client-side by the disabled button; no need to double-submit manually.

- [ ] **Step 9: Confirm Go Hall is untouched**

Navigate to `/admin/go-hall`, `/teacher/go-hall`, `/student/go-hall` and confirm they still render and behave exactly as before (no regressions from the schema/nav changes).

- [ ] **Step 10: Stop the dev server**

Stop `npm run dev` (Ctrl-C). No commit for this task — it is verification-only.

---

## Self-Review Notes

- **Spec coverage:** every service function, API route, and UI surface listed in the spec's Data/API/UI layer sections maps to a task above. `getActivityDetail` was added (not explicitly named in the spec's service bullet list) because the spec's API layer explicitly requires `GET /api/activities/[id]` to return "full detail for one activity + roster" — mirroring Go Hall's `getSessionDetail` precedent.
- **Design decision — embedded roster in list responses:** the spec's wording for `listAllActivities`/`listActivitiesForTeacher` ("with registration count **and full roster**") differs from Go Hall's list functions (count only). This plan follows the spec literally: `ACTIVITY_LIST_SELECT` embeds the full roster, so the admin and teacher pages open their roster `Modal` directly from already-loaded row data with no extra fetch. `GET /api/activities/[id]` remains necessary for the student flow, where `listRegistrationsForStudent`/`listOpenActivitiesForStudent` deliberately omit the roster (students shouldn't receive other students' real names in a list payload) and must fetch the single-activity endpoint to get the role-masked roster.
- **Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code.
- **Type consistency:** `ActivityRow` (admin/teacher, full roster) vs `ActivityStudentRow`/`ActivityDetail` (student, roster only on the single-item detail) are intentionally different shapes matching their distinct API payloads — verified consistent between service `select` objects (Tasks 3–4, 7) and the corresponding page-level TypeScript interfaces (Tasks 12–14).
