# 堂數管理 (Session Quota Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins set/edit a student's total session quota (堂數) per class enrollment, top it up later (加堂), and see the resulting 已上/剩餘 numbers wherever enrollments are already shown — the student list, the class roster, and the student's own dashboard.

**Architecture:** This is a follow-up to the already-merged core attendance system (`ClassAttendance`, `ClassEnrollment.totalSessions` already exist in `prisma/schema.prisma` on `main`). No schema changes here. `classService.ts` and `studentService.ts` gain quota-aware read/write functions that call `attendanceService.getClassEnrollmentQuota` (already exists) rather than reimplementing the used-sessions count. Two existing admin pages (`/admin/students`, `/admin/classes`) and one existing student page (`/student`) get their existing enrollment UI extended in place — no new pages, no new routes except one new `PATCH` handler on an existing route file.

**Tech Stack:** Same as the core attendance system — Next.js 14 (App Router) + TypeScript, Prisma 7 + Postgres, next-auth, Tailwind, Vitest (real Postgres test DB, no mocking).

## Global Constraints

- Follow this codebase's existing conventions exactly (see the core attendance plan's Global Constraints for the full list — API routes do inline role checks, no comments unless non-obvious WHY, etc.). This section only calls out what's specific to this plan.
- **`totalSessions` write semantics:** the edit form always sends the *complete current value* for every checked class, so `totalSessions: null` explicitly clears quota tracking for that enrollment (not "leave unchanged" — Prisma's "leave unchanged" semantics only apply to `undefined`, which this plan never sends for `totalSessions`).
- **`加堂` (add-sessions) semantics:** `totalSessions = (totalSessions ?? 0) + amount` — a `null` (untracked) enrollment starts from 0 when first topped up. No audit/history log of who added how many sessions when — matches the whole attendance feature's "no version history" principle.
- **No backend validation on `addSessions` being positive** — the UI guards `amount > 0` before sending the request; the service/route trust the input, matching this codebase's existing "no invented safety net beyond what's asked" convention (e.g. `POST /api/subject-colors` stores whatever hex string it's given).
- **Read-side enrichment reuses `attendanceService.getClassEnrollmentQuota`** everywhere (`listStudents`, `listClasses`, `listStudentEnrolledClasses`) rather than reimplementing the `usedSessions` count — this keeps the ON_LEAVE-exclusion business rule defined in exactly one place.
- **`CLASS_BOOKING_SELECT` in `classService.ts` is untouched** — it's shared by three unrelated call sites (student/teacher leave-request pickers, student makeup-request picker) that don't need quota data. Only `listStudentEnrolledClasses`'s *return value* is enriched, by mapping over the already-fetched result, not by changing the shared `select` object.
- Full design rationale: [`docs/superpowers/specs/2026-07-27-attendance-system-design.md`](../specs/2026-07-27-attendance-system-design.md), section 行政端堂數管理.

---

### Task 1: `classService` — `totalSessions`-aware enrollment writes

**Files:**
- Modify: `src/lib/services/classService.ts`
- Modify: `src/lib/services/classService.test.ts`

**Interfaces:**
- Produces: `EnrollmentInput { classId: string; totalSessions: number | null }`; `setStudentEnrollments(studentId: string, enrollments: EnrollmentInput[]): Promise<void>` (signature change — was `(studentId: string, classIds: string[])`); `addEnrollmentSessions(classId: string, studentId: string, amount: number): Promise<ClassEnrollment>`.
- Consumes: nothing new (existing `prisma` import).
- **Breaking change:** `setStudentEnrollments`'s second parameter changes from `string[]` to `EnrollmentInput[]`. Task 4 (API routes) and this task's own test file are the only other callers in the codebase — both are updated as part of this same task/plan, so there's no dangling caller with the old signature after this task completes.

- [ ] **Step 1: Write the failing tests**

Replace the existing `describe('setStudentEnrollments', ...)` block in `src/lib/services/classService.test.ts` (currently lines 102-121) with:

```ts
describe('setStudentEnrollments', () => {
  it('adds new enrollments and removes dropped ones, leaving unchanged ones alone', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-set-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-set-ming@example.com', password: 'x' });
    const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    const classC = await createClass({ name: '數學C班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });

    await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: null }, { classId: classB.id, totalSessions: null }]);
    const originalEnrollmentA = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: classA.id } });

    await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: null }, { classId: classC.id, totalSessions: null }]);

    const finalEnrollments = await prisma.classEnrollment.findMany({ where: { studentId: student.id } });
    expect(finalEnrollments.map((e) => e.classId).sort()).toEqual([classA.id, classC.id].sort());

    const stillA = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: classA.id } });
    expect(stillA.id).toBe(originalEnrollmentA.id);
  });

  it('sets totalSessions on a newly created enrollment', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-quota-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-quota-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(enrollment.totalSessions).toBe(12);
  });

  it('updates totalSessions in place on an enrollment that stays checked, without touching its id', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-quota-update-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-quota-update-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);
    const original = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 18 }]);

    const updated = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(updated.id).toBe(original.id);
    expect(updated.totalSessions).toBe(18);
  });

  it('clears totalSessions to null when the resent value is null', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-quota-clear-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-quota-clear-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: null }]);

    const updated = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(updated.totalSessions).toBeNull();
  });
});

describe('addEnrollmentSessions', () => {
  it('adds to an existing totalSessions value', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-add-sessions-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-add-sessions-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    const updated = await addEnrollmentSessions(cls.id, student.id, 6);

    expect(updated.totalSessions).toBe(18);
  });

  it('treats a null totalSessions as 0 before adding', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-add-sessions-null-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-add-sessions-null-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: null }]);

    const updated = await addEnrollmentSessions(cls.id, student.id, 6);

    expect(updated.totalSessions).toBe(6);
  });
});
```

Also update the import line at the top of the file (currently line 6-16) to add `addEnrollmentSessions`:

```ts
import {
  createClass,
  listClasses,
  listClassesBySubjectAndLevel,
  enrollStudent,
  updateClass,
  setStudentEnrollments,
  addEnrollmentSessions,
  unenrollStudent,
  listStudentEnrolledClasses,
  deleteClass,
} from './classService';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: FAIL — the rewritten `setStudentEnrollments` calls pass objects where the current signature expects strings (TypeScript/runtime mismatch), and `addEnrollmentSessions` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

In `src/lib/services/classService.ts`, replace the existing `setStudentEnrollments` function (currently lines 116-128) with:

```ts
export interface EnrollmentInput {
  classId: string;
  totalSessions: number | null;
}

export async function setStudentEnrollments(studentId: string, enrollments: EnrollmentInput[]) {
  const current = await prisma.classEnrollment.findMany({ where: { studentId }, select: { classId: true } });
  const currentIds = new Set(current.map((e) => e.classId));
  const desiredIds = new Set(enrollments.map((e) => e.classId));

  const toAdd = enrollments.filter((e) => !currentIds.has(e.classId));
  const toRemove = Array.from(currentIds).filter((id) => !desiredIds.has(id));
  const toUpdate = enrollments.filter((e) => currentIds.has(e.classId));

  await prisma.$transaction([
    ...(toRemove.length > 0 ? [prisma.classEnrollment.deleteMany({ where: { studentId, classId: { in: toRemove } } })] : []),
    ...toAdd.map((e) => prisma.classEnrollment.create({ data: { studentId, classId: e.classId, totalSessions: e.totalSessions } })),
    ...toUpdate.map((e) =>
      prisma.classEnrollment.update({
        where: { studentId_classId: { studentId, classId: e.classId } },
        data: { totalSessions: e.totalSessions },
      })
    ),
  ]);
}

export async function addEnrollmentSessions(classId: string, studentId: string, amount: number) {
  const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } } });
  return prisma.classEnrollment.update({
    where: { studentId_classId: { studentId, classId } },
    data: { totalSessions: (enrollment.totalSessions ?? 0) + amount },
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: PASS — all tests in the file green (the pre-existing ones plus the 6 new/rewritten ones in this task).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/classService.ts src/lib/services/classService.test.ts
git commit -m "$(cat <<'EOF'
feat: add totalSessions support to enrollment writes and an add-sessions helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `studentService` — quota-enriched `listStudents`

**Files:**
- Modify: `src/lib/services/studentService.ts`
- Modify: `src/lib/services/studentService.test.ts`

**Interfaces:**
- Consumes: `getClassEnrollmentQuota(classId: string, studentId: string): Promise<{totalSessions: number | null; usedSessions: number; remaining: number | null}>` from `@/lib/services/attendanceService` (already exists on `main`).
- Produces: `listStudents()`'s return type changes — each student's `enrollments` array elements change shape from `{classId: string}` to `{classId: string; totalSessions: number | null; usedSessions: number; remaining: number | null}`. Task 5 (admin/students UI) consumes this exact shape.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/services/studentService.test.ts`, inside the existing `describe('listStudents', ...)` block (currently lines 53-60), a new `it`:

```ts
it('includes per-enrollment session quota, with used sessions excluding leave', async () => {
  const teacher = await createTeacher({ name: '陳老師', email: 'student-list-quota-chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'student-list-quota-ming@example.com', password: 'x' });
  const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
  await enrollStudent(cls.id, student.id);
  await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 12 } });
  const marker = await prisma.user.create({ data: { id: 'quota-marker-1', name: '行政', email: 'quota-marker@example.com', password: 'x', role: 'ADMIN' } });
  await prisma.classAttendance.create({
    data: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04'), status: 'PRESENT', markedById: marker.id },
  });
  await prisma.classAttendance.create({
    data: { classId: cls.id, studentId: student.id, date: new Date('2026-08-11'), status: 'ON_LEAVE', markedById: marker.id },
  });

  const students = await listStudents();

  const found = students.find((s) => s.id === student.id);
  expect(found?.enrollments).toHaveLength(1);
  expect(found?.enrollments[0].classId).toBe(cls.id);
  expect(found?.enrollments[0].totalSessions).toBe(12);
  expect(found?.enrollments[0].usedSessions).toBe(1);
  expect(found?.enrollments[0].remaining).toBe(11);
});
```

Update the import line at the top of the file (currently line 5) to add `enrollStudent`:

```ts
import { createClass, enrollStudent } from './classService';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/services/studentService.test.ts`
Expected: FAIL — `found?.enrollments[0].totalSessions` is `undefined` (current shape only has `classId`).

- [ ] **Step 3: Write the implementation**

In `src/lib/services/studentService.ts`, add the import at the top:

```ts
import { getClassEnrollmentQuota } from './attendanceService';
```

Replace the existing `listStudents` function (currently lines 33-43) with:

```ts
export async function listStudents() {
  const students = await prisma.student.findMany({
    select: {
      id: true,
      parentPhone: true,
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/services/studentService.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/studentService.ts src/lib/services/studentService.test.ts
git commit -m "$(cat <<'EOF'
feat: enrich listStudents with per-enrollment session quota

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `classService` — quota-enriched `listClasses` and `listStudentEnrolledClasses`

**Files:**
- Modify: `src/lib/services/classService.ts`
- Modify: `src/lib/services/classService.test.ts`

**Interfaces:**
- Consumes: `getClassEnrollmentQuota` from `@/lib/services/attendanceService` (same as Task 2).
- Produces: `listClasses()`'s return type changes — each class's `enrollments` array elements gain `totalSessions`/`usedSessions`/`remaining` alongside the existing `id`/`studentId`/`student.user.name`. `listStudentEnrolledClasses()`'s return type changes — each class gains a `quota: {totalSessions, usedSessions, remaining}` field. Task 6 (admin/classes UI) consumes the `listClasses` shape; Task 7 (student dashboard) consumes the `listStudentEnrolledClasses` shape.

- [ ] **Step 1: Write the failing tests**

Extend the existing `describe('createClass / listClasses', ...)` test in `src/lib/services/classService.test.ts` (currently lines 32-52) — add a new `it` inside that same `describe` block:

```ts
it('includes per-enrollment session quota alongside the existing enrollment fields', async () => {
  const teacher = await createTeacher({ name: '陳老師', email: 'class-list-quota-chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'class-list-quota-ming@example.com', password: 'x' });
  const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
  await enrollStudent(cls.id, student.id);
  await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 12 } });

  const classes = await listClasses();

  const found = classes.find((c) => c.id === cls.id);
  expect(found?.enrollments).toHaveLength(1);
  expect(found?.enrollments[0].studentId).toBe(student.id);
  expect(found?.enrollments[0].student.user.name).toBe('小明');
  expect(found?.enrollments[0].totalSessions).toBe(12);
  expect(found?.enrollments[0].usedSessions).toBe(0);
  expect(found?.enrollments[0].remaining).toBe(12);
});
```

Extend the existing `describe('listStudentEnrolledClasses', ...)` test (currently lines 137-149) — add a new `it` inside that same `describe` block:

```ts
it('includes the enrolled student\'s own session quota', async () => {
  const teacher = await createTeacher({ name: '陳老師', email: 'class-enrolled-quota-chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'class-enrolled-quota-ming@example.com', password: 'x' });
  const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
  await enrollStudent(cls.id, student.id);
  await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 12 } });

  const result = await listStudentEnrolledClasses(student.id);

  expect(result).toHaveLength(1);
  expect(result[0].quota.totalSessions).toBe(12);
  expect(result[0].quota.usedSessions).toBe(0);
  expect(result[0].quota.remaining).toBe(12);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: FAIL — `found?.enrollments[0].totalSessions` and `result[0].quota` are `undefined` under the current shapes.

- [ ] **Step 3: Write the implementation**

In `src/lib/services/classService.ts`, add the import at the top (alongside the existing single import line):

```ts
import { getClassEnrollmentQuota } from './attendanceService';
```

Replace the existing `listClasses` function (currently lines 73-85) with:

```ts
export async function listClasses() {
  const classes = await prisma.class.findMany({
    select: CLASS_WITH_TEACHER_SELECT,
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
  const enriched = await Promise.all(
    classes.map(async (c) => ({
      ...c,
      enrollments: await Promise.all(
        c.enrollments.map(async (e) => ({ ...e, ...(await getClassEnrollmentQuota(c.id, e.studentId)) }))
      ),
    }))
  );
  return enriched.sort((a, b) => {
    const rank = (subject: string) => {
      const i = SUBJECT_ORDER.indexOf(subject);
      return i === -1 ? SUBJECT_ORDER.length : i;
    };
    return rank(a.subject) - rank(b.subject);
  });
}
```

Replace the existing `listStudentEnrolledClasses` function (currently lines 134-140) with:

```ts
export async function listStudentEnrolledClasses(studentId: string) {
  const classes = await prisma.class.findMany({
    where: { enrollments: { some: { studentId } } },
    select: CLASS_BOOKING_SELECT,
    orderBy: { name: 'asc' },
  });
  return Promise.all(classes.map(async (c) => ({ ...c, quota: await getClassEnrollmentQuota(c.id, studentId) })));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/classService.ts src/lib/services/classService.test.ts
git commit -m "$(cat <<'EOF'
feat: enrich listClasses and listStudentEnrolledClasses with session quota

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: API routes — quota-aware student writes and add-sessions endpoint

**Files:**
- Modify: `src/app/api/students/route.ts`
- Modify: `src/app/api/students/[id]/route.ts`
- Modify: `src/app/api/classes/[id]/enrollments/route.ts`

**Interfaces:**
- Consumes: `setStudentEnrollments(studentId, EnrollmentInput[])` and `addEnrollmentSessions(classId, studentId, amount)` from `@/lib/services/classService` (Task 1).
- Produces: `POST /api/students` and `PATCH /api/students/:id` now read `body.enrollments: {classId, totalSessions}[]` instead of `body.classIds: string[]`. New `PATCH /api/classes/:id/enrollments` — body `{studentId: string, addSessions: number}` → the updated `ClassEnrollment` record as JSON. Task 5 (admin/students UI) sends the new `enrollments` body shape and calls the new `PATCH` endpoint (it only checks `res.ok`, doesn't read the response body, so the exact shape returned isn't load-bearing for the UI).

This task has no automated test — this codebase has zero API route test files anywhere (established convention, confirmed in the core attendance plan's Global Constraints). Verified by `npx tsc --noEmit` plus manual browser verification later.

- [ ] **Step 1: Update the two student routes**

In `src/app/api/students/route.ts`, change the `POST` handler's body destructuring (currently line 21: `const { classIds, ...input } = await req.json();`) and the enrollment call (currently lines 24-26):

```ts
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { enrollments, ...input } = await req.json();
  try {
    const student = await createStudent(input);
    if (Array.isArray(enrollments) && enrollments.length > 0) {
      await setStudentEnrollments(student.id, enrollments);
    }
    return NextResponse.json(student, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 });
    }
    throw err;
  }
}
```

(The `GET` handler and the imports at the top of the file are unchanged.)

In `src/app/api/students/[id]/route.ts`, change the `PATCH` handler's body destructuring (currently line 13) and the enrollment call (currently lines 16-18):

```ts
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { enrollments, ...profileInput } = await req.json();
  try {
    const updated = await updateStudent(params.id, profileInput);
    if (Array.isArray(enrollments)) {
      await setStudentEnrollments(params.id, enrollments);
    }
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 });
    }
    throw err;
  }
}
```

(The `DELETE` handler is unchanged.)

- [ ] **Step 2: Add the `PATCH` handler to the enrollments route**

In `src/app/api/classes/[id]/enrollments/route.ts`, add the import and a new `PATCH` export. The full file becomes:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { enrollStudent, unenrollStudent, addEnrollmentSessions } from '@/lib/services/classService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId } = await req.json();
  const enrollment = await enrollStudent(params.id, studentId);
  return NextResponse.json(enrollment, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId, addSessions } = await req.json();
  const updated = await addEnrollmentSessions(params.id, studentId, addSessions);
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId } = await req.json();
  await unenrollStudent(params.id, studentId);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Verify with a type check**

Run: `npx tsc --noEmit`
Expected: no new errors in the three modified route files.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/students/route.ts src/app/api/students/\[id\]/route.ts src/app/api/classes/\[id\]/enrollments/route.ts
git commit -m "$(cat <<'EOF'
feat: switch student routes to quota-aware enrollments payload, add PATCH add-sessions route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `/admin/students` — row click, quota inputs, 加堂

**Files:**
- Modify: `src/app/admin/students/page.tsx`

**Interfaces:**
- Consumes: `GET /api/students` (now returns quota-enriched `enrollments`, Task 2), `POST /api/students` / `PATCH /api/students/:id` (now expect `enrollments` body, Task 4), `PATCH /api/classes/:id/enrollments` (Task 4).
- Produces: no new exports — this is a leaf page component.

This task has no automated test — pure UI page, this codebase's established convention has zero `*.test.tsx` files. Verified manually in the browser in Step 2.

- [ ] **Step 1: Rewrite the page**

Replace the full contents of `src/app/admin/students/page.tsx` with:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface EnrollmentQuota {
  classId: string;
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
}

interface StudentRow {
  id: string;
  parentPhone: string | null;
  user: { name: string; email: string };
  enrollments: EnrollmentQuota[];
}

interface ClassOption {
  id: string;
  name: string;
  subject: string;
}

export default function StudentsPage() {
  const { showToast } = useToast();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', parentPhone: '' });
  const [formEnrollments, setFormEnrollments] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', parentPhone: '' });
  const [editEnrollments, setEditEnrollments] = useState<Record<string, string>>({});
  const [addAmount, setAddAmount] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const [studentsRes, classesRes] = await Promise.all([fetch('/api/students'), fetch('/api/classes')]);
      setStudents(await studentsRes.json());
      setClasses(await classesRes.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function enrollmentsFromMap(map: Record<string, string>) {
    return Object.entries(map).map(([classId, val]) => ({
      classId,
      totalSessions: val === '' ? null : Number(val),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      setFormError('');
      const res = await fetch('/api/students', {
        method: 'POST',
        body: JSON.stringify({ ...form, enrollments: enrollmentsFromMap(formEnrollments) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : `錯誤：${data.error}`);
        return;
      }
      setForm({ name: '', email: '', password: '', parentPhone: '' });
      setFormEnrollments({});
      setShowAddForm(false);
      showToast('已新增');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function toggleFormClass(classId: string) {
    setFormEnrollments((prev) => {
      if (classId in prev) {
        const { [classId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [classId]: '' };
    });
  }

  function openEdit(s: StudentRow) {
    setEditing(s);
    setEditForm({ name: s.user.name, email: s.user.email, password: '', parentPhone: s.parentPhone ?? '' });
    setEditEnrollments(Object.fromEntries(s.enrollments.map((e) => [e.classId, e.totalSessions === null ? '' : String(e.totalSessions)])));
    setAddAmount({});
    setEditError('');
  }

  function toggleClass(classId: string) {
    setEditEnrollments((prev) => {
      if (classId in prev) {
        const { [classId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [classId]: '' };
    });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      setEditError('');
      const res = await fetch(`/api/students/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...editForm, enrollments: enrollmentsFromMap(editEnrollments) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setEditError(data.error === 'EMAIL_TAKEN' ? '此帳號已被使用' : `錯誤：${data.error}`);
        return;
      }
      setEditing(null);
      showToast('已儲存');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddSessions(classId: string) {
    if (!editing) return;
    const amount = Number(addAmount[classId]);
    if (!amount || amount <= 0) return;
    const res = await fetch(`/api/classes/${classId}/enrollments`, {
      method: 'PATCH',
      body: JSON.stringify({ studentId: editing.id, addSessions: amount }),
    });
    if (!res.ok) {
      const data = await res.json();
      setEditError(`錯誤：${data.error}`);
      return;
    }
    setAddAmount((prev) => ({ ...prev, [classId]: '' }));
    showToast('已加堂');
    const studentsRes = await fetch('/api/students');
    const updatedStudents: StudentRow[] = await studentsRes.json();
    setStudents(updatedStudents);
    const updatedEditing = updatedStudents.find((s) => s.id === editing.id);
    if (updatedEditing) {
      setEditing(updatedEditing);
      setEditEnrollments(
        Object.fromEntries(updatedEditing.enrollments.map((en) => [en.classId, en.totalSessions === null ? '' : String(en.totalSessions)]))
      );
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm(`確定要刪除學生「${editing.user.name}」嗎？此操作無法復原。`)) return;
    setEditError('');
    const res = await fetch(`/api/students/${editing.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      setEditError(data.error === 'STUDENT_HAS_RECORDS' ? '此學生仍有請假紀錄，請先處理後再刪除' : `錯誤：${data.error}`);
      return;
    }
    setEditing(null);
    showToast('已刪除');
    load();
  }

  const filteredStudents = students.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.user.name.toLowerCase().includes(q) ||
      s.user.email.toLowerCase().includes(q) ||
      (s.parentPhone ?? '').toLowerCase().includes(q)
    );
  });

  const columns: Column<StudentRow>[] = [
    { header: '姓名', render: (s) => s.user.name },
    { header: '帳號', render: (s) => s.user.email },
    { header: '家長電話', render: (s) => s.parentPhone ?? '-' },
    { header: '班級數', render: (s) => s.enrollments.length },
    {
      header: '操作',
      render: (s) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(s)}>
          編輯
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">學生名單</h1>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder="搜尋姓名、帳號或家長電話"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        {!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增學生</Button>}
      </div>
      {showAddForm && (
        <Card className="mb-6 max-w-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增學生</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input placeholder="帳號" type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <Input
              placeholder="初始密碼（留空預設 12345678）"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <Input placeholder="家長電話" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
            <div>
              <p className="mb-1 text-sm font-medium text-ink">所屬班級（可複選，可留空）</p>
              <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-lg border border-borderStrong p-2">
                {classes.map((c) => {
                  const checked = c.id in formEnrollments;
                  return (
                    <div key={c.id} className="flex items-center gap-2">
                      <label className="flex flex-1 items-center gap-2 text-sm text-ink">
                        <input type="checkbox" checked={checked} onChange={() => toggleFormClass(c.id)} />
                        {c.name}（{c.subject}）
                      </label>
                      {checked && (
                        <Input
                          type="number"
                          placeholder="總堂數"
                          value={formEnrollments[c.id] ?? ''}
                          onChange={(e) => setFormEnrollments((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          className="w-24"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {formError && <p className="text-sm text-rejected">{formError}</p>}
            <Button type="submit" loading={submitting}>新增</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={filteredStudents}
          keyField={(s) => s.id}
          loading={loading}
          onRowClick={openEdit}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯學生">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <Input placeholder="姓名" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
          <Input
            placeholder="帳號"
            type="text"
            value={editForm.email}
            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
            required
          />
          <Input
            placeholder="新密碼（留空＝不變更）"
            type="password"
            value={editForm.password}
            onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
          />
          <Input
            placeholder="家長電話"
            value={editForm.parentPhone}
            onChange={(e) => setEditForm({ ...editForm, parentPhone: e.target.value })}
          />

          <div>
            <p className="mb-1 text-sm font-medium text-ink">所屬班級</p>
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border border-borderStrong p-2">
              {classes.map((c) => {
                const checked = c.id in editEnrollments;
                const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                return (
                  <div key={c.id} className="flex flex-col gap-1 border-b border-borderSubtle pb-2 last:border-b-0 last:pb-0">
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={checked} onChange={() => toggleClass(c.id)} />
                      {c.name}（{c.subject}）
                    </label>
                    {checked && (
                      <div className="ml-6 flex flex-wrap items-center gap-2">
                        <Input
                          type="number"
                          placeholder="總堂數"
                          value={editEnrollments[c.id] ?? ''}
                          onChange={(e) => setEditEnrollments((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          className="w-24"
                        />
                        {enrollment && (
                          <>
                            {enrollment.totalSessions !== null && (
                              <span className="text-xs text-inkMuted">
                                已上 {enrollment.usedSessions}／剩餘 {enrollment.remaining}
                              </span>
                            )}
                            <Input
                              type="number"
                              placeholder="+堂數"
                              value={addAmount[c.id] ?? ''}
                              onChange={(e) => setAddAmount((prev) => ({ ...prev, [c.id]: e.target.value }))}
                              className="w-20"
                            />
                            <button
                              type="button"
                              className="text-xs text-brandDark hover:underline"
                              onClick={() => handleAddSessions(c.id)}
                            >
                              加堂
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {editError && <p className="text-sm text-rejected">{editError}</p>}
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除學生
        </button>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Verify manually in the browser**

Run: `npm run dev`, log in as an admin, open `http://localhost:3000/admin/students`.

Check:
- Clicking anywhere on a student's row (not just the 編輯 link) opens the edit modal.
- 新增學生: checking a class shows a 總堂數 input next to it; unchecking hides it again.
- 編輯學生: for a student already enrolled in a class with `totalSessions` set, the 總堂數 input is pre-filled and "已上 X／剩餘 Y" is shown; for an enrollment with no `totalSessions` set, no 已上/剩餘 text appears.
- Checking a brand-new class in the edit modal shows the 總堂數 input but no 已上/剩餘 text and no +堂數 control (nothing to add to yet).
- Typing an amount into +堂數 and clicking 加堂 immediately updates the 總堂數/已上/剩餘 display without needing to click 儲存.
- Saving the whole form (儲存) persists the 總堂數 values — reopening the same student shows them unchanged.
- Clearing a 總堂數 field to empty and saving results in "已上/剩餘" no longer showing for that class on the next open (quota tracking cleared).

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/students/page.tsx
git commit -m "$(cat <<'EOF'
feat: add session-quota inputs and 加堂 to the admin student edit form

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `/admin/classes` — row click, read-only quota display

**Files:**
- Modify: `src/app/admin/classes/page.tsx`

**Interfaces:**
- Consumes: `GET /api/classes` (now returns quota-enriched `enrollments`, Task 3).
- Produces: no new exports.

No automated test — verified manually in Step 2.

- [ ] **Step 1: Update the `EnrollmentRow` interface**

In `src/app/admin/classes/page.tsx`, replace the `EnrollmentRow` interface (currently lines 20-24) with:

```ts
interface EnrollmentRow {
  id: string;
  studentId: string;
  student: { user: { name: string } };
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
}
```

- [ ] **Step 2: Add `onRowClick` to the `DataTable`**

Replace the `DataTable` call (currently line 229):

```tsx
<DataTable
  columns={columns}
  rows={filteredClasses}
  keyField={(c) => c.id}
  loading={loading}
  onRowClick={openEdit}
  rowClassName={() => 'cursor-pointer hover:bg-stripe'}
/>
```

- [ ] **Step 3: Show the quota in the roster list**

Replace the roster `<li>` block inside the "已加入學生" section (currently lines 268-275):

```tsx
<li key={en.id} className="flex items-center justify-between text-sm text-ink">
  <span>
    {en.student.user.name}
    {en.totalSessions !== null && (
      <span className="ml-2 text-xs text-inkMuted">
        （總堂數 {en.totalSessions}／已上 {en.usedSessions}／剩餘 {en.remaining}）
      </span>
    )}
  </span>
  <button type="button" className="text-rejected hover:underline" onClick={() => removeStudent(en.studentId)}>
    移除
  </button>
</li>
```

(This is view-only — no input field, no save action here, matching the design decision that quota is edited only from `/admin/students`.)

- [ ] **Step 4: Verify manually in the browser**

Run: `npm run dev`, log in as an admin, open `http://localhost:3000/admin/classes`.

Check:
- Clicking anywhere on a class's row opens the edit modal (in addition to the existing 編輯 link).
- The "已加入學生" list shows `（總堂數 X／已上 Y／剩餘 Z）` next to a student whose `totalSessions` was set via `/admin/students` in Task 5's verification; a student with no quota set shows just their name with no parenthetical.
- There is no way to edit the quota numbers from this screen (no input field appears) — confirms the read-only design decision.
- 移除 still works and still refreshes the roster (unrelated to this task, but confirms nothing broke).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/classes/page.tsx
git commit -m "$(cat <<'EOF'
feat: show read-only session quota in the admin class roster

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `/student` dashboard — 剩餘堂數 column

**Files:**
- Modify: `src/app/student/page.tsx`

**Interfaces:**
- Consumes: `listStudentEnrolledClasses` (now returns a `quota` field per class, Task 3) — this page calls it directly (server component), not via `fetch`.
- Produces: no new exports.

No automated test — verified manually in Step 2.

- [ ] **Step 1: Update the `ClassRow` interface and add the column**

In `src/app/student/page.tsx`, replace the `ClassRow` interface (currently lines 20-28) with:

```ts
interface ClassRow {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
  quota: { totalSessions: number | null; usedSessions: number; remaining: number | null };
}
```

Replace the `classColumns` definition (currently lines 60-66) with:

```ts
const classColumns: Column<ClassRow>[] = [
  { header: '班級名稱', render: (c) => c.name },
  { header: '科目', render: (c) => c.subject },
  { header: '程度', render: (c) => c.level },
  { header: '上課時間', render: (c) => `每週${WEEKDAYS[c.weekday]} ${c.startTime}-${c.endTime}` },
  { header: '授課老師', render: (c) => c.teacher.user.name },
  { header: '剩餘堂數', render: (c) => (c.quota.remaining !== null ? c.quota.remaining : '-') },
];
```

(No other part of the file changes — `listStudentEnrolledClasses` is already imported and called; its return shape just gained the `quota` field that this new column reads.)

- [ ] **Step 2: Verify manually in the browser**

Run: `npm run dev`, log in as the student enrolled in the class you set a quota for in Task 5's verification.

Check:
- `/student` dashboard's "我的班級" table now has a "剩餘堂數" column.
- The class with `totalSessions` set shows the correct remaining number (matching what Task 5/6 showed on the admin side).
- Any other enrolled class with no `totalSessions` set shows `-`.

- [ ] **Step 3: Commit**

```bash
git add src/app/student/page.tsx
git commit -m "$(cat <<'EOF'
feat: show remaining session quota on the student dashboard's class list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
