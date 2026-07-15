# 補習班補課/調課系統 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js web app for a small single-branch tutoring center that digitizes student leave requests, two types of makeup-class requests (class insertion and one-on-one), and teacher leave/substitute assignment — replacing the current LINE-group-based process.

**Architecture:** Single Next.js (App Router, TypeScript) project. Business logic lives in framework-agnostic service modules under `src/lib/services/`; API route handlers under `src/app/api/**/route.ts` are thin wrappers that call services; pages under `src/app/**/page.tsx` render role-specific UI. SQLite via Prisma is the only datastore. NextAuth (Credentials provider) handles login; a middleware guards routes by role stored in the session JWT.

**Tech Stack:** Next.js 14 (App Router) + TypeScript, Prisma ORM + SQLite, NextAuth v4 (Credentials provider, JWT session), Tailwind CSS, bcryptjs, Vitest for tests.

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-07-14-tutoring-makeup-system-design.md`
- No full scheduling engine — classes/teachers/students are simple manually-maintained records, no per-day session rows except the exception entities (LeaveRequest, MakeupRequest, SubstituteRequest).
- No class-capacity enforcement — display headcount only, never block on it.
- No push notifications (LINE/Email) — users see status only after logging in.
- Single branch only — no multi-tenant/branch fields anywhere.
- "季" (quarter) = calendar quarter: Q1 Jan-Mar, Q2 Apr-Jun, Q3 Jul-Sep, Q4 Oct-Dec. One-on-one makeup quota = 1 per student per quarter, counted against requests with status `PENDING_ADMIN` or `APPROVED` (rejected requests free the quota).
- One-on-one makeup request goes straight to `PENDING_ADMIN` on submission — there is no separate teacher-approval step; the teacher's only input is maintaining their own weekly `TeacherAvailability` windows in advance.
- One-on-one slot must fall entirely within one of the chosen teacher's weekly availability windows, and must not overlap another `PENDING_ADMIN`/`APPROVED` one-on-one request for that same teacher.
- **Amended after Task 2:** `npm install prisma @prisma/client` resolved to Prisma 7.8.0, which requires an explicit driver adapter for SQLite (a bare `new PrismaClient()` throws). The project uses `@prisma/adapter-better-sqlite3` + `better-sqlite3`, wired through `prisma.config.ts` and `src/lib/db.ts` (see Task 5). Every later task still imports `prisma` from `@/lib/db` exactly as originally planned — this only changes how that one file constructs the client.
- **Amended after Task 6 review:** never query a `User` relation with `include: { user: true }` (or nested equivalents) — that leaks the bcrypt password hash into API responses. Always `select` only safe fields (`{ name: true, email: true }`, conventionally named `SAFE_USER_SELECT`) instead. This applies to Tasks 6, 7, 8, 11, 14 (all updated in this doc); Task 9's `leaveRequestService` never included `user` in the first place.
- **Amended after Task 8:** `vitest.config.ts` must set `fileParallelism: false` (see Task 1). All service test files share one physical SQLite file (`prisma/test.db`) with destructive `beforeEach` cleanup on overlapping tables — running test files in parallel (Vitest's default) races those cleanups and produces nondeterministic failures.
- Three roles share one login mechanism: `ADMIN`, `TEACHER`, `STUDENT`.

---

## File Structure Overview

```
prisma/
  schema.prisma
  seed.ts
src/
  lib/
    db.ts                          # Prisma client singleton
    auth.ts                        # NextAuth options
    quarter.ts                     # pure date/quarter helpers
    quarter.test.ts
    timeSlot.ts                    # pure time-window helpers
    timeSlot.test.ts
    services/
      teacherService.ts
      teacherService.test.ts
      studentService.ts
      studentService.test.ts
      classService.ts
      classService.test.ts
      leaveRequestService.ts
      leaveRequestService.test.ts
      availabilityService.ts
      availabilityService.test.ts
      makeupRequestService.ts
      makeupRequestService.test.ts
      substituteRequestService.ts
      substituteRequestService.test.ts
  middleware.ts
  app/
    login/page.tsx
    api/
      auth/[...nextauth]/route.ts
      teachers/route.ts
      students/route.ts
      classes/route.ts
      classes/[id]/enrollments/route.ts
      leave-requests/route.ts
      availability/route.ts
      makeup-requests/route.ts
      makeup-requests/[id]/route.ts
      substitute-requests/route.ts
      substitute-requests/[id]/route.ts
    admin/
      page.tsx
      teachers/page.tsx
      students/page.tsx
      classes/page.tsx
      makeup-requests/page.tsx
      substitute-requests/page.tsx
    teacher/
      page.tsx
      availability/page.tsx
      leave-request/page.tsx
    student/
      page.tsx
      leave-request/page.tsx
      makeup-request/page.tsx
vitest.config.ts
vitest.setup.ts
```

---

### Task 1: Project scaffold & tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.js`
- Create: `vitest.config.ts`, `vitest.setup.ts`
- Create: `src/app/layout.tsx`, `src/app/page.tsx` (temporary placeholder)

**Interfaces:**
- Produces: an npm project with `npm run dev`, `npm run build`, `npm test` all working.

- [ ] **Step 1: Scaffold Next.js app**

```bash
npx create-next-app@14 . --typescript --tailwind --app --src-dir --import-alias "@/*" --eslint --use-npm
```

When prompted, accept defaults (no `src/app/api` conflicts since directory is empty).

- [ ] **Step 2: Install remaining dependencies**

```bash
npm install prisma @prisma/client next-auth bcryptjs
npm install -D vitest tsx @types/bcryptjs vite-tsconfig-paths dotenv
```

- [ ] **Step 3: Add Vitest config**

> **Amended after Task 8:** every service test file shares one physical SQLite file (`prisma/test.db`) and each does destructive `deleteMany()` cleanup in `beforeEach` on overlapping tables. Vitest's default parallel file execution races these cleanups against each other, causing nondeterministic failures (confirmed: repeated runs failed a different number of tests each time). `fileParallelism: false` forces test files to run sequentially, eliminating the race — required given the shared-database design, not optional.

`vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
  },
});
```

`vitest.setup.ts`:
```typescript
process.env.DATABASE_URL = 'file:./prisma/test.db';
```

- [ ] **Step 4: Add npm scripts**

Edit `package.json` `scripts` section to include:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "npm run test:dbpush && vitest run",
    "test:dbpush": "cross-env DATABASE_URL=file:./prisma/test.db npx prisma db push --skip-generate",
    "seed": "tsx prisma/seed.ts"
  }
}
```

Also run `npm install -D cross-env`.

- [ ] **Step 5: Verify dev server boots**

Run: `npm run build`
Expected: build completes with no errors (default Next.js starter page).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project with Prisma, NextAuth, Vitest"
```

---

### Task 2: Prisma schema, migration, seed script

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`
- Modify: `.env` (add `DATABASE_URL="file:./prisma/dev.db"`)

**Interfaces:**
- Produces: Prisma models `User`, `Teacher`, `Student`, `Class`, `ClassEnrollment`, `TeacherAvailability`, `LeaveRequest`, `MakeupRequest`, `SubstituteRequest`, and enums `Role`, `MakeupType`, `MakeupStatus`, `SubstituteStatus`, `LeaveStatus` — every later task's Prisma queries depend on these exact field names.

- [ ] **Step 1: Write the schema**

`prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
}

enum Role {
  ADMIN
  TEACHER
  STUDENT
}

enum LeaveStatus {
  APPROVED
}

enum MakeupType {
  INSERTION
  ONE_ON_ONE
}

enum MakeupStatus {
  PENDING_ADMIN
  APPROVED
  REJECTED
}

enum SubstituteStatus {
  PENDING_ASSIGNMENT
  ASSIGNED
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String
  name      String
  role      Role
  createdAt DateTime @default(now())
  teacher   Teacher?
  student   Student?
}

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
}

model Student {
  id            String            @id @default(cuid())
  userId        String            @unique
  user          User              @relation(fields: [userId], references: [id])
  parentPhone   String?
  enrollments   ClassEnrollment[]
  leaveRequests LeaveRequest[]
}

model Class {
  id              String              @id @default(cuid())
  name            String
  subject         String
  level           String
  teacherId       String
  teacher         Teacher             @relation(fields: [teacherId], references: [id])
  weekday         Int
  startTime       String
  endTime         String
  enrollments     ClassEnrollment[]
  leaveRequests   LeaveRequest[]
  substituteReqs  SubstituteRequest[]
  insertionTargets MakeupRequest[]    @relation("TargetClass")
}

model ClassEnrollment {
  id        String  @id @default(cuid())
  studentId String
  classId   String
  student   Student @relation(fields: [studentId], references: [id])
  class     Class   @relation(fields: [classId], references: [id])

  @@unique([studentId, classId])
}

model TeacherAvailability {
  id        String  @id @default(cuid())
  teacherId String
  teacher   Teacher @relation(fields: [teacherId], references: [id])
  weekday   Int
  startTime String
  endTime   String
}

model LeaveRequest {
  id            String         @id @default(cuid())
  studentId     String
  student       Student        @relation(fields: [studentId], references: [id])
  classId       String
  class         Class          @relation(fields: [classId], references: [id])
  date          DateTime
  reason        String
  status        LeaveStatus    @default(APPROVED)
  createdAt     DateTime       @default(now())
  makeupRequest MakeupRequest?
}

model MakeupRequest {
  id             String       @id @default(cuid())
  leaveRequestId String       @unique
  leaveRequest   LeaveRequest @relation(fields: [leaveRequestId], references: [id])
  type           MakeupType
  status         MakeupStatus @default(PENDING_ADMIN)

  targetClassId  String?
  targetClass    Class?       @relation("TargetClass", fields: [targetClassId], references: [id])
  targetDate     DateTime?

  teacherId      String?
  teacher        Teacher?     @relation("OneOnOneTeacher", fields: [teacherId], references: [id])
  slotDate       DateTime?
  slotStartTime  String?
  slotEndTime    String?

  createdAt      DateTime     @default(now())
}

model SubstituteRequest {
  id                  String           @id @default(cuid())
  classId             String
  class               Class            @relation(fields: [classId], references: [id])
  originalTeacherId   String
  originalTeacher     Teacher          @relation("OriginalTeacher", fields: [originalTeacherId], references: [id])
  date                DateTime
  reason              String
  substituteTeacherId String?
  substituteTeacher   Teacher?         @relation("SubstituteTeacher", fields: [substituteTeacherId], references: [id])
  status              SubstituteStatus @default(PENDING_ASSIGNMENT)
  createdAt           DateTime         @default(now())
}
```

- [ ] **Step 2: Add `.env` and generate the dev database**

`.env`:
```
DATABASE_URL="file:./prisma/dev.db"
```

Run:
```bash
npx prisma db push
npx prisma generate
```
Expected: `prisma/dev.db` created, Prisma Client generated with no errors.

- [ ] **Step 3: Write the seed script**

`prisma/seed.ts`:
```typescript
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.create({
    data: { email: 'admin@example.com', password, name: '行政人員', role: 'ADMIN' },
  });

  const teacherUser = await prisma.user.create({
    data: { email: 'teacher@example.com', password, name: '王老師', role: 'TEACHER' },
  });
  const teacher = await prisma.teacher.create({
    data: { userId: teacherUser.id, subjects: '數學', phone: '0900000000' },
  });

  const studentUser = await prisma.user.create({
    data: { email: 'student@example.com', password, name: '小明', role: 'STUDENT' },
  });
  const student = await prisma.student.create({
    data: { userId: studentUser.id, parentPhone: '0911111111' },
  });

  const classA = await prisma.class.create({
    data: {
      name: '數學A班',
      subject: '數學',
      level: '國一',
      teacherId: teacher.id,
      weekday: 1,
      startTime: '19:00',
      endTime: '21:00',
    },
  });

  await prisma.classEnrollment.create({
    data: { studentId: student.id, classId: classA.id },
  });

  await prisma.teacherAvailability.create({
    data: { teacherId: teacher.id, weekday: 3, startTime: '16:00', endTime: '18:00' },
  });

  console.log('Seed complete:', { admin: admin.email, teacher: teacherUser.email, student: studentUser.email });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 4: Run the seed and verify**

Run: `npm run seed`
Expected: prints the seed summary with no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Prisma schema, dev db, and seed script"
```

---

### Task 3: Pure quarter-calculation helpers (TDD)

**Files:**
- Create: `src/lib/quarter.ts`
- Test: `src/lib/quarter.test.ts`

**Interfaces:**
- Produces: `getQuarter(date: Date): { year: number; quarter: 1|2|3|4 }`, `isSameQuarter(a: Date, b: Date): boolean`, `getQuarterRange(date: Date): { start: Date; end: Date }` — used by `makeupRequestService.ts` (Task 9) for the one-on-one quota check.

- [ ] **Step 1: Write the failing tests**

`src/lib/quarter.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { getQuarter, isSameQuarter, getQuarterRange } from './quarter';

describe('getQuarter', () => {
  it('returns Q1 for January', () => {
    expect(getQuarter(new Date(2026, 0, 15))).toEqual({ year: 2026, quarter: 1 });
  });
  it('returns Q2 for April', () => {
    expect(getQuarter(new Date(2026, 3, 1))).toEqual({ year: 2026, quarter: 2 });
  });
  it('returns Q3 for September', () => {
    expect(getQuarter(new Date(2026, 8, 30))).toEqual({ year: 2026, quarter: 3 });
  });
  it('returns Q4 for December', () => {
    expect(getQuarter(new Date(2026, 11, 31))).toEqual({ year: 2026, quarter: 4 });
  });
});

describe('isSameQuarter', () => {
  it('is true for two dates in the same quarter', () => {
    expect(isSameQuarter(new Date(2026, 0, 1), new Date(2026, 2, 31))).toBe(true);
  });
  it('is false for dates in different quarters', () => {
    expect(isSameQuarter(new Date(2026, 2, 31), new Date(2026, 3, 1))).toBe(false);
  });
  it('is false for the same quarter number in different years', () => {
    expect(isSameQuarter(new Date(2025, 0, 1), new Date(2026, 0, 1))).toBe(false);
  });
});

describe('getQuarterRange', () => {
  it('returns the full Q1 range', () => {
    const { start, end } = getQuarterRange(new Date(2026, 1, 10));
    expect(start).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 2, 31, 23, 59, 59, 999));
  });
  it('returns the full Q4 range', () => {
    const { start, end } = getQuarterRange(new Date(2026, 10, 5));
    expect(start).toEqual(new Date(2026, 9, 1, 0, 0, 0, 0));
    expect(end).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/quarter.test.ts`
Expected: FAIL — `Cannot find module './quarter'`

- [ ] **Step 3: Implement**

`src/lib/quarter.ts`:
```typescript
export interface Quarter {
  year: number;
  quarter: 1 | 2 | 3 | 4;
}

export function getQuarter(date: Date): Quarter {
  const year = date.getFullYear();
  const quarter = (Math.floor(date.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return { year, quarter };
}

export function isSameQuarter(a: Date, b: Date): boolean {
  const qa = getQuarter(a);
  const qb = getQuarter(b);
  return qa.year === qb.year && qa.quarter === qb.quarter;
}

export function getQuarterRange(date: Date): { start: Date; end: Date } {
  const { year, quarter } = getQuarter(date);
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  return { start, end };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/quarter.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/quarter.ts src/lib/quarter.test.ts
git commit -m "feat: add quarter calculation helpers"
```

---

### Task 4: Pure time-window helpers (TDD)

**Files:**
- Create: `src/lib/timeSlot.ts`
- Test: `src/lib/timeSlot.test.ts`

**Interfaces:**
- Produces: `isWithinAvailability(requested: {weekday: number; startTime: string; endTime: string}, availabilities: {weekday: number; startTime: string; endTime: string}[]): boolean` and `slotsOverlap(a: {startTime: string; endTime: string}, b: {startTime: string; endTime: string}): boolean` — used by `makeupRequestService.ts` (Task 9).

- [ ] **Step 1: Write the failing tests**

`src/lib/timeSlot.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { isWithinAvailability, slotsOverlap } from './timeSlot';

describe('isWithinAvailability', () => {
  const availabilities = [
    { weekday: 1, startTime: '16:00', endTime: '18:00' },
    { weekday: 3, startTime: '16:00', endTime: '18:00' },
  ];

  it('is true when requested slot fits exactly inside a window', () => {
    expect(isWithinAvailability({ weekday: 1, startTime: '16:00', endTime: '17:00' }, availabilities)).toBe(true);
  });
  it('is false when weekday does not match any window', () => {
    expect(isWithinAvailability({ weekday: 2, startTime: '16:00', endTime: '17:00' }, availabilities)).toBe(false);
  });
  it('is false when requested slot starts before the window', () => {
    expect(isWithinAvailability({ weekday: 1, startTime: '15:00', endTime: '17:00' }, availabilities)).toBe(false);
  });
  it('is false when requested slot ends after the window', () => {
    expect(isWithinAvailability({ weekday: 1, startTime: '17:00', endTime: '19:00' }, availabilities)).toBe(false);
  });
});

describe('slotsOverlap', () => {
  it('is true when slots partially overlap', () => {
    expect(slotsOverlap({ startTime: '16:00', endTime: '17:00' }, { startTime: '16:30', endTime: '17:30' })).toBe(true);
  });
  it('is false when slots are back-to-back with no overlap', () => {
    expect(slotsOverlap({ startTime: '16:00', endTime: '17:00' }, { startTime: '17:00', endTime: '18:00' })).toBe(false);
  });
  it('is false when slots are entirely separate', () => {
    expect(slotsOverlap({ startTime: '16:00', endTime: '17:00' }, { startTime: '17:30', endTime: '18:00' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/timeSlot.test.ts`
Expected: FAIL — `Cannot find module './timeSlot'`

- [ ] **Step 3: Implement**

`src/lib/timeSlot.ts`:
```typescript
interface TimeRange {
  startTime: string;
  endTime: string;
}

interface WeeklyWindow extends TimeRange {
  weekday: number;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function isWithinAvailability(
  requested: WeeklyWindow,
  availabilities: WeeklyWindow[]
): boolean {
  return availabilities.some(
    (a) =>
      a.weekday === requested.weekday &&
      toMinutes(requested.startTime) >= toMinutes(a.startTime) &&
      toMinutes(requested.endTime) <= toMinutes(a.endTime)
  );
}

export function slotsOverlap(a: TimeRange, b: TimeRange): boolean {
  return toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/timeSlot.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeSlot.ts src/lib/timeSlot.test.ts
git commit -m "feat: add time-window overlap and availability helpers"
```

---

### Task 5: Prisma client singleton + NextAuth + role-based middleware

**Files:**
- Create: `src/lib/db.ts`
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/middleware.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/types/next-auth.d.ts`

**Interfaces:**
- Produces: `prisma` client export from `src/lib/db.ts`; `authOptions` from `src/lib/auth.ts`; session shape `{ user: { id, name, email, role } }` — every service/API task after this depends on `prisma` and every page depends on the session `role`.

- [ ] **Step 1: Prisma client singleton**

> **Note (post-Task-2 adaptation):** Task 2 installed Prisma 7.8.0, which requires an explicit driver adapter for SQLite — a bare `new PrismaClient()` will throw. Task 2's `prisma/seed.ts` already uses `@prisma/adapter-better-sqlite3`; this singleton must use the same adapter, reading `DATABASE_URL` at construction time so `vitest.setup.ts`'s override (`file:./prisma/test.db`) still takes effect per test run.

`src/lib/db.ts`:
```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./prisma/dev.db' });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: NextAuth type augmentation**

`src/types/next-auth.d.ts`:
```typescript
import { Role } from '@prisma/client';
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: Role;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
  }
}
```

- [ ] **Step 3: NextAuth options**

`src/lib/auth.ts`:
```typescript
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './db';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({ where: { email: credentials.email } });
        if (!user) return null;
        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
};
```

- [ ] **Step 4: Route handler**

`src/app/api/auth/[...nextauth]/route.ts`:
```typescript
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

Add to `.env`:
```
NEXTAUTH_SECRET="dev-secret-change-me"
NEXTAUTH_URL="http://localhost:3000"
```

- [ ] **Step 5: Login page**

`src/app/login/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = await signIn('credentials', { email, password, redirect: false });
    if (result?.error) {
      setError('帳號或密碼錯誤');
      return;
    }
    router.push('/');
  }

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="mb-4 text-xl font-bold">登入</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          className="border p-2"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="border p-2"
          type="password"
          placeholder="密碼"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-red-600">{error}</p>}
        <button className="bg-black p-2 text-white" type="submit">
          登入
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Root layout wraps children in SessionProvider**

`src/app/layout.tsx` (replace generated content):
```tsx
import './globals.css';
import Providers from './providers';

export const metadata = { title: '補習班補課系統' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

`src/app/providers.tsx`:
```tsx
'use client';

import { SessionProvider } from 'next-auth/react';

export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

- [ ] **Step 7: Role-based middleware**

`src/middleware.ts`:
```typescript
import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const role = req.nextauth.token?.role;
    const path = req.nextUrl.pathname;

    if (path.startsWith('/admin') && role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/', req.url));
    }
    if (path.startsWith('/teacher') && role !== 'TEACHER') {
      return NextResponse.redirect(new URL('/', req.url));
    }
    if (path.startsWith('/student') && role !== 'STUDENT') {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  },
  { callbacks: { authorized: ({ token }) => !!token } }
);

export const config = {
  matcher: ['/admin/:path*', '/teacher/:path*', '/student/:path*'],
};
```

- [ ] **Step 8: Manual verification**

Run: `npm run dev`, open `http://localhost:3000/login`, log in with `teacher@example.com` / `password123` (seeded in Task 2).
Expected: redirected to `/` after login with no errors in the terminal.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add NextAuth credentials login and role-based middleware"
```

---

### Task 6: Admin — Teacher management (service + API + UI)

**Files:**
- Create: `src/lib/services/teacherService.ts`
- Test: `src/lib/services/teacherService.test.ts`
- Create: `src/app/api/teachers/route.ts`
- Create: `src/app/admin/teachers/page.tsx`

**Interfaces:**
- Consumes: `prisma` from `src/lib/db.ts` (Task 5), `Role` enum from Prisma schema (Task 2).
- Produces: `createTeacher(input: { name: string; email: string; password: string; subjects: string; phone?: string }): Promise<Teacher>`, `listTeachers(): Promise<(Teacher & { user: User })[]>` — consumed by Task 8 (Class needs a teacher picker) and Task 11 (Availability page needs current teacher's own record).

- [ ] **Step 1: Write the failing tests**

`src/lib/services/teacherService.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher, listTeachers } from './teacherService';

beforeEach(async () => {
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

describe('createTeacher', () => {
  it('creates a User with role TEACHER and a linked Teacher record', async () => {
    const teacher = await createTeacher({
      name: '陳老師',
      email: 'chen@example.com',
      password: 'secret123',
      subjects: '英文',
      phone: '0922222222',
    });
    expect(teacher.subjects).toBe('英文');

    const user = await prisma.user.findUnique({ where: { email: 'chen@example.com' } });
    expect(user?.role).toBe('TEACHER');
    expect(user?.password).not.toBe('secret123');
  });
});

describe('listTeachers', () => {
  it('returns all teachers with their user info', async () => {
    await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'secret123', subjects: '英文' });
    const teachers = await listTeachers();
    expect(teachers).toHaveLength(1);
    expect(teachers[0].user.name).toBe('陳老師');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:dbpush && npx vitest run src/lib/services/teacherService.test.ts`
Expected: FAIL — `Cannot find module './teacherService'`

- [ ] **Step 3: Implement**

`src/lib/services/teacherService.ts`:
```typescript
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export interface CreateTeacherInput {
  name: string;
  email: string;
  password: string;
  subjects: string;
  phone?: string;
}

const SAFE_USER_SELECT = { name: true, email: true } as const;

export async function createTeacher(input: CreateTeacherInput) {
  const hashed = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, password: hashed, role: 'TEACHER' },
  });
  return prisma.teacher.create({
    data: { userId: user.id, subjects: input.subjects, phone: input.phone },
    select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } },
  });
}

export function listTeachers() {
  return prisma.teacher.findMany({
    select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } },
    orderBy: { user: { name: 'asc' } },
  });
}
```

> **Security note:** never `include: { user: true }` — that pulls the bcrypt password hash into API responses. Always `select` only the safe fields (`name`, `email`) via a `SAFE_USER_SELECT`-style constant. This applies to every service in this plan that touches a `User` relation (Tasks 7, 8, 11, 14 — Task 9's `leaveRequestService` never includes `user`, so it's unaffected).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/teacherService.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: API route**

`src/app/api/teachers/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createTeacher, listTeachers } from '@/lib/services/teacherService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const teachers = await listTeachers();
  return NextResponse.json(teachers);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const teacher = await createTeacher(body);
  return NextResponse.json(teacher, { status: 201 });
}
```

- [ ] **Step 6: Admin UI page**

`src/app/admin/teachers/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

interface TeacherRow {
  id: string;
  subjects: string;
  phone: string | null;
  user: { name: string; email: string };
}

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', subjects: '', phone: '' });

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

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">老師名單</h1>
      <table className="mb-6 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">姓名</th>
            <th className="p-2">Email</th>
            <th className="p-2">科目</th>
            <th className="p-2">電話</th>
          </tr>
        </thead>
        <tbody>
          {teachers.map((t) => (
            <tr key={t.id} className="border-b">
              <td className="p-2">{t.user.name}</td>
              <td className="p-2">{t.user.email}</td>
              <td className="p-2">{t.subjects}</td>
              <td className="p-2">{t.phone}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 font-bold">新增老師</h2>
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-2">
        <input className="border p-2" placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="border p-2" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input className="border p-2" placeholder="初始密碼" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <input className="border p-2" placeholder="任教科目" value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} required />
        <input className="border p-2" placeholder="電話" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <button className="bg-black p-2 text-white" type="submit">新增</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/teacherService.ts src/lib/services/teacherService.test.ts src/app/api/teachers/route.ts src/app/admin/teachers/page.tsx
git commit -m "feat: add teacher management (service, API, admin UI)"
```

---

### Task 7: Admin — Student management (service + API + UI)

**Files:**
- Create: `src/lib/services/studentService.ts`
- Test: `src/lib/services/studentService.test.ts`
- Create: `src/app/api/students/route.ts`
- Create: `src/app/admin/students/page.tsx`

**Interfaces:**
- Consumes: `prisma` (Task 5).
- Produces: `createStudent(input: { name: string; email: string; password: string; parentPhone?: string }): Promise<Student>`, `listStudents(): Promise<(Student & { user: User })[]>` — consumed by Task 8 (enrollment picker) and Task 9 (leave request student list).

- [ ] **Step 1: Write the failing tests**

`src/lib/services/studentService.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent, listStudents } from './studentService';

beforeEach(async () => {
  await prisma.classEnrollment.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

describe('createStudent', () => {
  it('creates a User with role STUDENT and a linked Student record', async () => {
    const student = await createStudent({
      name: '小華',
      email: 'hua@example.com',
      password: 'secret123',
      parentPhone: '0933333333',
    });
    expect(student.parentPhone).toBe('0933333333');
    const user = await prisma.user.findUnique({ where: { email: 'hua@example.com' } });
    expect(user?.role).toBe('STUDENT');
  });
});

describe('listStudents', () => {
  it('returns all students with user info', async () => {
    await createStudent({ name: '小華', email: 'hua@example.com', password: 'secret123' });
    const students = await listStudents();
    expect(students).toHaveLength(1);
    expect(students[0].user.name).toBe('小華');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/studentService.test.ts`
Expected: FAIL — `Cannot find module './studentService'`

- [ ] **Step 3: Implement**

`src/lib/services/studentService.ts`:
```typescript
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export interface CreateStudentInput {
  name: string;
  email: string;
  password: string;
  parentPhone?: string;
}

const SAFE_USER_SELECT = { name: true, email: true } as const;

export async function createStudent(input: CreateStudentInput) {
  const hashed = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, password: hashed, role: 'STUDENT' },
  });
  return prisma.student.create({
    data: { userId: user.id, parentPhone: input.parentPhone },
    select: { id: true, parentPhone: true, user: { select: SAFE_USER_SELECT } },
  });
}

export function listStudents() {
  return prisma.student.findMany({
    select: { id: true, parentPhone: true, user: { select: SAFE_USER_SELECT } },
    orderBy: { user: { name: 'asc' } },
  });
}
```

> **Security note:** never `include: { user: true }` — see the same note in Task 6. Use `select` with a `SAFE_USER_SELECT`-style constant (`{ name: true, email: true }`) instead.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/studentService.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: API route**

`src/app/api/students/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createStudent, listStudents } from '@/lib/services/studentService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listStudents());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json();
  const student = await createStudent(body);
  return NextResponse.json(student, { status: 201 });
}
```

- [ ] **Step 6: Admin UI page**

`src/app/admin/students/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

interface StudentRow {
  id: string;
  parentPhone: string | null;
  user: { name: string; email: string };
}

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', parentPhone: '' });

  async function load() {
    const res = await fetch('/api/students');
    setStudents(await res.json());
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

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">學生名單</h1>
      <table className="mb-6 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">姓名</th>
            <th className="p-2">Email</th>
            <th className="p-2">家長電話</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.id} className="border-b">
              <td className="p-2">{s.user.name}</td>
              <td className="p-2">{s.user.email}</td>
              <td className="p-2">{s.parentPhone}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 font-bold">新增學生</h2>
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-2">
        <input className="border p-2" placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="border p-2" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input className="border p-2" placeholder="初始密碼" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <input className="border p-2" placeholder="家長電話" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
        <button className="bg-black p-2 text-white" type="submit">新增</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/studentService.ts src/lib/services/studentService.test.ts src/app/api/students/route.ts src/app/admin/students/page.tsx
git commit -m "feat: add student management (service, API, admin UI)"
```

---

### Task 8: Admin — Class management + enrollment (service + API + UI)

**Files:**
- Create: `src/lib/services/classService.ts`
- Test: `src/lib/services/classService.test.ts`
- Create: `src/app/api/classes/route.ts`
- Create: `src/app/api/classes/[id]/enrollments/route.ts`
- Create: `src/app/admin/classes/page.tsx`

**Interfaces:**
- Consumes: `prisma` (Task 5), `listTeachers` (Task 6), `listStudents` (Task 7).
- Produces: `createClass(input): Promise<Class>`, `listClasses(): Promise<(Class & {teacher: Teacher & {user: User}, enrollments: ClassEnrollment[]})[]>`, `listClassesBySubjectAndLevel(subject: string, level: string, excludeClassId?: string): Promise<Class[]>`, `enrollStudent(classId: string, studentId: string): Promise<ClassEnrollment>` — `listClassesBySubjectAndLevel` is consumed by Task 10 (insertion makeup eligible-class list).

- [ ] **Step 1: Write the failing tests**

`src/lib/services/classService.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, listClasses, listClassesBySubjectAndLevel, enrollStudent } from './classService';

beforeEach(async () => {
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

describe('createClass / listClasses', () => {
  it('creates and lists a class with its teacher', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    expect(cls.name).toBe('數學A班');

    const classes = await listClasses();
    expect(classes).toHaveLength(1);
    expect(classes[0].teacher.user.name).toBe('陳老師');
  });
});

describe('listClassesBySubjectAndLevel', () => {
  it('returns only classes matching subject and level, excluding the given class', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await createClass({ name: '英文班', subject: '英文', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });

    const result = await listClassesBySubjectAndLevel('數學', '國一', classA.id);
    expect(result.map((c) => c.id)).toEqual([classB.id]);
  });
});

describe('enrollStudent', () => {
  it('links a student to a class', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const enrollment = await enrollStudent(cls.id, student.id);
    expect(enrollment.studentId).toBe(student.id);
    expect(enrollment.classId).toBe(cls.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: FAIL — `Cannot find module './classService'`

- [ ] **Step 3: Implement**

`src/lib/services/classService.ts`:
```typescript
import { prisma } from '@/lib/db';

export interface CreateClassInput {
  name: string;
  subject: string;
  level: string;
  teacherId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

const SAFE_USER_SELECT = { name: true, email: true } as const;
const CLASS_WITH_TEACHER_SELECT = {
  id: true,
  name: true,
  subject: true,
  level: true,
  weekday: true,
  startTime: true,
  endTime: true,
  teacher: { select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } } },
  enrollments: true,
} as const;

export function createClass(input: CreateClassInput) {
  return prisma.class.create({ data: input });
}

export function listClasses() {
  return prisma.class.findMany({
    select: CLASS_WITH_TEACHER_SELECT,
    orderBy: { name: 'asc' },
  });
}

export function listClassesBySubjectAndLevel(subject: string, level: string, excludeClassId?: string) {
  return prisma.class.findMany({
    where: {
      subject,
      level,
      ...(excludeClassId ? { id: { not: excludeClassId } } : {}),
    },
    select: CLASS_WITH_TEACHER_SELECT,
    orderBy: { name: 'asc' },
  });
}

export function enrollStudent(classId: string, studentId: string) {
  return prisma.classEnrollment.create({ data: { classId, studentId } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: API routes**

`src/app/api/classes/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createClass, listClasses } from '@/lib/services/classService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await listClasses());
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

`src/app/api/classes/[id]/enrollments/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { enrollStudent } from '@/lib/services/classService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { studentId } = await req.json();
  const enrollment = await enrollStudent(params.id, studentId);
  return NextResponse.json(enrollment, { status: 201 });
}
```

- [ ] **Step 6: Admin UI page**

`src/app/admin/classes/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface ClassRow {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
  enrollments: { id: string }[];
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [form, setForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });

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

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">班級名單</h1>
      <table className="mb-6 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">班名</th>
            <th className="p-2">科目/等級</th>
            <th className="p-2">老師</th>
            <th className="p-2">時間</th>
            <th className="p-2">人數</th>
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => (
            <tr key={c.id} className="border-b">
              <td className="p-2">{c.name}</td>
              <td className="p-2">{c.subject} / {c.level}</td>
              <td className="p-2">{c.teacher.user.name}</td>
              <td className="p-2">週{WEEKDAYS[c.weekday]} {c.startTime}-{c.endTime}</td>
              <td className="p-2">{c.enrollments.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-2 font-bold">新增班級</h2>
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-2">
        <input className="border p-2" placeholder="班名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <input className="border p-2" placeholder="科目" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
        <input className="border p-2" placeholder="等級" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} required />
        <select className="border p-2" value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} required>
          <option value="">選擇老師</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>{t.user.name}</option>
          ))}
        </select>
        <select className="border p-2" value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
          {WEEKDAYS.map((w, i) => (
            <option key={i} value={i}>週{w}</option>
          ))}
        </select>
        <input className="border p-2" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
        <input className="border p-2" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
        <button className="bg-black p-2 text-white" type="submit">新增</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/classService.ts src/lib/services/classService.test.ts src/app/api/classes src/app/admin/classes
git commit -m "feat: add class management and enrollment (service, API, admin UI)"
```

---

### Task 9: Student — Leave request (service + API + UI)

**Files:**
- Create: `src/lib/services/leaveRequestService.ts`
- Test: `src/lib/services/leaveRequestService.test.ts`
- Create: `src/app/api/leave-requests/route.ts`
- Create: `src/app/student/leave-request/page.tsx`

**Interfaces:**
- Consumes: `prisma` (Task 5).
- Produces: `createLeaveRequest(input: { studentId: string; classId: string; date: Date; reason: string }): Promise<LeaveRequest>` (auto-approved), `listLeaveRequestsForStudent(studentId: string): Promise<LeaveRequest[]>` — `createLeaveRequest`'s returned `id` is consumed by Task 12 (`MakeupRequest.leaveRequestId`).

- [ ] **Step 1: Write the failing tests**

`src/lib/services/leaveRequestService.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass } from './classService';
import { createLeaveRequest, listLeaveRequestsForStudent } from './leaveRequestService';

beforeEach(async () => {
  await prisma.leaveRequest.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

async function setupClassAndStudent() {
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
  return { student, cls };
}

describe('createLeaveRequest', () => {
  it('creates a leave request with status APPROVED', async () => {
    const { student, cls } = await setupClassAndStudent();
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(2026, 6, 20), reason: '感冒' });
    expect(leave.status).toBe('APPROVED');
    expect(leave.reason).toBe('感冒');
  });
});

describe('listLeaveRequestsForStudent', () => {
  it('returns only the given student\'s leave requests', async () => {
    const { student, cls } = await setupClassAndStudent();
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(2026, 6, 20), reason: '感冒' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createLeaveRequest({ studentId: otherStudent.id, classId: cls.id, date: new Date(2026, 6, 21), reason: '事假' });

    const results = await listLeaveRequestsForStudent(student.id);
    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe('感冒');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/leaveRequestService.test.ts`
Expected: FAIL — `Cannot find module './leaveRequestService'`

- [ ] **Step 3: Implement**

`src/lib/services/leaveRequestService.ts`:
```typescript
import { prisma } from '@/lib/db';

export interface CreateLeaveRequestInput {
  studentId: string;
  classId: string;
  date: Date;
  reason: string;
}

export function createLeaveRequest(input: CreateLeaveRequestInput) {
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/leaveRequestService.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: API route**

`src/app/api/leave-requests/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createLeaveRequest, listLeaveRequestsForStudent } from '@/lib/services/leaveRequestService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
  if (!student) return NextResponse.json([], { status: 200 });
  return NextResponse.json(await listLeaveRequestsForStudent(student.id));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUnique({ where: { userId: session.user.id } });
  if (!student) return NextResponse.json({ error: 'Not a student' }, { status: 400 });

  const body = await req.json();
  const leave = await createLeaveRequest({
    studentId: student.id,
    classId: body.classId,
    date: new Date(body.date),
    reason: body.reason,
  });
  return NextResponse.json(leave, { status: 201 });
}
```

- [ ] **Step 6: Student UI page**

`src/app/student/leave-request/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

interface ClassOption {
  id: string;
  name: string;
}

interface LeaveRow {
  id: string;
  date: string;
  reason: string;
  status: string;
  class: { name: string };
  makeupRequest: { type: string; status: string } | null;
}

export default function StudentLeaveRequestPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [form, setForm] = useState({ classId: '', date: '', reason: '' });

  async function load() {
    const [classesRes, leavesRes] = await Promise.all([fetch('/api/classes'), fetch('/api/leave-requests')]);
    setClasses(await classesRes.json());
    setLeaves(await leavesRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/leave-requests', { method: 'POST', body: JSON.stringify(form) });
    setForm({ classId: '', date: '', reason: '' });
    load();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">請假申請</h1>
      <form onSubmit={handleSubmit} className="mb-6 flex max-w-md flex-col gap-2">
        <select className="border p-2" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
          <option value="">選擇班級</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input className="border p-2" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        <input className="border p-2" placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
        <button className="bg-black p-2 text-white" type="submit">送出請假</button>
      </form>

      <h2 className="mb-2 font-bold">我的請假紀錄</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">班級</th>
            <th className="p-2">日期</th>
            <th className="p-2">原因</th>
            <th className="p-2">狀態</th>
            <th className="p-2">補課狀態</th>
          </tr>
        </thead>
        <tbody>
          {leaves.map((l) => (
            <tr key={l.id} className="border-b">
              <td className="p-2">{l.class.name}</td>
              <td className="p-2">{new Date(l.date).toLocaleDateString()}</td>
              <td className="p-2">{l.reason}</td>
              <td className="p-2">{l.status}</td>
              <td className="p-2">{l.makeupRequest ? `${l.makeupRequest.type} / ${l.makeupRequest.status}` : '尚未申請'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/leaveRequestService.ts src/lib/services/leaveRequestService.test.ts src/app/api/leave-requests src/app/student/leave-request
git commit -m "feat: add student leave request (service, API, UI)"
```

---

### Task 10: Teacher — Weekly availability management (service + API + UI)

**Files:**
- Create: `src/lib/services/availabilityService.ts`
- Test: `src/lib/services/availabilityService.test.ts`
- Create: `src/app/api/availability/route.ts`
- Create: `src/app/teacher/availability/page.tsx`

**Interfaces:**
- Consumes: `prisma` (Task 5).
- Produces: `setTeacherAvailability(teacherId: string, windows: {weekday: number; startTime: string; endTime: string}[]): Promise<TeacherAvailability[]>` (replaces all windows for that teacher), `listTeacherAvailability(teacherId: string): Promise<TeacherAvailability[]>` — consumed by Task 12 (`isWithinAvailability` check).

- [ ] **Step 1: Write the failing tests**

`src/lib/services/availabilityService.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { setTeacherAvailability, listTeacherAvailability } from './availabilityService';

beforeEach(async () => {
  await prisma.teacherAvailability.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.user.deleteMany();
});

describe('setTeacherAvailability', () => {
  it('replaces all windows for a teacher', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    await setTeacherAvailability(teacher.id, [{ weekday: 1, startTime: '16:00', endTime: '18:00' }]);
    await setTeacherAvailability(teacher.id, [
      { weekday: 3, startTime: '16:00', endTime: '18:00' },
      { weekday: 5, startTime: '10:00', endTime: '12:00' },
    ]);

    const windows = await listTeacherAvailability(teacher.id);
    expect(windows).toHaveLength(2);
    expect(windows.map((w) => w.weekday).sort()).toEqual([3, 5]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/availabilityService.test.ts`
Expected: FAIL — `Cannot find module './availabilityService'`

- [ ] **Step 3: Implement**

`src/lib/services/availabilityService.ts`:
```typescript
import { prisma } from '@/lib/db';

export interface AvailabilityWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

export async function setTeacherAvailability(teacherId: string, windows: AvailabilityWindow[]) {
  await prisma.teacherAvailability.deleteMany({ where: { teacherId } });
  await prisma.teacherAvailability.createMany({
    data: windows.map((w) => ({ teacherId, ...w })),
  });
  return listTeacherAvailability(teacherId);
}

export function listTeacherAvailability(teacherId: string) {
  return prisma.teacherAvailability.findMany({ where: { teacherId }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/availabilityService.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: API route**

`src/app/api/availability/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { setTeacherAvailability, listTeacherAvailability } from '@/lib/services/availabilityService';

async function getTeacherForSession(userId: string) {
  return prisma.teacher.findUnique({ where: { userId } });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const teacher = await getTeacherForSession(session.user.id);
  if (!teacher) return NextResponse.json([], { status: 200 });
  return NextResponse.json(await listTeacherAvailability(teacher.id));
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const teacher = await getTeacherForSession(session.user.id);
  if (!teacher) return NextResponse.json({ error: 'Not a teacher' }, { status: 400 });

  const { windows } = await req.json();
  const result = await setTeacherAvailability(teacher.id, windows);
  return NextResponse.json(result);
}
```

- [ ] **Step 6: Teacher UI page**

`src/app/teacher/availability/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface Window {
  weekday: number;
  startTime: string;
  endTime: string;
}

export default function AvailabilityPage() {
  const [windows, setWindows] = useState<Window[]>([]);

  async function load() {
    const res = await fetch('/api/availability');
    setWindows(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  function addWindow() {
    setWindows([...windows, { weekday: 1, startTime: '16:00', endTime: '18:00' }]);
  }

  function updateWindow(index: number, patch: Partial<Window>) {
    setWindows(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  function removeWindow(index: number) {
    setWindows(windows.filter((_, i) => i !== index));
  }

  async function save() {
    await fetch('/api/availability', { method: 'PUT', body: JSON.stringify({ windows }) });
    load();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">我的每週可補課時段</h1>
      <div className="flex flex-col gap-2">
        {windows.map((w, i) => (
          <div key={i} className="flex items-center gap-2">
            <select className="border p-2" value={w.weekday} onChange={(e) => updateWindow(i, { weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((label, idx) => (
                <option key={idx} value={idx}>週{label}</option>
              ))}
            </select>
            <input className="border p-2" type="time" value={w.startTime} onChange={(e) => updateWindow(i, { startTime: e.target.value })} />
            <input className="border p-2" type="time" value={w.endTime} onChange={(e) => updateWindow(i, { endTime: e.target.value })} />
            <button className="text-red-600" onClick={() => removeWindow(i)}>刪除</button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="border p-2" onClick={addWindow}>新增時段</button>
        <button className="bg-black p-2 text-white" onClick={save}>儲存</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/availabilityService.ts src/lib/services/availabilityService.test.ts src/app/api/availability src/app/teacher/availability
git commit -m "feat: add teacher weekly availability management (service, API, UI)"
```

---

### Task 11: Makeup request — creation logic for both types (TDD)

**Files:**
- Create: `src/lib/services/makeupRequestService.ts`
- Test: `src/lib/services/makeupRequestService.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 5), `getQuarterRange` (Task 3), `isWithinAvailability`/`slotsOverlap` (Task 4), `listTeacherAvailability` (Task 10).
- Produces:
  - `createInsertionMakeupRequest(input: { leaveRequestId: string; targetClassId: string; targetDate: Date }): Promise<MakeupRequest>`
  - `createOneOnOneMakeupRequest(input: { leaveRequestId: string; studentId: string; teacherId: string; slotDate: Date; slotStartTime: string; slotEndTime: string }): Promise<MakeupRequest>` — weekday is derived internally from `slotDate.getDay()`, never taken from the caller, so a mismatched weekday/date pair from the client can't bypass the availability check. Throws `Error('QUOTA_EXCEEDED')`, `Error('OUTSIDE_AVAILABILITY')`, or `Error('SLOT_CONFLICT')` on validation failure
  - `listPendingMakeupRequests(): Promise<MakeupRequest[]>`
  - `decideMakeupRequest(id: string, decision: 'APPROVED' | 'REJECTED'): Promise<MakeupRequest>`
  - These are consumed by Task 12 (insertion API/UI), Task 13 (one-on-one API/UI), and Task 14 (admin review API/UI).

- [ ] **Step 1: Write the failing tests**

`src/lib/services/makeupRequestService.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass } from './classService';
import { createLeaveRequest } from './leaveRequestService';
import { setTeacherAvailability } from './availabilityService';
import {
  createInsertionMakeupRequest,
  createOneOnOneMakeupRequest,
  listPendingMakeupRequests,
  decideMakeupRequest,
} from './makeupRequestService';

beforeEach(async () => {
  await prisma.makeupRequest.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
  const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
  const leave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 20), reason: '感冒' });
  return { teacher, student, classA, classB, leave };
}

describe('createInsertionMakeupRequest', () => {
  it('creates a PENDING_ADMIN insertion request', async () => {
    const { classB, leave } = await setup();
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    expect(makeup.type).toBe('INSERTION');
    expect(makeup.status).toBe('PENDING_ADMIN');
  });
});

describe('createOneOnOneMakeupRequest', () => {
  it('creates a PENDING_ADMIN one-on-one request when slot is within availability and free', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date(2026, 6, 15), // a Wednesday
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });
    expect(makeup.type).toBe('ONE_ON_ONE');
    expect(makeup.status).toBe('PENDING_ADMIN');
  });

  it('throws OUTSIDE_AVAILABILITY when slot is not within any window', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    await expect(
      createOneOnOneMakeupRequest({
        leaveRequestId: leave.id,
        studentId: student.id,
        teacherId: teacher.id,
        slotDate: new Date(2026, 6, 15),
        slotStartTime: '19:00',
        slotEndTime: '20:00',
      })
    ).rejects.toThrow('OUTSIDE_AVAILABILITY');
  });

  it('throws SLOT_CONFLICT when another pending/approved request already holds the slot', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date(2026, 6, 15),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    const classA = await prisma.class.findFirstOrThrow();
    const otherLeave = await createLeaveRequest({ studentId: otherStudent.id, classId: classA.id, date: new Date(2026, 6, 20), reason: '事假' });

    await expect(
      createOneOnOneMakeupRequest({
        leaveRequestId: otherLeave.id,
        studentId: otherStudent.id,
        teacherId: teacher.id,
        slotDate: new Date(2026, 6, 15),
        slotStartTime: '16:30',
        slotEndTime: '17:30',
      })
    ).rejects.toThrow('SLOT_CONFLICT');
  });

  it('throws QUOTA_EXCEEDED when student already has a pending/approved one-on-one request this quarter', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date(2026, 6, 15),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    const classA = await prisma.class.findFirstOrThrow();
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });

    await expect(
      createOneOnOneMakeupRequest({
        leaveRequestId: secondLeave.id,
        studentId: student.id,
        teacherId: teacher.id,
        slotDate: new Date(2026, 6, 29),
        slotStartTime: '17:00',
        slotEndTime: '18:00',
      })
    ).rejects.toThrow('QUOTA_EXCEEDED');
  });
});

describe('listPendingMakeupRequests / decideMakeupRequest', () => {
  it('lists pending requests and allows admin to approve one', async () => {
    const { classB, leave } = await setup();
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });

    const pending = await listPendingMakeupRequests();
    expect(pending.map((m) => m.id)).toContain(makeup.id);

    const decided = await decideMakeupRequest(makeup.id, 'APPROVED');
    expect(decided.status).toBe('APPROVED');

    const pendingAfter = await listPendingMakeupRequests();
    expect(pendingAfter.map((m) => m.id)).not.toContain(makeup.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: FAIL — `Cannot find module './makeupRequestService'`

- [ ] **Step 3: Implement**

`src/lib/services/makeupRequestService.ts`:
```typescript
import { prisma } from '@/lib/db';
import { getQuarterRange } from '@/lib/quarter';
import { isWithinAvailability, slotsOverlap } from '@/lib/timeSlot';
import { listTeacherAvailability } from './availabilityService';

export interface CreateInsertionInput {
  leaveRequestId: string;
  targetClassId: string;
  targetDate: Date;
}

export function createInsertionMakeupRequest(input: CreateInsertionInput) {
  return prisma.makeupRequest.create({
    data: {
      leaveRequestId: input.leaveRequestId,
      type: 'INSERTION',
      status: 'PENDING_ADMIN',
      targetClassId: input.targetClassId,
      targetDate: input.targetDate,
    },
  });
}

export interface CreateOneOnOneInput {
  leaveRequestId: string;
  studentId: string;
  teacherId: string;
  slotDate: Date;
  slotStartTime: string;
  slotEndTime: string;
}

export async function createOneOnOneMakeupRequest(input: CreateOneOnOneInput) {
  const { start, end } = getQuarterRange(new Date());
  const quotaUsed = await prisma.makeupRequest.count({
    where: {
      type: 'ONE_ON_ONE',
      status: { in: ['PENDING_ADMIN', 'APPROVED'] },
      leaveRequest: { studentId: input.studentId },
      createdAt: { gte: start, lte: end },
    },
  });
  if (quotaUsed > 0) throw new Error('QUOTA_EXCEEDED');

  // Derived from slotDate rather than trusted from the caller, so a
  // mismatched weekday/date pair can't be used to slip past the check.
  const weekday = input.slotDate.getDay();
  const availabilities = await listTeacherAvailability(input.teacherId);
  const withinAvailability = isWithinAvailability(
    { weekday, startTime: input.slotStartTime, endTime: input.slotEndTime },
    availabilities
  );
  if (!withinAvailability) throw new Error('OUTSIDE_AVAILABILITY');

  const sameDayRequests = await prisma.makeupRequest.findMany({
    where: {
      type: 'ONE_ON_ONE',
      teacherId: input.teacherId,
      slotDate: input.slotDate,
      status: { in: ['PENDING_ADMIN', 'APPROVED'] },
    },
  });
  const conflict = sameDayRequests.some((r) =>
    slotsOverlap({ startTime: input.slotStartTime, endTime: input.slotEndTime }, { startTime: r.slotStartTime!, endTime: r.slotEndTime! })
  );
  if (conflict) throw new Error('SLOT_CONFLICT');

  return prisma.makeupRequest.create({
    data: {
      leaveRequestId: input.leaveRequestId,
      type: 'ONE_ON_ONE',
      status: 'PENDING_ADMIN',
      teacherId: input.teacherId,
      slotDate: input.slotDate,
      slotStartTime: input.slotStartTime,
      slotEndTime: input.slotEndTime,
    },
  });
}

const SAFE_USER_SELECT = { name: true, email: true } as const;

export function listPendingMakeupRequests() {
  return prisma.makeupRequest.findMany({
    where: { status: 'PENDING_ADMIN' },
    select: {
      id: true,
      type: true,
      status: true,
      targetDate: true,
      slotDate: true,
      slotStartTime: true,
      slotEndTime: true,
      createdAt: true,
      leaveRequest: {
        select: {
          student: { select: { user: { select: SAFE_USER_SELECT } } },
          class: true,
        },
      },
      targetClass: true,
      teacher: { select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export function decideMakeupRequest(id: string, decision: 'APPROVED' | 'REJECTED') {
  return prisma.makeupRequest.update({ where: { id }, data: { status: decision } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/makeupRequestService.ts src/lib/services/makeupRequestService.test.ts
git commit -m "feat: add makeup request creation logic with quota/availability/conflict checks"
```

---

### Task 12: Student — Insertion makeup request UI + API

**Files:**
- Create: `src/app/api/makeup-requests/route.ts`
- Create: `src/app/student/makeup-request/page.tsx`

**Interfaces:**
- Consumes: `createInsertionMakeupRequest`, `createOneOnOneMakeupRequest` (Task 11), `listClassesBySubjectAndLevel` (Task 8), `listTeachers` (Task 6), `listTeacherAvailability` (Task 10).
- Produces: `POST /api/makeup-requests` handling both `type: 'INSERTION'` and `type: 'ONE_ON_ONE'` bodies; `GET /api/makeup-requests?leaveRequestId=` returns eligible classes for a given leave request; `GET /api/makeup-requests?teacherId=` returns that teacher's weekly availability windows (shown to the student before they pick a one-on-one slot). Consumed by the UI in this task and reused as-is by Task 14 (admin uses `GET /api/makeup-requests` without params for the pending queue — see Task 14 for that route variant).

- [ ] **Step 1: API route (both makeup types + eligible-options + availability lookup)**

`src/app/api/makeup-requests/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { listClassesBySubjectAndLevel } from '@/lib/services/classService';
import { listTeacherAvailability } from '@/lib/services/availabilityService';
import { createInsertionMakeupRequest, createOneOnOneMakeupRequest } from '@/lib/services/makeupRequestService';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const teacherId = req.nextUrl.searchParams.get('teacherId');
  if (teacherId) {
    const availability = await listTeacherAvailability(teacherId);
    return NextResponse.json({ availability });
  }

  const leaveRequestId = req.nextUrl.searchParams.get('leaveRequestId');
  if (!leaveRequestId) return NextResponse.json({ error: 'leaveRequestId or teacherId required' }, { status: 400 });

  const leave = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: leaveRequestId }, include: { class: true } });
  const eligibleClasses = await listClassesBySubjectAndLevel(leave.class.subject, leave.class.level, leave.classId);
  return NextResponse.json({ eligibleClasses });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const body = await req.json();

  try {
    if (body.type === 'INSERTION') {
      const makeup = await createInsertionMakeupRequest({
        leaveRequestId: body.leaveRequestId,
        targetClassId: body.targetClassId,
        targetDate: new Date(body.targetDate),
      });
      return NextResponse.json(makeup, { status: 201 });
    }

    if (body.type === 'ONE_ON_ONE') {
      const makeup = await createOneOnOneMakeupRequest({
        leaveRequestId: body.leaveRequestId,
        studentId: student.id,
        teacherId: body.teacherId,
        slotDate: new Date(body.slotDate),
        slotStartTime: body.slotStartTime,
        slotEndTime: body.slotEndTime,
      });
      return NextResponse.json(makeup, { status: 201 });
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
```

- [ ] **Step 2: Student UI page**

`src/app/student/makeup-request/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface LeaveRow {
  id: string;
  date: string;
  class: { name: string; subject: string; level: string };
  makeupRequest: { id: string } | null;
}

interface ClassOption {
  id: string;
  name: string;
  weekday: number;
  startTime: string;
  endTime: string;
  enrollments: { id: string }[];
}

interface TeacherOption {
  id: string;
  user: { name: string };
  subjects: string;
}

interface AvailabilityWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

export default function MakeupRequestPage() {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [selectedLeaveId, setSelectedLeaveId] = useState('');
  const [makeupType, setMakeupType] = useState<'INSERTION' | 'ONE_ON_ONE'>('INSERTION');
  const [eligibleClasses, setEligibleClasses] = useState<ClassOption[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [message, setMessage] = useState('');

  const [insertionForm, setInsertionForm] = useState({ targetClassId: '', targetDate: '' });
  const [oneOnOneForm, setOneOnOneForm] = useState({ teacherId: '', slotDate: '', slotStartTime: '16:00', slotEndTime: '17:00' });

  useEffect(() => {
    fetch('/api/leave-requests').then((r) => r.json()).then(setLeaves);
    fetch('/api/teachers').then((r) => r.json()).then(setTeachers);
  }, []);

  useEffect(() => {
    if (!selectedLeaveId) return;
    fetch(`/api/makeup-requests?leaveRequestId=${selectedLeaveId}`)
      .then((r) => r.json())
      .then((data) => setEligibleClasses(data.eligibleClasses));
  }, [selectedLeaveId]);

  useEffect(() => {
    if (!oneOnOneForm.teacherId) {
      setAvailability([]);
      return;
    }
    fetch(`/api/makeup-requests?teacherId=${oneOnOneForm.teacherId}`)
      .then((r) => r.json())
      .then((data) => setAvailability(data.availability));
  }, [oneOnOneForm.teacherId]);

  async function submitInsertion(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    const res = await fetch('/api/makeup-requests', {
      method: 'POST',
      body: JSON.stringify({ type: 'INSERTION', leaveRequestId: selectedLeaveId, ...insertionForm }),
    });
    const data = await res.json();
    setMessage(res.ok ? '已送出插班申請，待行政確認' : `錯誤：${data.error}`);
  }

  async function submitOneOnOne(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    const res = await fetch('/api/makeup-requests', {
      method: 'POST',
      body: JSON.stringify({
        type: 'ONE_ON_ONE',
        leaveRequestId: selectedLeaveId,
        teacherId: oneOnOneForm.teacherId,
        slotDate: oneOnOneForm.slotDate,
        slotStartTime: oneOnOneForm.slotStartTime,
        slotEndTime: oneOnOneForm.slotEndTime,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage('已送出一對一補課申請，待行政確認');
    } else if (data.error === 'QUOTA_EXCEEDED') {
      setMessage('本季一對一補課名額已使用');
    } else if (data.error === 'OUTSIDE_AVAILABILITY') {
      setMessage('該時段不在老師可補課時段內');
    } else if (data.error === 'SLOT_CONFLICT') {
      setMessage('該時段已被其他學生預約');
    } else {
      setMessage(`錯誤：${data.error}`);
    }
  }

  const leavesWithoutMakeup = leaves.filter((l) => !l.makeupRequest);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">申請補課</h1>

      <select className="mb-4 border p-2" value={selectedLeaveId} onChange={(e) => setSelectedLeaveId(e.target.value)}>
        <option value="">選擇要補課的請假紀錄</option>
        {leavesWithoutMakeup.map((l) => (
          <option key={l.id} value={l.id}>
            {l.class.name} - {new Date(l.date).toLocaleDateString()}
          </option>
        ))}
      </select>

      {selectedLeaveId && (
        <>
          <div className="mb-4 flex gap-4">
            <label>
              <input type="radio" checked={makeupType === 'INSERTION'} onChange={() => setMakeupType('INSERTION')} /> 插班補課
            </label>
            <label>
              <input type="radio" checked={makeupType === 'ONE_ON_ONE'} onChange={() => setMakeupType('ONE_ON_ONE')} /> 一對一補課
            </label>
          </div>

          {makeupType === 'INSERTION' && (
            <form onSubmit={submitInsertion} className="flex max-w-md flex-col gap-2">
              <select className="border p-2" value={insertionForm.targetClassId} onChange={(e) => setInsertionForm({ ...insertionForm, targetClassId: e.target.value })} required>
                <option value="">選擇班級</option>
                {eligibleClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（週{WEEKDAYS[c.weekday]} {c.startTime}-{c.endTime}，目前 {c.enrollments.length} 人）
                  </option>
                ))}
              </select>
              <input className="border p-2" type="date" value={insertionForm.targetDate} onChange={(e) => setInsertionForm({ ...insertionForm, targetDate: e.target.value })} required />
              <button className="bg-black p-2 text-white" type="submit">送出插班申請</button>
            </form>
          )}

          {makeupType === 'ONE_ON_ONE' && (
            <form onSubmit={submitOneOnOne} className="flex max-w-md flex-col gap-2">
              <select className="border p-2" value={oneOnOneForm.teacherId} onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, teacherId: e.target.value })} required>
                <option value="">選擇老師</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>{t.user.name}（{t.subjects}）</option>
                ))}
              </select>
              {oneOnOneForm.teacherId && (
                <p className="text-sm text-gray-600">
                  可補課時段：
                  {availability.length === 0
                    ? '尚未設定'
                    : availability.map((w, i) => (
                        <span key={i}>
                          週{WEEKDAYS[w.weekday]} {w.startTime}-{w.endTime}
                          {i < availability.length - 1 ? '、' : ''}
                        </span>
                      ))}
                </p>
              )}
              <input className="border p-2" type="date" value={oneOnOneForm.slotDate} onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotDate: e.target.value })} required />
              <div className="flex gap-2">
                <input className="border p-2" type="time" value={oneOnOneForm.slotStartTime} onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotStartTime: e.target.value })} />
                <input className="border p-2" type="time" value={oneOnOneForm.slotEndTime} onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotEndTime: e.target.value })} />
              </div>
              <button className="bg-black p-2 text-white" type="submit">送出一對一申請</button>
            </form>
          )}
        </>
      )}

      {message && <p className="mt-4">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, log in as the seeded student, go to `/student/leave-request` to create a leave, then `/student/makeup-request`, select the leave, submit an insertion request.
Expected: message "已送出插班申請，待行政確認"; verify with `npx prisma studio` that a `MakeupRequest` row with `status = PENDING_ADMIN` exists.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/makeup-requests/route.ts src/app/student/makeup-request
git commit -m "feat: add student makeup request UI (insertion + one-on-one)"
```

---

### Task 13: Admin — Unified makeup request review queue

**Files:**
- Create: `src/app/api/makeup-requests/pending/route.ts`
- Create: `src/app/api/makeup-requests/[id]/route.ts`
- Create: `src/app/admin/makeup-requests/page.tsx`

**Interfaces:**
- Consumes: `listPendingMakeupRequests`, `decideMakeupRequest` (Task 11).
- Produces: `GET /api/makeup-requests/pending`, `PATCH /api/makeup-requests/:id` with body `{ decision: 'APPROVED' | 'REJECTED' }`.

- [ ] **Step 1: Pending list API route**

`src/app/api/makeup-requests/pending/route.ts`:
```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listPendingMakeupRequests } from '@/lib/services/makeupRequestService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listPendingMakeupRequests());
}
```

- [ ] **Step 2: Decision API route**

`src/app/api/makeup-requests/[id]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { decideMakeupRequest } from '@/lib/services/makeupRequestService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { decision } = await req.json();
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }
  const updated = await decideMakeupRequest(params.id, decision);
  return NextResponse.json(updated);
}
```

- [ ] **Step 3: Admin UI page**

`src/app/admin/makeup-requests/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

interface PendingRow {
  id: string;
  type: 'INSERTION' | 'ONE_ON_ONE';
  leaveRequest: { student: { user: { name: string } }; class: { name: string } };
  targetClass: { name: string } | null;
  targetDate: string | null;
  teacher: { user: { name: string } } | null;
  slotDate: string | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
}

export default function AdminMakeupRequestsPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);

  async function load() {
    const res = await fetch('/api/makeup-requests/pending');
    setRows(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    await fetch(`/api/makeup-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
    load();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">待確認補課申請</h1>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">學生</th>
            <th className="p-2">原班級</th>
            <th className="p-2">類型</th>
            <th className="p-2">目標</th>
            <th className="p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-2">{r.leaveRequest.student.user.name}</td>
              <td className="p-2">{r.leaveRequest.class.name}</td>
              <td className="p-2">{r.type === 'INSERTION' ? '插班' : '一對一'}</td>
              <td className="p-2">
                {r.type === 'INSERTION'
                  ? `${r.targetClass?.name} @ ${r.targetDate ? new Date(r.targetDate).toLocaleDateString() : ''}`
                  : `${r.teacher?.user.name} @ ${r.slotDate ? new Date(r.slotDate).toLocaleDateString() : ''} ${r.slotStartTime}-${r.slotEndTime}`}
              </td>
              <td className="p-2">
                <button className="mr-2 bg-black px-3 py-1 text-white" onClick={() => decide(r.id, 'APPROVED')}>核准</button>
                <button className="bg-white border px-3 py-1" onClick={() => decide(r.id, 'REJECTED')}>拒絕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Manual verification**

With the `MakeupRequest` created in Task 12's manual test, log in as admin, go to `/admin/makeup-requests`, click 核准.
Expected: row disappears from the pending list; `npx prisma studio` shows `status = APPROVED`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/makeup-requests/pending src/app/api/makeup-requests/[id] src/app/admin/makeup-requests
git commit -m "feat: add admin makeup request review queue"
```

---

### Task 14: Teacher leave + substitute assignment (service + API + UI)

**Files:**
- Create: `src/lib/services/substituteRequestService.ts`
- Test: `src/lib/services/substituteRequestService.test.ts`
- Create: `src/app/api/substitute-requests/route.ts`
- Create: `src/app/api/substitute-requests/[id]/route.ts`
- Create: `src/app/teacher/leave-request/page.tsx`
- Create: `src/app/admin/substitute-requests/page.tsx`

**Interfaces:**
- Consumes: `prisma` (Task 5).
- Produces: `createSubstituteRequest(input: { classId: string; originalTeacherId: string; date: Date; reason: string }): Promise<SubstituteRequest>`, `listPendingSubstituteRequests(): Promise<SubstituteRequest[]>`, `assignSubstituteTeacher(id: string, substituteTeacherId: string): Promise<SubstituteRequest>`.

- [ ] **Step 1: Write the failing tests**

`src/lib/services/substituteRequestService.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createClass } from './classService';
import { createSubstituteRequest, listPendingSubstituteRequests, assignSubstituteTeacher } from './substituteRequestService';

beforeEach(async () => {
  await prisma.substituteRequest.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.user.deleteMany();
});

describe('createSubstituteRequest / listPendingSubstituteRequests', () => {
  it('creates a request with status PENDING_ASSIGNMENT and lists it', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2026, 6, 20), reason: '出差' });
    expect(req.status).toBe('PENDING_ASSIGNMENT');

    const pending = await listPendingSubstituteRequests();
    expect(pending.map((p) => p.id)).toContain(req.id);
  });
});

describe('assignSubstituteTeacher', () => {
  it('assigns a substitute teacher and marks the request ASSIGNED', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2026, 6, 20), reason: '出差' });

    const updated = await assignSubstituteTeacher(req.id, substitute.id);
    expect(updated.status).toBe('ASSIGNED');
    expect(updated.substituteTeacherId).toBe(substitute.id);

    const pending = await listPendingSubstituteRequests();
    expect(pending.map((p) => p.id)).not.toContain(req.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/services/substituteRequestService.test.ts`
Expected: FAIL — `Cannot find module './substituteRequestService'`

- [ ] **Step 3: Implement**

`src/lib/services/substituteRequestService.ts`:
```typescript
import { prisma } from '@/lib/db';

export interface CreateSubstituteRequestInput {
  classId: string;
  originalTeacherId: string;
  date: Date;
  reason: string;
}

export function createSubstituteRequest(input: CreateSubstituteRequestInput) {
  return prisma.substituteRequest.create({ data: { ...input, status: 'PENDING_ASSIGNMENT' } });
}

const SAFE_USER_SELECT = { name: true, email: true } as const;

export function listPendingSubstituteRequests() {
  return prisma.substituteRequest.findMany({
    where: { status: 'PENDING_ASSIGNMENT' },
    select: {
      id: true,
      date: true,
      reason: true,
      status: true,
      createdAt: true,
      class: true,
      originalTeacher: { select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } } },
    },
    orderBy: { date: 'asc' },
  });
}

export function assignSubstituteTeacher(id: string, substituteTeacherId: string) {
  return prisma.substituteRequest.update({
    where: { id },
    data: { substituteTeacherId, status: 'ASSIGNED' },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/services/substituteRequestService.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: API routes**

`src/app/api/substitute-requests/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { createSubstituteRequest, listPendingSubstituteRequests } from '@/lib/services/substituteRequestService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listPendingSubstituteRequests());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'TEACHER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const teacher = await prisma.teacher.findUniqueOrThrow({ where: { userId: session.user.id } });
  const body = await req.json();
  const request = await createSubstituteRequest({
    classId: body.classId,
    originalTeacherId: teacher.id,
    date: new Date(body.date),
    reason: body.reason,
  });
  return NextResponse.json(request, { status: 201 });
}
```

`src/app/api/substitute-requests/[id]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { assignSubstituteTeacher } from '@/lib/services/substituteRequestService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { substituteTeacherId } = await req.json();
  const updated = await assignSubstituteTeacher(params.id, substituteTeacherId);
  return NextResponse.json(updated);
}
```

- [ ] **Step 6: Teacher UI page**

`src/app/teacher/leave-request/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

interface ClassOption {
  id: string;
  name: string;
}

export default function TeacherLeaveRequestPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [form, setForm] = useState({ classId: '', date: '', reason: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/classes').then((r) => r.json()).then(setClasses);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/substitute-requests', { method: 'POST', body: JSON.stringify(form) });
    setMessage(res.ok ? '已送出，行政將安排代課老師' : '送出失敗');
    setForm({ classId: '', date: '', reason: '' });
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">請假/調課申請（代課安排）</h1>
      <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-2">
        <select className="border p-2" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
          <option value="">選擇班級</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input className="border p-2" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        <input className="border p-2" placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
        <button className="bg-black p-2 text-white" type="submit">送出</button>
      </form>
      {message && <p className="mt-4">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 7: Admin UI page**

`src/app/admin/substitute-requests/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface PendingRow {
  id: string;
  date: string;
  reason: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
}

export default function AdminSubstituteRequestsPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});

  async function load() {
    const [reqRes, teacherRes] = await Promise.all([fetch('/api/substitute-requests'), fetch('/api/teachers')]);
    setRows(await reqRes.json());
    setTeachers(await teacherRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function assign(id: string) {
    const substituteTeacherId = selected[id];
    if (!substituteTeacherId) return;
    await fetch(`/api/substitute-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ substituteTeacherId }) });
    load();
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">待安排代課</h1>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">班級</th>
            <th className="p-2">原老師</th>
            <th className="p-2">日期</th>
            <th className="p-2">原因</th>
            <th className="p-2">指派代課</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b">
              <td className="p-2">{r.class.name}</td>
              <td className="p-2">{r.originalTeacher.user.name}</td>
              <td className="p-2">{new Date(r.date).toLocaleDateString()}</td>
              <td className="p-2">{r.reason}</td>
              <td className="p-2">
                <select className="border p-2" onChange={(e) => setSelected({ ...selected, [r.id]: e.target.value })}>
                  <option value="">選擇代課老師</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>{t.user.name}</option>
                  ))}
                </select>
                <button className="ml-2 bg-black px-3 py-1 text-white" onClick={() => assign(r.id)}>指派</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/services/substituteRequestService.ts src/lib/services/substituteRequestService.test.ts src/app/api/substitute-requests src/app/teacher/leave-request src/app/admin/substitute-requests
git commit -m "feat: add teacher leave request and admin substitute assignment"
```

---

### Task 15: Role dashboards, home redirect, and manual smoke test

**Files:**
- Create: `src/app/page.tsx` (replace placeholder — redirects by role)
- Create: `src/app/admin/page.tsx`
- Create: `src/app/teacher/page.tsx`
- Create: `src/app/student/page.tsx`

**Interfaces:**
- Consumes: `authOptions` (Task 5), `listPendingMakeupRequests` (Task 11), `listPendingSubstituteRequests` (Task 14).

- [ ] **Step 1: Home page redirects by role**

`src/app/page.tsx`:
```tsx
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  if (session.user.role === 'ADMIN') redirect('/admin');
  if (session.user.role === 'TEACHER') redirect('/teacher');
  redirect('/student');
}
```

- [ ] **Step 2: Admin dashboard**

`src/app/admin/page.tsx`:
```tsx
import { listPendingMakeupRequests } from '@/lib/services/makeupRequestService';
import { listPendingSubstituteRequests } from '@/lib/services/substituteRequestService';
import Link from 'next/link';

export default async function AdminDashboard() {
  const [pendingMakeups, pendingSubstitutes] = await Promise.all([
    listPendingMakeupRequests(),
    listPendingSubstituteRequests(),
  ]);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">行政儀表板</h1>
      <ul className="mb-6 flex flex-col gap-2">
        <li><Link className="underline" href="/admin/makeup-requests">待確認補課申請：{pendingMakeups.length} 筆</Link></li>
        <li><Link className="underline" href="/admin/substitute-requests">待安排代課：{pendingSubstitutes.length} 筆</Link></li>
      </ul>
      <nav className="flex gap-4">
        <Link className="underline" href="/admin/teachers">老師名單</Link>
        <Link className="underline" href="/admin/students">學生名單</Link>
        <Link className="underline" href="/admin/classes">班級名單</Link>
      </nav>
    </div>
  );
}
```

- [ ] **Step 3: Teacher dashboard**

`src/app/teacher/page.tsx`:
```tsx
import Link from 'next/link';

export default function TeacherDashboard() {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">老師首頁</h1>
      <nav className="flex flex-col gap-2">
        <Link className="underline" href="/teacher/leave-request">請假/調課申請</Link>
        <Link className="underline" href="/teacher/availability">設定我的可補課時段</Link>
      </nav>
    </div>
  );
}
```

- [ ] **Step 4: Student dashboard**

`src/app/student/page.tsx`:
```tsx
import Link from 'next/link';

export default function StudentDashboard() {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-bold">學生首頁</h1>
      <nav className="flex flex-col gap-2">
        <Link className="underline" href="/student/leave-request">請假申請與紀錄</Link>
        <Link className="underline" href="/student/makeup-request">申請補課</Link>
      </nav>
    </div>
  );
}
```

- [ ] **Step 5: Full test suite run**

Run: `npm test`
Expected: all tests across `src/lib/**/*.test.ts` pass.

> **Amended after Task 14:** `npm test` only runs Vitest against the service layer — it never exercises Next.js's own build/lint/type pipeline. A malformed dynamic-route directory name (`\[id\]` instead of `[id]`) and two ESLint `no-explicit-any` errors both went undetected through 9 tasks' worth of `npm test` runs and were only caught when a reviewer thought to run a full build. Add this as its own required step before the manual smoke test:

- [ ] **Step 5b: Full production build**

Run: `npx next build`
Expected: `✓ Compiled successfully`, no ESLint errors, no TypeScript errors, and every expected route (including all dynamic `[id]` routes) appears in the build's route table.

- [ ] **Step 6: Manual smoke test (golden path)**

Run: `npm run dev`, then in a browser:
1. Log in as `admin@example.com` / `password123` → `/admin` shows dashboard with counts.
2. Add a second teacher and a second class (same subject/level as the seeded one) via `/admin/teachers` and `/admin/classes`.
3. Log in as `student@example.com` / `password123` → submit a leave request on `/student/leave-request`.
4. On `/student/makeup-request`, submit an insertion request to the new class, then a one-on-one request to the seeded teacher (using the seeded Wednesday 16:00-18:00 availability).
5. Log in as `teacher@example.com` / `password123` → confirm `/teacher/availability` shows the seeded window, submit a leave request on `/teacher/leave-request`.
6. Log back in as admin → approve/reject the makeup requests on `/admin/makeup-requests`, assign a substitute on `/admin/substitute-requests`.

Expected: no console errors; every status transition described in the spec (`docs/superpowers/specs/2026-07-14-tutoring-makeup-system-design.md`) is observable end-to-end.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx src/app/admin/page.tsx src/app/teacher/page.tsx src/app/student/page.tsx
git commit -m "feat: add role dashboards and home redirect"
```
