# Admin Edit + Student Class Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make teacher/student/class records editable from the admin UI, let admins bind students to the classes they're actually enrolled in, and make the student leave-request page only show a student's own classes (enforced server-side too).

**Architecture:** Add `updateX` service functions mirroring the existing `createX` ones (partial update, same safe-select projections), a `setStudentEnrollments`/`unenrollStudent`/`listStudentEnrolledClasses` trio for the enrollment side, three new `PATCH /api/{teachers,students,classes}/[id]` routes plus a `DELETE` on the existing `/api/classes/[id]/enrollments` route, and a shared `Modal` UI primitive used by an "編輯" button added to each admin list page.

**Tech Stack:** Next.js 14 (App Router), Prisma 7 + Postgres, NextAuth, Vitest, Tailwind (existing design tokens from the prior UI redesign — no new tokens needed).

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-07-19-admin-edit-and-enrollment-design.md`
- All new API routes are ADMIN-only, matching the existing `POST` handlers on the same route files (identical guard: `if (!session || session.user.role !== 'ADMIN') return 403`).
- Partial updates: an omitted/undefined field means "leave unchanged." An empty-string password means "don't change the password." This relies on Prisma's own `update()` semantics (a key absent from `data` is left untouched) — do not hand-roll conditional object-building beyond what's shown in each task.
- Email uniqueness violations (Prisma `P2002`) must surface as a friendly `{error: 'EMAIL_TAKEN'}` JSON response, not a raw 500.
- Reuse existing `Input`/`Select`/`Button`/`Card`/`DataTable` primitives and Tailwind tokens (`text-ink`, `text-inkMuted`, `bg-brand`, `text-rejected`, etc.) — no new tokens, no inline hex colors.
- `npx tsc --noEmit` and `npm test` must stay green after every task. `npm test` requires a local Postgres reachable at `localhost:5432` (see `docker-compose.yml` at the repo root — run `docker compose up -d` once before starting this plan if it isn't already running).

---

### Task 1: Modal UI primitive

**Files:**
- Create: `src/components/ui/Modal.tsx`

**Interfaces:**
- Produces: `Modal` (default export), props `{ open: boolean; onClose: () => void; title: string; children: React.ReactNode }` — consumed by Tasks 8, 9, 10.

- [ ] **Step 1: Modal**

`src/components/ui/Modal.tsx`:
```tsx
'use client';

import { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-ink">{title}</h2>
          <button onClick={onClose} className="text-inkMuted hover:text-ink" aria-label="關閉">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Modal.tsx
git commit -m "feat(ui): add Modal component"
```

---

### Task 2: `updateTeacher` service function

**Files:**
- Modify: `src/lib/services/teacherService.ts`
- Test: `src/lib/services/teacherService.test.ts`

**Interfaces:**
- Consumes: nothing new (uses existing `prisma`, `bcrypt`, `SAFE_USER_SELECT` already in the file).
- Produces: `UpdateTeacherInput` (named export interface, `{ name?: string; email?: string; password?: string; subjects?: string; phone?: string }`), `updateTeacher(id: string, input: UpdateTeacherInput)` (named export, returns the same shape as `createTeacher`) — consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/teacherService.test.ts` (add the import and the new `describe` block; the existing `beforeEach` and other tests stay as-is):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher, listTeachers, updateTeacher } from './teacherService';
```

```ts
describe('updateTeacher', () => {
  it('updates only the provided fields, leaving others unchanged', async () => {
    const teacher = await createTeacher({
      name: '陳老師',
      email: 'chen@example.com',
      password: 'secret123',
      subjects: '英文',
      phone: '0911111111',
    });

    const updated = await updateTeacher(teacher.id, { phone: '0922222222' });

    expect(updated.phone).toBe('0922222222');
    expect(updated.subjects).toBe('英文');
    expect(updated.user.name).toBe('陳老師');
  });

  it('hashes a new password when provided, and leaves it unchanged when omitted', async () => {
    const teacher = await createTeacher({
      name: '陳老師',
      email: 'chen@example.com',
      password: 'secret123',
      subjects: '英文',
    });
    const before = await prisma.user.findUniqueOrThrow({ where: { email: 'chen@example.com' } });

    await updateTeacher(teacher.id, { subjects: '數學' });
    const afterNoPasswordChange = await prisma.user.findUniqueOrThrow({ where: { email: 'chen@example.com' } });
    expect(afterNoPasswordChange.password).toBe(before.password);

    await updateTeacher(teacher.id, { password: 'newpassword456' });
    const afterPasswordChange = await prisma.user.findUniqueOrThrow({ where: { email: 'chen@example.com' } });
    expect(afterPasswordChange.password).not.toBe(before.password);
    expect(afterPasswordChange.password).not.toBe('newpassword456');
  });

  it('throws when the new email is already taken by another user', async () => {
    await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'secret123', subjects: '英文' });
    const other = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'secret123', subjects: '數學' });

    await expect(updateTeacher(other.id, { email: 'chen@example.com' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/teacherService.test.ts`
Expected: FAIL — `updateTeacher` is not exported from `./teacherService`.

- [ ] **Step 3: Implement `updateTeacher`**

Add to `src/lib/services/teacherService.ts` (after the existing `CreateTeacherInput` interface, and after `createTeacher`):

```ts
export interface UpdateTeacherInput {
  name?: string;
  email?: string;
  password?: string;
  subjects?: string;
  phone?: string;
}

export async function updateTeacher(id: string, input: UpdateTeacherInput) {
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { id } });
  const hashedPassword = input.password ? await bcrypt.hash(input.password, 10) : undefined;

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: teacher.userId },
      data: { name: input.name, email: input.email, password: hashedPassword },
    });
    return tx.teacher.update({
      where: { id },
      data: { subjects: input.subjects, phone: input.phone },
      select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } },
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/teacherService.test.ts`
Expected: `Test Files 1 passed (1)`, all tests passing (2 pre-existing + 3 new = 5).

- [ ] **Step 5: Full suite + type-check**

Run: `npm test` then `npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/teacherService.ts src/lib/services/teacherService.test.ts
git commit -m "feat: add updateTeacher service function"
```

---

### Task 3: `updateStudent` service function

**Files:**
- Modify: `src/lib/services/studentService.ts`
- Test: `src/lib/services/studentService.test.ts`

**Interfaces:**
- Produces: `UpdateStudentInput` (named export interface, `{ name?: string; email?: string; password?: string; parentPhone?: string }`), `updateStudent(id: string, input: UpdateStudentInput)` (named export) — consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

Update the import line in `src/lib/services/studentService.test.ts`:

```ts
import { createStudent, listStudents, updateStudent } from './studentService';
```

Append:

```ts
describe('updateStudent', () => {
  it('updates only the provided fields, leaving others unchanged', async () => {
    const student = await createStudent({
      name: '小華',
      email: 'hua@example.com',
      password: 'secret123',
      parentPhone: '0933333333',
    });

    const updated = await updateStudent(student.id, { parentPhone: '0944444444' });

    expect(updated.parentPhone).toBe('0944444444');
    expect(updated.user.name).toBe('小華');
  });

  it('hashes a new password when provided, and leaves it unchanged when omitted', async () => {
    const student = await createStudent({ name: '小華', email: 'hua@example.com', password: 'secret123' });
    const before = await prisma.user.findUniqueOrThrow({ where: { email: 'hua@example.com' } });

    await updateStudent(student.id, { parentPhone: '0955555555' });
    const afterNoPasswordChange = await prisma.user.findUniqueOrThrow({ where: { email: 'hua@example.com' } });
    expect(afterNoPasswordChange.password).toBe(before.password);

    await updateStudent(student.id, { password: 'newpassword456' });
    const afterPasswordChange = await prisma.user.findUniqueOrThrow({ where: { email: 'hua@example.com' } });
    expect(afterPasswordChange.password).not.toBe(before.password);
  });

  it('throws when the new email is already taken by another user', async () => {
    await createStudent({ name: '小華', email: 'hua@example.com', password: 'secret123' });
    const other = await createStudent({ name: '小明', email: 'ming@example.com', password: 'secret123' });

    await expect(updateStudent(other.id, { email: 'hua@example.com' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/studentService.test.ts`
Expected: FAIL — `updateStudent` is not exported.

- [ ] **Step 3: Implement `updateStudent`**

Add to `src/lib/services/studentService.ts`:

```ts
export interface UpdateStudentInput {
  name?: string;
  email?: string;
  password?: string;
  parentPhone?: string;
}

export async function updateStudent(id: string, input: UpdateStudentInput) {
  const student = await prisma.student.findUniqueOrThrow({ where: { id } });
  const hashedPassword = input.password ? await bcrypt.hash(input.password, 10) : undefined;

  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: student.userId },
      data: { name: input.name, email: input.email, password: hashedPassword },
    });
    return tx.student.update({
      where: { id },
      data: { parentPhone: input.parentPhone },
      select: { id: true, parentPhone: true, user: { select: SAFE_USER_SELECT } },
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/studentService.test.ts`
Expected: all passing (2 pre-existing + 3 new = 5).

- [ ] **Step 5: Full suite + type-check**

Run: `npm test` then `npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/studentService.ts src/lib/services/studentService.test.ts
git commit -m "feat: add updateStudent service function"
```

---

### Task 4: `updateClass` service function

**Files:**
- Modify: `src/lib/services/classService.ts`
- Test: `src/lib/services/classService.test.ts`

**Interfaces:**
- Produces: `UpdateClassInput` (named export interface, `{ name?: string; subject?: string; level?: string; teacherId?: string; weekday?: number; startTime?: string; endTime?: string }`), `updateClass(id: string, input: UpdateClassInput)` (named export, returns the same shape as `listClasses()`'s rows) — consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Update the import line in `src/lib/services/classService.test.ts`:

```ts
import { createClass, listClasses, listClassesBySubjectAndLevel, enrollStudent, updateClass } from './classService';
```

Append:

```ts
describe('updateClass', () => {
  it('updates only the provided fields, leaving others unchanged', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-update-chen@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const updated = await updateClass(cls.id, { startTime: '20:00', endTime: '22:00' });

    expect(updated.startTime).toBe('20:00');
    expect(updated.endTime).toBe('22:00');
    expect(updated.name).toBe('數學A班');
    expect(updated.weekday).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: FAIL — `updateClass` is not exported.

- [ ] **Step 3: Implement `updateClass`**

Add to `src/lib/services/classService.ts` (after `createClass`):

```ts
export interface UpdateClassInput {
  name?: string;
  subject?: string;
  level?: string;
  teacherId?: string;
  weekday?: number;
  startTime?: string;
  endTime?: string;
}

export function updateClass(id: string, input: UpdateClassInput) {
  return prisma.class.update({
    where: { id },
    data: input,
    select: CLASS_WITH_TEACHER_SELECT,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: all passing (4 pre-existing + 1 new = 5).

- [ ] **Step 5: Full suite + type-check**

Run: `npm test` then `npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/classService.ts src/lib/services/classService.test.ts
git commit -m "feat: add updateClass service function"
```

---

### Task 5: Enrollment management service functions

**Files:**
- Modify: `src/lib/services/classService.ts`
- Modify: `src/lib/services/studentService.ts`
- Test: `src/lib/services/classService.test.ts`

**Interfaces:**
- Produces:
  - `setStudentEnrollments(studentId: string, classIds: string[]): Promise<void>` (named export) — consumed by Task 7 (student PATCH route).
  - `unenrollStudent(classId: string, studentId: string): Promise<void>` (named export) — consumed by Task 7 (enrollments DELETE route).
  - `listStudentEnrolledClasses(studentId: string)` (named export, returns `CLASS_BOOKING_SELECT`-shaped rows) — consumed by Task 6.
  - `listStudents()`'s existing return rows now also include `enrollments: { classId: string }[]` — consumed by Task 9.
  - `listClasses()`'s existing return rows now also include richer `enrollments` entries: `{ id: string; studentId: string; student: { user: { name: string } } }[]` (previously bare `ClassEnrollment` rows with no nested student info) — consumed by Task 10.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/classService.test.ts`:

```ts
describe('setStudentEnrollments', () => {
  it('adds new enrollments and removes dropped ones, leaving unchanged ones alone', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-set-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-set-ming@example.com', password: 'x' });
    const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    const classC = await createClass({ name: '數學C班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });

    await setStudentEnrollments(student.id, [classA.id, classB.id]);
    const originalEnrollmentA = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: classA.id } });

    await setStudentEnrollments(student.id, [classA.id, classC.id]);

    const finalEnrollments = await prisma.classEnrollment.findMany({ where: { studentId: student.id } });
    expect(finalEnrollments.map((e) => e.classId).sort()).toEqual([classA.id, classC.id].sort());

    const stillA = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: classA.id } });
    expect(stillA.id).toBe(originalEnrollmentA.id);
  });
});

describe('unenrollStudent', () => {
  it('removes a specific enrollment', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-unenroll-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-unenroll-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    await unenrollStudent(cls.id, student.id);

    const remaining = await prisma.classEnrollment.findMany({ where: { studentId: student.id, classId: cls.id } });
    expect(remaining).toHaveLength(0);
  });
});

describe('listStudentEnrolledClasses', () => {
  it('returns only classes the student is enrolled in', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-list-enrolled-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-list-enrolled-ming@example.com', password: 'x' });
    const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(classA.id, student.id);

    const result = await listStudentEnrolledClasses(student.id);

    expect(result.map((c) => c.id)).toEqual([classA.id]);
  });
});
```

Add the new imports to the top of the test file:

```ts
import {
  createClass,
  listClasses,
  listClassesBySubjectAndLevel,
  enrollStudent,
  updateClass,
  setStudentEnrollments,
  unenrollStudent,
  listStudentEnrolledClasses,
} from './classService';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: FAIL — the three new functions aren't exported yet.

- [ ] **Step 3: Implement the enrollment functions**

Add to `src/lib/services/classService.ts` (after the existing `enrollStudent` function):

```ts
export async function setStudentEnrollments(studentId: string, classIds: string[]) {
  const current = await prisma.classEnrollment.findMany({ where: { studentId }, select: { classId: true } });
  const currentIds = new Set(current.map((e) => e.classId));
  const desiredIds = new Set(classIds);

  const toAdd = classIds.filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));

  await prisma.$transaction([
    ...(toRemove.length > 0 ? [prisma.classEnrollment.deleteMany({ where: { studentId, classId: { in: toRemove } } })] : []),
    ...toAdd.map((classId) => prisma.classEnrollment.create({ data: { studentId, classId } })),
  ]);
}

export function unenrollStudent(classId: string, studentId: string) {
  return prisma.classEnrollment.delete({ where: { studentId_classId: { studentId, classId } } });
}

export function listStudentEnrolledClasses(studentId: string) {
  return prisma.class.findMany({
    where: { enrollments: { some: { studentId } } },
    select: CLASS_BOOKING_SELECT,
    orderBy: { name: 'asc' },
  });
}
```

Then widen `CLASS_WITH_TEACHER_SELECT`'s `enrollments` field so the admin classes page can show enrolled students' names (change the bare `enrollments: true` to a nested select):

```ts
const CLASS_WITH_TEACHER_SELECT = {
  id: true,
  name: true,
  subject: true,
  level: true,
  weekday: true,
  startTime: true,
  endTime: true,
  teacher: { select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } } },
  enrollments: { select: { id: true, studentId: true, student: { select: { user: { select: { name: true } } } } } },
} as const;
```

Leave `CLASS_BOOKING_SELECT`'s `enrollments: true` as-is — that projection is used by student/teacher-facing bookings and must not expose other students' names.

Finally, in `src/lib/services/studentService.ts`, widen `listStudents()`'s select to include each student's enrolled class ids:

```ts
export function listStudents() {
  return prisma.student.findMany({
    select: {
      id: true,
      parentPhone: true,
      user: { select: SAFE_USER_SELECT },
      enrollments: { select: { classId: true } },
    },
    orderBy: { user: { name: 'asc' } },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: all passing (5 pre-existing + 3 new = 8).

- [ ] **Step 5: Full suite + type-check**

Run: `npm test` then `npx tsc --noEmit`
Expected: both clean. (The `listClasses()`/`listStudents()` select widening is additive — no existing consumer destructures a shape that would break.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/classService.ts src/lib/services/classService.test.ts src/lib/services/studentService.ts
git commit -m "feat: add student class enrollment management functions"
```

---

### Task 6: Enforce enrollment on leave-request creation

**Files:**
- Modify: `src/lib/services/leaveRequestService.ts`
- Modify: `src/app/api/classes/route.ts`
- Test: `src/lib/services/leaveRequestService.test.ts`
- Test: `src/lib/services/makeupRequestService.test.ts` (fixture fix, no new tests)

**Interfaces:**
- Consumes: `enrollStudent` from `./classService` (Task 5, already existed before this task too).
- Produces: `createLeaveRequest` now throws `Error('NOT_ENROLLED')` if the student isn't enrolled in the given class — this is a behavior change existing callers must account for (see Step 1 fixture fixes below).

This task changes `createLeaveRequest` to reject leave requests for classes the student isn't enrolled in. Two other test files create leave requests via fixture helpers that don't currently enroll their students — those fixtures must be fixed in this same task, or their tests will start failing.

- [ ] **Step 1: Fix fixtures in dependent test files first**

In `src/lib/services/leaveRequestService.test.ts`, add the `enrollStudent` import and enroll inside `setupClassAndStudent`:

```ts
import { createClass, enrollStudent } from './classService';
```

```ts
async function setupClassAndStudent() {
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
  await enrollStudent(cls.id, student.id);
  return { student, cls };
}
```

And in the `listLeaveRequestsForStudent` test, enroll `otherStudent` too before its leave request:

```ts
describe('listLeaveRequestsForStudent', () => {
  it('returns only the given student\'s leave requests', async () => {
    const { student, cls } = await setupClassAndStudent();
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(2026, 6, 20), reason: '感冒' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await enrollStudent(cls.id, otherStudent.id);
    await createLeaveRequest({ studentId: otherStudent.id, classId: cls.id, date: new Date(2026, 6, 21), reason: '事假' });

    const results = await listLeaveRequestsForStudent(student.id);
    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe('感冒');
  });
});
```

In `src/lib/services/makeupRequestService.test.ts`, add `enrollStudent` to the `classService` import:

```ts
import { createClass, enrollStudent } from './classService';
```

Enroll the student inside `setup()`, right before it creates the leave:

```ts
async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
  const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
  await enrollStudent(classA.id, student.id);
  const leave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 20), reason: '感冒' });
  return { teacher, student, classA, classB, leave };
}
```

This exact 3-line block appears twice more in the same file, byte-for-byte identical both times (once in the `SLOT_CONFLICT`-reproducing test that comes right before the concurrency tests, and once inside `it('allows only one of two concurrent requests for the same teacher/slot to succeed', ...)`):

```ts
const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
const classA = await prisma.class.findFirstOrThrow();
const otherLeave = await createLeaveRequest({ studentId: otherStudent.id, classId: classA.id, date: new Date(2026, 6, 20), reason: '事假' });
```

Replace **both** occurrences with:

```ts
const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
const classA = await prisma.class.findFirstOrThrow();
await enrollStudent(classA.id, otherStudent.id);
const otherLeave = await createLeaveRequest({ studentId: otherStudent.id, classId: classA.id, date: new Date(2026, 6, 20), reason: '事假' });
```

- [ ] **Step 2: Run the fixture-only fix and confirm it's still green before adding the new behavior**

Run: `npm test`
Expected: all existing tests still pass (fixtures now enroll students, but `createLeaveRequest` doesn't check enrollment yet, so this is a no-op change at this point).

- [ ] **Step 3: Write the failing test for the new validation**

Append to `src/lib/services/leaveRequestService.test.ts`:

```ts
describe('createLeaveRequest enrollment check', () => {
  it('throws NOT_ENROLLED for a class the student is not enrolled in', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小美', email: 'mei@example.com', password: 'x' });
    const cls = await createClass({ name: '數學D班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 4, startTime: '19:00', endTime: '21:00' });

    await expect(
      createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(2026, 6, 20), reason: '事假' })
    ).rejects.toThrow('NOT_ENROLLED');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/services/leaveRequestService.test.ts`
Expected: FAIL — `createLeaveRequest` currently succeeds for any class regardless of enrollment.

- [ ] **Step 5: Implement the validation**

Replace `createLeaveRequest` in `src/lib/services/leaveRequestService.ts`:

```ts
import { prisma } from '@/lib/db';

export interface CreateLeaveRequestInput {
  studentId: string;
  classId: string;
  date: Date;
  reason: string;
}

export async function createLeaveRequest(input: CreateLeaveRequestInput) {
  const enrolled = await prisma.classEnrollment.findUnique({
    where: { studentId_classId: { studentId: input.studentId, classId: input.classId } },
  });
  if (!enrolled) throw new Error('NOT_ENROLLED');

  return prisma.leaveRequest.create({
    data: { ...input, status: 'APPROVED' },
  });
}

export function listLeaveRequestsForStudent(studentId: string) {
  return prisma.leaveRequest.findMany({
    where: { studentId },
    include: { class: true, makeupRequest: true },
    orderBy: { date: 'desc' },
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: all tests passing across the whole suite (no regressions in `makeupRequestService.test.ts` or `leaveRequestService.test.ts`).

- [ ] **Step 7: Switch the student-facing class picker to enrolled-only**

In `src/app/api/classes/route.ts`, import `listStudentEnrolledClasses` and use it for STUDENT sessions (TEACHER sessions keep using `listClassesForBooking()` — teachers aren't enrolled in classes, so this only changes the STUDENT branch):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createClass, listClasses, listClassesForBooking, listStudentEnrolledClasses } from '@/lib/services/classService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.role === 'ADMIN') return NextResponse.json(await listClasses());

  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
    if (!student) return NextResponse.json([]);
    return NextResponse.json(await listStudentEnrolledClasses(student.id));
  }

  return NextResponse.json(await listClassesForBooking());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const cls = await createClass(body);
  return NextResponse.json(cls, { status: 201 });
}
```

Note this route now imports `prisma` directly (matching the existing pattern already used in `src/app/api/leave-requests/route.ts` for the same "look up the Student row for this session" need).

- [ ] **Step 8: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/services/leaveRequestService.ts src/lib/services/leaveRequestService.test.ts src/lib/services/makeupRequestService.test.ts src/app/api/classes/route.ts
git commit -m "feat: enforce class enrollment on leave-request creation and class picker"
```

---

### Task 7: PATCH API routes

**Files:**
- Create: `src/app/api/teachers/[id]/route.ts`
- Create: `src/app/api/students/[id]/route.ts`
- Create: `src/app/api/classes/[id]/route.ts`
- Modify: `src/app/api/classes/[id]/enrollments/route.ts`

**Interfaces:**
- Consumes: `updateTeacher` (Task 2), `updateStudent` + `setStudentEnrollments` (Tasks 3, 5), `updateClass` (Task 4), `unenrollStudent` (Task 5).
- Produces: `PATCH /api/teachers/[id]`, `PATCH /api/students/[id]` (body may include `classIds: string[]`), `PATCH /api/classes/[id]`, `DELETE /api/classes/[id]/enrollments` (body `{ studentId: string }`) — all consumed by Tasks 8, 9, 10.

No dedicated route-level tests: this codebase has no `route.test.ts` files anywhere (API routes are thin wrappers around already-unit-tested service functions, verified via manual/browser checks instead — see Task 11). This task follows that existing convention.

- [ ] **Step 1: Teacher PATCH route**

`src/app/api/teachers/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { updateTeacher } from '@/lib/services/teacherService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  try {
    const updated = await updateTeacher(params.id, body);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'EMAIL_TAKEN' }, { status: 409 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Student PATCH route**

`src/app/api/students/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { updateStudent } from '@/lib/services/studentService';
import { setStudentEnrollments } from '@/lib/services/classService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { classIds, ...profileInput } = await req.json();
  try {
    const updated = await updateStudent(params.id, profileInput);
    if (Array.isArray(classIds)) {
      await setStudentEnrollments(params.id, classIds);
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

- [ ] **Step 3: Class PATCH route**

`src/app/api/classes/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateClass } from '@/lib/services/classService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const updated = await updateClass(params.id, body);
  return NextResponse.json(updated);
}
```

- [ ] **Step 4: Add DELETE to the existing enrollments route**

`src/app/api/classes/[id]/enrollments/route.ts` (add the `DELETE` export and `unenrollStudent` import alongside the existing `POST`/`enrollStudent`):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { enrollStudent, unenrollStudent } from '@/lib/services/classService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId } = await req.json();
  const enrollment = await enrollStudent(params.id, studentId);
  return NextResponse.json(enrollment, { status: 201 });
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

- [ ] **Step 5: Type-check and full suite**

Run: `npx tsc --noEmit` then `npm test`
Expected: both clean (these routes only wire together already-tested service functions).

- [ ] **Step 6: Production build**

Run: `npx next build`
Expected: `✓ Compiled successfully`, all previous routes plus the four new ones appear in the route table (`/api/teachers/[id]`, `/api/students/[id]`, `/api/classes/[id]`).

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/teachers/[id]/route.ts" "src/app/api/students/[id]/route.ts" "src/app/api/classes/[id]/route.ts" "src/app/api/classes/[id]/enrollments/route.ts"
git commit -m "feat: add PATCH routes for teachers, students, and classes"
```

---

### Task 8: Admin teachers page — edit modal

**Files:**
- Modify: `src/app/admin/teachers/page.tsx`

**Interfaces:**
- Consumes: `Modal` (Task 1), `PATCH /api/teachers/[id]` (Task 7).

- [ ] **Step 1: Full replacement**

`src/app/admin/teachers/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

interface TeacherRow {
  id: string;
  subjects: string;
  phone: string | null;
  user: { name: string; email: string };
}

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', subjects: '', phone: '' });
  const [editing, setEditing] = useState<TeacherRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', subjects: '', phone: '' });

  async function load() {
    const res = await fetch('/api/teachers');
    setTeachers(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/teachers', { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', email: '', password: '', subjects: '', phone: '' });
    load();
  }

  function openEdit(t: TeacherRow) {
    setEditing(t);
    setEditForm({ name: t.user.name, email: t.user.email, password: '', subjects: t.subjects, phone: t.phone ?? '' });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    await fetch(`/api/teachers/${editing.id}`, { method: 'PATCH', body: JSON.stringify(editForm) });
    setEditing(null);
    load();
  }

  const columns: Column<TeacherRow>[] = [
    { header: '姓名', render: (t) => t.user.name },
    { header: 'Email', render: (t) => t.user.email },
    { header: '科目', render: (t) => t.subjects },
    { header: '電話', render: (t) => t.phone ?? '-' },
    {
      header: '操作',
      render: (t) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(t)}>
          編輯
        </button>
      ),
    },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">老師名單</h1>
      <Card className="mb-6">
        <DataTable columns={columns} rows={teachers} keyField={(t) => t.id} />
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 font-bold text-ink">新增老師</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Input
            placeholder="初始密碼"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Input placeholder="任教科目" value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} required />
          <Input placeholder="電話" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Button type="submit">新增</Button>
        </form>
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯老師">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-2">
          <Input placeholder="姓名" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
          <Input
            placeholder="Email"
            type="email"
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
            placeholder="任教科目"
            value={editForm.subjects}
            onChange={(e) => setEditForm({ ...editForm, subjects: e.target.value })}
            required
          />
          <Input placeholder="電話" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
          <Button type="submit">儲存</Button>
        </form>
      </Modal>
    </AppShell>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/teachers/page.tsx
git commit -m "feat(ui): add teacher edit modal"
```

---

### Task 9: Admin students page — edit modal with class enrollment

**Files:**
- Modify: `src/app/admin/students/page.tsx`

**Interfaces:**
- Consumes: `Modal` (Task 1), `PATCH /api/students/[id]` (Task 7, accepts `classIds`), `GET /api/classes` (admin branch, unchanged — still `listClasses()`).

- [ ] **Step 1: Full replacement**

`src/app/admin/students/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

interface StudentRow {
  id: string;
  parentPhone: string | null;
  user: { name: string; email: string };
  enrollments: { classId: string }[];
}

interface ClassOption {
  id: string;
  name: string;
  subject: string;
}

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', parentPhone: '' });
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', parentPhone: '' });
  const [editClassIds, setEditClassIds] = useState<string[]>([]);

  async function load() {
    const [studentsRes, classesRes] = await Promise.all([fetch('/api/students'), fetch('/api/classes')]);
    setStudents(await studentsRes.json());
    setClasses(await classesRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/students', { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', email: '', password: '', parentPhone: '' });
    load();
  }

  function openEdit(s: StudentRow) {
    setEditing(s);
    setEditForm({ name: s.user.name, email: s.user.email, password: '', parentPhone: s.parentPhone ?? '' });
    setEditClassIds(s.enrollments.map((e) => e.classId));
  }

  function toggleClass(classId: string) {
    setEditClassIds((prev) => (prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]));
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    await fetch(`/api/students/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...editForm, classIds: editClassIds }),
    });
    setEditing(null);
    load();
  }

  const columns: Column<StudentRow>[] = [
    { header: '姓名', render: (s) => s.user.name },
    { header: 'Email', render: (s) => s.user.email },
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
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">學生名單</h1>
      <Card className="mb-6">
        <DataTable columns={columns} rows={students} keyField={(s) => s.id} />
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 font-bold text-ink">新增學生</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Input
            placeholder="初始密碼"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Input placeholder="家長電話" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
          <Button type="submit">新增</Button>
        </form>
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯學生">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <Input placeholder="姓名" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
          <Input
            placeholder="Email"
            type="email"
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
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-gray-300 p-2">
              {classes.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={editClassIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
                  {c.name}（{c.subject}）
                </label>
              ))}
            </div>
          </div>

          <Button type="submit">儲存</Button>
        </form>
      </Modal>
    </AppShell>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/students/page.tsx
git commit -m "feat(ui): add student edit modal with class enrollment management"
```

---

### Task 10: Admin classes page — edit modal with roster removal

**Files:**
- Modify: `src/app/admin/classes/page.tsx`

**Interfaces:**
- Consumes: `Modal` (Task 1), `PATCH /api/classes/[id]` (Task 7), `DELETE /api/classes/[id]/enrollments` (Task 7).

- [ ] **Step 1: Full replacement**

`src/app/admin/classes/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface EnrollmentRow {
  id: string;
  studentId: string;
  student: { user: { name: string } };
}

interface ClassRow {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { id: string; user: { name: string } };
  enrollments: EnrollmentRow[];
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [form, setForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [editForm, setEditForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });

  async function load() {
    const [classesRes, teachersRes] = await Promise.all([fetch('/api/classes'), fetch('/api/teachers')]);
    setClasses(await classesRes.json());
    setTeachers(await teachersRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/classes', {
      method: 'POST',
      body: JSON.stringify({ ...form, weekday: Number(form.weekday) }),
    });
    setForm({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
    load();
  }

  function openEdit(c: ClassRow) {
    setEditing(c);
    setEditForm({
      name: c.name,
      subject: c.subject,
      level: c.level,
      teacherId: c.teacher.id,
      weekday: String(c.weekday),
      startTime: c.startTime,
      endTime: c.endTime,
    });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    await fetch(`/api/classes/${editing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...editForm, weekday: Number(editForm.weekday) }),
    });
    setEditing(null);
    load();
  }

  async function removeStudent(studentId: string) {
    if (!editing) return;
    await fetch(`/api/classes/${editing.id}/enrollments`, { method: 'DELETE', body: JSON.stringify({ studentId }) });
    const res = await fetch('/api/classes');
    const updatedClasses: ClassRow[] = await res.json();
    setClasses(updatedClasses);
    const updatedEditing = updatedClasses.find((c) => c.id === editing.id);
    if (updatedEditing) setEditing(updatedEditing);
  }

  const columns: Column<ClassRow>[] = [
    { header: '班名', render: (c) => c.name },
    { header: '科目/等級', render: (c) => `${c.subject} / ${c.level}` },
    { header: '老師', render: (c) => c.teacher.user.name },
    { header: '時間', render: (c) => `週${WEEKDAYS[c.weekday]} ${c.startTime}-${c.endTime}` },
    { header: '人數', render: (c) => c.enrollments.length },
    {
      header: '操作',
      render: (c) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(c)}>
          編輯
        </button>
      ),
    },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">班級名單</h1>
      <Card className="mb-6">
        <DataTable columns={columns} rows={classes} keyField={(c) => c.id} />
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 font-bold text-ink">新增班級</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input placeholder="班名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="科目" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
          <Input placeholder="等級" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} required />
          <Select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} required>
            <option value="">選擇老師</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.user.name}
              </option>
            ))}
          </Select>
          <Select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
            {WEEKDAYS.map((w, i) => (
              <option key={i} value={i}>
                週{w}
              </option>
            ))}
          </Select>
          <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          <Button type="submit">新增</Button>
        </form>
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯班級">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-2">
          <Input placeholder="班名" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
          <Input placeholder="科目" value={editForm.subject} onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })} required />
          <Input placeholder="等級" value={editForm.level} onChange={(e) => setEditForm({ ...editForm, level: e.target.value })} required />
          <Select value={editForm.teacherId} onChange={(e) => setEditForm({ ...editForm, teacherId: e.target.value })} required>
            <option value="">選擇老師</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.user.name}
              </option>
            ))}
          </Select>
          <Select value={editForm.weekday} onChange={(e) => setEditForm({ ...editForm, weekday: e.target.value })}>
            {WEEKDAYS.map((w, i) => (
              <option key={i} value={i}>
                週{w}
              </option>
            ))}
          </Select>
          <Input type="time" value={editForm.startTime} onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })} />
          <Input type="time" value={editForm.endTime} onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })} />
          <Button type="submit">儲存</Button>
        </form>

        {editing && (
          <div className="mt-4 border-t border-gray-200 pt-3">
            <p className="mb-2 text-sm font-medium text-ink">已加入學生（{editing.enrollments.length}）</p>
            {editing.enrollments.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生加入</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {editing.enrollments.map((en) => (
                  <li key={en.id} className="flex items-center justify-between text-sm text-ink">
                    {en.student.user.name}
                    <button type="button" className="text-rejected hover:underline" onClick={() => removeStudent(en.studentId)}>
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </AppShell>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/classes/page.tsx
git commit -m "feat(ui): add class edit modal with student roster removal"
```

---

### Task 11: Final verification

**Files:** none (verification-only task)

**Interfaces:** none — this task only verifies Tasks 1–10 together.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests passing (pre-existing count + all new tests added in Tasks 2–6). Requires a local Postgres reachable at `localhost:5432` — run `docker compose up -d` first if it isn't already running. If Docker/Postgres isn't available in the execution environment, say so explicitly rather than skipping this step silently — do not report the plan as complete without having actually run it somewhere.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 3: Production build**

Run: `npx next build`
Expected: `✓ Compiled successfully`, no ESLint errors, route table includes the three new `[id]` PATCH routes alongside every pre-existing route.

- [ ] **Step 4: Manual smoke test**

Run `npm run dev`, log in as `admin@example.com` / `password123`:
1. `/admin/teachers` — click 編輯 on a row, change 電話, save, confirm the table updates. Try setting a new password and confirm you can log in with it afterward. Try changing an email to one that's already taken and confirm you see a friendly error rather than a raw 500.
2. `/admin/students` — click 編輯 on a row, check/uncheck a couple of classes, save, confirm 班級數 updates in the table.
3. `/admin/classes` — click 編輯 on a row with enrolled students, click 移除 on one, confirm the roster list and 人數 column both update without closing the modal.
4. Log in as the student edited in step 2, visit `/student/leave-request` — confirm the class dropdown shows only the classes just assigned, submit a leave request for one of them (should succeed), and confirm there's no way to submit for a class that was left unchecked (it won't appear in the dropdown at all).

- [ ] **Step 5: Commit (only if fixes were needed)**

If Steps 1–4 required any fixes, commit them now with a descriptive message. If everything passed as-is, this task requires no commit.
