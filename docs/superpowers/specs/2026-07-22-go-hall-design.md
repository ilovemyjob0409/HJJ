# 弈廳 (Go Hall) — Design

## Problem

Students currently have no way to sign up for open, unscheduled Go-playing
time at the tutoring center ("弈廳" — the physical room where students come
to play Go outside of their regular enrolled classes). Admins need a way to
open specific dates for this, cap attendance per date, and assign a
supervising teacher; students need to browse open dates and reserve a spot.

## Scope

**In scope:**
- Admin: batch-create concrete session dates for a given weekday within a
  chosen month, with the ability to exclude specific generated dates (e.g.
  a holiday) before confirming.
- Admin: view all sessions, view/manage each session's full roster (real
  names), remove a student's registration.
- Assigned teacher: read-only view of the sessions they're supervising and
  each one's full roster (real names).
- Student: browse currently open sessions, register (auto-confirmed if not
  full), self-cancel their own registration, view their own registration
  history.
- Student-facing rosters only: names are masked (see "Name masking" below).
- Dashboard integration for all three roles, with click-through from a
  dashboard row to the full session record (reusing the existing
  highlight-and-scroll pattern from the admin dashboard's leave-record →
  makeup-request link).

**Out of scope (not touched by this spec):**
- Recurring/standing registration ("every Saturday automatically",
  rejected during brainstorming in favor of per-date registration).
- Notifications (email/SMS) to students when a session they registered for
  is deleted — the delete-confirmation dialog is the only signal, matching
  the rest of the app's no-notification-system baseline.
- Waitlists for full sessions.
- Payment/fee handling.
- Skill/rank-based opponent matchmaking.

## Data layer

Two new tables, modeled after the existing `Class` / `ClassEnrollment`
pattern (a real row per concrete date, not a computed/virtual occurrence —
chosen so a single date can be deleted or inspected independently, e.g. a
holiday cancellation):

```prisma
model GoHallSession {
  id            String              @id @default(cuid())
  date          DateTime
  startTime     String
  endTime       String
  capacity      Int
  teacherId     String
  teacher       Teacher             @relation(fields: [teacherId], references: [id])
  registrations GoHallRegistration[]
  createdAt     DateTime            @default(now())
}

model GoHallRegistration {
  id        String        @id @default(cuid())
  sessionId String
  session   GoHallSession @relation(fields: [sessionId], references: [id])
  studentId String
  student   Student       @relation(fields: [studentId], references: [id])
  createdAt DateTime      @default(now())

  @@unique([sessionId, studentId])
}
```

`Teacher` and `Student` each get the corresponding back-relation array
field, same as every other relation on those models today.

Service functions (`src/lib/services/goHallService.ts`):

- `previewSessionDates(weekday: number, month: string)` — pure date-math
  helper (no DB access): returns every date in the given calendar month
  that falls on `weekday`. Used by the admin UI to render the
  checklist-with-exclusions before anything is written.
- `createSessions(dates: Date[], startTime, endTime, capacity, teacherId)`
  — bulk-creates one `GoHallSession` per date. Re-running for a
  date that already has a session for that weekday/time is *not*
  deduplicated automatically in v1 — the admin sees existing sessions in
  the list below the form and is expected not to double-generate
  (matches the "no invented safety net beyond what's asked" scope call
  from the earlier admin-edit spec).
- `listAllSessions()` — admin: every session, soonest first, with
  registration count and full roster (real names).
- `listSessionsForTeacher(teacherId)` — teacher: only sessions where
  `teacherId` matches, same shape as `listAllSessions`.
- `listOpenSessionsForStudent()` — student browse view: upcoming sessions
  (`date >= today`) with `registeredCount`/`capacity`, so the UI can show
  remaining spots and disable full ones.
- `listRegistrationsForStudent(studentId)` — student's own registration
  history, for their dashboard section and cancel list.
- `registerForSession(sessionId, studentId)` — wrapped in a
  `prisma.$transaction` with `Serializable` isolation and a retry-on-
  conflict loop, reusing the exact concurrency pattern already documented
  in `src/lib/db.ts` / exercised by `makeupRequestService.test.ts`. Counts
  current registrations for the session inside the transaction; throws
  `SESSION_FULL` if `count >= capacity`. The `@@unique([sessionId,
  studentId])` constraint is the second line of defense against a
  double-click double-registering.
- `cancelRegistration(id, studentId)` — deletes the registration row only
  if it belongs to `studentId` (ownership check in the service, not just
  the UI), mirroring how other self-service delete/cancel actions in this
  app are guarded.
- `deleteSession(id)` — deletes the session; `onDelete: Cascade` isn't set
  in the schema on purpose (Prisma default is restrict), so this function
  explicitly deletes the session's registrations first inside a
  transaction, then the session. The confirmation copy for this lives in
  the UI layer (see below).
- `adminRemoveRegistration(id)` — same delete as `cancelRegistration` but
  without the ownership check, for the admin roster-management view.

## API layer

New routes, following the existing `getServerSession` + role-check guard
pattern used on every route in this app:

- `GET /api/go-hall-sessions` — role-aware: ADMIN gets
  `listAllSessions()`, TEACHER gets `listSessionsForTeacher(session.user.id
  → teacher.id)`, STUDENT gets `listOpenSessionsForStudent()`.
- `POST /api/go-hall-sessions` — ADMIN-only. Body:
  `{ dates: string[], startTime, endTime, capacity, teacherId }` (the
  `dates` array is whatever the admin left checked after excluding
  holidays in the preview step — no separate `/preview` endpoint needed
  since `previewSessionDates` is pure date arithmetic and runs client-side
  in the admin form).
- `DELETE /api/go-hall-sessions/[id]` — ADMIN-only.
- `GET /api/go-hall-sessions/[id]` — full detail for one session
  (date/time/teacher/capacity + roster). Role-aware roster shape: ADMIN
  and the session's own assigned TEACHER get real names; STUDENT gets
  masked names (see below). Used by all three "click a dashboard row →
  land on this session's full record" destinations.
- `POST /api/go-hall-registrations` — STUDENT-only. Body:
  `{ sessionId }`. Returns `SESSION_FULL` (409) if capacity is hit.
- `DELETE /api/go-hall-registrations/[id]` — STUDENT or ADMIN. STUDENT
  requests are ownership-checked (`cancelRegistration`); ADMIN requests
  skip the ownership check (`adminRemoveRegistration`). Same single route,
  branching on `session.user.role`, matching how other routes in this app
  (e.g. `GET /api/classes`) already branch behavior by role rather than
  duplicating routes per role.

## Name masking

```ts
function maskName(name: string): string {
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + 'Ｏ';
  return name[0] + 'Ｏ'.repeat(name.length - 2) + name[name.length - 1];
}
```

Applied only when building the roster response for a STUDENT-role
requester (`GET /api/go-hall-sessions/[id]`). ADMIN and the assigned
TEACHER always receive real names — masking happens server-side in the API
layer, not the client, so a student can't bypass it by reading the network
response.

## UI layer

**Admin — `/admin/go-hall`:**
- Collapsed "＋ 開放弈廳場次" form (same collapse-toggle pattern as the
  existing 新增老師/學生/班級 forms): 星期幾 (Select) / 月份 (month
  picker) / 開始時間 / 結束時間 / 人數上限 / 指定老師 (Select). Submitting
  the *first* step calls `previewSessionDates` client-side and renders a
  checklist of matching dates, all pre-checked; admin unchecks any to
  exclude, then confirms to actually `POST`.
- `DataTable` below: 日期 / 時間 / 老師 / 人數（已報名／上限） / 操作. Row
  click (or a "查看名單" link in 操作) opens the existing `Modal` pattern
  (same one used for the Class roster view) showing the full real-name
  roster with a 移除 action per student, plus a 刪除場次 action with the
  "已有 N 人報名，刪除將一併取消他們的報名" confirm copy.

**Teacher — `/teacher/go-hall`:**
- Read-only `DataTable`: 日期 / 時間 / 人數（已報名／上限）. Row click
  opens the same roster modal, real names, no remove/delete actions.

**Student — `/student/go-hall`:**
- "開放中的場次" list: 日期 / 時間 / 老師 / 剩餘名額, with a 報名 button
  disabled once full.
- "我的報名紀錄" list: sessions the student has registered for, with a
  取消 button. Clicking through opens the same roster `Modal` pattern as
  admin/teacher, but with masked names.

**Dashboards (`AppShell`-wrapped role pages):**
- Admin dashboard: new 弈廳管理 `DataTable` section, columns 日期 / 人數 /
  狀態 (badge: 尚有名額 in `approved` green / 已額滿 in `rejected` red,
  computed from `registeredCount >= capacity`, not a new Prisma enum).
  Row click → `/admin/go-hall?highlight=<sessionId>`.
- Teacher dashboard: same 弈廳管理 section, scoped to
  `listSessionsForTeacher`. Row click → `/teacher/go-hall?highlight=<id>`.
- Student dashboard: 弈廳報名紀錄 section, same 日期／人數／狀態 columns,
  scoped to `listRegistrationsForStudent`. Row click →
  `/student/go-hall?highlight=<id>`.
- All three target pages read the `highlight` search param and reuse the
  existing scroll-into-view + `rowClassName` highlight treatment already
  built for `/admin/makeup-requests`.

**Nav:** 弈廳 added to `NAV_LINKS.ADMIN` and `NAV_LINKS.STUDENT` in
`AppShell.tsx`. Teachers reach `/teacher/go-hall` only via their dashboard
row-click and the dashboard section header (kept off the teacher tab bar
since it's a secondary, read-only view — consistent with how substitute
duty assignments today don't get their own teacher nav tab either).

## Error handling

- `SESSION_FULL` (409) on `POST /api/go-hall-registrations`: shown as an
  inline message on the student browse page; the "報名" button also
  disables once the client-side `registeredCount` already shows full, so
  this mostly guards the race between two students clicking at once.
- Session deletion with existing registrations: no error — the confirm
  dialog *is* the guard, per Scope.
- Ownership violation on `DELETE /api/go-hall-registrations/[id]` (a
  student trying to cancel someone else's registration by guessing an id):
  403, matching the guard style already used elsewhere in the API layer.

## Testing

- `previewSessionDates`: correct dates for a given weekday+month,
  including edge months (28/29/30/31-day months) and a month with only
  four occurrences of the weekday vs. five.
- `createSessions` / `listAllSessions` / `listSessionsForTeacher` /
  `listOpenSessionsForStudent` / `listRegistrationsForStudent`: basic
  service-level coverage matching the existing service test style.
- `registerForSession`: concurrency test mirroring
  `makeupRequestService.test.ts` — two concurrent registrations against a
  session with 1 remaining spot, exactly one succeeds.
- `cancelRegistration`: rejects when `studentId` doesn't own the
  registration.
- `maskName`: 1/2/3/4+ character names.
- `deleteSession`: registrations are gone afterward too (no orphaned
  rows).
