# Admin Edit + Student Class Enrollment — Design

## Problem

Two related gaps found while preparing the system for real (parent-facing) use:

1. **No enrollment.** `createStudent` never creates a `ClassEnrollment`. The
   schema and an `enrollStudent()` service function already exist (added
   for the makeup-request insertion flow), but no admin UI ever calls the
   `POST /api/classes/[id]/enrollments` endpoint. A student can exist in
   the system with zero classes attached to them.
2. **No edit, anywhere.** `teacherService` / `studentService` /
   `classService` only have `createX` / `listX`. The admin teachers,
   students, and classes pages (`/admin/teachers`, `/admin/students`,
   `/admin/classes`) can only add new rows — nothing can be corrected or
   changed afterward (typo in a name, phone number changes, a class's
   meeting time changes, a forgotten password, etc.).

These compound: without enrollment, the student leave-request page's class
picker (`GET /api/classes` for a STUDENT session) falls back to listing
**every class in the system**, not the classes the student is actually in
— so a student (or a parent using the student's account) has no reliable
way to know which class a given leave request is really "for," and the
picked class's subject/level is what later gates makeup-class eligibility.

## Scope

A student can be enrolled in multiple classes at once (e.g. math + English
concurrently) — the existing many-to-many `ClassEnrollment` join table
already models this correctly; nothing changes there.

**In scope:**
- `PATCH` update capability for Teacher, Student, and Class records —
  name/subject/phone/level/schedule fields, email, and an optional
  password reset, all editable from one edit surface per entity.
- Student enrollment management (add/remove classes) integrated into the
  student edit surface, *and* a symmetric "manage roster" surface on the
  class side (view/remove enrolled students from a class row).
- Student leave-request page's class picker changes to show only the
  logged-in student's enrolled classes.
- Server-side enforcement that a leave request's `classId` is one the
  student is actually enrolled in (not just a UI-level restriction).

**Out of scope (not touched by this spec):**
- Bulk/CSV import of enrollments.
- Enrollment history/audit trail (who enrolled whom, when).
- Any change to how makeup-request eligibility is computed
  (`listClassesBySubjectAndLevel` already filters by subject+level
  correctly — see the separate test-coverage fix already committed).

## Data layer

New service functions (each mirrors the existing `createX` function's
shape and safe-select projections):

- `updateTeacher(id, input: Partial<{name, email, password, subjects, phone}>)`
- `updateStudent(id, input: Partial<{name, email, password, parentPhone}>)`
- `updateClass(id, input: Partial<{name, subject, level, teacherId, weekday, startTime, endTime}>)`
- `setStudentEnrollments(studentId, classIds: string[])` — diffs the
  student's current `ClassEnrollment` rows against `classIds` and
  creates/deletes only what changed (not a delete-all-then-recreate, to
  avoid destroying unrelated timestamps/ids if those ever matter later).
- `listStudentEnrolledClasses(studentId)` — used by the leave-request
  page's class picker instead of `listClassesForBooking()`.

`name`/`email`/`password` live on `User`, not `Teacher`/`Student` directly
(see schema), so `updateTeacher`/`updateStudent` write to both `User` and
the role table in one `prisma.$transaction` (matching the existing pattern
in `createOneOnOneMakeupRequest`).

Password: only hashed and updated if a new one is provided; omitted or
empty means "leave unchanged." Email: on a Prisma `P2002` unique-constraint
violation, the API translates it to a friendly `EMAIL_TAKEN` error instead
of letting the raw Prisma error surface (matching how
`createOneOnOneMakeupRequest`'s errors are already translated into
friendly strings for the frontend).

## API layer

New routes, all ADMIN-only (same guard pattern as the existing `POST`
handlers on these same route files):

- `PATCH /api/teachers/[id]`
- `PATCH /api/students/[id]` — body may include `classIds: string[]` to
  sync enrollments in the same request as the profile update
- `PATCH /api/classes/[id]`

Existing `GET /api/classes`: for a STUDENT session, switches from
`listClassesForBooking()` (all classes) to `listStudentEnrolledClasses(studentId)`.

Existing `POST /api/leave-requests`: before calling `createLeaveRequest`,
verifies a `ClassEnrollment` exists for `(studentId, classId)`; if not,
returns a 400 with a friendly error instead of silently creating a leave
request for a class the student was never in.

## UI layer

**Pattern: modal dialog**, opened by a new "編輯" button per `DataTable`
row on all three admin list pages. Chosen over inline row-expansion (gets
cramped once the student modal also has a class-checkbox list) and over
dedicated `/admin/*/[id]/edit` pages (six new routes for what's
fundamentally one form per entity — more surface area than this warrants).
The modal reuses the existing `Input`/`Select`/`Button` primitives from the
Task 1–2 design-token work, prefilled with the row's current values.

- **Teacher edit modal**: 姓名 / Email / 任教科目 / 電話 / 新密碼（留空＝不變更）
- **Student edit modal**: 姓名 / Email / 家長電話 / 新密碼（留空＝不變更）, plus
  a checkbox list of all classes (grouped by 科目, showing 班名 + weekday/time)
  with the student's current enrollments pre-checked
- **Class edit modal**: 班名 / 科目 / 等級 / 老師（Select）/ 星期 / 起訖時間,
  plus a read-only-with-remove list of currently enrolled students (adding
  a student to a class from this side reuses the same
  `setStudentEnrollments` semantics, just entered from the class's row
  instead of the student's)

Each modal's submit does one `PATCH` request, then reloads the page's
existing `load()` list (same reload pattern already used by the "新增"
forms on these pages).

## Error handling

- `EMAIL_TAKEN`: shown as 此 Email 已被使用 next to the email field.
- Leave-request creation with a `classId` the student isn't enrolled in:
  400 with a friendly message shown in the existing `message` state on the
  leave-request page (same pattern as the makeup-request page's error
  branches).
- Removing a student's last remaining enrollment, or a class's last
  remaining student: allowed — no minimum-enrollment constraint exists
  anywhere else in the system, so this spec doesn't invent one.

## Testing

- Service-layer tests for `updateTeacher`/`updateStudent`/`updateClass`
  (partial update leaves untouched fields alone; password-omitted leaves
  the hash unchanged; email-collision throws a catchable error).
- `setStudentEnrollments` test: starting from an existing enrollment set,
  confirm it only touches the diff (adds new ones, removes dropped ones,
  leaves unchanged ones' rows alone).
- `listStudentEnrolledClasses` test: a student enrolled in class A but not
  B only sees A.
- API-level test (or service-level equivalent) confirming
  `POST /api/leave-requests` rejects a `classId` the student isn't
  enrolled in.
