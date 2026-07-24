# Activity Multi-Teacher & Manageable Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the already-shipped Activity Zone (活動專區) feature so that (1) an activity's 帶領老師 supports multiple teachers (minimum 1, was single/optional), and (2) 分類 becomes an admin-manageable list (was a fixed 4-value enum) with add/delete, managed inline on `/admin/activities`.

**Architecture:** Replace the `ActivityCategory` enum with a real `ActivityCategory` model (FK from `Activity.categoryId`), and replace `Activity.teacherId` (nullable single FK) with an explicit `ActivityTeacher` join table, mirroring the existing `ActivityRegistration` join-table style. Service layer, 3 API routes, and 3 UI pages are updated to match; a new `activity-categories` API resource is added for category CRUD.

**Tech Stack:** Same as the rest of the app — Next.js 14.2, Prisma 7 (`pg` driver adapter), PostgreSQL, NextAuth, Vitest.

## Global Constraints

- This only touches the Activity Zone feature. Do not modify Go Hall (`GoHallSession`, `GoHallRegistration`, `goHallService.ts`, any `go-hall-*` route/page).
- No activity edit path — still create + delete only.
- Category deletion is blocked (409 `CATEGORY_IN_USE`) while any activity still references it — never allow a cascading/orphaning delete.
- `teacherIds` on activity creation must have length ≥ 1 — enforced both client-side (before the fetch call) and server-side (400 if empty/missing).
- Category management UI lives inline on `/admin/activities` — no new route/page.
- Production currently has 0 `Activity` rows — no data migration script is needed, but the 4 original category names (營隊/講座/比賽/觀摩課) must be seeded into the dev database as the initial manageable list.
- Run `npm run test` and `npx tsc --noEmit` after every task that touches TypeScript source, before committing.
- Full spec: `docs/superpowers/specs/2026-07-24-activity-multi-teacher-category-design.md`.

---

### Task 1: Schema — `ActivityCategory` model, `ActivityTeacher` join table

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `model ActivityCategory { id, name (unique), createdAt, activities }`; `model ActivityTeacher { id, activityId, activity, teacherId, teacher }` with `@@unique([activityId, teacherId])`; `Activity.categoryId` (required FK, replaces the `category` enum field) and `Activity.teachers ActivityTeacher[]` (replaces `teacherId`/`teacher`) — consumed by every later task.

- [ ] **Step 1: Replace the `Teacher` back-relation field**

In `prisma/schema.prisma`, find the `model Teacher` block and change:

```prisma
  goHallSessions              GoHallSession[]
  activities                  Activity[]
```

to:

```prisma
  goHallSessions              GoHallSession[]
  activityTeachers            ActivityTeacher[]
```

- [ ] **Step 2: Replace the `ActivityCategory` enum and `Activity` model**

Find:

```prisma
enum ActivityCategory {
  CAMP // 營隊
  LECTURE // 講座
  COMPETITION // 比賽
  OBSERVATION // 觀摩課
}

model Activity {
  id            String                 @id @default(cuid())
  title         String
  description   String
  category      ActivityCategory
  location      String?
  startDate     DateTime
  endDate       DateTime
  capacity      Int
  teacherId     String?
  teacher       Teacher?               @relation(fields: [teacherId], references: [id])
  registrations ActivityRegistration[]
  createdAt     DateTime               @default(now())
}
```

Replace with:

```prisma
model ActivityCategory {
  id         String     @id @default(cuid())
  name       String     @unique
  createdAt  DateTime   @default(now())
  activities Activity[]
}

model ActivityTeacher {
  id         String   @id @default(cuid())
  activityId String
  activity   Activity @relation(fields: [activityId], references: [id])
  teacherId  String
  teacher    Teacher  @relation(fields: [teacherId], references: [id])

  @@unique([activityId, teacherId])
}

model Activity {
  id            String                  @id @default(cuid())
  title         String
  description   String
  categoryId    String
  category      ActivityCategory        @relation(fields: [categoryId], references: [id])
  location      String?
  startDate     DateTime
  endDate       DateTime
  capacity      Int
  teachers      ActivityTeacher[]
  registrations ActivityRegistration[]
  createdAt     DateTime                @default(now())
}
```

`model ActivityRegistration` below is unchanged — leave it exactly as-is.

- [ ] **Step 3: Format and validate**

Run: `npx prisma format`
Expected: exits 0, no errors.

- [ ] **Step 4: Push to the test database**

Run: `npm run test:dbpush`
Expected: `🚀  Your database is now in sync with your Prisma schema.`, no errors.

- [ ] **Step 5: Push to the dev database and regenerate the client**

Run: `npx prisma db push && npx prisma generate`
Expected: both succeed with no errors.

- [ ] **Step 6: Seed the 4 initial categories into the dev database**

Run:

```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d tutoring_makeup_system -c "
INSERT INTO \"ActivityCategory\" (id, name, \"createdAt\") VALUES
  (gen_random_uuid()::text, '營隊', now()),
  (gen_random_uuid()::text, '講座', now()),
  (gen_random_uuid()::text, '比賽', now()),
  (gen_random_uuid()::text, '觀摩課', now())
ON CONFLICT (name) DO NOTHING;
"
```

Expected: `INSERT 0 4` (or fewer if some already exist). Verify with:

```bash
PGPASSWORD=postgres psql -h localhost -U postgres -d tutoring_makeup_system -c 'SELECT name FROM "ActivityCategory" ORDER BY name;'
```

Expected: 4 rows — 營隊, 講座, 比賽, 觀摩課. Do **not** run this against the test database (`tutoring_makeup_system_test`) — tests create their own categories per-test via `createCategory`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: replace activity category enum with manageable table, teacherId with multi-teacher join table"
```

---

### Task 2: `activityService` — rewrite for categories + multi-teacher, add category CRUD

**Files:**
- Modify: `src/lib/services/activityService.ts`
- Modify: `src/lib/services/activityService.test.ts`

**Interfaces:**
- Produces: `CreateActivityInput` now `{ title, description, categoryId, location?, startDate, endDate, capacity, teacherIds: string[] }`; `listCategories()`, `createCategory(name: string)`, `deleteCategory(id: string)` (throws `Error('CATEGORY_IN_USE')`); every list/detail function's row shape now has `category: { name: string }` and `teachers: { teacher: { user: { name: string } } }[]` instead of the old `category: ActivityCategoryValue` / `teacher: {...} | null` — consumed by Tasks 3–6.

This task replaces the schema-breaking parts of the service in one pass (the Task 1 schema change makes the old field names not type-check), then adds the new category functions in the same pass since the file must compile as a whole. Because this changes the shape of nearly every existing test, the full new content for both files is given below rather than incremental diffs — write each file's complete content as shown, don't try to diff against the old version by hand.

- [ ] **Step 1: Replace the full contents of `src/lib/services/activityService.ts`**

```ts
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { runSerializableWithRetry } from '@/lib/transaction';

// Activity rosters are sent to STUDENT-role requesters (with names masked)
// as well as ADMIN/TEACHER (real names) — email must not be selected here
// or it would leak unmasked in the student-facing response.
const NAME_ONLY_SELECT = { name: true } as const;

const ACTIVITY_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  category: { select: { name: true } },
  location: true,
  startDate: true,
  endDate: true,
  capacity: true,
  teachers: { select: { teacher: { select: { user: { select: NAME_ONLY_SELECT } } } } },
  registrations: {
    select: {
      id: true,
      studentId: true,
      student: { select: { user: { select: NAME_ONLY_SELECT } } },
    },
  },
  _count: { select: { registrations: true } },
} as const;

const ACTIVITY_STUDENT_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  category: { select: { name: true } },
  location: true,
  startDate: true,
  endDate: true,
  capacity: true,
  teachers: { select: { teacher: { select: { user: { select: NAME_ONLY_SELECT } } } } },
  _count: { select: { registrations: true } },
} as const;

export interface CreateActivityInput {
  title: string;
  description: string;
  categoryId: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  capacity: number;
  teacherIds: string[];
}

export function createActivity(input: CreateActivityInput) {
  return prisma.activity.create({
    data: {
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      location: input.location,
      startDate: input.startDate,
      endDate: input.endDate,
      capacity: input.capacity,
      teachers: { create: input.teacherIds.map((teacherId) => ({ teacherId })) },
    },
  });
}

export function listAllActivities() {
  return prisma.activity.findMany({
    select: ACTIVITY_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
}

export function listActivitiesForTeacher(teacherId: string) {
  return prisma.activity.findMany({
    where: { teachers: { some: { teacherId } } },
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

export async function cancelRegistration(id: string, studentId: string) {
  const registration = await prisma.activityRegistration.findUniqueOrThrow({ where: { id } });
  if (registration.studentId !== studentId) throw new Error('NOT_OWNER');
  await prisma.activityRegistration.delete({ where: { id } });
}

export async function adminRemoveRegistration(id: string) {
  await prisma.activityRegistration.delete({ where: { id } });
}

export async function deleteActivity(id: string) {
  await prisma.$transaction([
    prisma.activityRegistration.deleteMany({ where: { activityId: id } }),
    prisma.activityTeacher.deleteMany({ where: { activityId: id } }),
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

export function listCategories() {
  return prisma.activityCategory.findMany({ orderBy: { name: 'asc' } });
}

export function createCategory(name: string) {
  return prisma.activityCategory.create({ data: { name } });
}

export async function deleteCategory(id: string) {
  const count = await prisma.activity.count({ where: { categoryId: id } });
  if (count > 0) throw new Error('CATEGORY_IN_USE');
  await prisma.activityCategory.delete({ where: { id } });
}
```

- [ ] **Step 2: Replace the full contents of `src/lib/services/activityService.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
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
  listCategories,
  createCategory,
  deleteCategory,
} from './activityService';

beforeEach(async () => {
  await prisma.activityRegistration.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
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
  it('creates an activity and lists activities soonest-startDate-first with registration count, category, and teachers', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const otherTeacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    const camp = await createCategory('營隊');
    const lecture = await createCategory('講座');

    await createActivity({
      title: '暑期營隊',
      description: '為期三天的暑期營隊',
      categoryId: camp.id,
      location: '活動中心',
      startDate: new Date(2026, 7, 15),
      endDate: new Date(2026, 7, 17),
      capacity: 20,
      teacherIds: [teacher.id, otherTeacher.id],
    });
    await createActivity({
      title: '棋藝講座',
      description: '一日講座',
      categoryId: lecture.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 30,
      teacherIds: [teacher.id],
    });

    const activities = await listAllActivities();
    expect(activities).toHaveLength(2);
    expect(activities[0].title).toBe('棋藝講座');
    expect(activities[1].title).toBe('暑期營隊');
    expect(activities[1].category.name).toBe('營隊');
    const soonestTeacherNames = activities[1].teachers.map((t) => t.teacher.user.name);
    expect(soonestTeacherNames).toHaveLength(2);
    expect(soonestTeacherNames).toContain('陳老師');
    expect(soonestTeacherNames).toContain('林老師');
    expect(activities[0].teachers.map((t) => t.teacher.user.name)).toEqual(['陳老師']);
    expect(activities[0]._count.registrations).toBe(0);
    expect(activities[0].registrations).toEqual([]);
  });
});

describe('listActivitiesForTeacher', () => {
  it('returns only activities assigned to the given teacher', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const teacherB = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    await createActivity({
      title: 'A 活動',
      description: 'a',
      categoryId: category.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 10,
      teacherIds: [teacherA.id],
    });
    await createActivity({
      title: 'B 活動',
      description: 'b',
      categoryId: category.id,
      startDate: new Date(2026, 7, 2),
      endDate: new Date(2026, 7, 2),
      capacity: 10,
      teacherIds: [teacherB.id],
    });

    const results = await listActivitiesForTeacher(teacherA.id);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('A 活動');
  });

  it('returns an activity assigned to multiple teachers for each assigned teacher, and not for an unassigned one', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const teacherB = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    const teacherC = await createTeacher({ name: '王老師', email: 'wang@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    await createActivity({
      title: '共同帶領活動',
      description: 'x',
      categoryId: category.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 10,
      teacherIds: [teacherA.id, teacherB.id],
    });

    const resultsA = await listActivitiesForTeacher(teacherA.id);
    const resultsB = await listActivitiesForTeacher(teacherB.id);
    const resultsC = await listActivitiesForTeacher(teacherC.id);
    expect(resultsA).toHaveLength(1);
    expect(resultsB).toHaveLength(1);
    expect(resultsC).toHaveLength(0);
  });
});

describe('listOpenActivitiesForStudent', () => {
  it('excludes an activity whose endDate is in the past and includes one ending today or later', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await createActivity({ title: '已結束活動', description: 'x', categoryId: category.id, startDate: yesterday, endDate: yesterday, capacity: 10, teacherIds: [teacher.id] });
    await createActivity({ title: '進行中活動', description: 'x', categoryId: category.id, startDate: tomorrow, endDate: tomorrow, capacity: 10, teacherIds: [teacher.id] });

    const results = await listOpenActivitiesForStudent();
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('進行中活動');
  });
});

describe('registerForActivity', () => {
  it('creates a registration when under capacity', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();

    const registration = await registerForActivity(activity.id, student.id);
    expect(registration.activityId).toBe(activity.id);
    expect(registration.studentId).toBe(student.id);
  });

  it('throws ACTIVITY_FULL once capacity is reached', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 1, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, studentA.id);

    await expect(registerForActivity(activity.id, studentB.id)).rejects.toThrow('ACTIVITY_FULL');
  });

  it('allows only one of two concurrent registrations to succeed when capacity is 1', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 1, teacherIds: [teacher.id] });
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

describe('cancelRegistration', () => {
  it('deletes the registration when the student owns it', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    const registration = await registerForActivity(activity.id, student.id);

    await cancelRegistration(registration.id, student.id);

    const remaining = await prisma.activityRegistration.count();
    expect(remaining).toBe(0);
  });

  it('throws NOT_OWNER when a different student tries to cancel it', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    const registration = await registerForActivity(activity.id, student.id);

    await expect(cancelRegistration(registration.id, otherStudent.id)).rejects.toThrow('NOT_OWNER');
  });
});

describe('adminRemoveRegistration', () => {
  it('deletes the registration regardless of owner', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    const registration = await registerForActivity(activity.id, student.id);

    await adminRemoveRegistration(registration.id);

    const remaining = await prisma.activityRegistration.count();
    expect(remaining).toBe(0);
  });
});

describe('deleteActivity', () => {
  it('removes the activity along with its registrations and teacher assignments, leaving no orphaned row', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, student.id);

    await deleteActivity(activity.id);

    const remainingActivities = await prisma.activity.count();
    const remainingRegistrations = await prisma.activityRegistration.count();
    const remainingTeacherLinks = await prisma.activityTeacher.count();
    expect(remainingActivities).toBe(0);
    expect(remainingRegistrations).toBe(0);
    expect(remainingTeacherLinks).toBe(0);
  });
});

describe('listRegistrationsForStudent', () => {
  it("returns only the given student's registrations, with activity details", async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
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
  it('returns activity info with the full (unmasked) roster, category, and all assigned teachers', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const teacherB = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '王大明', email: 'wang@example.com', password: 'x' });
    await createActivity({
      title: '營隊',
      description: 'x',
      categoryId: category.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 8,
      teacherIds: [teacherA.id, teacherB.id],
    });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, student.id);

    const detail = await getActivityDetail(activity.id);
    const teacherNames = detail.teachers.map((t) => t.teacher.user.name);
    expect(teacherNames).toHaveLength(2);
    expect(teacherNames).toContain('陳老師');
    expect(teacherNames).toContain('林老師');
    expect(detail.category.name).toBe('營隊');
    expect(detail.registrations).toHaveLength(1);
    expect(detail.registrations[0].student.user.name).toBe('王大明');
  });
});

describe('listCategories / createCategory / deleteCategory', () => {
  it('creates categories and lists all of them', async () => {
    await createCategory('講座');
    await createCategory('營隊');

    const categories = await listCategories();
    const names = categories.map((c) => c.name);
    expect(names).toHaveLength(2);
    expect(names).toContain('營隊');
    expect(names).toContain('講座');
  });

  it('throws CATEGORY_IN_USE when deleting a category still used by an activity', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });

    await expect(deleteCategory(category.id)).rejects.toThrow('CATEGORY_IN_USE');
  });

  it('deletes a category that is not used by any activity', async () => {
    const category = await createCategory('營隊');

    await deleteCategory(category.id);

    const remaining = await prisma.activityCategory.count();
    expect(remaining).toBe(0);
  });

  it('rejects creating a category with a name that already exists', async () => {
    await createCategory('營隊');

    await expect(createCategory('營隊')).rejects.toThrow();
  });
});

// Other service test files' beforeEach blocks predate the Activity /
// ActivityRegistration tables and don't clean them up before deleting
// Student, so a registration row left behind by this file's last test
// (e.g. the concurrency test, which intentionally leaves exactly one) would
// break every test file that runs after this one with a foreign key
// violation on student.deleteMany(). Clean up after ourselves so this file
// leaves no residue for other files, regardless of run order.
afterAll(async () => {
  await prisma.activityRegistration.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/activityService.test.ts`
Expected: PASS (17 tests).

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npm run test`
Expected: all suites pass (the previously-independent `activityCategory.test.ts`/`activityDateRange.test.ts` files are untouched by this task and still pass).

- [ ] **Step 5: Type-check, expecting known pending errors elsewhere**

Run: `npx tsc --noEmit`
Expected: errors will appear in `src/app/api/activities/route.ts` and the three `activities/page.tsx` files (admin/teacher/student) — they still reference the old `category`/`teacherId` shape and are fixed in Tasks 3–6. Confirm the errors are confined to those known files and that `src/lib/services/activityService.ts`/`.test.ts` themselves report no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/activityService.ts src/lib/services/activityService.test.ts
git commit -m "feat: rewrite activityService for multi-teacher and manageable categories"
```

---

### Task 3: API layer — `activity-categories` routes + update `/api/activities` POST

**Files:**
- Create: `src/app/api/activity-categories/route.ts`
- Create: `src/app/api/activity-categories/[id]/route.ts`
- Modify: `src/app/api/activities/route.ts`

**Interfaces:**
- Consumes: `listCategories`, `createCategory`, `deleteCategory` from `@/lib/services/activityService` (Task 2).
- Produces: `GET/POST /api/activity-categories` (ADMIN-only), `DELETE /api/activity-categories/[id]` (ADMIN-only, 409 `CATEGORY_IN_USE`); `POST /api/activities` now takes `categoryId`/`teacherIds` and 400s on empty `teacherIds` — consumed by Tasks 4–6.

- [ ] **Step 1: Create `src/app/api/activity-categories/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { listCategories, createCategory } from '@/lib/services/activityService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listCategories());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { name } = await req.json();
  try {
    const category = await createCategory(name);
    return NextResponse.json(category, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'CATEGORY_NAME_TAKEN' }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Create `src/app/api/activity-categories/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { deleteCategory } from '@/lib/services/activityService';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    await deleteCategory(params.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: message === 'CATEGORY_IN_USE' ? 409 : 400 });
  }
}
```

- [ ] **Step 3: Update `POST` in `src/app/api/activities/route.ts`**

Replace the file's `POST` function:

```ts
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const teacherIds: string[] = Array.isArray(body.teacherIds) ? body.teacherIds : [];
  if (teacherIds.length === 0) {
    return NextResponse.json({ error: 'TEACHER_REQUIRED' }, { status: 400 });
  }
  const created = await createActivity({
    title: body.title,
    description: body.description,
    categoryId: body.categoryId,
    location: body.location || undefined,
    startDate: new Date(body.startDate),
    endDate: new Date(body.endDate),
    capacity: Number(body.capacity),
    teacherIds,
  });
  return NextResponse.json(created, { status: 201 });
}
```

`GET` in this file is unchanged — leave it as-is.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (This will still show errors from Tasks 4–6's not-yet-updated UI files if run before those tasks — that's expected mid-plan; just confirm no errors originate from the 3 files this task touches.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/activity-categories/route.ts src/app/api/activity-categories/\[id\]/route.ts src/app/api/activities/route.ts
git commit -m "feat: add activity-categories API and update activity creation for multi-teacher"
```

---

### Task 4: UI — Admin `/admin/activities` (category management panel + multi-select teachers)

**Files:**
- Modify: `src/app/admin/activities/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/activities`, `GET /api/teachers`, `GET/POST /api/activity-categories`, `DELETE /api/activity-categories/[id]`, `DELETE /api/activities/[id]`, `DELETE /api/activity-registrations/[id]` (Task 3).
- Produces: the updated `/admin/activities` page. No longer imports from `@/lib/activityCategory` (removed in Task 6).

- [ ] **Step 1: Replace the full contents of `src/app/admin/activities/page.tsx`**

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

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface CategoryOption {
  id: string;
  name: string;
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
  category: { name: string };
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teachers: { teacher: { user: { name: string } } }[];
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
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    categoryId: '',
    location: '',
    startDate: '',
    endDate: '',
    capacity: '20',
  });
  const [formTeacherIds, setFormTeacherIds] = useState<string[]>([]);
  const [formError, setFormError] = useState('');
  const [showCategoryPanel, setShowCategoryPanel] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [viewing, setViewing] = useState<ActivityRow | null>(null);

  async function load() {
    const [activitiesRes, teachersRes, categoriesRes] = await Promise.all([
      fetch('/api/activities'),
      fetch('/api/teachers'),
      fetch('/api/activity-categories'),
    ]);
    setActivities(await activitiesRes.json());
    setTeachers(await teachersRes.json());
    setCategories(await categoriesRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  function toggleFormTeacher(teacherId: string) {
    setFormTeacherIds((prev) => (prev.includes(teacherId) ? prev.filter((id) => id !== teacherId) : [...prev, teacherId]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (formTeacherIds.length === 0) {
      setFormError('請至少選擇一位帶領老師');
      return;
    }
    await fetch('/api/activities', {
      method: 'POST',
      body: JSON.stringify({ ...form, capacity: Number(form.capacity), teacherIds: formTeacherIds }),
    });
    setForm({ title: '', description: '', categoryId: '', location: '', startDate: '', endDate: '', capacity: '20' });
    setFormTeacherIds([]);
    setShowAddForm(false);
    showToast('已新增活動');
    load();
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/activity-categories', { method: 'POST', body: JSON.stringify({ name: newCategoryName }) });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error === 'CATEGORY_NAME_TAKEN' ? '此分類名稱已存在' : `錯誤：${data.error}`);
      return;
    }
    setNewCategoryName('');
    showToast('已新增分類');
    load();
  }

  async function handleDeleteCategory(id: string) {
    const res = await fetch(`/api/activity-categories/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      showToast(data.error === 'CATEGORY_IN_USE' ? '此分類仍有活動使用中，請先處理' : `錯誤：${data.error}`);
      return;
    }
    showToast('已刪除分類');
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
    { header: '分類', render: (a) => a.category.name },
    { header: '日期區間', render: (a) => formatActivityDateRange(a.startDate, a.endDate, 'zh-TW') },
    { header: '老師', render: (a) => a.teachers.map((t) => t.teacher.user.name).join('、') },
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

      <div className="mb-6 flex flex-wrap gap-3">
        {!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增活動</Button>}
        {!showCategoryPanel && (
          <Button variant="secondary" onClick={() => setShowCategoryPanel(true)}>
            管理分類
          </Button>
        )}
      </div>

      {showAddForm && (
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
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} required>
              <option value="">請選擇分類</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
            <div>
              <p className="mb-1 text-sm font-medium text-ink">帶領老師（至少選 1 位）</p>
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-borderStrong p-2">
                {teachers.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={formTeacherIds.includes(t.id)} onChange={() => toggleFormTeacher(t.id)} />
                    {t.user.name}
                  </label>
                ))}
              </div>
            </div>
            {formError && <p className="text-sm text-rejected">{formError}</p>}
            <Button type="submit">新增</Button>
          </form>
        </Card>
      )}

      {showCategoryPanel && (
        <Card className="mb-6 max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">管理分類</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowCategoryPanel(false)}>
              收合
            </button>
          </div>
          {categories.length === 0 ? (
            <p className="mb-3 text-sm text-inkMuted">尚無分類</p>
          ) : (
            <ul className="mb-3 flex flex-col gap-1">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm text-ink">
                  {c.name}
                  <button type="button" className="text-rejected hover:underline" onClick={() => handleDeleteCategory(c.id)}>
                    刪除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={handleAddCategory} className="flex gap-2">
            <Input
              placeholder="新分類名稱"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              required
              className="flex-1"
            />
            <Button type="submit">新增分類</Button>
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
              {viewing.category.name} · {formatActivityDateRange(viewing.startDate, viewing.endDate, 'zh-TW')} ·{' '}
              {viewing.teachers.map((t) => t.teacher.user.name).join('、')} · {viewing.registrations.length}/{viewing.capacity}
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
Expected: no errors originating from this file (errors from not-yet-updated Task 5/6 files are expected until those tasks land).

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/activities/page.tsx
git commit -m "feat: admin activity page — multi-select teachers and inline category management"
```

---

### Task 5: UI — Teacher `/teacher/activities`

**Files:**
- Modify: `src/app/teacher/activities/page.tsx`

**Interfaces:**
- Consumes: `GET /api/activities` (TEACHER session → `listActivitiesForTeacher` shape with `category`/`teachers`).
- Produces: the updated `/teacher/activities` page, showing category name and all assigned teachers (not just the viewer).

- [ ] **Step 1: Replace the full contents of `src/app/teacher/activities/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { formatActivityDateRange } from '@/lib/activityDateRange';

interface RosterEntry {
  id: string;
  studentId: string;
  student: { user: { name: string } };
}

interface ActivityRow {
  id: string;
  title: string;
  description: string;
  category: { name: string };
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teachers: { teacher: { user: { name: string } } }[];
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
    { header: '分類', render: (a) => a.category.name },
    { header: '日期區間', render: (a) => formatActivityDateRange(a.startDate, a.endDate, 'zh-TW') },
    { header: '老師', render: (a) => a.teachers.map((t) => t.teacher.user.name).join('、') },
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
              {viewing.category.name} · {formatActivityDateRange(viewing.startDate, viewing.endDate, 'zh-TW')} ·{' '}
              {viewing.teachers.map((t) => t.teacher.user.name).join('、')} · {viewing.registrations.length}/{viewing.capacity}
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
Expected: no errors originating from this file (errors from the not-yet-updated Task 6 student page are expected until that task lands).

- [ ] **Step 3: Commit**

```bash
git add src/app/teacher/activities/page.tsx
git commit -m "feat: teacher activity page shows category name and all assigned teachers"
```

---

### Task 6: UI — Student `/student/activities`, delete unused `activityCategory` helper

**Files:**
- Modify: `src/app/student/activities/page.tsx`
- Delete: `src/lib/activityCategory.ts`
- Delete: `src/lib/activityCategory.test.ts`

**Interfaces:**
- Consumes: `GET /api/activities` (STUDENT session → `listOpenActivitiesForStudent` shape), `GET/POST /api/activity-registrations`, `DELETE /api/activity-registrations/[id]`, `GET /api/activities/[id]` (masked roster) — all now carry `category: { name }` / `teachers: [...]` instead of the old enum/single-teacher shape.
- Produces: the updated `/student/activities` page. After this task, no file in the app imports `@/lib/activityCategory` — it is deleted as dead code.

- [ ] **Step 1: Replace the full contents of `src/app/student/activities/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatActivityDateRange } from '@/lib/activityDateRange';

interface ActivityStudentRow {
  id: string;
  title: string;
  description: string;
  category: { name: string };
  location: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  teachers: { teacher: { user: { name: string } } }[];
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
    { header: '分類', render: (a) => a.category.name },
    { header: '日期區間', render: (a) => formatActivityDateRange(a.startDate, a.endDate, 'zh-TW') },
    { header: '地點', render: (a) => a.location ?? '-' },
    { header: '老師', render: (a) => a.teachers.map((t) => t.teacher.user.name).join('、') },
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
    { header: '分類', render: (r) => r.activity.category.name },
    { header: '日期區間', render: (r) => formatActivityDateRange(r.activity.startDate, r.activity.endDate, 'zh-TW') },
    {
      header: '操作',
      render: (r) => (
        <button
          type="button"
          className="text-rejected hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            handleCancel(r.id);
          }}
        >
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
              {viewing.category.name} · {formatActivityDateRange(viewing.startDate, viewing.endDate, 'zh-TW')} ·{' '}
              {viewing.teachers.map((t) => t.teacher.user.name).join('、')}
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

- [ ] **Step 2: Delete the now-unused category helper and its test**

```bash
git rm src/lib/activityCategory.ts src/lib/activityCategory.test.ts
```

Confirm no remaining references:

Run: `grep -rn "lib/activityCategory'" src --include="*.ts" --include="*.tsx"`
Expected: no output (no file imports it anymore).

- [ ] **Step 3: Type-check and run the full test suite**

Run: `npx tsc --noEmit && npm run test`
Expected: `tsc` reports zero errors; test suite passes with **123 tests** (104 pre-existing service tests + 2 `activityDateRange` tests + 17 `activityService` tests — the 2 deleted `activityCategory.test.ts` tests are gone).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: student activity page shows category name and all assigned teachers; remove unused activityCategory helper"
```

---

### Task 7: Manual browser verification

**Files:** none (browser verification only).

- [ ] **Step 1: Run the full automated suite one more time**

Run: `npm run test && npx tsc --noEmit`
Expected: 123/123 tests pass, zero type errors.

- [ ] **Step 2: Start the dev server**

Run the app's dev server against the already-seeded dev database (`tutoring_makeup_system`, which now has the 4 `ActivityCategory` rows from Task 1 Step 6).

- [ ] **Step 3: Admin — category management**

Log in as an ADMIN account. Go to `/admin/activities`, click 管理分類. Confirm the 4 seeded categories (營隊/講座/比賽/觀摩課) are listed. Add a new category (e.g. "測試分類"), confirm it appears immediately and is selectable in the 新增活動 form's 分類 dropdown. Delete the test category while unused — confirm it disappears and the toast reads "已刪除分類". Try creating a category with a name that already exists (e.g. "營隊" again) — confirm the toast reads "此分類名稱已存在".

- [ ] **Step 4: Admin — multi-teacher activity creation**

Open 新增活動. Confirm 帶領老師 is now a checkbox list (not a single dropdown) with a "至少選 1 位" hint. Try submitting with 0 teachers checked — confirm the form blocks submission and shows "請至少選擇一位帶領老師" without hitting the network. Check 2 teachers, fill the rest of the form, submit. Confirm the new activity appears in the table with 老師 showing both names joined by 、.

- [ ] **Step 5: Admin — category-in-use delete guard**

With the just-created activity still using its category, try deleting that category from the 管理分類 panel. Confirm the toast reads "此分類仍有活動使用中，請先處理" and the category is NOT removed from the list. Delete the activity itself first (open its roster modal → 刪除此活動), then retry deleting the category — confirm it now succeeds.

- [ ] **Step 6: Teacher — multi-teacher visibility**

Create one more activity assigned to two teachers you have login credentials for. Log in as each of those two teachers in turn; confirm both see the activity on `/teacher/activities`, and the 老師 column / roster modal both list both teachers' names.

- [ ] **Step 7: Student — display**

Log in as a student. Confirm `/student/activities` shows the category name and joined teacher names correctly in both 活動列表 and (after registering) 我的報名紀錄's roster modal. Register and cancel once to confirm the existing flow still works end-to-end with the new data shape.

- [ ] **Step 8: Clean up test data**

Delete any activities/categories created purely for this verification pass (via the UI's own delete actions used above), so the dev database is left in the same state it started in (4 seeded categories, 0 activities).

- [ ] **Step 9: Stop the dev server.** No commit for this task — it is verification-only.
