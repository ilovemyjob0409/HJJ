# 班級週課表 (Class Weekly Timetable) — Design

## Problem

The admin classes page (`/admin/classes`) only shows classes as a flat
table — there's no way to see the week's schedule at a glance. Admins want
a button that opens a visual weekly timetable: every class laid out by
weekday, color-coded by subject, so schedule gaps and overlaps are
obvious.

## Scope

**In scope:**
- A "週課表" button in the top-right of the `/admin/classes` page header,
  opening a modal with all classes arranged into a 7-day grid (日–六).
- Classes within a day are stacked top-to-bottom by start time (no
  hour-scaled axis — this is not a to-scale calendar).
- Each class card shows: class name (with the redundant weekday substring
  stripped, since it's implied by the column), time range, and
  "老師・程度" on a third line.
- Cards are colored by subject. Subject is freeform text (not an enum), so
  colors are admin-configurable and persisted, not hardcoded per name.
- A small accent bar on the right edge of each card represents 程度
  (level) — level is also freeform text, but level colors are **not**
  admin-managed: they're derived deterministically by hashing the level
  string against a fixed palette, so any value works with zero
  maintenance.
- "色塊調整" button (top of the modal, next to the subject legend) expands
  a panel listing every distinct subject currently in use (auto-derived
  from `Class.subject`, not manually typed) with a color swatch per
  subject. Subjects with no assigned color show a "尚未設定" tag and
  render as neutral gray everywhere until set.
- Column header per weekday is a pill-shaped badge (brand yellow) showing
  just the single character (日/一/二/三/四/五/六); column bodies
  alternate background shade (odd/even) for scan-ability.
- Empty weekday columns show a muted "無課程" placeholder.

**Out of scope:**
- Editing a class's time/teacher/etc. from within the timetable — it's a
  read-only view; edits still happen through the existing 編輯 modal on
  the table below.
- Hour-scaled/to-scale layout (a real calendar grid) — rejected during
  brainstorming in favor of the simpler stacked-by-time-order column.
- Level color management — only subject colors are persisted/editable.
- Teacher or student-facing timetable views — this is the admin classes
  page only.

## Data layer

One new table for admin-configurable subject colors:

```prisma
model SubjectColor {
  id      String @id @default(cuid())
  subject String @unique
  color   String
}
```

Not related to `Class` by foreign key — `Class.subject` is matched by
plain string equality, the same way `Class.subject`/`Class.level` are
already freeform, unvalidated text today (no enum exists for either).

Service functions (`src/lib/services/subjectColorService.ts`):
- `listSubjectColors()` — every saved `{subject, color}` pair.
- `setSubjectColor(subject, color)` — upsert on the unique `subject`
  column, so re-picking a color for the same subject updates in place
  rather than erroring on a duplicate.

Shared pure-function utilities (no DB, colocated with the timetable UI
since they're presentation formatting, not business logic — mirrors the
existing `src/lib/maskName.ts` pattern):
- `stripWeekday(name: string): string` — removes `週[日一二三四五六]`
  substrings (handles both the prefix form like `週一基礎2A` and the
  parenthetical form like `MPM（週一）`), then collapses any resulting
  empty `（）` left behind.
- `levelColor(level: string): string` — sums char codes into a hash
  (`hash = hash * 31 + charCode`), mods into an 8-color fixed pastel
  palette (`#F2C14E #6FCF97 #EB5757 #56CCF2 #BB6BD9 #F2994A #27AE60
  #9B51E0`). Same string always yields the same color; no persistence
  needed since it's not meant to be curated.

## API layer

New routes, following the existing `getServerSession` + role-check guard
pattern:

- `GET /api/subject-colors` — ADMIN-only. Returns `listSubjectColors()`.
- `POST /api/subject-colors` — ADMIN-only. Body `{ subject, color }`,
  calls `setSubjectColor`.

No new endpoint for the class data itself — the timetable modal reuses
the classes already fetched by the existing `GET /api/classes` call on
the page (the admin/classes page already loads the full class list for
its table), just grouped client-side into the 7-day buckets.

## UI layer

**`Modal` component change:** today `Modal.tsx` hardcodes `max-w-md`,
too narrow for a 7-column grid. Add an optional `maxWidthClassName` prop
(default `'max-w-md'`, preserving every existing caller's current
behavior unchanged) so the timetable modal alone can pass a wider value
(e.g. `max-w-5xl`).

**`/admin/classes` page header:** the existing row (搜尋 input + ＋新增班級
button) gets a third element, right-aligned — "週課表" button that opens
the new modal.

**New component `src/app/admin/classes/TimetableModal.tsx`** (co-located
with the page, mirroring `src/app/admin/LeaveRecordsTable.tsx`'s
page-specific-component precedent):
- Receives the already-fetched `classes` array as a prop (no separate
  fetch) plus fetches subject colors itself on open via
  `GET /api/subject-colors`.
- Renders the `Modal` (wide variant) with:
  - Header: title "週課表", subject-color legend (dot + label per
    distinct subject in use), and the "色塊調整" button.
  - Grid: 7 columns, pill weekday badges, zebra-striped column bodies,
    classes stacked by `startTime` within each column, "無課程" for empty
    columns.
  - Cards: `background: SUBJECT_COLOR[subject] ?? neutral-gray`, right
    accent bar `background: levelColor(level)`, text = `stripWeekday(name)`
    / `${startTime}-${endTime}` / `${teacher}・${level}`.
- "色塊調整" panel (button-toggled open/closed, animated via
  `grid-template-rows` — not `max-height`/`padding`, which cause layout
  thrash): one row per distinct subject found in the current `classes`
  array, each with a native `<input type="color">` swatch. Changing a
  swatch calls `POST /api/subject-colors` and updates local state so the
  legend/cards recolor immediately. Subjects with no `SubjectColor` row
  yet show the "尚未設定" tag and the neutral fallback swatch value.

## Error handling

- `POST /api/subject-colors` with a missing/invalid body: 400, matching
  the guard style used elsewhere (no other validation needed — `color` is
  just stored as whatever hex string the native color input produced).
- No delete/remove path for a subject color in this scope — if a subject
  stops being used by any class, its color row is simply orphaned and
  harmless (not cleaned up), consistent with this codebase's existing
  "no invented safety net beyond what's asked" precedent.

## Testing

- `stripWeekday`: prefix form (`週一基礎2A` → `基礎2A`), parenthetical form
  (`MPM（週一）` → `MPM`), name with no weekday reference (unchanged).
- `levelColor`: same input always returns the same color; different
  inputs are not required to differ (hash collisions are acceptable) but
  the returned value must always be one of the 8 palette entries.
- `subjectColorService`: `setSubjectColor` creates on first call and
  updates in place (not duplicates) on a second call for the same
  subject; `listSubjectColors` returns what was saved.
- No route-level tests — matches this codebase's existing convention
  (service-level tests only, no API route test files exist anywhere in
  the repo today).
- Manual browser verification (per this project's UI-change convention):
  open the timetable from `/admin/classes`, confirm the 7-column grid
  matches real data, confirm 色塊調整 panel edits recolor cards/legend
  live, confirm a subject with no saved color renders gray with the
  "尚未設定" tag.
