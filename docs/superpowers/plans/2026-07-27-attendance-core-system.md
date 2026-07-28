# 點名核心系統 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core attendance (check-in/check-out) system covering class, one-on-one makeup, Go Hall, and activity sessions, so teachers/admins can take attendance and students can see their own history.

**Architecture:** Four new Prisma tables (`ClassAttendance`, `OneOnOneAttendance`, `GoHallAttendance`, `ActivityAttendance`) plus a `totalSessions` column on `ClassEnrollment`. A single `attendanceService.ts` holds roster-building, upsert-save, and reporting logic. Seven new API routes under `/api/attendance/*` follow this codebase's existing inline-role-check convention. UI adds a shared `AttendanceHub` component (session list + roster modal) reused by `/admin/attendance` (with a stats tab) and `/teacher/attendance`, plus a `/student/attendance` history page.

**Tech Stack:** Next.js 14 (App Router) + TypeScript, Prisma 7 + Postgres, next-auth (Credentials), Tailwind, Vitest (real Postgres test DB, no mocking).

## Global Constraints

- Follow this codebase's existing conventions exactly — do not introduce new patterns:
  - Service functions are plain exported functions in `src/lib/services/*.ts`, no classes, importing `{ prisma }` from `@/lib/db`.
  - API routes do inline `getServerSession(authOptions)` + role checks, duplicated per-route (this codebase never factors auth checks into a shared helper) — see `src/app/api/go-hall-sessions/route.ts` as the reference pattern.
  - Dates are always constructed as `new Date(dateString)` from a plain `"YYYY-MM-DD"` string (never normalized further) — this is required for `DateTime` equality comparisons (e.g. matching `LeaveRequest.date`) to work, since two calls to `new Date("2026-07-27")` produce bit-identical UTC-midnight timestamps.
  - `markedById` on every attendance record is `session.user.id` (the `User.id` of whoever is currently saving — teacher or admin), matching how `User.id` is used elsewhere (e.g. `Teacher.userId`/`Student.userId` lookups).
- **No comments in code** unless explaining a non-obvious WHY (this codebase's existing files are sparse on comments — match that).
- **Testing convention (already established in this repo, do not deviate):** service-layer functions get real Vitest tests against a real Postgres test DB (no mocking), with a `beforeEach` that deletes all touched tables in FK-dependency order (children before parents), and fixtures built via other services' `create*` functions. **API routes and UI components have zero test coverage anywhere in this codebase today** (confirmed: no `*.test.ts` route files, no `*.test.tsx` component files exist) — this plan does not introduce the first one either. API/UI tasks are verified by a manual step (curl or browser), not automated tests.
- **No push notifications** (LINE/SMS/Email) anywhere in this feature — matches the whole system's existing "log in and check status yourself" principle.
- **No audit/version history** on attendance records — `POST`/upsert overwrites the prior value in place; only `updatedAt`/`markedById` track the last edit.
- Full design rationale lives in [`docs/superpowers/specs/2026-07-27-attendance-system-design.md`](../specs/2026-07-27-attendance-system-design.md) — read it first if anything below is ambiguous.
- This plan covers the **core attendance system only**. A separate follow-up plan will cover admin quota/加堂 (`ClassEnrollment.totalSessions` editing UI, add-sessions action, students/classes list enrichment) — that plan depends on `ClassAttendance` existing (for the `usedSessions` count) so it must run after this one.

---

### Task 1: Prisma schema — attendance tables + quota column

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `AttendanceStatus` enum (`PRESENT | LATE | LEFT_EARLY | ON_LEAVE | ABSENT`); `ClassAttendance`, `OneOnOneAttendance`, `GoHallAttendance`, `ActivityAttendance` models; `ClassEnrollment.totalSessions Int?`. Every later task's service/API/UI code depends on these exact model and field names.

- [ ] **Step 1: Add the new enum and four models to `prisma/schema.prisma`**

Append these blocks anywhere after the existing `enum SubstituteStatus` block (order among models doesn't matter to Prisma):

```prisma
enum AttendanceStatus {
  PRESENT
  LATE
  LEFT_EARLY
  ON_LEAVE
  ABSENT
}

model ClassAttendance {
  id              String            @id @default(cuid())
  classId         String
  class           Class             @relation(fields: [classId], references: [id])
  studentId       String
  student         Student           @relation(fields: [studentId], references: [id])
  date            DateTime
  status          AttendanceStatus
  checkInTime     String?
  checkOutTime    String?
  makeupRequestId String?           @unique
  makeupRequest   MakeupRequest?    @relation(fields: [makeupRequestId], references: [id])
  markedById      String
  markedBy        User              @relation(fields: [markedById], references: [id])
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  @@unique([classId, studentId, date])
}

model OneOnOneAttendance {
  id              String            @id @default(cuid())
  makeupRequestId String            @unique
  makeupRequest   MakeupRequest     @relation(fields: [makeupRequestId], references: [id])
  status          AttendanceStatus
  checkInTime     String?
  checkOutTime    String?
  markedById      String
  markedBy        User              @relation(fields: [markedById], references: [id])
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
}

model GoHallAttendance {
  id           String            @id @default(cuid())
  sessionId    String
  session      GoHallSession     @relation(fields: [sessionId], references: [id])
  studentId    String
  student      Student           @relation(fields: [studentId], references: [id])
  status       AttendanceStatus
  checkInTime  String?
  checkOutTime String?
  markedById   String
  markedBy     User              @relation(fields: [markedById], references: [id])
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  @@unique([sessionId, studentId])
}

model ActivityAttendance {
  id           String            @id @default(cuid())
  activityId   String
  activity     Activity          @relation(fields: [activityId], references: [id])
  studentId    String
  student      Student           @relation(fields: [studentId], references: [id])
  date         DateTime
  status       AttendanceStatus
  checkInTime  String?
  checkOutTime String?
  markedById   String
  markedBy     User              @relation(fields: [markedById], references: [id])
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt

  @@unique([activityId, studentId, date])
}
```

- [ ] **Step 2: Add the back-relation fields required by Prisma on the existing models**

Edit `model Class` — add one field after `insertionTargets`:
```prisma
  attendances      ClassAttendance[]
```

Edit `model Student` — add three fields after `activityRegistrations`:
```prisma
  classAttendances    ClassAttendance[]
  goHallAttendances   GoHallAttendance[]
  activityAttendances ActivityAttendance[]
```

Edit `model MakeupRequest` — add two fields after `createdAt DateTime @default(now())`:
```prisma
  classAttendance    ClassAttendance?
  oneOnOneAttendance OneOnOneAttendance?
```

Edit `model GoHallSession` — add one field after `createdAt`:
```prisma
  attendances GoHallAttendance[]
```

Edit `model Activity` — add one field after `images`:
```prisma
  attendances ActivityAttendance[]
```

Edit `model User` — add four fields after `student`:
```prisma
  markedClassAttendances    ClassAttendance[]
  markedOneOnOneAttendances OneOnOneAttendance[]
  markedGoHallAttendances   GoHallAttendance[]
  markedActivityAttendances ActivityAttendance[]
```

- [ ] **Step 3: Add the quota column to `ClassEnrollment`**

```prisma
model ClassEnrollment {
  id            String  @id @default(cuid())
  studentId     String
  classId       String
  student       Student @relation(fields: [studentId], references: [id])
  class         Class   @relation(fields: [classId], references: [id])
  totalSessions Int?

  @@unique([studentId, classId])
}
```

- [ ] **Step 4: Push the schema to the local dev DB and regenerate the client**

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.` and a regenerated `@prisma/client` with no type errors.

- [ ] **Step 5: Push the schema to the test DB**

Run: `npm run test:dbpush`
Expected: same success output, targeting the `tutoring_makeup_system_test` database.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat: add attendance tables and enrollment session-quota column

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `attendanceService` — class attendance (roster, save, quota)

**Files:**
- Create: `src/lib/services/attendanceService.ts`
- Create: `src/lib/services/attendanceService.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`; existing models `ClassEnrollment`, `MakeupRequest`, `LeaveRequest`, `ClassAttendance` from Task 1.
- Produces: `AttendanceStatusValue` type; `ClassRosterEntry` interface; `getClassRoster(classId: string, date: Date): Promise<ClassRosterEntry[]>`; `SaveAttendanceRecordInput` interface; `saveClassAttendance(classId: string, date: Date, markedById: string, records: SaveAttendanceRecordInput[]): Promise<void>`; `ClassAttendanceQuota` interface; `getClassEnrollmentQuota(classId: string, studentId: string): Promise<ClassAttendanceQuota>`. Tasks 3–7 append to this same file and reuse `AttendanceStatusValue` and `SaveAttendanceRecordInput`; Task 8 (API) consumes all three functions here directly.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/services/attendanceService.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createLeaveRequest } from './leaveRequestService';
import { createInsertionMakeupRequest, decideMakeupRequest } from './makeupRequestService';
import { getClassRoster, saveClassAttendance, getClassEnrollmentQuota } from './attendanceService';

beforeEach(async () => {
  await prisma.classAttendance.deleteMany();
  await prisma.oneOnOneAttendance.deleteMany();
  await prisma.goHallAttendance.deleteMany();
  await prisma.activityAttendance.deleteMany();
  await prisma.goHallRegistration.deleteMany();
  await prisma.goHallSession.deleteMany();
  await prisma.activityRegistration.deleteMany();
  await prisma.activityImage.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
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

async function setupClassWithStudent() {
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
  await enrollStudent(cls.id, student.id);
  return { teacher, student, cls };
}

describe('getClassRoster', () => {
  it('lists enrolled students with no status yet', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04');

    const roster = await getClassRoster(cls.id, date);

    expect(roster).toHaveLength(1);
    expect(roster[0].studentId).toBe(student.id);
    expect(roster[0].studentName).toBe('小明');
    expect(roster[0].makeupRequestId).toBeNull();
    expect(roster[0].onLeave).toBe(false);
    expect(roster[0].status).toBeNull();
  });

  it('marks onLeave when an approved leave request exists for that class and date', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04');
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date, reason: '感冒' });

    const roster = await getClassRoster(cls.id, date);

    expect(roster[0].onLeave).toBe(true);
  });

  it('includes an approved insertion-makeup student from another class, tagged with makeupRequestId', async () => {
    const { teacher, student: homeStudent, cls: homeClass } = await setupClassWithStudent();
    const targetClass = await createClass({ name: '週二進階班', subject: '圍棋', level: '進階', teacherId: teacher.id, weekday: 2, startTime: '16:00', endTime: '18:00' });
    const date = new Date('2026-08-04');
    const leave = await createLeaveRequest({ studentId: homeStudent.id, classId: homeClass.id, date, reason: '調課' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: date });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    const roster = await getClassRoster(targetClass.id, date);

    expect(roster).toHaveLength(1);
    expect(roster[0].studentId).toBe(homeStudent.id);
    expect(roster[0].makeupRequestId).toBe(makeup.id);
    expect(roster[0].onLeave).toBe(false);
  });
});

describe('saveClassAttendance', () => {
  it('creates a record for an enrolled student then updates it in place on a second save', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04');

    await saveClassAttendance(cls.id, date, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    let roster = await getClassRoster(cls.id, date);
    expect(roster[0].status).toBe('PRESENT');

    await saveClassAttendance(cls.id, date, 'marker-1', [{ studentId: student.id, status: 'LATE', checkInTime: '14:10' }]);
    roster = await getClassRoster(cls.id, date);
    expect(roster[0].status).toBe('LATE');
    expect(roster[0].checkInTime).toBe('14:10');

    const count = await prisma.classAttendance.count({ where: { classId: cls.id, studentId: student.id } });
    expect(count).toBe(1);
  });

  it('writes an insertion-makeup student into the target class keyed by makeupRequestId', async () => {
    const { teacher, student: homeStudent, cls: homeClass } = await setupClassWithStudent();
    const targetClass = await createClass({ name: '週二進階班', subject: '圍棋', level: '進階', teacherId: teacher.id, weekday: 2, startTime: '16:00', endTime: '18:00' });
    const date = new Date('2026-08-04');
    const leave = await createLeaveRequest({ studentId: homeStudent.id, classId: homeClass.id, date, reason: '調課' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: date });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    await saveClassAttendance(targetClass.id, date, 'marker-1', [{ studentId: homeStudent.id, status: 'PRESENT', makeupRequestId: makeup.id }]);

    const roster = await getClassRoster(targetClass.id, date);
    expect(roster[0].status).toBe('PRESENT');
    const homeRoster = await getClassRoster(homeClass.id, date);
    expect(homeRoster[0].status).toBeNull();
  });
});

describe('getClassEnrollmentQuota', () => {
  it('returns null totalSessions/remaining when the enrollment has no quota set', async () => {
    const { student, cls } = await setupClassWithStudent();

    const quota = await getClassEnrollmentQuota(cls.id, student.id);

    expect(quota.totalSessions).toBeNull();
    expect(quota.remaining).toBeNull();
    expect(quota.usedSessions).toBe(0);
  });

  it('counts PRESENT/LATE/LEFT_EARLY/ABSENT as used but excludes ON_LEAVE', async () => {
    const { student, cls } = await setupClassWithStudent();
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 12 } });

    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-18'), 'marker-1', [{ studentId: student.id, status: 'ON_LEAVE' }]);

    const quota = await getClassEnrollmentQuota(cls.id, student.id);

    expect(quota.totalSessions).toBe(12);
    expect(quota.usedSessions).toBe(2);
    expect(quota.remaining).toBe(10);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:dbpush && npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL — `Cannot find module './attendanceService'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/services/attendanceService.ts`:

```ts
import { prisma } from '@/lib/db';

export type AttendanceStatusValue = 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT';

const NAME_SELECT = { user: { select: { name: true } } } as const;

export interface SaveAttendanceRecordInput {
  studentId: string;
  status: AttendanceStatusValue;
  checkInTime?: string;
  checkOutTime?: string;
  makeupRequestId?: string;
}

export interface ClassRosterEntry {
  studentId: string;
  studentName: string;
  makeupRequestId: string | null;
  onLeave: boolean;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function getClassRoster(classId: string, date: Date): Promise<ClassRosterEntry[]> {
  const [enrollments, insertions, leaves, existing] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { classId },
      select: { studentId: true, student: { select: NAME_SELECT } },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'INSERTION', status: 'APPROVED', targetClassId: classId, targetDate: date },
      select: { id: true, leaveRequest: { select: { studentId: true, student: { select: NAME_SELECT } } } },
    }),
    prisma.leaveRequest.findMany({ where: { classId, date }, select: { studentId: true } }),
    prisma.classAttendance.findMany({ where: { classId, date } }),
  ]);

  const onLeaveStudentIds = new Set(leaves.map((l) => l.studentId));
  const existingByStudentId = new Map(existing.filter((a) => a.makeupRequestId === null).map((a) => [a.studentId, a]));
  const existingByMakeupRequestId = new Map(
    existing.filter((a) => a.makeupRequestId !== null).map((a) => [a.makeupRequestId as string, a])
  );

  const enrolledRows: ClassRosterEntry[] = enrollments.map((e) => {
    const record = existingByStudentId.get(e.studentId);
    return {
      studentId: e.studentId,
      studentName: e.student.user.name,
      makeupRequestId: null,
      onLeave: onLeaveStudentIds.has(e.studentId),
      status: (record?.status as AttendanceStatusValue) ?? null,
      checkInTime: record?.checkInTime ?? null,
      checkOutTime: record?.checkOutTime ?? null,
    };
  });

  const insertionRows: ClassRosterEntry[] = insertions.map((ins) => {
    const record = existingByMakeupRequestId.get(ins.id);
    return {
      studentId: ins.leaveRequest.studentId,
      studentName: ins.leaveRequest.student.user.name,
      makeupRequestId: ins.id,
      onLeave: false,
      status: (record?.status as AttendanceStatusValue) ?? null,
      checkInTime: record?.checkInTime ?? null,
      checkOutTime: record?.checkOutTime ?? null,
    };
  });

  return [...enrolledRows, ...insertionRows].sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}

export async function saveClassAttendance(
  classId: string,
  date: Date,
  markedById: string,
  records: SaveAttendanceRecordInput[]
): Promise<void> {
  await prisma.$transaction(
    records.map((r) =>
      prisma.classAttendance.upsert({
        where: r.makeupRequestId
          ? { makeupRequestId: r.makeupRequestId }
          : { classId_studentId_date: { classId, studentId: r.studentId, date } },
        create: {
          classId,
          studentId: r.studentId,
          date,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          makeupRequestId: r.makeupRequestId,
          markedById,
        },
        update: {
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          markedById,
        },
      })
    )
  );
}

export interface ClassAttendanceQuota {
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
}

export async function getClassEnrollmentQuota(classId: string, studentId: string): Promise<ClassAttendanceQuota> {
  const [enrollment, usedSessions] = await Promise.all([
    prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } } }),
    prisma.classAttendance.count({ where: { classId, studentId, status: { not: 'ON_LEAVE' } } }),
  ]);
  const { totalSessions } = enrollment;
  return {
    totalSessions,
    usedSessions,
    remaining: totalSessions === null ? null : totalSessions - usedSessions,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "$(cat <<'EOF'
feat: add class attendance roster, save, and quota service functions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `attendanceService` — one-on-one makeup attendance

**Files:**
- Modify: `src/lib/services/attendanceService.ts` (append)
- Modify: `src/lib/services/attendanceService.test.ts` (append)

**Interfaces:**
- Consumes: `AttendanceStatusValue` from Task 2.
- Produces: `OneOnOneRosterEntry` interface; `getOneOnOneAttendance(makeupRequestId: string): Promise<OneOnOneRosterEntry>`; `saveOneOnOneAttendance(makeupRequestId: string, markedById: string, input: { status: AttendanceStatusValue; checkInTime?: string; checkOutTime?: string }): Promise<void>`. Task 9 (API) consumes both.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/attendanceService.test.ts`:

```ts
import { createOneOnOneMakeupRequest } from './makeupRequestService';
import { getOneOnOneAttendance, saveOneOnOneAttendance } from './attendanceService';

describe('getOneOnOneAttendance / saveOneOnOneAttendance', () => {
  async function setupOneOnOne() {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    await prisma.teacherAvailability.create({ data: { teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '18:00' } });
    const { student, cls } = await setupClassWithStudent();
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date('2026-08-04'), reason: '請假' });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-08-11'),
      slotStartTime: '15:00',
      slotEndTime: '16:00',
    });
    return { student, makeup };
  }

  it('returns null status before anything is saved', async () => {
    const { student, makeup } = await setupOneOnOne();

    const entry = await getOneOnOneAttendance(makeup.id);

    expect(entry.studentId).toBe(student.id);
    expect(entry.status).toBeNull();
  });

  it('creates then updates in place on a second save', async () => {
    const { makeup } = await setupOneOnOne();

    await saveOneOnOneAttendance(makeup.id, 'marker-1', { status: 'PRESENT' });
    let entry = await getOneOnOneAttendance(makeup.id);
    expect(entry.status).toBe('PRESENT');

    await saveOneOnOneAttendance(makeup.id, 'marker-1', { status: 'LATE', checkInTime: '15:05' });
    entry = await getOneOnOneAttendance(makeup.id);
    expect(entry.status).toBe('LATE');
    expect(entry.checkInTime).toBe('15:05');

    const count = await prisma.oneOnOneAttendance.count({ where: { makeupRequestId: makeup.id } });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL — `getOneOnOneAttendance is not a function` (or similar import error).

- [ ] **Step 3: Write the implementation**

Append to `src/lib/services/attendanceService.ts`:

```ts
export interface OneOnOneRosterEntry {
  makeupRequestId: string;
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function getOneOnOneAttendance(makeupRequestId: string): Promise<OneOnOneRosterEntry> {
  const makeupRequest = await prisma.makeupRequest.findUniqueOrThrow({
    where: { id: makeupRequestId },
    select: {
      id: true,
      leaveRequest: { select: { studentId: true, student: { select: NAME_SELECT } } },
      oneOnOneAttendance: true,
    },
  });
  const record = makeupRequest.oneOnOneAttendance;
  return {
    makeupRequestId: makeupRequest.id,
    studentId: makeupRequest.leaveRequest.studentId,
    studentName: makeupRequest.leaveRequest.student.user.name,
    status: (record?.status as AttendanceStatusValue) ?? null,
    checkInTime: record?.checkInTime ?? null,
    checkOutTime: record?.checkOutTime ?? null,
  };
}

export async function saveOneOnOneAttendance(
  makeupRequestId: string,
  markedById: string,
  input: { status: AttendanceStatusValue; checkInTime?: string; checkOutTime?: string }
): Promise<void> {
  await prisma.oneOnOneAttendance.upsert({
    where: { makeupRequestId },
    create: {
      makeupRequestId,
      status: input.status,
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      markedById,
    },
    update: {
      status: input.status,
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      markedById,
    },
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: PASS — all tests green (Task 2's 7 + this task's 2 = 9).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "$(cat <<'EOF'
feat: add one-on-one makeup attendance service functions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `attendanceService` — Go Hall attendance

**Files:**
- Modify: `src/lib/services/attendanceService.ts` (append)
- Modify: `src/lib/services/attendanceService.test.ts` (append)

**Interfaces:**
- Consumes: `AttendanceStatusValue`, `SaveAttendanceRecordInput` from Task 2.
- Produces: `GoHallRosterEntry` interface; `getGoHallRoster(sessionId: string): Promise<GoHallRosterEntry[]>`; `saveGoHallAttendance(sessionId: string, markedById: string, records: SaveAttendanceRecordInput[]): Promise<void>`. Task 10 (API) consumes both.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/attendanceService.test.ts`:

```ts
import { createSessions, registerForSession } from './goHallService';
import { getGoHallRoster, saveGoHallAttendance } from './attendanceService';

describe('getGoHallRoster / saveGoHallAttendance', () => {
  it('lists registered students with no status yet, then reflects a save', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createSessions({ dates: [new Date('2026-08-01')], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);

    let roster = await getGoHallRoster(session.id);
    expect(roster).toHaveLength(1);
    expect(roster[0].studentId).toBe(student.id);
    expect(roster[0].status).toBeNull();

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    roster = await getGoHallRoster(session.id);
    expect(roster[0].status).toBe('PRESENT');

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);
    const count = await prisma.goHallAttendance.count({ where: { sessionId: session.id, studentId: student.id } });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL — `getGoHallRoster is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/services/attendanceService.ts`:

```ts
export interface GoHallRosterEntry {
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function getGoHallRoster(sessionId: string): Promise<GoHallRosterEntry[]> {
  const [registrations, existing] = await Promise.all([
    prisma.goHallRegistration.findMany({
      where: { sessionId },
      select: { studentId: true, student: { select: NAME_SELECT } },
    }),
    prisma.goHallAttendance.findMany({ where: { sessionId } }),
  ]);
  const existingByStudentId = new Map(existing.map((a) => [a.studentId, a]));
  return registrations
    .map((r) => {
      const record = existingByStudentId.get(r.studentId);
      return {
        studentId: r.studentId,
        studentName: r.student.user.name,
        status: (record?.status as AttendanceStatusValue) ?? null,
        checkInTime: record?.checkInTime ?? null,
        checkOutTime: record?.checkOutTime ?? null,
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}

export async function saveGoHallAttendance(
  sessionId: string,
  markedById: string,
  records: SaveAttendanceRecordInput[]
): Promise<void> {
  await prisma.$transaction(
    records.map((r) =>
      prisma.goHallAttendance.upsert({
        where: { sessionId_studentId: { sessionId, studentId: r.studentId } },
        create: {
          sessionId,
          studentId: r.studentId,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          markedById,
        },
        update: {
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          markedById,
        },
      })
    )
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: PASS — all tests green (9 + 1 = 10).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "$(cat <<'EOF'
feat: add Go Hall attendance service functions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `attendanceService` — activity attendance (per-day)

**Files:**
- Modify: `src/lib/services/attendanceService.ts` (append)
- Modify: `src/lib/services/attendanceService.test.ts` (append)

**Interfaces:**
- Consumes: `AttendanceStatusValue`, `SaveAttendanceRecordInput` from Task 2.
- Produces: `ActivityRosterEntry` interface; `getActivityRoster(activityId: string, date: Date): Promise<ActivityRosterEntry[]>`; `saveActivityAttendance(activityId: string, date: Date, markedById: string, records: SaveAttendanceRecordInput[]): Promise<void>`. Task 11 (API) consumes both.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/attendanceService.test.ts`:

```ts
import { createActivity, createCategory, registerForActivity } from './activityService';
import { getActivityRoster, saveActivityAttendance } from './attendanceService';

describe('getActivityRoster / saveActivityAttendance', () => {
  it('tracks attendance per day for a multi-day activity independently', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小美', email: 'mei@example.com', password: 'x' });
    const category = await createCategory('比賽');
    const activity = await createActivity({
      title: '暑期營隊',
      description: '三天營隊',
      categoryId: category.id,
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-03'),
      capacity: 20,
      teacherIds: [teacher.id],
    });
    await registerForActivity(activity.id, student.id);

    let day1 = await getActivityRoster(activity.id, new Date('2026-08-01'));
    expect(day1[0].status).toBeNull();

    await saveActivityAttendance(activity.id, new Date('2026-08-01'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    day1 = await getActivityRoster(activity.id, new Date('2026-08-01'));
    expect(day1[0].status).toBe('PRESENT');

    const day2 = await getActivityRoster(activity.id, new Date('2026-08-02'));
    expect(day2[0].status).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL — `getActivityRoster is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/services/attendanceService.ts`:

```ts
export interface ActivityRosterEntry {
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function getActivityRoster(activityId: string, date: Date): Promise<ActivityRosterEntry[]> {
  const [registrations, existing] = await Promise.all([
    prisma.activityRegistration.findMany({
      where: { activityId },
      select: { studentId: true, student: { select: NAME_SELECT } },
    }),
    prisma.activityAttendance.findMany({ where: { activityId, date } }),
  ]);
  const existingByStudentId = new Map(existing.map((a) => [a.studentId, a]));
  return registrations
    .map((r) => {
      const record = existingByStudentId.get(r.studentId);
      return {
        studentId: r.studentId,
        studentName: r.student.user.name,
        status: (record?.status as AttendanceStatusValue) ?? null,
        checkInTime: record?.checkInTime ?? null,
        checkOutTime: record?.checkOutTime ?? null,
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}

export async function saveActivityAttendance(
  activityId: string,
  date: Date,
  markedById: string,
  records: SaveAttendanceRecordInput[]
): Promise<void> {
  await prisma.$transaction(
    records.map((r) =>
      prisma.activityAttendance.upsert({
        where: { activityId_studentId_date: { activityId, studentId: r.studentId, date } },
        create: {
          activityId,
          studentId: r.studentId,
          date,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          markedById,
        },
        update: {
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          markedById,
        },
      })
    )
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: PASS — all tests green (10 + 1 = 11).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "$(cat <<'EOF'
feat: add per-day activity attendance service functions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `attendanceService` — hub listing (sessions for a date)

**Files:**
- Modify: `src/lib/services/attendanceService.ts` (append)
- Modify: `src/lib/services/attendanceService.test.ts` (append)

**Interfaces:**
- Consumes: nothing new from earlier tasks in this file (reads `Class`, `MakeupRequest`, `GoHallSession`, `Activity` plus the four attendance tables directly).
- Produces: `AttendanceSessionType` type (`'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY'`); `AttendanceSessionSummary` interface; `listAttendanceSessionsForDate(date: Date, teacherId: string | null): Promise<AttendanceSessionSummary[]>`. Task 12 (API `/api/attendance/sessions`) consumes this; the UI's `AttendanceHub` (Task 15) consumes the `type`/`id`/`title`/`timeLabel`/`markedCount`/`totalCount` field names.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/attendanceService.test.ts`:

```ts
import { listAttendanceSessionsForDate } from './attendanceService';

describe('listAttendanceSessionsForDate', () => {
  it('lists a class scheduled on that weekday, with marked/total counts', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04'); // a Tuesday, matches weekday: 2 in setupClassWithStudent

    let sessions = await listAttendanceSessionsForDate(date, null);
    const classRow = sessions.find((s) => s.type === 'CLASS' && s.id === cls.id);
    expect(classRow).toBeDefined();
    expect(classRow!.markedCount).toBe(0);
    expect(classRow!.totalCount).toBe(1);

    await saveClassAttendance(cls.id, date, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    sessions = await listAttendanceSessionsForDate(date, null);
    expect(sessions.find((s) => s.type === 'CLASS' && s.id === cls.id)!.markedCount).toBe(1);
  });

  it('excludes classes scheduled on a different weekday', async () => {
    const { cls } = await setupClassWithStudent();
    const sessions = await listAttendanceSessionsForDate(new Date('2026-08-05'), null); // a Wednesday
    expect(sessions.find((s) => s.type === 'CLASS' && s.id === cls.id)).toBeUndefined();
  });

  it('scopes to a given teacherId when provided', async () => {
    const { teacher, cls } = await setupClassWithStudent();
    const otherTeacher = await createTeacher({ name: '林老師', email: 'lin2@example.com', password: 'x', subjects: '圍棋' });
    const date = new Date('2026-08-04');

    const scoped = await listAttendanceSessionsForDate(date, otherTeacher.id);
    expect(scoped.find((s) => s.type === 'CLASS' && s.id === cls.id)).toBeUndefined();

    const own = await listAttendanceSessionsForDate(date, teacher.id);
    expect(own.find((s) => s.type === 'CLASS' && s.id === cls.id)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL — `listAttendanceSessionsForDate is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/services/attendanceService.ts`:

```ts
export type AttendanceSessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY';

export interface AttendanceSessionSummary {
  type: AttendanceSessionType;
  id: string;
  title: string;
  timeLabel: string;
  markedCount: number;
  totalCount: number;
}

export async function listAttendanceSessionsForDate(
  date: Date,
  teacherId: string | null
): Promise<AttendanceSessionSummary[]> {
  const weekday = date.getDay();

  const [classes, oneOnOnes, goHallSessions, activities] = await Promise.all([
    prisma.class.findMany({
      where: { weekday, ...(teacherId ? { teacherId } : {}) },
      select: { id: true, name: true, startTime: true, endTime: true, _count: { select: { enrollments: true } } },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'ONE_ON_ONE', status: 'APPROVED', slotDate: date, ...(teacherId ? { teacherId } : {}) },
      select: {
        id: true,
        slotStartTime: true,
        slotEndTime: true,
        leaveRequest: { select: { student: { select: NAME_SELECT } } },
      },
    }),
    prisma.goHallSession.findMany({
      where: { date, ...(teacherId ? { teacherId } : {}) },
      select: { id: true, startTime: true, endTime: true, _count: { select: { registrations: true } } },
    }),
    prisma.activity.findMany({
      where: { startDate: { lte: date }, endDate: { gte: date }, ...(teacherId ? { teachers: { some: { teacherId } } } : {}) },
      select: { id: true, title: true, _count: { select: { registrations: true } } },
    }),
  ]);

  const classRows: AttendanceSessionSummary[] = await Promise.all(
    classes.map(async (c) => ({
      type: 'CLASS' as const,
      id: c.id,
      title: c.name,
      timeLabel: `${c.startTime}-${c.endTime}`,
      markedCount: await prisma.classAttendance.count({ where: { classId: c.id, date } }),
      totalCount: c._count.enrollments,
    }))
  );

  const oneOnOneRows: AttendanceSessionSummary[] = await Promise.all(
    oneOnOnes.map(async (o) => ({
      type: 'ONE_ON_ONE' as const,
      id: o.id,
      title: `${o.leaveRequest.student.user.name}（一對一）`,
      timeLabel: `${o.slotStartTime}-${o.slotEndTime}`,
      markedCount: (await prisma.oneOnOneAttendance.count({ where: { makeupRequestId: o.id } })) > 0 ? 1 : 0,
      totalCount: 1,
    }))
  );

  const goHallRows: AttendanceSessionSummary[] = await Promise.all(
    goHallSessions.map(async (s) => ({
      type: 'GO_HALL' as const,
      id: s.id,
      title: '弈廳',
      timeLabel: `${s.startTime}-${s.endTime}`,
      markedCount: await prisma.goHallAttendance.count({ where: { sessionId: s.id } }),
      totalCount: s._count.registrations,
    }))
  );

  const activityRows: AttendanceSessionSummary[] = await Promise.all(
    activities.map(async (a) => ({
      type: 'ACTIVITY' as const,
      id: a.id,
      title: a.title,
      timeLabel: '',
      markedCount: await prisma.activityAttendance.count({ where: { activityId: a.id, date } }),
      totalCount: a._count.registrations,
    }))
  );

  return [...classRows, ...oneOnOneRows, ...goHallRows, ...activityRows];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: PASS — all tests green (11 + 3 = 14).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "$(cat <<'EOF'
feat: add cross-type attendance session listing for the point-name hub

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `attendanceService` — student history + admin stats

**Files:**
- Modify: `src/lib/services/attendanceService.ts` (append)
- Modify: `src/lib/services/attendanceService.test.ts` (append)

**Interfaces:**
- Consumes: `AttendanceStatusValue`, `AttendanceSessionType` from Tasks 2 and 6.
- Produces: `MyAttendanceRow` interface; `listMyAttendance(studentId: string): Promise<MyAttendanceRow[]>`; `AttendanceStatsResult` interface; `getAttendanceStats(filter: { studentId?: string; classId?: string; from: Date; to: Date }): Promise<AttendanceStatsResult>`. Task 12 (API `/me` and `/stats`) consumes both; Task 17 (student page) consumes `MyAttendanceRow`'s field names directly.
- Note: `getAttendanceStats` is scoped to `ClassAttendance` only — the admin requirement was specifically "查詢某學生或某班的出席率", which only makes sense for class attendance (one-on-one/Go Hall/activity have no notion of a recurring "rate").

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/services/attendanceService.test.ts`:

```ts
import { listMyAttendance, getAttendanceStats } from './attendanceService';

describe('listMyAttendance', () => {
  it('returns one row per attendance record across all four types, newest first, with a unique id', async () => {
    const { student, cls } = await setupClassWithStudent();
    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'LATE' }]);

    const rows = await listMyAttendance(student.id);

    expect(rows).toHaveLength(2);
    expect(rows[0].date.getTime()).toBeGreaterThan(rows[1].date.getTime());
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(rows[0].type).toBe('CLASS');
    expect(rows[0].title).toBe('週二基礎班');
  });
});

describe('getAttendanceStats', () => {
  it('counts each status within the date range for the given class', async () => {
    const { student, cls } = await setupClassWithStudent();
    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-18'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const stats = await getAttendanceStats({ classId: cls.id, from: new Date('2026-08-01'), to: new Date('2026-08-31') });

    expect(stats.counts.PRESENT).toBe(2);
    expect(stats.counts.ABSENT).toBe(1);
    expect(stats.counts.LATE).toBe(0);
  });

  it('excludes records outside the date range', async () => {
    const { student, cls } = await setupClassWithStudent();
    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-09-01'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const stats = await getAttendanceStats({ classId: cls.id, from: new Date('2026-08-01'), to: new Date('2026-08-31') });

    expect(stats.counts.PRESENT).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: FAIL — `listMyAttendance is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/services/attendanceService.ts`:

```ts
export interface MyAttendanceRow {
  id: string;
  type: AttendanceSessionType;
  date: Date;
  title: string;
  status: AttendanceStatusValue;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function listMyAttendance(studentId: string): Promise<MyAttendanceRow[]> {
  const [classRows, oneOnOneRows, goHallRows, activityRows] = await Promise.all([
    prisma.classAttendance.findMany({
      where: { studentId },
      select: { id: true, date: true, status: true, checkInTime: true, checkOutTime: true, class: { select: { name: true } } },
    }),
    prisma.oneOnOneAttendance.findMany({
      where: { makeupRequest: { leaveRequest: { studentId } } },
      select: {
        id: true,
        status: true,
        checkInTime: true,
        checkOutTime: true,
        makeupRequest: { select: { slotDate: true, teacher: { select: { user: { select: { name: true } } } } } },
      },
    }),
    prisma.goHallAttendance.findMany({
      where: { studentId },
      select: { id: true, status: true, checkInTime: true, checkOutTime: true, session: { select: { date: true } } },
    }),
    prisma.activityAttendance.findMany({
      where: { studentId },
      select: { id: true, date: true, status: true, checkInTime: true, checkOutTime: true, activity: { select: { title: true } } },
    }),
  ]);

  const rows: MyAttendanceRow[] = [
    ...classRows.map((r) => ({
      id: `class-${r.id}`,
      type: 'CLASS' as const,
      date: r.date,
      title: r.class.name,
      status: r.status as AttendanceStatusValue,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
    })),
    ...oneOnOneRows.map((r) => ({
      id: `one-on-one-${r.id}`,
      type: 'ONE_ON_ONE' as const,
      date: r.makeupRequest.slotDate as Date,
      title: `${r.makeupRequest.teacher?.user.name ?? ''}（一對一）`,
      status: r.status as AttendanceStatusValue,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
    })),
    ...goHallRows.map((r) => ({
      id: `go-hall-${r.id}`,
      type: 'GO_HALL' as const,
      date: r.session.date,
      title: '弈廳',
      status: r.status as AttendanceStatusValue,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
    })),
    ...activityRows.map((r) => ({
      id: `activity-${r.id}`,
      type: 'ACTIVITY' as const,
      date: r.date,
      title: r.activity.title,
      status: r.status as AttendanceStatusValue,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
    })),
  ];

  return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export interface AttendanceStatsResult {
  counts: Record<AttendanceStatusValue, number>;
}

export async function getAttendanceStats(filter: {
  studentId?: string;
  classId?: string;
  from: Date;
  to: Date;
}): Promise<AttendanceStatsResult> {
  const rows = await prisma.classAttendance.findMany({
    where: {
      date: { gte: filter.from, lte: filter.to },
      ...(filter.studentId ? { studentId: filter.studentId } : {}),
      ...(filter.classId ? { classId: filter.classId } : {}),
    },
    select: { status: true },
  });
  const counts: Record<AttendanceStatusValue, number> = { PRESENT: 0, LATE: 0, LEFT_EARLY: 0, ON_LEAVE: 0, ABSENT: 0 };
  for (const r of rows) counts[r.status as AttendanceStatusValue]++;
  return { counts };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/services/attendanceService.test.ts`
Expected: PASS — all tests green (14 + 3 = 17).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "$(cat <<'EOF'
feat: add student attendance history and admin stats aggregation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: API route — class attendance

**Files:**
- Create: `src/app/api/attendance/class/[classId]/route.ts`

**Interfaces:**
- Consumes: `getClassRoster`, `saveClassAttendance`, `getClassEnrollmentQuota` from `@/lib/services/attendanceService` (Task 2).
- Produces: `GET /api/attendance/class/:classId?date=YYYY-MM-DD` → `{ roster: ClassRosterEntry[], quotaByStudentId: Record<string, ClassAttendanceQuota> }`; `POST /api/attendance/class/:classId` body `{ date: string, records: SaveAttendanceRecordInput[] }` → `{ success: true }`. Task 15 (`AttendanceHub`) consumes both response shapes exactly.

This task has no automated test — this codebase has zero API route test files anywhere (confirmed in Global Constraints), so it's verified manually with `curl` in Step 2.

- [ ] **Step 1: Write the route**

Create `src/app/api/attendance/class/[classId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getClassRoster, saveClassAttendance, getClassEnrollmentQuota } from '@/lib/services/attendanceService';

export async function GET(req: NextRequest, { params }: { params: { classId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const cls = await prisma.class.findUniqueOrThrow({ where: { id: params.classId }, select: { teacherId: true } });
    if (cls.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  const date = new Date(dateParam);

  const roster = await getClassRoster(params.classId, date);
  const homeStudents = roster.filter((r) => r.makeupRequestId === null);
  const quotas = await Promise.all(homeStudents.map((r) => getClassEnrollmentQuota(params.classId, r.studentId)));
  const quotaByStudentId = Object.fromEntries(homeStudents.map((r, i) => [r.studentId, quotas[i]]));

  return NextResponse.json({ roster, quotaByStudentId });
}

export async function POST(req: NextRequest, { params }: { params: { classId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const cls = await prisma.class.findUniqueOrThrow({ where: { id: params.classId }, select: { teacherId: true } });
    if (cls.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  if (!body.date) return NextResponse.json({ error: 'date required' }, { status: 400 });

  await saveClassAttendance(params.classId, new Date(body.date), session.user.id, body.records);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, log in as an admin account, then in another terminal:
```bash
curl -s "http://localhost:3000/api/attendance/class/<a real classId>?date=2026-08-04" -H "Cookie: <copy the next-auth session cookie from the browser>"
```
Expected: JSON with `{ "roster": [...], "quotaByStudentId": {...} }` and no server error in the `npm run dev` terminal. (Copying the session cookie from a logged-in browser tab is the fastest way to authenticate a manual curl check in this codebase — there's no test-only bypass.)

Then repeat the same request with a session cookie from a **different teacher** (one who doesn't teach this class).
Expected: `{"error":"Forbidden"}` with status 403 — this is the ownership check from Step 1, and it has no automated test anywhere in this codebase's convention, so this manual check is the only verification it gets.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/attendance/class/
git commit -m "$(cat <<'EOF'
feat: add class attendance API route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: API route — one-on-one makeup attendance

**Files:**
- Create: `src/app/api/attendance/one-on-one/[makeupRequestId]/route.ts`

**Interfaces:**
- Consumes: `getOneOnOneAttendance`, `saveOneOnOneAttendance` from `@/lib/services/attendanceService` (Task 3).
- Produces: `GET /api/attendance/one-on-one/:makeupRequestId` → `OneOnOneRosterEntry`; `POST /api/attendance/one-on-one/:makeupRequestId` body `{ status, checkInTime?, checkOutTime? }` → `{ success: true }`. Task 15 consumes both.

- [ ] **Step 1: Write the route**

Create `src/app/api/attendance/one-on-one/[makeupRequestId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getOneOnOneAttendance, saveOneOnOneAttendance } from '@/lib/services/attendanceService';

export async function GET(_req: NextRequest, { params }: { params: { makeupRequestId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const makeupRequest = await prisma.makeupRequest.findUniqueOrThrow({
      where: { id: params.makeupRequestId },
      select: { teacherId: true },
    });
    if (makeupRequest.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getOneOnOneAttendance(params.makeupRequestId));
}

export async function POST(req: NextRequest, { params }: { params: { makeupRequestId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const makeupRequest = await prisma.makeupRequest.findUniqueOrThrow({
      where: { id: params.makeupRequestId },
      select: { teacherId: true },
    });
    if (makeupRequest.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  await saveOneOnOneAttendance(params.makeupRequestId, session.user.id, {
    status: body.status,
    checkInTime: body.checkInTime,
    checkOutTime: body.checkOutTime,
  });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, then with a logged-in session cookie:
```bash
curl -s "http://localhost:3000/api/attendance/one-on-one/<a real makeupRequestId>" -H "Cookie: <session cookie>"
```
Expected: JSON with `studentId`/`studentName`/`status: null` and no server error.

Then repeat with a session cookie from a teacher who isn't `makeupRequest.teacherId` for this request.
Expected: `{"error":"Forbidden"}` with status 403.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/attendance/one-on-one/
git commit -m "$(cat <<'EOF'
feat: add one-on-one makeup attendance API route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: API route — Go Hall attendance

**Files:**
- Create: `src/app/api/attendance/go-hall/[sessionId]/route.ts`

**Interfaces:**
- Consumes: `getGoHallRoster`, `saveGoHallAttendance` from `@/lib/services/attendanceService` (Task 4).
- Produces: `GET /api/attendance/go-hall/:sessionId` → `GoHallRosterEntry[]`; `POST /api/attendance/go-hall/:sessionId` body `{ records: SaveAttendanceRecordInput[] }` → `{ success: true }`. Task 15 consumes both.

- [ ] **Step 1: Write the route**

Create `src/app/api/attendance/go-hall/[sessionId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getGoHallRoster, saveGoHallAttendance } from '@/lib/services/attendanceService';

export async function GET(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const goHallSession = await prisma.goHallSession.findUniqueOrThrow({
      where: { id: params.sessionId },
      select: { teacherId: true },
    });
    if (goHallSession.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await getGoHallRoster(params.sessionId));
}

export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const goHallSession = await prisma.goHallSession.findUniqueOrThrow({
      where: { id: params.sessionId },
      select: { teacherId: true },
    });
    if (goHallSession.teacherId !== teacher.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  await saveGoHallAttendance(params.sessionId, session.user.id, body.records);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, then with a logged-in session cookie:
```bash
curl -s "http://localhost:3000/api/attendance/go-hall/<a real sessionId>" -H "Cookie: <session cookie>"
```
Expected: JSON array (empty or with roster entries) and no server error.

Then repeat with a session cookie from a teacher who isn't `goHallSession.teacherId` for this session.
Expected: `{"error":"Forbidden"}` with status 403.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/attendance/go-hall/
git commit -m "$(cat <<'EOF'
feat: add Go Hall attendance API route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: API route — activity attendance

**Files:**
- Create: `src/app/api/attendance/activity/[activityId]/route.ts`

**Interfaces:**
- Consumes: `getActivityRoster`, `saveActivityAttendance` from `@/lib/services/attendanceService` (Task 5).
- Produces: `GET /api/attendance/activity/:activityId?date=YYYY-MM-DD` → `ActivityRosterEntry[]`; `POST /api/attendance/activity/:activityId` body `{ date: string, records: SaveAttendanceRecordInput[] }` → `{ success: true }`. Task 15 consumes both.

- [ ] **Step 1: Write the route**

Create `src/app/api/attendance/activity/[activityId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getActivityRoster, saveActivityAttendance } from '@/lib/services/attendanceService';

export async function GET(req: NextRequest, { params }: { params: { activityId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const isAssigned = await prisma.activityTeacher.findFirst({
      where: { activityId: params.activityId, teacherId: teacher.id },
    });
    if (!isAssigned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  return NextResponse.json(await getActivityRoster(params.activityId, new Date(dateParam)));
}

export async function POST(req: NextRequest, { params }: { params: { activityId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    const isAssigned = await prisma.activityTeacher.findFirst({
      where: { activityId: params.activityId, teacherId: teacher.id },
    });
    if (!isAssigned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  if (!body.date) return NextResponse.json({ error: 'date required' }, { status: 400 });
  await saveActivityAttendance(params.activityId, new Date(body.date), session.user.id, body.records);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, then with a logged-in session cookie:
```bash
curl -s "http://localhost:3000/api/attendance/activity/<a real activityId>?date=2026-08-01" -H "Cookie: <session cookie>"
```
Expected: JSON array and no server error.

Then repeat with a session cookie from a teacher who isn't assigned to this activity via `ActivityTeacher`.
Expected: `{"error":"Forbidden"}` with status 403.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/attendance/activity/
git commit -m "$(cat <<'EOF'
feat: add activity attendance API route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: API routes — sessions hub, my history, stats

**Files:**
- Create: `src/app/api/attendance/sessions/route.ts`
- Create: `src/app/api/attendance/me/route.ts`
- Create: `src/app/api/attendance/stats/route.ts`

**Interfaces:**
- Consumes: `listAttendanceSessionsForDate` (Task 6), `listMyAttendance` and `getAttendanceStats` (Task 7).
- Produces: `GET /api/attendance/sessions?date=` → `AttendanceSessionSummary[]`; `GET /api/attendance/me` → `MyAttendanceRow[]`; `GET /api/attendance/stats?from=&to=&studentId=&classId=` → `AttendanceStatsResult`. Task 15 consumes `/sessions`; Task 17 consumes `/me`; Task 15's stats panel consumes `/stats`.

- [ ] **Step 1: Write the three routes**

Create `src/app/api/attendance/sessions/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listAttendanceSessionsForDate } from '@/lib/services/attendanceService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'TEACHER')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const dateParam = req.nextUrl.searchParams.get('date');
  if (!dateParam) return NextResponse.json({ error: 'date required' }, { status: 400 });
  const date = new Date(dateParam);

  let teacherId: string | null = null;
  if (session.user.role === 'TEACHER') {
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
    teacherId = teacher.id;
  }
  return NextResponse.json(await listAttendanceSessionsForDate(date, teacherId));
}
```

Create `src/app/api/attendance/me/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listMyAttendance } from '@/lib/services/attendanceService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  return NextResponse.json(await listMyAttendance(student.id));
}
```

Create `src/app/api/attendance/stats/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAttendanceStats } from '@/lib/services/attendanceService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const params = req.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 });

  const stats = await getAttendanceStats({
    studentId: params.get('studentId') ?? undefined,
    classId: params.get('classId') ?? undefined,
    from: new Date(from),
    to: new Date(to),
  });
  return NextResponse.json(stats);
}
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`, then with a logged-in admin session cookie:
```bash
curl -s "http://localhost:3000/api/attendance/sessions?date=2026-08-04" -H "Cookie: <session cookie>"
curl -s "http://localhost:3000/api/attendance/stats?from=2026-08-01&to=2026-08-31" -H "Cookie: <session cookie>"
```
And with a logged-in student session cookie:
```bash
curl -s "http://localhost:3000/api/attendance/me" -H "Cookie: <student session cookie>"
```
Expected: all three return JSON (arrays or `{"counts": {...}}`) with no server error.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/attendance/sessions/ src/app/api/attendance/me/ src/app/api/attendance/stats/
git commit -m "$(cat <<'EOF'
feat: add attendance sessions hub, my-history, and stats API routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: `StatusBadge` attendance statuses + nav entries

**Files:**
- Modify: `src/components/ui/StatusBadge.tsx`
- Modify: `src/components/ui/AppShell.tsx`

**Interfaces:**
- Produces: `StatusBadge` now renders the 5 attendance statuses with a label + color; `NAV_LINKS` gains `點名` (ADMIN, TEACHER) and `我的出席紀錄` (STUDENT) entries. Tasks 15–17 rely on these routes existing in the nav and on `<StatusBadge status="PRESENT" />` etc. rendering a real label.

This task has no automated test — `StatusBadge.test.ts` (existing) only covers the status→config mapping function, and this codebase has no component-render tests. Verified manually in Task 17's browser check.

- [ ] **Step 1: Extend `StatusBadge`'s known statuses**

Edit `src/components/ui/StatusBadge.tsx`:

```ts
export type KnownStatus =
  | 'APPROVED'
  | 'PENDING_ADMIN'
  | 'PENDING_ASSIGNMENT'
  | 'REJECTED'
  | 'ASSIGNED'
  | 'PRESENT'
  | 'LATE'
  | 'LEFT_EARLY'
  | 'ON_LEAVE'
  | 'ABSENT';

interface StatusConfig {
  label: string;
  bg: string;
  text: string;
}

const STATUS_CONFIG: Record<KnownStatus, StatusConfig> = {
  APPROVED: { label: '已核准', bg: 'bg-approvedBg', text: 'text-approved' },
  PENDING_ADMIN: { label: '待確認', bg: 'bg-pendingBg', text: 'text-pending' },
  PENDING_ASSIGNMENT: { label: '待確認', bg: 'bg-pendingBg', text: 'text-pending' },
  REJECTED: { label: '已拒絕', bg: 'bg-rejectedBg', text: 'text-rejected' },
  ASSIGNED: { label: '已指派', bg: 'bg-assignedBg', text: 'text-assigned' },
  PRESENT: { label: '出席', bg: 'bg-approvedBg', text: 'text-approved' },
  LATE: { label: '遲到', bg: 'bg-pendingBg', text: 'text-pending' },
  LEFT_EARLY: { label: '早退', bg: 'bg-pendingBg', text: 'text-pending' },
  ON_LEAVE: { label: '請假', bg: 'bg-assignedBg', text: 'text-assigned' },
  ABSENT: { label: '缺席未請假', bg: 'bg-rejectedBg', text: 'text-rejected' },
};
```

(The rest of the file — `getStatusBadgeConfig` and the default `StatusBadge` component — is unchanged.)

- [ ] **Step 2: Add nav entries**

Edit `src/components/ui/AppShell.tsx`'s `NAV_LINKS`:

```ts
const NAV_LINKS: Record<Role, { href: string; label: string; exact?: boolean }[]> = {
  ADMIN: [
    { href: '/admin', label: '首頁', exact: true },
    { href: '/admin/teachers', label: '老師名單' },
    { href: '/admin/students', label: '學生名單' },
    { href: '/admin/classes', label: '班級名單' },
    { href: '/admin/makeup-requests', label: '補課申請' },
    { href: '/admin/substitute-requests', label: '代課安排' },
    { href: '/admin/attendance', label: '點名' },
    { href: '/admin/go-hall', label: '弈廳' },
    { href: '/admin/activities', label: '活動專區' },
  ],
  TEACHER: [
    { href: '/teacher', label: '首頁', exact: true },
    { href: '/teacher/leave-request', label: '請假/調課申請' },
    { href: '/teacher/availability', label: '設定可補課時段' },
    { href: '/teacher/attendance', label: '點名' },
    { href: '/teacher/activities', label: '活動專區' },
  ],
  STUDENT: [
    { href: '/student', label: '首頁', exact: true },
    { href: '/student/leave-request', label: '請假申請' },
    { href: '/student/makeup-request', label: '補課申請' },
    { href: '/student/go-hall', label: '弈廳' },
    { href: '/student/attendance', label: '我的出席紀錄' },
    { href: '/student/activities', label: '活動專區' },
  ],
};
```

(Everything else in the file — `HOME_HREF`, the component body — is unchanged.)

- [ ] **Step 3: Run the existing test suite to confirm nothing broke**

Run: `npx vitest run src/components/ui/StatusBadge.test.ts`
Expected: PASS (existing tests for the pre-existing statuses are untouched).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/StatusBadge.tsx src/components/ui/AppShell.tsx
git commit -m "$(cat <<'EOF'
feat: add attendance status badges and 點名 nav entries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: `AttendanceRosterEditor` shared component

**Files:**
- Create: `src/components/AttendanceRosterEditor.tsx`

**Interfaces:**
- Consumes: `Button`, `Input` from `src/components/ui/`.
- Produces: `AttendanceStatusValue` type (re-declared here as a UI-local type — it's a plain string union, not imported from the service layer, since client components don't import server-only service files); `RosterRow` interface (`key`, `studentId`, `studentName`, `status`, `checkInTime`, `checkOutTime`, `defaultOnLeave?`, `quotaLabel?`); default-exported `AttendanceRosterEditor({ rows, onSave })` component. Task 15's `AttendanceHub` is the sole consumer — it builds `RosterRow[]` from each of the four roster API shapes and passes an `onSave` callback that POSTs to the right endpoint.

This is a pure UI component with no automated test — matches this codebase's established convention (zero `*.test.tsx` files exist; component behavior is verified by hand in the browser). It's verified in Task 15's manual browser check, since it has no meaningful behavior in isolation from a real roster response.

- [ ] **Step 1: Write the component**

Create `src/components/AttendanceRosterEditor.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

export type AttendanceStatusValue = 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT';

const STATUS_OPTIONS: { value: AttendanceStatusValue; label: string }[] = [
  { value: 'PRESENT', label: '出席' },
  { value: 'LATE', label: '遲到' },
  { value: 'LEFT_EARLY', label: '早退' },
  { value: 'ON_LEAVE', label: '請假' },
  { value: 'ABSENT', label: '缺席未請假' },
];

export interface RosterRow {
  key: string;
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  defaultOnLeave?: boolean;
  quotaLabel?: string;
}

export interface SavedRecord {
  studentId: string;
  key: string;
  status: AttendanceStatusValue;
  checkInTime?: string;
  checkOutTime?: string;
}

interface Props {
  rows: RosterRow[];
  onSave: (records: SavedRecord[]) => Promise<void>;
}

export default function AttendanceRosterEditor({ rows, onSave }: Props) {
  const [edits, setEdits] = useState<Record<string, { status: AttendanceStatusValue; checkInTime: string; checkOutTime: string }>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.key,
        {
          status: r.status ?? (r.defaultOnLeave ? 'ON_LEAVE' : 'PRESENT'),
          checkInTime: r.checkInTime ?? '',
          checkOutTime: r.checkOutTime ?? '',
        },
      ])
    )
  );
  const [saving, setSaving] = useState(false);

  function updateStatus(key: string, status: AttendanceStatusValue) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], status } }));
  }
  function updateTime(key: string, field: 'checkInTime' | 'checkOutTime', value: string) {
    setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(
        rows.map((r) => ({
          studentId: r.studentId,
          key: r.key,
          status: edits[r.key].status,
          checkInTime: edits[r.key].checkInTime || undefined,
          checkOutTime: edits[r.key].checkOutTime || undefined,
        }))
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="text-sm text-inkMuted">名單是空的</p>
      ) : (
        rows.map((r) => (
          <div key={r.key} className="flex flex-col gap-2 rounded-lg border border-borderSubtle p-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">{r.studentName}</span>
              {r.quotaLabel && <span className="text-xs text-inkMuted">{r.quotaLabel}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateStatus(r.key, opt.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    edits[r.key].status === opt.value
                      ? 'bg-brand text-brandInk'
                      : 'border border-borderStrong text-inkMuted hover:bg-stripe'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="簽到時間"
                value={edits[r.key].checkInTime}
                onChange={(e) => updateTime(r.key, 'checkInTime', e.target.value)}
                className="w-28"
              />
              <Input
                placeholder="簽退時間"
                value={edits[r.key].checkOutTime}
                onChange={(e) => updateTime(r.key, 'checkOutTime', e.target.value)}
                className="w-28"
              />
            </div>
          </div>
        ))
      )}
      {rows.length > 0 && (
        <Button onClick={handleSave} loading={saving}>
          儲存點名
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run the TypeScript build to catch compile errors**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this file.

- [ ] **Step 3: Commit**

```bash
git add src/components/AttendanceRosterEditor.tsx
git commit -m "$(cat <<'EOF'
feat: add shared attendance roster editor component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: `AttendanceHub` component + admin attendance page

**Files:**
- Create: `src/components/AttendanceHub.tsx`
- Create: `src/app/admin/attendance/page.tsx`

**Interfaces:**
- Consumes: `GET /api/attendance/sessions`, `GET/POST /api/attendance/class/:id`, `GET/POST /api/attendance/one-on-one/:id`, `GET/POST /api/attendance/go-hall/:id`, `GET/POST /api/attendance/activity/:id`, `GET /api/classes`, `GET /api/students`, `GET /api/attendance/stats` (Tasks 8–12); `AttendanceRosterEditor`, `RosterRow` (Task 14); `Card`, `DataTable`, `Modal`, `Input`, `Select`, `Button`, `useToast` from `src/components/ui/`.
- Produces: `todayDateInput()` helper and default-exported `AttendanceHub({ hideDatePicker?: boolean })` component. Task 16 (teacher page + teacher dashboard) imports both.

This is a pure UI page/component with no automated test, per this codebase's established convention — verified manually in Step 2 below.

- [ ] **Step 1: Write `AttendanceHub`**

Create `src/components/AttendanceHub.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import AttendanceRosterEditor, { RosterRow, SavedRecord } from '@/components/AttendanceRosterEditor';

type SessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY';

interface SessionSummary {
  type: SessionType;
  id: string;
  title: string;
  timeLabel: string;
  markedCount: number;
  totalCount: number;
}

const TYPE_LABEL: Record<SessionType, string> = {
  CLASS: '班級',
  ONE_ON_ONE: '一對一補課',
  GO_HALL: '弈廳',
  ACTIVITY: '活動',
};

export function todayDateInput() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function apiPathFor(type: SessionType, id: string) {
  if (type === 'CLASS') return `/api/attendance/class/${id}`;
  if (type === 'ONE_ON_ONE') return `/api/attendance/one-on-one/${id}`;
  if (type === 'GO_HALL') return `/api/attendance/go-hall/${id}`;
  return `/api/attendance/activity/${id}`;
}

export default function AttendanceHub({ hideDatePicker = false }: { hideDatePicker?: boolean }) {
  const [date, setDate] = useState(todayDateInput());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<SessionSummary | null>(null);
  const [rosterRows, setRosterRows] = useState<RosterRow[] | null>(null);
  const { showToast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/attendance/sessions?date=${date}`);
      setSessions(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function openSession(s: SessionSummary) {
    setOpening(s);
    if (s.type === 'CLASS') {
      const res = await fetch(`/api/attendance/class/${s.id}?date=${date}`);
      const { roster, quotaByStudentId } = await res.json();
      setRosterRows(
        roster.map((r: any) => ({
          key: r.makeupRequestId ?? r.studentId,
          studentId: r.studentId,
          studentName: r.studentName + (r.makeupRequestId ? '（插班）' : ''),
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          defaultOnLeave: r.onLeave,
          quotaLabel:
            !r.makeupRequestId && quotaByStudentId[r.studentId]?.totalSessions != null
              ? `已上 ${quotaByStudentId[r.studentId].usedSessions}／共 ${quotaByStudentId[r.studentId].totalSessions} 堂`
              : undefined,
        }))
      );
    } else if (s.type === 'ONE_ON_ONE') {
      const res = await fetch(`/api/attendance/one-on-one/${s.id}`);
      const r = await res.json();
      setRosterRows([
        {
          key: r.makeupRequestId,
          studentId: r.studentId,
          studentName: r.studentName,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
        },
      ]);
    } else if (s.type === 'GO_HALL') {
      const res = await fetch(`/api/attendance/go-hall/${s.id}`);
      const roster = await res.json();
      setRosterRows(
        roster.map((r: any) => ({
          key: r.studentId,
          studentId: r.studentId,
          studentName: r.studentName,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
        }))
      );
    } else {
      const res = await fetch(`/api/attendance/activity/${s.id}?date=${date}`);
      const roster = await res.json();
      setRosterRows(
        roster.map((r: any) => ({
          key: r.studentId,
          studentId: r.studentId,
          studentName: r.studentName,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
        }))
      );
    }
  }

  async function handleSaveRoster(records: SavedRecord[]) {
    if (!opening) return;
    const path = apiPathFor(opening.type, opening.id);
    const body =
      opening.type === 'ONE_ON_ONE'
        ? records[0]
        : {
            date,
            records: records.map((r) => ({
              studentId: r.studentId,
              status: r.status,
              checkInTime: r.checkInTime,
              checkOutTime: r.checkOutTime,
              ...(opening.type === 'CLASS' && r.key !== r.studentId ? { makeupRequestId: r.key } : {}),
            })),
          };
    await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    showToast('點名已儲存');
    setOpening(null);
    setRosterRows(null);
    load();
  }

  const columns: Column<SessionSummary>[] = [
    { header: '類型', render: (s) => TYPE_LABEL[s.type] },
    { header: '名稱', render: (s) => s.title },
    { header: '時間', render: (s) => s.timeLabel || '-' },
    { header: '點名進度', render: (s) => `${s.markedCount}/${s.totalCount}` },
  ];

  return (
    <>
      {!hideDatePicker && (
        <div className="mb-4">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      )}
      <Card>
        <DataTable
          columns={columns}
          rows={sessions}
          loading={loading}
          keyField={(s) => `${s.type}-${s.id}`}
          onRowClick={openSession}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal
        open={opening !== null}
        onClose={() => {
          setOpening(null);
          setRosterRows(null);
        }}
        title={opening ? `${TYPE_LABEL[opening.type]}點名 - ${opening.title}` : ''}
        maxWidthClassName="max-w-2xl"
      >
        {rosterRows && <AttendanceRosterEditor rows={rosterRows} onSave={handleSaveRoster} />}
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Write the admin attendance page with a stats tab**

Create `src/app/admin/attendance/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Select from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import AttendanceHub, { todayDateInput } from '@/components/AttendanceHub';

interface ClassOption {
  id: string;
  name: string;
}

interface StudentOption {
  id: string;
  user: { name: string };
}

const STATUS_LABELS: { key: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT'; label: string }[] = [
  { key: 'PRESENT', label: '出席' },
  { key: 'LATE', label: '遲到' },
  { key: 'LEFT_EARLY', label: '早退' },
  { key: 'ON_LEAVE', label: '請假' },
  { key: 'ABSENT', label: '缺席未請假' },
];

function AttendanceStatsPanel() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [from, setFrom] = useState(todayDateInput());
  const [to, setTo] = useState(todayDateInput());
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    fetch('/api/classes')
      .then((r) => r.json())
      .then(setClasses);
    fetch('/api/students')
      .then((r) => r.json())
      .then(setStudents);
  }, []);

  async function runQuery() {
    const params = new URLSearchParams({ from, to });
    if (studentId) params.set('studentId', studentId);
    if (classId) params.set('classId', classId);
    const res = await fetch(`/api/attendance/stats?${params.toString()}`);
    const data = await res.json();
    setCounts(data.counts);
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">全部學生</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.user.name}
            </option>
          ))}
        </Select>
        <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">全部班級</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button onClick={runQuery}>查詢</Button>
      </div>
      {counts && (
        <ul className="flex flex-col gap-1 text-sm text-ink">
          {STATUS_LABELS.map(({ key, label }) => (
            <li key={key}>
              {label}：{counts[key]}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AdminAttendancePage() {
  const [tab, setTab] = useState<'roll' | 'stats'>('roll');

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">點名</h1>
      <div className="mb-4 flex gap-2">
        <Button variant={tab === 'roll' ? 'primary' : 'secondary'} onClick={() => setTab('roll')}>
          點名總覽
        </Button>
        <Button variant={tab === 'stats' ? 'primary' : 'secondary'} onClick={() => setTab('stats')}>
          統計
        </Button>
      </div>
      {tab === 'roll' ? <AttendanceHub /> : <AttendanceStatsPanel />}
    </>
  );
}
```

- [ ] **Step 3: Verify manually in the browser**

Run: `npm run dev`, log in as an admin, open `http://localhost:3000/admin/attendance`.

Check:
- The date picker defaults to today; changing it reloads the session list.
- A class scheduled on the selected weekday appears with `0/N` marked, click it, the roster modal opens with all enrolled students defaulted to 出席 (or 請假 if they have an approved leave that date).
- Pick a few statuses, fill a check-in time, click 儲存點名 — the toast "點名已儲存" appears, the modal closes, and the list's marked count updates.
- Re-open the same class — the previously-saved statuses are shown, not reset.
- Switch to the 統計 tab, pick a class and a date range, click 查詢 — the counts render.

- [ ] **Step 4: Commit**

```bash
git add src/components/AttendanceHub.tsx src/app/admin/attendance/
git commit -m "$(cat <<'EOF'
feat: add admin point-name hub with roll-call and stats tabs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Teacher attendance page + teacher dashboard entries

**Files:**
- Create: `src/app/teacher/attendance/page.tsx`
- Modify: `src/app/teacher/page.tsx`

**Interfaces:**
- Consumes: `AttendanceHub` (Task 15).
- Produces: `/teacher/attendance` route; teacher dashboard gains a "點名" shortcut card and a "今日點名" section.

No automated test — verified manually in Step 3.

- [ ] **Step 1: Write the teacher attendance page**

Create `src/app/teacher/attendance/page.tsx`:

```tsx
import AttendanceHub from '@/components/AttendanceHub';

export default function TeacherAttendancePage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">點名</h1>
      <AttendanceHub />
    </>
  );
}
```

- [ ] **Step 2: Add the dashboard shortcut card and today's-sessions section**

Edit `src/app/teacher/page.tsx`. First, add the import at the top alongside the other component imports:

```tsx
import AttendanceHub from '@/components/AttendanceHub';
```

Then change the existing shortcut-card grid from `sm:grid-cols-2` to `sm:grid-cols-3` and add the third card:

```tsx
<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
  <Link href="/teacher/leave-request">
    <Card className="text-ink transition-shadow hover:shadow-md">請假/調課申請</Card>
  </Link>
  <Link href="/teacher/availability">
    <Card className="text-ink transition-shadow hover:shadow-md">設定可補課時段</Card>
  </Link>
  <Link href="/teacher/attendance">
    <Card className="text-ink transition-shadow hover:shadow-md">點名</Card>
  </Link>
</div>
```

Finally, add a new section right after the closing `</Card>` of the existing "被指派代課" block (before "學生請假紀錄"):

```tsx
<h2 className="mb-2 font-bold text-ink">今日點名</h2>
<div className="mb-6">
  <AttendanceHub hideDatePicker />
</div>
```

- [ ] **Step 3: Verify manually in the browser**

Run: `npm run dev`, log in as a teacher who has at least one class scheduled today.

Check:
- `/teacher` dashboard shows a "點名" shortcut card and, further down, "今日點名" with today's sessions for this teacher only (not other teachers' classes).
- Clicking a row opens the roster modal directly from the dashboard, without navigating away.
- `/teacher/attendance` shows the same session list with a date picker, and a different teacher's classes never appear regardless of the selected date.

- [ ] **Step 4: Commit**

```bash
git add src/app/teacher/attendance/ src/app/teacher/page.tsx
git commit -m "$(cat <<'EOF'
feat: add teacher point-name page and dashboard quick-access entries

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Student attendance history page + dashboard shortcut

**Files:**
- Create: `src/app/student/attendance/page.tsx`
- Modify: `src/app/student/page.tsx`

**Interfaces:**
- Consumes: `GET /api/attendance/me` (Task 12); `Card`, `DataTable`, `StatusBadge` from `src/components/ui/`; `formatDateWithWeekday` from `@/lib/dateFormat`.
- Produces: `/student/attendance` route; student dashboard gains a "我的出席紀錄" shortcut card.

No automated test — verified manually in Step 3.

- [ ] **Step 1: Write the student attendance page**

Create `src/app/student/attendance/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateWithWeekday } from '@/lib/dateFormat';

type SessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY';

interface MyAttendanceRow {
  id: string;
  type: SessionType;
  date: string;
  title: string;
  status: string;
  checkInTime: string | null;
  checkOutTime: string | null;
}

const TYPE_LABEL: Record<SessionType, string> = {
  CLASS: '班級',
  ONE_ON_ONE: '一對一補課',
  GO_HALL: '弈廳',
  ACTIVITY: '活動',
};

export default function StudentAttendancePage() {
  const [rows, setRows] = useState<MyAttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/attendance/me')
      .then((res) => res.json())
      .then(setRows)
      .finally(() => setLoading(false));
  }, []);

  const columns: Column<MyAttendanceRow>[] = [
    { header: '類型', render: (r) => TYPE_LABEL[r.type] },
    { header: '名稱', render: (r) => r.title },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW') },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
    { header: '簽到', render: (r) => r.checkInTime ?? '-' },
    { header: '簽退', render: (r) => r.checkOutTime ?? '-' },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">我的出席紀錄</h1>
      <Card>
        <DataTable columns={columns} rows={rows} loading={loading} keyField={(r) => r.id} />
      </Card>
    </>
  );
}
```

- [ ] **Step 2: Add the dashboard shortcut card**

Edit `src/app/student/page.tsx`. Change the existing shortcut-card grid from `sm:grid-cols-2` to `sm:grid-cols-3` and add a third card:

```tsx
<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
  <Link href="/student/leave-request">
    <Card className="text-ink transition-shadow hover:shadow-md">請假申請與紀錄</Card>
  </Link>
  <Link href="/student/makeup-request">
    <Card className="text-ink transition-shadow hover:shadow-md">申請補課</Card>
  </Link>
  <Link href="/student/attendance">
    <Card className="text-ink transition-shadow hover:shadow-md">我的出席紀錄</Card>
  </Link>
</div>
```

- [ ] **Step 3: Verify manually in the browser end-to-end**

Run: `npm run dev`. As an admin or teacher, take attendance for a class that a test student is enrolled in (mark one student `PRESENT` with a check-in time). Then log in as that student.

Check:
- `/student` dashboard shows a "我的出席紀錄" shortcut card.
- `/student/attendance` lists the just-marked record with the correct type (班級), class name, date, `出席` badge, and check-in time.
- The record does **not** appear for a different student who wasn't marked.

- [ ] **Step 4: Commit**

```bash
git add src/app/student/attendance/ src/app/student/page.tsx
git commit -m "$(cat <<'EOF'
feat: add student attendance history page and dashboard shortcut

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---
