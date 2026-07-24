# 行政儀表板資料表收合＋搜尋 (Admin Dashboard Table Collapse & Search) — Design

## Problem

The admin-facing historical-record tables keep growing forever with no
row limit, no pagination, and (for most of them) no way to search — the
whole table renders at once regardless of how many rows exist. On the
homepage dashboard (`/admin`) this pushes the page very long; on the
Go-hall session management page it will only get worse over time since
every session ever created stays in the list forever.

## Scope

**In scope — exactly 4 tables**, chosen because their underlying query is
unbounded (`findMany()` with no `status`/date filter, so row count grows
with all-time history rather than staying naturally small):

| Table | Location | Data source |
|---|---|---|
| 請假紀錄 (leave records) | `/admin` homepage, `LeaveRecordsTable.tsx` | `listAllLeaveRequests()` |
| 代課歷史 (substitute history) | `/admin` homepage, inline in `admin/page.tsx` | `listAllSubstituteRequests()` |
| Go-hall 摘要 (Go-hall summary) | `/admin` homepage, `GoHallSummaryTable.tsx` | `listAllSessions()` |
| Go-hall 場次管理 (Go-hall session management) | `/admin/go-hall` | `listAllSessions()` via `GET /api/go-hall-sessions` |

Each gets both changes: collapse-to-3-rows-by-default with an expand
toggle, and a keyword search box.

**Out of scope:**
- 學生/老師/班級名單 (`/admin/students`, `/admin/teachers`,
  `/admin/classes`) — explicitly excluded per product decision. These
  already have search boxes; they get neither the collapse behavior nor
  any change.
- 代課申請 (`/admin/substitute-requests`) and 補課申請
  (`/admin/makeup-requests`) — both already filter to a single pending
  status (`PENDING_ASSIGNMENT` / `PENDING_ADMIN`), so list size is bounded
  by current pending volume, not all-time history. No change needed.
- Pagination (page numbers, "load more N at a time") — rejected during
  brainstorming; expand always reveals every matching row at once.
- Persisting expand/collapse state across navigation or reload — rejected;
  every page load/tab switch starts collapsed.

## Architecture

### Component-boundary prerequisite

`DataTable.tsx` currently has no `'use client'` directive (it uses no
hooks). Adding the `expanded` state below makes it a client component, so
`'use client'` must be added to the top of the file — this is safe since
Next.js server components can render client components as children, just
not the reverse.

The homepage (`/admin/page.tsx`) is an `async` server component. Two of
its three in-scope tables are already separate `'use client'` components
(`LeaveRecordsTable.tsx`, `GoHallSummaryTable.tsx`) and can add the search
`useState` directly. The third — 代課歷史 (substitute history) — is
currently an *inline* `DataTable` call built straight in the server
component (`admin/page.tsx:47-54,78-80`), which cannot hold `useState`.
It must be extracted into a new client component,
`src/app/admin/SubstituteHistoryTable.tsx`, mirroring
`LeaveRecordsTable.tsx`'s existing pattern: takes `rows` (and the already-
defined `SubstituteRow` type + column list) as props, owns the search
state itself, renders `Card` + `Input` + `DataTable` internally.
`admin/page.tsx` then just calls `<SubstituteHistoryTable rows={allSubstitutes} />`
instead of building columns/`DataTable` inline.

### `DataTable` component change

`src/components/ui/DataTable.tsx` gains one new optional prop:

```ts
interface DataTableProps<T> {
  // ...existing props unchanged...
  maxRows?: number;
}
```

- **Default: unset.** When `maxRows` is not passed, behavior is byte-for-byte
  identical to today — all rows render, no footer. This is what keeps the
  other 5+ tables using `DataTable` completely unaffected; only the 4
  in-scope call sites will pass `maxRows={3}`.
- Internal `const [expanded, setExpanded] = useState(false)` — component-local,
  not persisted (resets to collapsed on every mount, i.e. every page
  load/navigation).
- Visible rows: `maxRows == null || expanded || rows.length <= maxRows ? rows : rows.slice(0, maxRows)`.
- When `maxRows` is set and `rows.length > maxRows`, render a footer bar
  directly below `</table>` but still inside the existing bordered/rounded
  wrapper div (`border-t border-borderSubtle`, `flex items-center
  justify-between`, `px-4 py-2 text-sm`):
  - Left: `顯示 {visible.length} / {rows.length} 筆`
  - Right: a text-link style button (`text-brandDark hover:underline
    font-medium`, matching the existing "收合" convention used for the
    add-forms) reading `展開全部` when collapsed, `收合` when expanded.
- If `rows.length <= maxRows`, no footer renders at all (nothing to expand).

### Search box (page-level, not inside `DataTable`)

Search is **not** built into `DataTable` — it follows the exact pattern
already shipped on `/admin/students`, `/admin/teachers`, `/admin/classes`:
a `useState('')` on the page, a shared `Input` above the `Card` wrapping
the table, and a `.filter()` applied to the row array before it's passed
into `DataTable`.

```tsx
const [search, setSearch] = useState('');
const filtered = allRows.filter((r) => {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return searchText(r).toLowerCase().includes(q);
});
```

```jsx
<div className="mb-6 flex flex-wrap items-center gap-3">
  <Input placeholder="搜尋..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
</div>
<Card>
  <DataTable rows={filtered} maxRows={search.trim() ? undefined : 3} ... />
</Card>
```

Passing `maxRows={undefined}` while searching reuses `DataTable`'s own
"unset = no limit" default, so a non-empty search always shows every
matching row regardless of the 3-row cap; clearing the box restores the
3-row collapse.

**Matching rule:** the search string is built only from the same text
already visible in that row's rendered columns (using the same formatting
functions the columns use, e.g. `formatDateWithWeekday` for dates) — never
from a field the table doesn't display. This keeps "why did this row
match" always answerable by looking at the row.

**Per-table `searchText(row)` fields:**

| Table | Fields concatenated for matching |
|---|---|
| 請假紀錄 | 學生姓名、請假班級、插班班級（若有）、補課狀態文字 |
| 代課歷史 | 班級、原老師、原因、代課老師、狀態文字 |
| Go-hall 摘要 | 日期（`formatDateWithWeekday` 格式化文字）、狀態文字（已額滿/尚有名額）|
| Go-hall 場次管理 | 日期（格式化文字）、時間範圍、老師姓名 |

Go-hall 摘要 only has 3 columns and no name field, so its searchable
surface is inherently small (date + status) — kept for consistency across
the 4 tables rather than special-cased out.

## UI/interaction summary

- Every in-scope table: search box above the `Card`, table below showing
  up to 3 rows, footer with count + `展開全部`/`收合` when there are more
  than 3 rows and no active search.
- Typing in the search box immediately filters (client-side, no API call)
  and, whenever the box is non-empty, shows every match with no 3-row cap
  and no expand button.
- Clearing the search box returns to the collapsed 3-row state (not
  "restores previous expand/collapse choice" — always resets to
  collapsed, matching the no-persistence decision above).
- No expand/collapse or search state survives a page reload or navigating
  away and back.

## Testing

- `DataTable`: unit tests for `maxRows` unset (renders all, no footer),
  `maxRows` set with `rows.length <= maxRows` (renders all, no footer),
  `maxRows` set with more rows (renders first `maxRows`, footer shown with
  correct count, clicking `展開全部` reveals the rest and swaps the button
  label to `收合`, clicking again re-collapses).
- Each of the 4 pages: a test that typing a keyword filters to matching
  rows only, bypassing the 3-row cap when the row count of matches exceeds
  3; clearing the box restores the 3-row collapsed view.
- No changes/new tests needed for the excluded tables — regression check
  is just confirming existing tests for those pages still pass unmodified.
