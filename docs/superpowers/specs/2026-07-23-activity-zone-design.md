# 活動專區 (Activity Zone) — Design

## Problem

The center runs one-off or multi-day activities (camps, lectures,
competitions, observation classes) that today have no home in the system —
they get announced outside the app. Admins need a way to publish these
activities with a capacity cap and an optional lead teacher; students need
to browse and self-register; teachers need to see what they've been
assigned to lead.

This is a new, independent feature. It does not touch or generalize the
existing 弈廳 (Go Hall) feature — that stays exactly as-is, Go-specific,
single-date-per-session. Activity Zone is a separate registration system
for everything else.

## Scope

**In scope:**
- Admin: create an activity (title, description, category, location,
  start/end date, capacity, optional lead teacher), view all activities,
  view/manage each activity's full roster (real names), remove a student's
  registration, delete an activity.
- Assigned teacher: read-only view of activities they're leading and each
  one's full roster (real names).
- Student: browse activities that haven't ended yet, register (auto-
  confirmed if not full), self-cancel their own registration, view their
  own registration history.
- Student-facing rosters only: names are masked, reusing the existing
  `maskName` helper (`src/lib/maskName.ts`) — no new masking logic.
- Fixed category enum (營隊/講座/比賽/觀摩課), selected from a dropdown at
  creation.
- Nav entry for all three roles.

**Out of scope (not touched by this spec):**
- Editing an already-created activity — matches the existing Go Hall
  precedent (create + delete only, no update path); a mistake is fixed by
  deleting and recreating.
- Cover images / file uploads — text-only, matching the rest of the app's
  current UI (no image upload exists anywhere else in the system today).
- Dashboard summary widgets on the role home pages — the Activity Zone
  page itself is the only surface; no `AppShell`-wrapped dashboard section
  is added (unlike Go Hall's 弈廳管理/弈廳報名紀錄 widgets).
- Visibility scoping by subject/class — every student sees every activity,
  no per-class targeting.
- Waitlists, payment/fee handling, recurring activities, notifications.

## Data layer

Two new tables, independent of `GoHallSession`/`GoHallRegistration`:

```prisma
enum ActivityCategory {
  CAMP          // 營隊
  LECTURE       // 講座
  COMPETITION   // 比賽
  OBSERVATION   // 觀摩課
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

`Teacher` and `Student` each get the corresponding back-relation array
field, same pattern as every other relation on those models.

All date display reuses the existing `formatDateWithWeekday` helper
(established convention: every date in this app renders as 日期（星期）,
e.g. `2026/8/1（六）`). A single-day activity (`startDate === endDate`)
renders as one formatted date; a multi-day one renders as
`start ~ end`, each side individually formatted.

`teacherId` is nullable — not every activity needs a lead teacher (e.g. an
admin-run field trip). `startDate`/`endDate` cover both single-day
activities (`startDate === endDate`) and multi-day ones without needing
separate per-day rows, unlike Go Hall's one-row-per-date model — this
system doesn't need to cancel/inspect individual days independently, so a
single range row is sufficient.

Service functions (`src/lib/services/activityService.ts`), mirroring
`goHallService.ts`'s shape:

- `createActivity(input)` — creates one `Activity` row from the admin
  form fields.
- `listAllActivities()` — admin: every activity, soonest `startDate`
  first, with registration count and full roster (real names).
- `listActivitiesForTeacher(teacherId)` — teacher: only activities where
  `teacherId` matches, same shape as `listAllActivities`.
- `listOpenActivitiesForStudent()` — student browse view: activities that
  haven't ended (`endDate >= today`), with `registeredCount`/`capacity`.
- `listRegistrationsForStudent(studentId)` — student's own registration
  history.
- `registerForActivity(activityId, studentId)` — wrapped in a
  `prisma.$transaction` with `Serializable` isolation and the same
  retry-on-conflict loop used by `registerForSession`. Counts current
  registrations inside the transaction; throws `ACTIVITY_FULL` if
  `count >= capacity`. `@@unique([activityId, studentId])` is the second
  line of defense against a double-click double-registering.
- `cancelRegistration(id, studentId)` — deletes the registration row only
  if it belongs to `studentId`.
- `deleteActivity(id)` — no `onDelete: Cascade` on purpose (matches Go
  Hall), so this explicitly deletes the activity's registrations first
  inside a transaction, then the activity. Confirmation copy lives in the
  UI layer.
- `adminRemoveRegistration(id)` — same delete as `cancelRegistration` but
  without the ownership check.

## API layer

New routes, following the existing `getServerSession` + role-check guard
pattern used on every route in this app:

- `GET /api/activities` — role-aware: ADMIN gets `listAllActivities()`,
  TEACHER gets `listActivitiesForTeacher(...)`, STUDENT gets
  `listOpenActivitiesForStudent()`.
- `POST /api/activities` — ADMIN-only. Body: `{ title, description,
  category, location, startDate, endDate, capacity, teacherId }`
  (`teacherId` optional).
- `DELETE /api/activities/[id]` — ADMIN-only.
- `GET /api/activities/[id]` — full detail for one activity + roster.
  Role-aware roster shape: ADMIN and the activity's own assigned TEACHER
  get real names; STUDENT gets masked names.
- `POST /api/activity-registrations` — STUDENT-only. Body:
  `{ activityId }`. Returns `ACTIVITY_FULL` (409) if capacity is hit.
- `DELETE /api/activity-registrations/[id]` — STUDENT or ADMIN. STUDENT
  requests are ownership-checked; ADMIN requests skip the ownership check.
  Same single route, branching on `session.user.role`, matching the
  existing `DELETE /api/go-hall-registrations/[id]` pattern.

## UI layer

**Admin — `/admin/activities`:**
- Collapsed "＋ 新增活動" form (same collapse-toggle pattern as
  老師/學生/班級/弈廳 forms): 標題 / 描述 / 分類 (Select) / 地點 / 起始日期
  / 結束日期 / 人數上限 / 帶領老師 (Select, optional — empty option
  included).
- `DataTable` below: 標題 / 分類 / 日期區間 / 老師 / 人數（已報名／上限）/
  狀態 / 操作. Row click (or "查看名單" in 操作) opens the existing `Modal`
  roster pattern with full real names and a 移除 action per student, plus
  a 刪除活動 action with a "已有 N 人報名，刪除將一併取消他們的報名" confirm
  copy (same wording style as Go Hall's delete confirm).

**Teacher — `/teacher/activities`:**
- Read-only `DataTable`: 標題 / 分類 / 日期區間 / 人數（已報名／上限）. Row
  click opens the same roster modal, real names, no remove/delete actions.

**Student — `/student/activities`:**
- "活動列表" list: 標題 / 分類 / 日期區間 / 地點 / 老師 / 剩餘名額, with a
  報名 button (disabled once full) and a confirm dialog before registering
  ("確定要報名這個活動嗎？", mirroring Go Hall's confirm-before-register
  fix).
- "我的報名紀錄" list: activities the student has registered for, with a
  取消 button (confirm dialog, same wording as Go Hall's cancel flow).
  Clicking through opens the roster `Modal`, masked names.

**Nav (`AppShell.tsx`):** 活動專區 added to `NAV_LINKS.ADMIN`,
`NAV_LINKS.TEACHER`, and `NAV_LINKS.STUDENT`, pointing at
`/admin/activities`, `/teacher/activities`, `/student/activities`
respectively. Existing 弈廳 entries are untouched.

## Error handling

- `ACTIVITY_FULL` (409) on `POST /api/activity-registrations`: shown as an
  inline message on the student browse page; the 報名 button also disables
  once the client-side `registeredCount` already shows full, guarding the
  race between two students clicking at once.
- Activity deletion with existing registrations: no error — the confirm
  dialog is the guard, per Scope.
- Ownership violation on `DELETE /api/activity-registrations/[id]` (a
  student trying to cancel someone else's registration): 403, matching the
  existing guard style.

## Testing

- `createActivity` / `listAllActivities` / `listActivitiesForTeacher` /
  `listOpenActivitiesForStudent` / `listRegistrationsForStudent`:
  service-level coverage matching the existing service test style.
- `registerForActivity`: concurrency test mirroring
  `registerForSession`'s test — two concurrent registrations against an
  activity with 1 remaining spot, exactly one succeeds.
- `cancelRegistration`: rejects when `studentId` doesn't own the
  registration.
- `deleteActivity`: registrations are gone afterward too (no orphaned
  rows).
- `listOpenActivitiesForStudent`: an activity whose `endDate` is in the
  past is excluded; one whose `endDate` is today or later is included.
