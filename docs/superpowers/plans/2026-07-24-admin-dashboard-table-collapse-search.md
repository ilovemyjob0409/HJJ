# 行政儀表板資料表收合＋搜尋 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "collapse to 3 rows by default, with an expand toggle and a keyword search box" behavior to exactly 4 admin tables (leave records, substitute history, and Go-hall summary on the homepage `/admin`, plus the Go-hall session management table on `/admin/go-hall`), without touching any other table in the app.

**Architecture:** `DataTable` (`src/components/ui/DataTable.tsx`) gets a new optional `maxRows` prop, defaulting to unset (= unlimited, byte-for-byte unchanged behavior for every table that doesn't pass it). Only the 4 in-scope call sites pass `maxRows={3}`. Search is page/component-level (not inside `DataTable`), following the exact `useState` + `.filter()` + shared `Input` pattern already used on `/admin/students`, `/admin/teachers`, `/admin/classes`. Row-slicing and per-table search-matching logic are extracted into small pure functions (own `.ts` files) so they get real `vitest` unit tests — this codebase has no React component testing setup (`vitest.config.ts` only includes `src/**/*.test.ts`, no `jsdom`/`@testing-library/react` installed), so actual component rendering/click/type behavior is verified manually in the browser as the final task, not via automated component tests.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Tailwind, Vitest (node environment, `.test.ts` only).

## Global Constraints

- `maxRows` on `DataTable` defaults to **unset = unlimited**. Never make 3 the implicit default inside `DataTable` itself — only the 4 named call sites pass `maxRows={3}` explicitly. Every other `DataTable` usage in the app must remain completely unmodified in behavior.
- No persistence of expand/collapse or search state across page reload or navigation — every fresh mount starts collapsed with an empty search box.
- While a table's search box is non-empty, that table's `maxRows` limit is fully bypassed (pass `maxRows={undefined}`) — every matching row renders, no expand button.
- Search matching is case-insensitive substring match against a single concatenated string built only from the same text already visible in that row's rendered columns (reuse the exact formatting helpers the columns use — `formatDateWithWeekday`, `getStatusBadgeConfig(...).label` — never raw enum codes or hidden fields).
- Out of scope, must remain untouched: `/admin/students`, `/admin/teachers`, `/admin/classes`, `/admin/substitute-requests`, `/admin/makeup-requests`.
- `DataTable`'s internal `expanded` boolean is plain local component state, not reset when a search query is cleared — if a user had explicitly expanded a table before typing a search, clearing the search leaves it expanded. This is a deliberate simplification (avoids extra effect/remount wiring for a rare interaction sequence) and is a minor, intentional deviation from the design doc's "always resets to collapsed" phrasing; the common case (fresh page load = collapsed) is unaffected.
- The Go-hall session management page (`/admin/go-hall`) has an existing `?highlight=<id>` deep-link feature that scrolls to and opens a specific row on load. Its `maxRows` must also be bypassed whenever a `highlight` id is present (in addition to when searching), so the deep-linked row is guaranteed to be in the DOM for `scrollIntoView` to find.

---

## File Structure

New files:
- `src/components/ui/dataTableRows.ts` — pure `getVisibleRows` helper used by `DataTable`.
- `src/components/ui/dataTableRows.test.ts`
- `src/app/admin/leaveSearch.ts` — search predicate for leave records.
- `src/app/admin/leaveSearch.test.ts`
- `src/app/admin/substituteSearch.ts` — search predicate for substitute history.
- `src/app/admin/substituteSearch.test.ts`
- `src/app/admin/SubstituteHistoryTable.tsx` — new client component, extracted from the inline table currently built in `admin/page.tsx` (a server component can't hold the `useState` search needs).
- `src/components/goHallSummarySearch.ts` — search predicate for the Go-hall summary table.
- `src/components/goHallSummarySearch.test.ts`
- `src/app/admin/go-hall/sessionSearch.ts` — search predicate for the Go-hall sessions table.
- `src/app/admin/go-hall/sessionSearch.test.ts`

Modified files:
- `src/components/ui/DataTable.tsx` — add `'use client'`, `maxRows` prop, `expanded` state, footer UI.
- `src/app/admin/LeaveRecordsTable.tsx` — add search `Input` + wire `matchesLeaveSearch` + `maxRows={3}`.
- `src/app/admin/page.tsx` — replace the inline substitute-history table with `<SubstituteHistoryTable rows={allSubstitutes} />`; drop now-unused imports.
- `src/components/GoHallSummaryTable.tsx` — add search `Input` + wire `matchesGoHallSummarySearch` + `maxRows={3}`.
- `src/app/admin/go-hall/page.tsx` — add search `Input` + wire `matchesSessionSearch` + `maxRows` (bypassed on search or `highlight`).

---

### Task 1: `maxRows` support in `DataTable`

**Files:**
- Create: `src/components/ui/dataTableRows.ts`
- Test: `src/components/ui/dataTableRows.test.ts`
- Modify: `src/components/ui/DataTable.tsx`

**Interfaces:**
- Produces: `getVisibleRows<T>(rows: T[], maxRows: number | undefined, expanded: boolean): T[]` — exported from `src/components/ui/dataTableRows.ts`, used by later tasks' understanding of how collapse works (no other task imports it directly).
- Produces: `DataTable<T>` gains prop `maxRows?: number` (all existing props unchanged). Tasks 2–5 pass `maxRows={3}` or `maxRows={search.trim() ? undefined : 3}` to it.

- [ ] **Step 1: Write the failing test for `getVisibleRows`**

Create `src/components/ui/dataTableRows.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getVisibleRows } from './dataTableRows';

describe('getVisibleRows', () => {
  it('returns all rows when maxRows is undefined', () => {
    expect(getVisibleRows([1, 2, 3, 4], undefined, false)).toEqual([1, 2, 3, 4]);
  });

  it('returns all rows when rows.length is less than or equal to maxRows', () => {
    expect(getVisibleRows([1, 2, 3], 3, false)).toEqual([1, 2, 3]);
  });

  it('slices to maxRows when collapsed and rows exceed maxRows', () => {
    expect(getVisibleRows([1, 2, 3, 4, 5], 3, false)).toEqual([1, 2, 3]);
  });

  it('returns all rows when expanded is true regardless of maxRows', () => {
    expect(getVisibleRows([1, 2, 3, 4, 5], 3, true)).toEqual([1, 2, 3, 4, 5]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/dataTableRows.test.ts`
Expected: FAIL — `Failed to resolve import "./dataTableRows"` (file doesn't exist yet).

- [ ] **Step 3: Implement `getVisibleRows`**

Create `src/components/ui/dataTableRows.ts`:

```ts
export function getVisibleRows<T>(rows: T[], maxRows: number | undefined, expanded: boolean): T[] {
  if (maxRows == null || expanded || rows.length <= maxRows) return rows;
  return rows.slice(0, maxRows);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/dataTableRows.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire `maxRows` into `DataTable`**

Replace the full contents of `src/components/ui/DataTable.tsx`:

```tsx
'use client';

import { ReactNode, useState } from 'react';
import { getVisibleRows } from './dataTableRows';

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  onRowMouseLeave?: (row: T) => void;
  maxRows?: number;
}

export default function DataTable<T>({
  columns,
  rows,
  keyField,
  onRowClick,
  rowClassName,
  onRowMouseLeave,
  maxRows,
}: DataTableProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const visibleRows = getVisibleRows(rows, maxRows, expanded);
  const showFooter = maxRows != null && rows.length > maxRows;

  return (
    <div className="overflow-x-auto rounded-lg border border-borderSubtle">
      <table className="w-full table-auto border-collapse text-sm md:table-fixed">
        <thead>
          <tr className="border-b border-brandDark bg-brand text-center text-brandInk">
            {columns.map((col, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-2 font-semibold md:whitespace-normal">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, index) => {
            const key = keyField(row);
            const customClass = rowClassName?.(row) ?? '';
            // Only a base bg-* utility (e.g. a highlight override) should suppress
            // the zebra stripe — a variant like hover:bg-stripe shouldn't, since it
            // only paints on hover and layers fine on top of the stripe underneath.
            const hasBaseBackground = customClass.split(/\s+/).some((c) => c.startsWith('bg-'));
            const stripeClass = hasBaseBackground ? '' : index % 2 === 1 ? 'bg-stripe' : 'bg-card';
            return (
              <tr
                key={key}
                id={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onMouseLeave={onRowMouseLeave ? () => onRowMouseLeave(row) : undefined}
                className={`border-b border-borderSubtle ${stripeClass} ${customClass}`}
              >
                {columns.map((col, i) => (
                  <td key={i} className="whitespace-nowrap px-4 py-3 text-center text-ink md:whitespace-normal">
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {showFooter && (
        <div className="flex items-center justify-between border-t border-borderSubtle px-4 py-2 text-sm text-inkMuted">
          <span>
            顯示 {visibleRows.length} / {rows.length} 筆
          </span>
          <button
            type="button"
            className="font-medium text-brandDark hover:underline"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? '收合' : '展開全部'}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/DataTable.tsx src/components/ui/dataTableRows.ts src/components/ui/dataTableRows.test.ts
git commit -m "feat: add optional maxRows collapse/expand support to DataTable"
```

---

### Task 2: Leave records search + collapse

**Files:**
- Create: `src/app/admin/leaveSearch.ts`
- Test: `src/app/admin/leaveSearch.test.ts`
- Modify: `src/app/admin/LeaveRecordsTable.tsx`

**Interfaces:**
- Consumes: `DataTable<T>` prop `maxRows?: number` from Task 1.
- Produces: `matchesLeaveSearch(row: LeaveSearchRow, query: string): boolean`, exported from `src/app/admin/leaveSearch.ts`. Not consumed by any other task.

- [ ] **Step 1: Write the failing tests**

Create `src/app/admin/leaveSearch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesLeaveSearch } from './leaveSearch';

const baseRow = {
  student: { user: { name: '王小明' } },
  class: { name: '週三高階A班' },
  makeupRequest: null as null | {
    type: string;
    status: string;
    targetClass: { name: string } | null;
  },
};

describe('matchesLeaveSearch', () => {
  it('returns true for an empty query', () => {
    expect(matchesLeaveSearch(baseRow, '')).toBe(true);
  });

  it('matches on student name', () => {
    expect(matchesLeaveSearch(baseRow, '小明')).toBe(true);
  });

  it('matches on class name', () => {
    expect(matchesLeaveSearch(baseRow, '高階A')).toBe(true);
  });

  it('matches "尚未申請" when there is no makeup request', () => {
    expect(matchesLeaveSearch(baseRow, '尚未申請')).toBe(true);
  });

  it('matches the insertion target class name when type is INSERTION', () => {
    const row = {
      ...baseRow,
      makeupRequest: { type: 'INSERTION', status: 'APPROVED', targetClass: { name: '週五初階C班' } },
    };
    expect(matchesLeaveSearch(row, '初階C')).toBe(true);
  });

  it('ignores target class when type is not INSERTION', () => {
    const row = {
      ...baseRow,
      makeupRequest: { type: 'RESCHEDULE', status: 'APPROVED', targetClass: { name: '週五初階C班' } },
    };
    expect(matchesLeaveSearch(row, '初階C')).toBe(false);
  });

  it('matches the human-readable status label, not the raw status code', () => {
    const row = {
      ...baseRow,
      makeupRequest: { type: 'INSERTION', status: 'APPROVED', targetClass: { name: '週五初階C班' } },
    };
    expect(matchesLeaveSearch(row, '已核准')).toBe(true);
    expect(matchesLeaveSearch(row, 'APPROVED')).toBe(false);
  });

  it('is case-insensitive', () => {
    const row = { ...baseRow, student: { user: { name: 'John Smith' } } };
    expect(matchesLeaveSearch(row, 'john')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesLeaveSearch(baseRow, '不存在的關鍵字')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/admin/leaveSearch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `matchesLeaveSearch`**

Create `src/app/admin/leaveSearch.ts`:

```ts
import { getStatusBadgeConfig } from '@/components/ui/StatusBadge';

interface LeaveSearchRow {
  student: { user: { name: string } };
  class: { name: string };
  makeupRequest: {
    type: string;
    status: string;
    targetClass: { name: string } | null;
  } | null;
}

export function matchesLeaveSearch(row: LeaveSearchRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const parts = [
    row.student.user.name,
    row.class.name,
    row.makeupRequest?.type === 'INSERTION' ? row.makeupRequest.targetClass?.name ?? '' : '',
    row.makeupRequest ? getStatusBadgeConfig(row.makeupRequest.status).label : '尚未申請',
  ];

  return parts.join(' ').toLowerCase().includes(q);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/admin/leaveSearch.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Wire search + collapse into `LeaveRecordsTable`**

Replace the full contents of `src/app/admin/LeaveRecordsTable.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { matchesLeaveSearch } from './leaveSearch';

interface LeaveRow {
  id: string;
  date: Date;
  reason: string;
  student: { user: { name: string } };
  class: { name: string };
  makeupRequest: {
    id: string;
    type: string;
    status: string;
    targetDate: Date | null;
    targetClass: { name: string } | null;
  } | null;
}

export default function LeaveRecordsTable({ rows }: { rows: LeaveRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const filteredRows = rows.filter((r) => matchesLeaveSearch(r, search));

  const columns: Column<LeaveRow>[] = [
    { header: '學生', render: (r) => r.student.user.name },
    { header: '請假班級', render: (r) => r.class.name },
    { header: '請假日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW') },
    {
      header: '插班班級',
      render: (r) => (r.makeupRequest?.type === 'INSERTION' ? (r.makeupRequest.targetClass?.name ?? '-') : '-'),
    },
    {
      header: '插班日期',
      render: (r) =>
        r.makeupRequest?.type === 'INSERTION' && r.makeupRequest.targetDate
          ? formatDateWithWeekday(r.makeupRequest.targetDate, 'zh-TW')
          : '-',
    },
    {
      header: '補課狀態',
      render: (r) => (r.makeupRequest ? <StatusBadge status={r.makeupRequest.status} /> : <span className="text-inkMuted">尚未申請</span>),
    },
  ];

  function handleRowClick(r: LeaveRow) {
    if (r.makeupRequest?.status === 'PENDING_ADMIN') {
      router.push(`/admin/makeup-requests?highlight=${r.makeupRequest.id}`);
    }
  }

  return (
    <>
      <div className="mb-3">
        <Input
          placeholder="搜尋學生、班級或補課狀態"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>
      <Card>
        <DataTable
          columns={columns}
          rows={filteredRows}
          keyField={(r) => r.id}
          onRowClick={handleRowClick}
          rowClassName={(r) => (r.makeupRequest?.status === 'PENDING_ADMIN' ? 'cursor-pointer hover:bg-stripe' : '')}
          maxRows={search.trim() ? undefined : 3}
        />
      </Card>
    </>
  );
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/leaveSearch.ts src/app/admin/leaveSearch.test.ts src/app/admin/LeaveRecordsTable.tsx
git commit -m "feat: add search and 3-row collapse to leave records table"
```

---

### Task 3: Substitute history search + collapse (extract to its own component)

**Files:**
- Create: `src/app/admin/substituteSearch.ts`
- Test: `src/app/admin/substituteSearch.test.ts`
- Create: `src/app/admin/SubstituteHistoryTable.tsx`
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `DataTable<T>` prop `maxRows?: number` from Task 1.
- Produces: `matchesSubstituteSearch(row: SubstituteSearchRow, query: string): boolean` from `substituteSearch.ts`. `SubstituteHistoryTable` default export taking `{ rows: SubstituteRow[] }`, consumed by `admin/page.tsx` in this task.

- [ ] **Step 1: Write the failing tests**

Create `src/app/admin/substituteSearch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesSubstituteSearch } from './substituteSearch';

const baseRow = {
  reason: '身體不適',
  status: 'PENDING_ASSIGNMENT',
  class: { name: '週四中階B班' },
  originalTeacher: { user: { name: '陳老師' } },
  substituteTeacher: null as null | { user: { name: string } },
};

describe('matchesSubstituteSearch', () => {
  it('returns true for an empty query', () => {
    expect(matchesSubstituteSearch(baseRow, '')).toBe(true);
  });

  it('matches on class name', () => {
    expect(matchesSubstituteSearch(baseRow, '中階B')).toBe(true);
  });

  it('matches on original teacher name', () => {
    expect(matchesSubstituteSearch(baseRow, '陳老師')).toBe(true);
  });

  it('matches on reason text', () => {
    expect(matchesSubstituteSearch(baseRow, '身體不適')).toBe(true);
  });

  it('matches on substitute teacher name when assigned', () => {
    const row = { ...baseRow, substituteTeacher: { user: { name: '林老師' } }, status: 'ASSIGNED' };
    expect(matchesSubstituteSearch(row, '林老師')).toBe(true);
  });

  it('matches the human-readable status label, not the raw status code', () => {
    expect(matchesSubstituteSearch(baseRow, '待確認')).toBe(true);
    expect(matchesSubstituteSearch(baseRow, 'PENDING_ASSIGNMENT')).toBe(false);
  });

  it('is case-insensitive', () => {
    const row = { ...baseRow, originalTeacher: { user: { name: 'Amy Chen' } } };
    expect(matchesSubstituteSearch(row, 'amy')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesSubstituteSearch(baseRow, '不存在的關鍵字')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/admin/substituteSearch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `matchesSubstituteSearch`**

Create `src/app/admin/substituteSearch.ts`:

```ts
import { getStatusBadgeConfig } from '@/components/ui/StatusBadge';

interface SubstituteSearchRow {
  reason: string;
  status: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
  substituteTeacher: { user: { name: string } } | null;
}

export function matchesSubstituteSearch(row: SubstituteSearchRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const parts = [
    row.class.name,
    row.originalTeacher.user.name,
    row.reason,
    row.substituteTeacher?.user.name ?? '',
    getStatusBadgeConfig(row.status).label,
  ];

  return parts.join(' ').toLowerCase().includes(q);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/admin/substituteSearch.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Create `SubstituteHistoryTable`**

Create `src/app/admin/SubstituteHistoryTable.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { matchesSubstituteSearch } from './substituteSearch';

interface SubstituteRow {
  id: string;
  date: Date;
  reason: string;
  status: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
  substituteTeacher: { user: { name: string } } | null;
}

export default function SubstituteHistoryTable({ rows }: { rows: SubstituteRow[] }) {
  const [search, setSearch] = useState('');
  const filteredRows = rows.filter((r) => matchesSubstituteSearch(r, search));

  const columns: Column<SubstituteRow>[] = [
    { header: '班級', render: (r) => r.class.name },
    { header: '原老師', render: (r) => r.originalTeacher.user.name },
    { header: '日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW') },
    { header: '原因', render: (r) => r.reason },
    { header: '代課老師', render: (r) => r.substituteTeacher?.user.name ?? '-' },
    { header: '狀態', render: (r) => <StatusBadge status={r.status} /> },
  ];

  return (
    <>
      <div className="mb-3">
        <Input
          placeholder="搜尋班級、老師或原因"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>
      <Card>
        <DataTable
          columns={columns}
          rows={filteredRows}
          keyField={(r) => r.id}
          maxRows={search.trim() ? undefined : 3}
        />
      </Card>
    </>
  );
}
```

- [ ] **Step 6: Update `admin/page.tsx` to use the new component**

Replace the full contents of `src/app/admin/page.tsx`:

```tsx
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listPendingMakeupRequests } from '@/lib/services/makeupRequestService';
import { listPendingSubstituteRequests, listAllSubstituteRequests } from '@/lib/services/substituteRequestService';
import { listAllLeaveRequests } from '@/lib/services/leaveRequestService';
import { listAllSessions } from '@/lib/services/goHallService';
import GoHallSummaryTable from '@/components/GoHallSummaryTable';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import LeaveRecordsTable from './LeaveRecordsTable';
import SubstituteHistoryTable from './SubstituteHistoryTable';

// Without this, Next.js prerenders the pending counts once at build time
// (this page has no cookie/header access to auto-trigger dynamic rendering)
// and serves that frozen snapshot to every admin until the next deploy.
export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions);
  const [pendingMakeups, pendingSubstitutes, allLeaves, allSubstitutes, goHallSessions] = await Promise.all([
    listPendingMakeupRequests(),
    listPendingSubstituteRequests(),
    listAllLeaveRequests(),
    listAllSubstituteRequests(),
    listAllSessions(),
  ]);

  const goHallRows = goHallSessions.map((s) => ({
    id: s.id,
    date: s.date,
    capacity: s.capacity,
    registeredCount: s._count.registrations,
  }));

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/admin/makeup-requests">
          <Card className="transition-shadow hover:shadow-md">
            <p className="text-sm text-inkMuted">待確認補課申請</p>
            <p className="text-2xl font-bold text-ink">{pendingMakeups.length} 筆</p>
          </Card>
        </Link>
        <Link href="/admin/substitute-requests">
          <Card className="transition-shadow hover:shadow-md">
            <p className="text-sm text-inkMuted">待安排代課</p>
            <p className="text-2xl font-bold text-ink">{pendingSubstitutes.length} 筆</p>
          </Card>
        </Link>
      </div>

      <h2 className="mb-2 font-bold text-ink">學生請假與插班紀錄</h2>
      <LeaveRecordsTable rows={allLeaves} />

      <h2 className="mb-2 mt-6 font-bold text-ink">安排代課紀錄</h2>
      <SubstituteHistoryTable rows={allSubstitutes} />

      <h2 className="mb-2 mt-6 font-bold text-ink">弈廳管理</h2>
      <GoHallSummaryTable rows={goHallRows} basePath="/admin/go-hall" />
    </>
  );
}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (confirms no leftover unused-but-required imports/types from the removed inline table).

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/substituteSearch.ts src/app/admin/substituteSearch.test.ts src/app/admin/SubstituteHistoryTable.tsx src/app/admin/page.tsx
git commit -m "feat: extract substitute history table with search and 3-row collapse"
```

---

### Task 4: Go-hall summary search + collapse

**Files:**
- Create: `src/components/goHallSummarySearch.ts`
- Test: `src/components/goHallSummarySearch.test.ts`
- Modify: `src/components/GoHallSummaryTable.tsx`

**Interfaces:**
- Consumes: `DataTable<T>` prop `maxRows?: number` from Task 1.
- Produces: `matchesGoHallSummarySearch(row: GoHallSummarySearchRow, query: string): boolean`. Not consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

Create `src/components/goHallSummarySearch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesGoHallSummarySearch } from './goHallSummarySearch';

const baseRow = {
  date: new Date('2026-07-25'),
  capacity: 8,
  registeredCount: 3,
};

describe('matchesGoHallSummarySearch', () => {
  it('returns true for an empty query', () => {
    expect(matchesGoHallSummarySearch(baseRow, '')).toBe(true);
  });

  it('matches "尚有名額" when registeredCount is below capacity', () => {
    expect(matchesGoHallSummarySearch(baseRow, '尚有名額')).toBe(true);
    expect(matchesGoHallSummarySearch(baseRow, '已額滿')).toBe(false);
  });

  it('matches "已額滿" when registeredCount reaches capacity', () => {
    const row = { ...baseRow, registeredCount: 8 };
    expect(matchesGoHallSummarySearch(row, '已額滿')).toBe(true);
    expect(matchesGoHallSummarySearch(row, '尚有名額')).toBe(false);
  });

  it('matches on the formatted date text', () => {
    expect(matchesGoHallSummarySearch(baseRow, '2026')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesGoHallSummarySearch(baseRow, '不存在的關鍵字')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/goHallSummarySearch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `matchesGoHallSummarySearch`**

Create `src/components/goHallSummarySearch.ts`:

```ts
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface GoHallSummarySearchRow {
  date: Date;
  capacity: number;
  registeredCount: number;
}

export function matchesGoHallSummarySearch(row: GoHallSummarySearchRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const statusLabel = row.registeredCount >= row.capacity ? '已額滿' : '尚有名額';
  const parts = [formatDateWithWeekday(row.date, 'zh-TW'), statusLabel];

  return parts.join(' ').toLowerCase().includes(q);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/goHallSummarySearch.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire search + collapse into `GoHallSummaryTable`**

Replace the full contents of `src/components/GoHallSummaryTable.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { matchesGoHallSummarySearch } from './goHallSummarySearch';

export interface GoHallSummaryRow {
  id: string;
  date: Date;
  capacity: number;
  registeredCount: number;
}

export default function GoHallSummaryTable({ rows, basePath }: { rows: GoHallSummaryRow[]; basePath: string }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const filteredRows = rows.filter((r) => matchesGoHallSummarySearch(r, search));

  const columns: Column<GoHallSummaryRow>[] = [
    { header: '日期', render: (r) => formatDateWithWeekday(r.date, 'zh-TW') },
    { header: '人數', render: (r) => `${r.registeredCount}/${r.capacity}` },
    {
      header: '狀態',
      render: (r) =>
        r.registeredCount >= r.capacity ? (
          <span className="inline-block rounded-full bg-rejectedBg px-3 py-1 text-xs font-semibold text-rejected">已額滿</span>
        ) : (
          <span className="inline-block rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">尚有名額</span>
        ),
    },
  ];

  return (
    <>
      <div className="mb-3">
        <Input
          placeholder="搜尋日期或狀態"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>
      <Card>
        <DataTable
          columns={columns}
          rows={filteredRows}
          keyField={(r) => r.id}
          onRowClick={(r) => router.push(`${basePath}?highlight=${r.id}`)}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
          maxRows={search.trim() ? undefined : 3}
        />
      </Card>
    </>
  );
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/goHallSummarySearch.ts src/components/goHallSummarySearch.test.ts src/components/GoHallSummaryTable.tsx
git commit -m "feat: add search and 3-row collapse to Go-hall summary table"
```

---

### Task 5: Go-hall session management search + collapse (with highlight bypass)

**Files:**
- Create: `src/app/admin/go-hall/sessionSearch.ts`
- Test: `src/app/admin/go-hall/sessionSearch.test.ts`
- Modify: `src/app/admin/go-hall/page.tsx`

**Interfaces:**
- Consumes: `DataTable<T>` prop `maxRows?: number` from Task 1.
- Produces: `matchesSessionSearch(row: SessionSearchRow, query: string): boolean`. Not consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

Create `src/app/admin/go-hall/sessionSearch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchesSessionSearch } from './sessionSearch';

const baseRow = {
  date: '2026-07-25',
  startTime: '14:00',
  endTime: '16:00',
  teacher: { user: { name: '王老師' } },
};

describe('matchesSessionSearch', () => {
  it('returns true for an empty query', () => {
    expect(matchesSessionSearch(baseRow, '')).toBe(true);
  });

  it('matches on the formatted date text', () => {
    expect(matchesSessionSearch(baseRow, '2026')).toBe(true);
  });

  it('matches on the time range text', () => {
    expect(matchesSessionSearch(baseRow, '14:00-16:00')).toBe(true);
  });

  it('matches on teacher name', () => {
    expect(matchesSessionSearch(baseRow, '王老師')).toBe(true);
  });

  it('is case-insensitive', () => {
    const row = { ...baseRow, teacher: { user: { name: 'Amy Wang' } } };
    expect(matchesSessionSearch(row, 'amy')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesSessionSearch(baseRow, '不存在的關鍵字')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/admin/go-hall/sessionSearch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `matchesSessionSearch`**

Create `src/app/admin/go-hall/sessionSearch.ts`:

```ts
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface SessionSearchRow {
  date: string;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
}

export function matchesSessionSearch(row: SessionSearchRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const parts = [
    formatDateWithWeekday(row.date, 'zh-TW'),
    `${row.startTime}-${row.endTime}`,
    row.teacher.user.name,
  ];

  return parts.join(' ').toLowerCase().includes(q);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/admin/go-hall/sessionSearch.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire search + collapse into the Go-hall sessions page**

In `src/app/admin/go-hall/page.tsx`:

Add the import (alongside the existing imports at the top of the file):

```ts
import { matchesSessionSearch } from './sessionSearch';
```

Add search state, right after the existing `const [highlightDismissed, setHighlightDismissed] = useState(false);` line inside `AdminGoHallContent`:

```ts
const [search, setSearch] = useState('');
```

Add the filtered rows computation right before `const columns: Column<SessionRow>[] = [`:

```ts
const filteredSessions = sessions.filter((s) => matchesSessionSearch(s, search));
```

Replace the closing block of the component — the `<Card>` that wraps the sessions `DataTable` (currently):

```tsx
      <Card>
        <DataTable
          columns={columns}
          rows={sessions}
          keyField={(s) => s.id}
          onRowClick={(s) => openRoster(s.id)}
          rowClassName={(s) => (s.id === highlightId && !highlightDismissed ? 'bg-pendingBg' : 'cursor-pointer hover:bg-stripe')}
          onRowMouseLeave={(s) => {
            if (s.id === highlightId) setHighlightDismissed(true);
          }}
        />
      </Card>
```

with:

```tsx
      <div className="mb-3">
        <Input
          placeholder="搜尋日期、時間或老師"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>
      <Card>
        <DataTable
          columns={columns}
          rows={filteredSessions}
          keyField={(s) => s.id}
          onRowClick={(s) => openRoster(s.id)}
          rowClassName={(s) => (s.id === highlightId && !highlightDismissed ? 'bg-pendingBg' : 'cursor-pointer hover:bg-stripe')}
          onRowMouseLeave={(s) => {
            if (s.id === highlightId) setHighlightDismissed(true);
          }}
          maxRows={search.trim() || highlightId ? undefined : 3}
        />
      </Card>
```

(`Input` is already imported in this file for the add-session form, and `columns` still maps over the full `SessionRow` shape, unchanged.)

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/go-hall/sessionSearch.ts src/app/admin/go-hall/sessionSearch.test.ts src/app/admin/go-hall/page.tsx
git commit -m "feat: add search and 3-row collapse to Go-hall session management table"
```

---

### Task 6: Full-suite check and manual browser verification

**Files:** none (verification only).

- [ ] **Step 1: Run every new unit test together**

Run: `npx vitest run src/components/ui/dataTableRows.test.ts src/app/admin/leaveSearch.test.ts src/app/admin/substituteSearch.test.ts src/components/goHallSummarySearch.test.ts src/app/admin/go-hall/sessionSearch.test.ts`
Expected: PASS, 32 tests total (4 + 9 + 8 + 5 + 6).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors (in particular, no unused-import warnings from the `admin/page.tsx` refactor in Task 3).

- [ ] **Step 3: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification in the browser**

Start the dev server and log in as an ADMIN user, then check:

- `/admin` homepage:
  - 請假紀錄, 代課歷史, and Go-hall摘要 each show at most 3 rows with a "顯示 X / Y 筆" + "展開全部" footer when they have more than 3 rows (skip this check for any table that happens to have ≤3 rows of seed data — add more rows via the app or Prisma seed if needed to exercise the collapsed state).
  - Clicking "展開全部" reveals every row and the button becomes "收合"; clicking it again re-collapses to 3.
  - Typing in each table's search box filters rows live and removes the 3-row cap (all matches shown, no expand button); clearing the box restores the 3-row view.
  - Reload the page: every table is back to collapsed with an empty search box.
- `/admin/go-hall`:
  - Same collapse/expand/search behavior on the sessions table.
  - Click a row from the Go-hall summary table on `/admin` (or otherwise navigate to `/admin/go-hall?highlight=<a session id>`) and confirm the target row is visible, scrolled into view, and its roster modal opens — even if that row would otherwise have been outside the top 3.
- `/admin/students`, `/admin/teachers`, `/admin/classes`, `/admin/substitute-requests`, `/admin/makeup-requests`: confirm these are completely unchanged — no collapse, no new search box beyond what already existed, all rows still render.

- [ ] **Step 5: Report results**

No commit for this task (verification only) — report the manual check results back before considering the feature complete.
