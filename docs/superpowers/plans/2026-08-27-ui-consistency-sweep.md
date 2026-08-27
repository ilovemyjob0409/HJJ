# UI Consistency Sweep (Batch 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the concrete UI-consistency gaps found by a full-site audit (admin/teacher/student portals) against this app's existing shared component vocabulary and design-token system, without inventing new patterns.

**Architecture:** Every fix routes through components/tokens that already exist and are already the dominant pattern elsewhere in the app (`CollapsibleDataTable`/`DataTable`, `Select`/`Input`, `useToast`, the `ink`/`inkMuted`/`borderStrong` CSS-variable tokens). Two small additions are made to the shared layer itself (a `--border-input` token, a `Textarea` component, a `Button` `variant="link"`) because three or more call sites were independently duplicating the same hand-rolled markup.

**Tech Stack:** Next.js (App Router) + React + TypeScript, Tailwind CSS (custom-property-backed tokens in `src/app/globals.css` / `tailwind.config.ts`), Vitest.

## Global Constraints

- This repo's automated tests are logic/service-layer only: `vitest.config.ts` sets `include: ['src/**/*.test.ts']` (note: `.ts`, not `.tsx`) and `environment: 'node'`; there are zero component-rendering tests in the codebase today. **Do not invent React Testing Library / jsdom component tests for this sweep** — that would itself be a new, inconsistent pattern, and it's out of scope (YAGNI). Every task in this plan is a JSX/markup/token change with no new extractable pure logic, so the correct verification per task is: (a) `npx tsc --noEmit` passes, (b) `npm test` still passes with no newly-broken tests (this sweep touches zero files under `src/lib/services` or other logic covered by existing `.test.ts` files, so the expectation is simply "no change" to the existing pass/fail set), (c) a manual check in the running dev server (the harness's Browser tool) confirming the affected screen renders and behaves correctly in both light and dark mode where relevant.
- Every user-facing string is Traditional Chinese, matching the surrounding file. Do not translate or rephrase existing strings beyond what a task explicitly calls for.
- Follow existing import ordering/style already present in each file (external imports, then `@/components/...`, then `@/lib/...`, matching what's already there).
- Do not touch `.claude/worktrees/**` — it's a stale worktree from a previous shipped feature, not live source.
- Commit after each task with `git add <files touched by that task>` (never `git add -A`).

---

### Task 1: Add a `--border-input` design token (fixes hardcoded form-control border color)

`src/components/ui/Input.tsx` and `src/components/ui/Select.tsx` currently hardcode `border-[#D8C9A8]` (a warm tan) instead of a themed token. In dark mode this makes every input/select border render as a bright light-mode tan against the dark surface, instead of the muted warm-brown (`#5a5147`) every other bordered element (`borderStrong`) uses in dark mode. Fix: add a `borderInput` token that equals the existing tan in light mode (zero visual change there) and reuses the existing dark `borderStrong` value in dark mode (dark mode's neutrals are already warm-toned, so this avoids introducing a new, barely-distinguishable color).

**Files:**
- Modify: `src/app/globals.css:5-53`
- Modify: `tailwind.config.ts:9-24`
- Modify: `src/components/ui/Input.tsx`
- Modify: `src/components/ui/Select.tsx`

**Interfaces:**
- Produces: Tailwind color `borderInput` (→ CSS var `--border-input`), usable as `border-borderInput` anywhere in the app. Task 2 (`Textarea`) consumes this.

- [ ] **Step 1: Add the CSS variable to all three theme blocks in `globals.css`**

In `:root` (after the existing `--border-strong: #d1d5db;` line):

```css
  --border-strong: #d1d5db;
  /* Form-control border only; a warmer tan than borderStrong so inputs read
     as inputs. See dark-theme blocks below for why this collapses to the
     same value as borderStrong there. */
  --border-input: #d8c9a8;
```

In `:root[data-theme="dark"]` (after the existing `--border-strong: #5a5147;` line):

```css
  --border-strong: #5a5147;
  /* Dark mode's neutrals are already warm-toned, so the light-mode
     light/warm distinction between borderStrong and borderInput collapses
     into the same color here rather than adding a new near-duplicate. */
  --border-input: #5a5147;
```

In `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` (after the existing `--border-strong: #5a5147;` line inside that block):

```css
    --border-strong: #5a5147;
    --border-input: #5a5147;
```

- [ ] **Step 2: Expose it as a Tailwind color**

In `tailwind.config.ts`, inside `theme.extend.colors`, add a line next to the existing `borderStrong` entry:

```ts
        borderSubtle: "var(--border-subtle)",
        borderStrong: "var(--border-strong)",
        borderInput: "var(--border-input)",
```

- [ ] **Step 3: Use the token in `Input.tsx` and `Select.tsx`**

`src/components/ui/Input.tsx` — replace `border-[#D8C9A8]` with `border-borderInput`:

```tsx
import { InputHTMLAttributes } from 'react';

export default function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-lg border border-borderInput bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25 ${className}`}
      {...props}
    />
  );
}
```

`src/components/ui/Select.tsx` — same replacement:

```tsx
import { SelectHTMLAttributes } from 'react';

export default function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-lg border border-borderInput bg-selectBg py-2 pl-3 pr-8 text-sm text-selectText focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25 ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as before this change (no test references these files).

Start the dev server, open any admin page with a form (e.g. `/admin/classes`), toggle dark mode via the header's theme toggle, and confirm the `Input`/`Select` borders now look like the muted warm-brown used by cards/tables in dark mode instead of a bright tan.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css tailwind.config.ts src/components/ui/Input.tsx src/components/ui/Select.tsx
git commit -m "fix: add borderInput token, stop hardcoding form-control border color"
```

---

### Task 2: Create a shared `Textarea` component and migrate its 3 duplicated call sites

No `Textarea` exists in `src/components/ui/`. Three admin pages each hand-roll a `<textarea>` with a copy-pasted className (one extracted to a `TEXTAREA_CLASS` constant, two inlined twice). Add a `Textarea` component mirroring `Input.tsx`, built on the `borderInput` token from Task 1.

**Files:**
- Create: `src/components/ui/Textarea.tsx`
- Modify: `src/app/admin/faq/page.tsx:1-15,170-220` (import + 2 call sites)
- Modify: `src/app/admin/activities/page.tsx:1-15,280-300` (import + 1 call site)
- Modify: `src/app/admin/makeup-notices/page.tsx:1-20,170-215` (import + remove `TEXTAREA_CLASS` + 2 call sites)

**Interfaces:**
- Consumes: `border-borderInput` Tailwind color (Task 1).
- Produces: `export default function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>)` — same prop surface as `Input`/`Select`.

- [ ] **Step 1: Create `src/components/ui/Textarea.tsx`**

```tsx
import { TextareaHTMLAttributes } from 'react';

export default function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`rounded-lg border border-borderInput bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25 ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 2: Migrate `src/app/admin/faq/page.tsx`**

Add the import alongside the other `@/components/ui/*` imports (after `import Input from '@/components/ui/Input';`):

```tsx
import Textarea from '@/components/ui/Textarea';
```

Replace the add-form textarea (originally at line 177-184):

```tsx
            <Textarea
              placeholder="答案"
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              rows={4}
              required
            />
```

Replace the edit-modal textarea (originally at line 210-217):

```tsx
          <Textarea
            placeholder="答案"
            value={editForm.answer}
            onChange={(e) => setEditForm({ ...editForm, answer: e.target.value })}
            rows={4}
            required
          />
```

- [ ] **Step 3: Migrate `src/app/admin/activities/page.tsx`**

Add the import (after `import Input from '@/components/ui/Input';`):

```tsx
import Textarea from '@/components/ui/Textarea';
```

Replace the textarea (originally at line 290-297):

```tsx
            <Textarea
              placeholder="描述"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              required
            />
```

- [ ] **Step 4: Migrate `src/app/admin/makeup-notices/page.tsx`**

Add the import (after `import Button from '@/components/ui/Button';`):

```tsx
import Textarea from '@/components/ui/Textarea';
```

Delete the now-unused constant:

```tsx
const TEXTAREA_CLASS =
  'rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25';
```

Replace the add-form textarea (originally at line 178-185):

```tsx
            <Textarea placeholder="須知內容" value={content} onChange={(e) => setContent(e.target.value)} rows={3} required />
```

Replace the edit-modal textarea (originally at line 205-212):

```tsx
          <Textarea placeholder="須知內容" value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={3} required />
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (in particular, confirm no other file still references `TEXTAREA_CLASS`).

Run: `npm test`
Expected: same pass/fail set as before.

In the dev server, open `/admin/faq`, `/admin/activities`, `/admin/makeup-notices`; open each "新增" form and each edit modal; confirm the textarea looks unchanged in light mode and now uses the muted dark-mode border in dark mode.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Textarea.tsx src/app/admin/faq/page.tsx src/app/admin/activities/page.tsx src/app/admin/makeup-notices/page.tsx
git commit -m "feat: add shared Textarea component, migrate faq/activities/makeup-notices"
```

---

### Task 3: Add a `variant="link"` to `Button` (for the app's text-action-button convention)

Every "edit/cancel/revoke"-style text action across the app is a hand-rolled raw `<button className="text-brandDark hover:underline">` (or an `inkMuted`/`rejected` tone variant for muted/destructive actions), because `Button` only supports `primary`/`secondary` (padded, pill-shaped). This task only adds the variant so it exists and is ready to use — it does **not** migrate the ~19 existing raw-button call sites (that's a separate, larger follow-up; see the plan's closing note).

**Files:**
- Modify: `src/components/ui/Button.tsx`

**Interfaces:**
- Produces: `<Button variant="link" tone="brand" | "muted" | "danger">` — `tone` only affects `variant="link"` and defaults to `"brand"`.

- [ ] **Step 1: Add the variant**

```tsx
import { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'link';
  tone?: 'brand' | 'muted' | 'danger';
  loading?: boolean;
}

const LINK_TONE_CLASS: Record<NonNullable<ButtonProps['tone']>, string> = {
  brand: 'text-brandDark',
  muted: 'text-inkMuted',
  danger: 'text-rejected',
};

export default function Button({
  variant = 'primary',
  tone = 'brand',
  loading = false,
  className = '',
  disabled,
  type,
  children,
  ...props
}: ButtonProps) {
  if (variant === 'link') {
    return (
      <button
        type={type ?? 'button'}
        className={`hover:underline disabled:cursor-not-allowed disabled:opacity-50 ${LINK_TONE_CLASS[tone]} ${className}`}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {children}
      </button>
    );
  }
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50';
  // Only one cursor class is ever present, so Tailwind's output order can't
  // make the wrong one win.
  const cursor = loading ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed';
  const styles =
    variant === 'primary'
      ? 'bg-brand text-brandInk hover:bg-brandDark'
      : 'border border-borderStrong bg-card text-ink hover:bg-stripe';
  return (
    <button
      type={type}
      className={`${base} ${cursor} ${styles} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
```

(`type={type}` for the non-link branch preserves today's behavior of leaving `type` unset — i.e. `"submit"` inside a `<form>` — exactly as every existing `primary`/`secondary` call site relies on.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. This is a purely additive change (new optional props with defaults), so every existing `<Button>` call site in the app compiles and renders identically.

Run: `npm test`
Expected: same pass/fail set as before.

In the dev server, spot-check one existing page that uses `Button` with `variant="primary"` and one with `variant="secondary"` (e.g. `/teacher/availability`) to confirm no visual change.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Button.tsx
git commit -m "feat: add Button variant=\"link\" for the app's text-action-button convention"
```

---

### Task 4: Fix `EnrollmentManager.tsx` — raw `<select>` and hardcoded gray

`src/app/admin/tutoring/EnrollmentManager.tsx` has the only raw `<select>` and the only hardcoded `text-gray-400` in the admin portal.

**Files:**
- Modify: `src/app/admin/tutoring/EnrollmentManager.tsx:1-17` (import), `:361-375` (the raw select)

**Interfaces:** N/A — standalone fix.

- [ ] **Step 1: Add the `Select` import**

After `import Input from '@/components/ui/Input';` (line 6):

```tsx
import Select from '@/components/ui/Select';
```

- [ ] **Step 2: Replace the raw `<select>`**

Replace this block (originally lines 361-375):

```tsx
          <label className="text-xs text-inkMuted">
            課程
            <select
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              className={`mt-1 block h-9 rounded-lg border border-borderSubtle bg-card px-2 text-sm ${programId ? 'text-ink' : 'text-gray-400'}`}
            >
              <option value="">請選擇</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
```

with:

```tsx
          <label className="text-xs text-inkMuted">
            課程
            <Select value={programId} onChange={(e) => setProgramId(e.target.value)} className="mt-1 block">
              <option value="">請選擇</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
```

(No other `Select` usage in the app grays out the unselected placeholder option, so the conditional `text-gray-400`/`text-ink` styling is dropped rather than reimplemented — this makes it behave exactly like every other `Select` in the app, which is the point of the fix.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as before.

In the dev server, open `/admin/tutoring`, use the enrollment-manager's "課程" dropdown; confirm it now looks like every other dropdown on the page (rounded pill, themed arrow) instead of the old square `h-9` box, and confirm dark mode looks correct.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/tutoring/EnrollmentManager.tsx
git commit -m "fix: use shared Select in EnrollmentManager, drop hardcoded gray"
```

---

### Task 5: Teacher Go Hall page — collapse the session list like admin/student do

`src/app/teacher/go-hall/page.tsx` uses plain `DataTable` with no row cap; the admin and student versions of the same list both use `CollapsibleDataTable maxRows={3}`.

**Files:**
- Modify: `src/app/teacher/go-hall/page.tsx:1-8` (import), `:74-87` (the table)

**Interfaces:** N/A — standalone fix.

- [ ] **Step 1: Swap the import**

Replace:

```tsx
import DataTable, { Column } from '@/components/ui/DataTable';
```

with:

```tsx
import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
```

- [ ] **Step 2: Swap the component and add `maxRows`**

Replace (originally lines 75-86):

```tsx
        <DataTable
          columns={columns}
          rows={sessions}
          loading={loading}
          keyField={(s) => s.id}
          emptyText="目前沒有被指派的弈廳場次"
          onRowClick={(s) => openRoster(s.id)}
          rowClassName={(s) => (s.id === highlightId && !highlightDismissed ? 'bg-pendingBg' : 'cursor-pointer hover:bg-stripe')}
          onRowMouseLeave={(s) => {
            if (s.id === highlightId) setHighlightDismissed(true);
          }}
        />
```

with:

```tsx
        <CollapsibleDataTable
          columns={columns}
          rows={sessions}
          maxRows={3}
          loading={loading}
          keyField={(s) => s.id}
          emptyText="目前沒有被指派的弈廳場次"
          onRowClick={(s) => openRoster(s.id)}
          rowClassName={(s) => (s.id === highlightId && !highlightDismissed ? 'bg-pendingBg' : 'cursor-pointer hover:bg-stripe')}
          onRowMouseLeave={(s) => {
            if (s.id === highlightId) setHighlightDismissed(true);
          }}
        />
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as before.

In the dev server, log in as a teacher assigned to 4+ Go Hall sessions (or seed test data), open `/teacher/go-hall`, confirm the list now shows a "展開全部" footer after 3 rows, matching `/admin/go-hall` and `/student/go-hall`.

- [ ] **Step 4: Commit**

```bash
git add src/app/teacher/go-hall/page.tsx
git commit -m "fix: collapse teacher go-hall session list like admin/student versions"
```

---

### Task 6: Empty-state consistency — use each table component's built-in `emptyText`

Four places show "no data" via ad-hoc markup instead of the table component's own empty-state handling.

**Files:**
- Modify: `src/app/student/attendance/page.tsx:54`
- Modify: `src/app/student/points/PointsHistoryTable.tsx` (full rewrite)
- Modify: `src/components/TeacherClassList.tsx:35-50`
- Modify: `src/components/TeacherTutoringWindowList.tsx:17-34`

**Interfaces:** N/A — standalone fixes, bundled because they're the same class of edit.

- [ ] **Step 1: `src/app/student/attendance/page.tsx`**

Replace line 54:

```tsx
        <CollapsibleDataTable columns={columns} rows={rows} loading={loading} keyField={(r) => r.id} maxRows={3} />
```

with:

```tsx
        <CollapsibleDataTable
          columns={columns}
          rows={rows}
          loading={loading}
          keyField={(r) => r.id}
          maxRows={3}
          emptyText="目前沒有出席紀錄"
        />
```

- [ ] **Step 2: `src/app/student/points/PointsHistoryTable.tsx`**

Replace the whole file:

```tsx
'use client';

import { Column } from '@/components/ui/DataTable';
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import { formatDateWithWeekday } from '@/lib/dateFormat';

const KIND_LABELS: Record<string, string> = {
  TEACHER_AWARD: '加分',
  LOTTERY_COST: '抽獎',
  LOTTERY_WIN: '抽獎獲得',
  REDEMPTION: '兌換',
  ADMIN_ADJUST: '調整',
};

interface HistoryRow {
  id: string;
  amount: number;
  kind: string;
  reason: string;
  createdAt: Date;
  teacher: { user: { name: string } } | null;
}

export default function PointsHistoryTable({ rows }: { rows: HistoryRow[] }) {
  const columns: Column<HistoryRow>[] = [
    { header: '日期', render: (r) => formatDateWithWeekday(r.createdAt), sortValue: (r) => r.createdAt },
    { header: '類型', render: (r) => KIND_LABELS[r.kind] ?? r.kind, sortValue: (r) => r.kind },
    { header: '說明', render: (r) => r.reason, sortValue: (r) => r.reason },
    {
      header: '點數',
      render: (r) => (
        <span className={r.amount > 0 ? 'font-semibold text-approved' : 'font-semibold text-rejected'}>
          {r.amount > 0 ? `+${r.amount}` : r.amount}
        </span>
      ),
      sortValue: (r) => r.amount,
    },
    { header: '加分老師', render: (r) => r.teacher?.user.name ?? '-', sortValue: (r) => r.teacher?.user.name ?? null },
  ];

  return <CollapsibleDataTable columns={columns} rows={rows} keyField={(r) => r.id} maxRows={3} emptyText="尚無點數紀錄" />;
}
```

- [ ] **Step 3: `src/components/TeacherClassList.tsx`**

Replace the `return (...)` block (originally lines 35-79):

```tsx
  return (
    <Card className="mb-6">
      <DataTable
        columns={columns}
        rows={classes}
        keyField={(r) => r.id}
        onRowClick={(r) => setViewing(r)}
        rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        emptyText="尚無帶班班級"
      />
      {classes.length > 0 && <p className="mt-2 text-xs text-inkMuted">點任一列開啟該班學生名單</p>}
      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={`${viewing?.name ?? ''} 學生名單`}>
        {viewing && (
          <>
            <p className="mb-3 text-sm text-inkMuted">
              {timeLabel(viewing)}・共 {viewing.students.length} 人
            </p>
            {viewing.students.length === 0 ? (
              <p className="text-sm text-inkMuted">尚無學生</p>
            ) : (
              <DataTable columns={studentColumns} rows={viewing.students} keyField={(s) => s.studentId} />
            )}
            {lowQuota.length > 0 && (
              <div className="mt-3 flex flex-col gap-1">
                {lowQuota.map((s) => (
                  <p key={s.studentId} className="text-sm text-pending">
                    ⚠ {s.name} 剩 {s.remaining} 堂
                  </p>
                ))}
              </div>
            )}
            <Link href={`/teacher/classes/${viewing.id}/attendance`} className="mt-3 inline-block text-sm text-brandDark hover:underline">
              查看出缺勤 →
            </Link>
          </>
        )}
      </Modal>
    </Card>
  );
```

(Only the top of the block changes — the `Modal` and its contents are unchanged, shown here for full-block accuracy.)

- [ ] **Step 4: `src/components/TeacherTutoringWindowList.tsx`**

Replace the `return (...)` block (originally lines 17-35):

```tsx
  return (
    <Card className="mb-6">
      <DataTable
        columns={columns}
        rows={windows}
        keyField={(w) => w.id}
        onRowClick={(w) => router.push(`/teacher/tutoring/windows/${w.id}/attendance`)}
        rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        emptyText="目前沒有個別輔導時段"
      />
      {windows.length > 0 && <p className="mt-2 text-xs text-inkMuted">點任一列查看該時段出缺勤總表</p>}
    </Card>
  );
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as before.

In the dev server: check `/student/attendance` and a student's points history for a student with zero records (or temporarily filter to one) — should show the table header + a centered "no data" row rather than nothing/a bare paragraph. Check a teacher account with zero classes and zero tutoring windows the same way.

- [ ] **Step 6: Commit**

```bash
git add src/app/student/attendance/page.tsx src/app/student/points/PointsHistoryTable.tsx src/components/TeacherClassList.tsx src/components/TeacherTutoringWindowList.tsx
git commit -m "fix: use table components' built-in emptyText instead of ad-hoc empty states"
```

---

### Task 7: Student makeup-request page — use `useToast()` instead of an inline `<p>` message

`src/app/student/makeup-request/page.tsx` is the only mutating student page that shows success/failure feedback as a plain paragraph instead of `showToast()`.

**Files:**
- Modify: `src/app/student/makeup-request/page.tsx`

**Interfaces:** N/A — standalone fix.

- [ ] **Step 1: Add the `useToast` import and replace the `message` state**

Add import (after `import Select from '@/components/ui/Select';`):

```tsx
import { useToast } from '@/components/ui/Toast';
```

Inside the component, replace:

```tsx
  const [message, setMessage] = useState('');
```

with:

```tsx
  const { showToast } = useToast();
```

(Remove `message` from the `useState` import list only if it becomes unused elsewhere in the file — it does not; `useState` is still used for every other field.)

- [ ] **Step 2: Update `submitInsertion`**

Replace:

```tsx
  async function submitInsertion(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    const targetClass = eligibleClasses.find((c) => c.id === insertionForm.targetClassId);
    const insertionAlert: WeekdayAlertInfo | null = targetClass
      ? { title: '插班日期選錯了', name: targetClass.name, weekday: targetClass.weekday, noun: '插班日期' }
      : null;
    if (targetClass && insertionForm.targetDate && new Date(insertionForm.targetDate).getUTCDay() !== targetClass.weekday) {
      setWeekdayAlert(insertionAlert);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/makeup-requests', {
        method: 'POST',
        body: JSON.stringify({ type: 'INSERTION', leaveRequestId: selectedLeaveId, ...insertionForm }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('已送出插班申請，待行政確認');
      } else if (data.error === 'INVALID_WEEKDAY' && insertionAlert) {
        setWeekdayAlert(insertionAlert);
      } else {
        setMessage(`錯誤：${data.error}`);
      }
    } finally {
      setSubmitting(false);
    }
  }
```

with:

```tsx
  async function submitInsertion(e: React.FormEvent) {
    e.preventDefault();
    const targetClass = eligibleClasses.find((c) => c.id === insertionForm.targetClassId);
    const insertionAlert: WeekdayAlertInfo | null = targetClass
      ? { title: '插班日期選錯了', name: targetClass.name, weekday: targetClass.weekday, noun: '插班日期' }
      : null;
    if (targetClass && insertionForm.targetDate && new Date(insertionForm.targetDate).getUTCDay() !== targetClass.weekday) {
      setWeekdayAlert(insertionAlert);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/makeup-requests', {
        method: 'POST',
        body: JSON.stringify({ type: 'INSERTION', leaveRequestId: selectedLeaveId, ...insertionForm }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('已送出插班申請，待行政確認');
      } else if (data.error === 'INVALID_WEEKDAY' && insertionAlert) {
        setWeekdayAlert(insertionAlert);
      } else {
        showToast(`錯誤：${data.error}`);
      }
    } finally {
      setSubmitting(false);
    }
  }
```

- [ ] **Step 3: Update `submitOneOnOne`**

Replace:

```tsx
  async function submitOneOnOne(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      setMessage('');
      const res = await fetch('/api/makeup-requests', {
        method: 'POST',
        body: JSON.stringify({
          type: 'ONE_ON_ONE',
          leaveRequestId: selectedLeaveId,
          teacherId: oneOnOneForm.teacherId,
          slotDate: oneOnOneForm.slotDate,
          slotStartTime: oneOnOneForm.slotStartTime,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('已送出一對一補課申請，待行政確認');
      } else if (data.error === 'QUOTA_EXCEEDED') {
        setMessage('本期一對一補課名額已使用');
      } else if (data.error === 'NOT_AVAILABLE') {
        setMessage('此班級科目不提供一對一補課');
      } else if (data.error === 'OUTSIDE_AVAILABILITY') {
        setMessage('該時段不在老師可補課時段內');
      } else if (data.error === 'SLOT_CONFLICT') {
        setMessage('該時段已被其他學生預約');
      } else {
        setMessage(`錯誤：${data.error}`);
      }
    } finally {
      setSubmitting(false);
    }
  }
```

with:

```tsx
  async function submitOneOnOne(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/makeup-requests', {
        method: 'POST',
        body: JSON.stringify({
          type: 'ONE_ON_ONE',
          leaveRequestId: selectedLeaveId,
          teacherId: oneOnOneForm.teacherId,
          slotDate: oneOnOneForm.slotDate,
          slotStartTime: oneOnOneForm.slotStartTime,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('已送出一對一補課申請，待行政確認');
      } else if (data.error === 'QUOTA_EXCEEDED') {
        showToast('本期一對一補課名額已使用');
      } else if (data.error === 'NOT_AVAILABLE') {
        showToast('此班級科目不提供一對一補課');
      } else if (data.error === 'OUTSIDE_AVAILABILITY') {
        showToast('該時段不在老師可補課時段內');
      } else if (data.error === 'SLOT_CONFLICT') {
        showToast('該時段已被其他學生預約');
      } else {
        showToast(`錯誤：${data.error}`);
      }
    } finally {
      setSubmitting(false);
    }
  }
```

- [ ] **Step 4: Remove the inline message paragraph**

Delete this line near the end of the component's JSX:

```tsx
      {message && <p className="mt-4 text-sm text-ink">{message}</p>}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors, and no remaining reference to `message`/`setMessage` in this file.

Run: `npm test`
Expected: same pass/fail set as before.

In the dev server as a student with an unmakeup'd leave record, open `/student/makeup-request`, submit an insertion makeup and confirm a toast appears at the bottom of the screen (matching `/student/go-hall`'s toast style) instead of inline text; trigger a validation error path (e.g. pick a slot then let it conflict, or just verify visually that the old `<p>` is gone) to confirm errors also toast.

- [ ] **Step 6: Commit**

```bash
git add src/app/student/makeup-request/page.tsx
git commit -m "fix: use useToast() for makeup-request feedback instead of inline message"
```

---

### Task 8: Fix loading-flash bugs (wrong empty-state text shows before data arrives)

Four places render "no data" text on first paint because there's no loading flag, before the real fetch resolves.

**Files:**
- Modify: `src/app/student/tutoring/page.tsx`
- Modify: `src/components/timetable/WeeklyTimetableGrid.tsx`
- Modify: `src/app/teacher/leave-request/page.tsx`
- Modify: `src/app/teacher/availability/page.tsx`

**Interfaces:** N/A — standalone fixes, bundled because they're the same class of edit.

- [ ] **Step 1: `src/app/student/tutoring/page.tsx`**

Add a `loading` state and gate the top-level empty check behind it. Replace:

```tsx
export default function StudentTutoringPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>('');
  const [attendanceRows, setAttendanceRows] = useState<BookingRow[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);

  async function loadEnrollments() {
    const res = await fetch('/api/tutoring-enrollments/me');
    const rows: Enrollment[] = await res.json();
    setEnrollments(rows);
    if (rows.length > 0) setSelectedEnrollmentId((prev) => prev || rows[0].id);
  }
```

with:

```tsx
export default function StudentTutoringPage() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState<string>('');
  const [attendanceRows, setAttendanceRows] = useState<BookingRow[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);

  async function loadEnrollments() {
    try {
      const res = await fetch('/api/tutoring-enrollments/me');
      const rows: Enrollment[] = await res.json();
      setEnrollments(rows);
      if (rows.length > 0) setSelectedEnrollmentId((prev) => prev || rows[0].id);
    } finally {
      setLoading(false);
    }
  }
```

Then replace the render's top-level branch:

```tsx
      {enrollments.length === 0 ? (
        <Card>
          <p className="text-sm text-inkMuted">目前沒有已報名的個別輔導課程</p>
        </Card>
      ) : (
```

with:

```tsx
      {loading ? (
        <Card>
          <p className="text-sm text-inkMuted">載入中…</p>
        </Card>
      ) : enrollments.length === 0 ? (
        <Card>
          <p className="text-sm text-inkMuted">目前沒有已報名的個別輔導課程</p>
        </Card>
      ) : (
```

(The closing `)}` of this ternary is unchanged.)

- [ ] **Step 2: `src/components/timetable/WeeklyTimetableGrid.tsx`**

Add a `loaded` flag. Replace:

```tsx
export default function WeeklyTimetableGrid({ colors, onClassClick, onTutoringClick, onSubjectsChange, posterRef }: WeeklyTimetableGridProps) {
  const [classes, setClasses] = useState<TimetableClass[]>([]);
  const [tutoringSlots, setTutoringSlots] = useState<TutoringSlot[]>([]);

  useEffect(() => {
    fetch('/api/timetable')
      .then((res) => (res.ok ? res.json() : { classes: [], tutoringSlots: [] }))
      .then((data: { classes: TimetableClass[]; tutoringSlots: TutoringSlot[] }) => {
        setClasses(data.classes);
        setTutoringSlots(data.tutoringSlots);
      })
      .catch(() => {
        setClasses([]);
        setTutoringSlots([]);
      });
  }, []);
```

with:

```tsx
export default function WeeklyTimetableGrid({ colors, onClassClick, onTutoringClick, onSubjectsChange, posterRef }: WeeklyTimetableGridProps) {
  const [classes, setClasses] = useState<TimetableClass[]>([]);
  const [tutoringSlots, setTutoringSlots] = useState<TutoringSlot[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/timetable')
      .then((res) => (res.ok ? res.json() : { classes: [], tutoringSlots: [] }))
      .then((data: { classes: TimetableClass[]; tutoringSlots: TutoringSlot[] }) => {
        setClasses(data.classes);
        setTutoringSlots(data.tutoringSlots);
      })
      .catch(() => {
        setClasses([]);
        setTutoringSlots([]);
      })
      .finally(() => setLoaded(true));
  }, []);
```

Then replace the per-day empty check:

```tsx
              {day.length === 0 ? (
                <p className="pt-3 text-center text-xs text-[#b89a5c]">無課程</p>
              ) : (
```

with:

```tsx
              {!loaded ? (
                <div className="skeleton-shimmer mx-auto mt-3 h-3 w-10 rounded" />
              ) : day.length === 0 ? (
                <p className="pt-3 text-center text-xs text-[#b89a5c]">無課程</p>
              ) : (
```

(The closing `)}` of this ternary, and the hardcoded `#FFF6E6`/`#b89a5c` colors, are unchanged — the user has confirmed those stay as-is since this grid doubles as a printable poster.)

- [ ] **Step 3: `src/app/teacher/leave-request/page.tsx`**

Add a `loadingClasses` flag. Replace:

```tsx
export default function TeacherLeaveRequestPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [form, setForm] = useState({ classId: '', date: '', reason: '' });
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [weekdayAlert, setWeekdayAlert] = useState<WeekdayAlertInfo | null>(null);

  useEffect(() => {
    fetch('/api/classes').then((r) => r.json()).then(setClasses);
  }, []);
```

with:

```tsx
export default function TeacherLeaveRequestPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [form, setForm] = useState({ classId: '', date: '', reason: '' });
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [weekdayAlert, setWeekdayAlert] = useState<WeekdayAlertInfo | null>(null);

  useEffect(() => {
    fetch('/api/classes')
      .then((r) => r.json())
      .then(setClasses)
      .finally(() => setLoadingClasses(false));
  }, []);
```

Then replace the `<Card>` body:

```tsx
      <Card className="max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
            <option value="">選擇班級</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}（週{WEEKDAY_LABELS[c.weekday]}）
              </option>
            ))}
          </Select>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <Input placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          <Button type="submit" loading={submitting}>送出</Button>
        </form>
        {message && <p className="mt-4 text-sm text-ink">{message}</p>}
      </Card>
```

with:

```tsx
      <Card className="max-w-md">
        {loadingClasses ? (
          <p className="text-sm text-inkMuted">載入中…</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
              <option value="">選擇班級</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（週{WEEKDAY_LABELS[c.weekday]}）
                </option>
              ))}
            </Select>
            <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            <Input placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
            <Button type="submit" loading={submitting}>送出</Button>
          </form>
        )}
        {message && <p className="mt-4 text-sm text-ink">{message}</p>}
      </Card>
```

- [ ] **Step 4: `src/app/teacher/availability/page.tsx`**

Add a `loading` flag. Replace:

```tsx
export default function AvailabilityPage() {
  const { showToast } = useToast();
  const [windows, setWindows] = useState<Window[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const res = await fetch('/api/availability');
    setWindows(await res.json());
  }
```

with:

```tsx
export default function AvailabilityPage() {
  const { showToast } = useToast();
  const [windows, setWindows] = useState<Window[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/availability');
      setWindows(await res.json());
    } finally {
      setLoading(false);
    }
  }
```

Then replace the `<Card>` body:

```tsx
      <Card className="max-w-lg">
        <div className="flex flex-col gap-2">
          {windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={w.weekday} onChange={(e) => updateWindow(i, { weekday: Number(e.target.value) })}>
                {WEEKDAY_LABELS.map((label, idx) => (
                  <option key={idx} value={idx}>
                    週{label}
                  </option>
                ))}
              </Select>
              <Input type="time" value={w.startTime} onChange={(e) => updateWindow(i, { startTime: e.target.value })} />
              <Input type="time" value={w.endTime} onChange={(e) => updateWindow(i, { endTime: e.target.value })} />
              <button className="text-rejected" onClick={() => removeWindow(i)}>
                刪除
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" onClick={addWindow}>
            新增時段
          </Button>
          <Button onClick={save} loading={submitting}>儲存</Button>
        </div>
      </Card>
```

with:

```tsx
      <Card className="max-w-lg">
        {loading ? (
          <p className="text-sm text-inkMuted">載入中…</p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {windows.map((w, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={w.weekday} onChange={(e) => updateWindow(i, { weekday: Number(e.target.value) })}>
                    {WEEKDAY_LABELS.map((label, idx) => (
                      <option key={idx} value={idx}>
                        週{label}
                      </option>
                    ))}
                  </Select>
                  <Input type="time" value={w.startTime} onChange={(e) => updateWindow(i, { startTime: e.target.value })} />
                  <Input type="time" value={w.endTime} onChange={(e) => updateWindow(i, { endTime: e.target.value })} />
                  <button className="text-rejected" onClick={() => removeWindow(i)}>
                    刪除
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={addWindow}>
                新增時段
              </Button>
              <Button onClick={save} loading={submitting}>儲存</Button>
            </div>
          </>
        )}
      </Card>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as before.

In the dev server with network throttling on (or a quick manual check on a slow connection), load `/student/tutoring`, `/student/timetable`, `/teacher/leave-request`, `/teacher/availability` and confirm each shows "載入中…" (or a skeleton bar, for the timetable grid) rather than a flash of "no data" before real content appears.

- [ ] **Step 6: Commit**

```bash
git add src/app/student/tutoring/page.tsx src/components/timetable/WeeklyTimetableGrid.tsx src/app/teacher/leave-request/page.tsx src/app/teacher/availability/page.tsx
git commit -m "fix: gate first paint behind a loading flag, stop flashing wrong empty states"
```

---

### Task 9: Standardize "whole card/row is clickable" on a real `<button>`

Two places manually reimplement keyboard support via `<div role="button" tabIndex={0} onKeyDown>`; `src/app/student/ClassesAndTutoringList.tsx` (unchanged by this task) already shows the preferred pattern of a real `<button type="button">`, which gets keyboard support for free.

**Files:**
- Modify: `src/app/student/GoHallQualificationCard.tsx`
- Modify: `src/app/student/go-hall/page.tsx:188-227`

**Interfaces:** N/A — standalone fixes, bundled because they're the same class of edit.

- [ ] **Step 1: `src/app/student/GoHallQualificationCard.tsx`**

Replace the whole file:

```tsx
'use client';

import { useState } from 'react';
import GoHallTicketHistoryModal from '@/components/GoHallTicketHistoryModal';
import { formatDateWithWeekday } from '@/lib/dateFormat';

interface MyTickets {
  balance: number;
  activePassEndDate: Date | string | null;
}

// 票券管理卡片裡的「弈廳資格」區塊：可點擊，打開跟 /student/go-hall 共用的
// 堂票紀錄彈窗（GoHallTicketHistoryModal）。抽成獨立 client component 是因為
// 首頁本身是 server component，只有這一小塊需要互動狀態。
export default function GoHallQualificationCard({ tickets }: { tickets: MyTickets }) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="flex w-full flex-col gap-2 border-t border-borderSubtle pt-4 text-left transition-opacity hover:opacity-80 sm:border-t-0 sm:pt-0"
        onClick={() => setHistoryOpen(true)}
      >
        <p className="text-xs font-semibold text-inkMuted">弈廳資格</p>
        {tickets.activePassEndDate ? (
          <>
            <span className="self-start rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">季票使用中</span>
            <p className="text-xs text-inkMuted">有效期至 {formatDateWithWeekday(tickets.activePassEndDate, 'zh-TW')}</p>
            {tickets.balance > 0 && <p className="text-xs text-inkMuted">另有堂票 {tickets.balance} 堂（季票期間不扣）</p>}
          </>
        ) : tickets.balance > 0 ? (
          <>
            <p className="text-sm text-ink">
              <span className="text-2xl font-bold tabular-nums">{tickets.balance}</span> 堂票剩餘
            </p>
            <p className="text-xs text-inkMuted">點名到場自動扣 1 堂・缺席不扣</p>
          </>
        ) : (
          <>
            <span className="self-start rounded-full bg-pendingBg px-3 py-1 text-xs font-semibold text-pending">單堂計費</span>
            <p className="text-xs text-inkMuted">現場收費</p>
          </>
        )}
        <p className="text-xs text-brandDark">查看堂票紀錄 →</p>
      </button>
      <GoHallTicketHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}
```

- [ ] **Step 2: `src/app/student/go-hall/page.tsx`**

Replace (originally lines 189-227):

```tsx
      <Card
        className="mb-6 cursor-pointer transition-shadow hover:shadow-md"
        role="button"
        tabIndex={0}
        onClick={() => setTicketHistoryOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setTicketHistoryOpen(true);
        }}
      >
        {tickets === null ? (
          <div className="flex flex-col gap-2">
            <div className="skeleton-shimmer h-4 w-40 rounded" />
            <div className="skeleton-shimmer h-4 w-56 rounded" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tickets.activePassEndDate ? (
              <>
                <span className="self-start rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">季票使用中</span>
                <p className="text-xs text-inkMuted">有效期至 {formatDateWithWeekday(tickets.activePassEndDate, 'zh-TW')}</p>
                {tickets.balance > 0 && <p className="text-xs text-inkMuted">另有堂票 {tickets.balance} 堂（季票期間不扣）</p>}
              </>
            ) : tickets.balance > 0 ? (
              <>
                <p className="text-sm text-ink">
                  <span className="text-2xl font-bold tabular-nums">{tickets.balance}</span> 堂票剩餘
                </p>
                <p className="text-xs text-inkMuted">點名到場自動扣 1 堂・缺席不扣</p>
              </>
            ) : (
              <>
                <span className="self-start rounded-full bg-pendingBg px-3 py-1 text-xs font-semibold text-pending">單堂計費</span>
                <p className="text-xs text-inkMuted">現場收費</p>
              </>
            )}
            <p className="mt-1 text-xs text-brandDark">查看堂票紀錄 →</p>
          </div>
        )}
      </Card>
```

with:

```tsx
      <button
        type="button"
        className="mb-6 w-full rounded-xl bg-card p-5 text-left shadow-sm transition-shadow hover:shadow-md"
        onClick={() => setTicketHistoryOpen(true)}
      >
        {tickets === null ? (
          <div className="flex flex-col gap-2">
            <div className="skeleton-shimmer h-4 w-40 rounded" />
            <div className="skeleton-shimmer h-4 w-56 rounded" />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {tickets.activePassEndDate ? (
              <>
                <span className="self-start rounded-full bg-approvedBg px-3 py-1 text-xs font-semibold text-approved">季票使用中</span>
                <p className="text-xs text-inkMuted">有效期至 {formatDateWithWeekday(tickets.activePassEndDate, 'zh-TW')}</p>
                {tickets.balance > 0 && <p className="text-xs text-inkMuted">另有堂票 {tickets.balance} 堂（季票期間不扣）</p>}
              </>
            ) : tickets.balance > 0 ? (
              <>
                <p className="text-sm text-ink">
                  <span className="text-2xl font-bold tabular-nums">{tickets.balance}</span> 堂票剩餘
                </p>
                <p className="text-xs text-inkMuted">點名到場自動扣 1 堂・缺席不扣</p>
              </>
            ) : (
              <>
                <span className="self-start rounded-full bg-pendingBg px-3 py-1 text-xs font-semibold text-pending">單堂計費</span>
                <p className="text-xs text-inkMuted">現場收費</p>
              </>
            )}
            <p className="mt-1 text-xs text-brandDark">查看堂票紀錄 →</p>
          </div>
        )}
      </button>
```

(`rounded-xl bg-card p-5 shadow-sm` reproduces `Card`'s own styling directly, since `Card` renders a `<div>` and this element must be a real `<button>`; `Card` itself is untouched and still used elsewhere in this file.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as before.

In the dev server, open `/student` (the "弈廳資格" block inside the tickets card) and `/student/go-hall`; click each card to confirm the ticket-history modal still opens; Tab to each with the keyboard and press Enter/Space to confirm keyboard activation still works (now via native `<button>` semantics instead of the manual `onKeyDown`).

- [ ] **Step 4: Commit**

```bash
git add src/app/student/GoHallQualificationCard.tsx src/app/student/go-hall/page.tsx
git commit -m "fix: use real <button> for clickable ticket cards instead of div role=button"
```

---

### Task 10: Refactor the two per-student attendance-overview tables onto `DataTable`

`ClassAttendanceOverview.tsx` and `TutoringWindowAttendanceOverview.tsx` both hand-roll a `<table>` inside a `<details>` disclosure. Replace the inner table with `DataTable` (not `CollapsibleDataTable` — the `<details>` element is already the collapsing mechanism; the inner table doesn't need its own row cap).

**Files:**
- Modify: `src/components/ClassAttendanceOverview.tsx` (full rewrite)
- Modify: `src/components/TutoringWindowAttendanceOverview.tsx` (full rewrite)

**Interfaces:** N/A — no existing `.test.ts` files cover either component.

- [ ] **Step 1: Rewrite `src/components/ClassAttendanceOverview.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import DataTable, { Column } from '@/components/ui/DataTable';
import { WEEKDAY_LABELS, formatDateWithWeekday } from '@/lib/dateFormat';

interface OverviewMakeup {
  status: 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED';
  type: 'INSERTION' | 'ONE_ON_ONE';
  label: string;
}

interface OverviewRecord {
  date: string;
  status: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED';
  checkInTime: string | null;
  checkOutTime: string | null;
  makeup: OverviewMakeup | null;
}

interface OverviewStudent {
  studentId: string;
  studentName: string;
  records: OverviewRecord[];
}

interface OverviewResponse {
  class: {
    id: string;
    name: string;
    subject: string;
    level: string;
    weekday: number;
    startTime: string;
    endTime: string;
    teacherName: string;
  };
  students: OverviewStudent[];
}

const recordColumns: Column<OverviewRecord>[] = [
  { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
  { header: '狀態', render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status },
  {
    header: '補課狀態',
    render: (r) =>
      r.status !== 'ON_LEAVE' ? (
        <span className="text-inkMuted">—</span>
      ) : r.makeup === null ? (
        <span className="text-inkMuted">尚未安排</span>
      ) : r.makeup.status === 'APPROVED' ? (
        <span className="text-approved">已核准・{r.makeup.label}</span>
      ) : (
        <StatusBadge status={r.makeup.status} />
      ),
  },
];

// 整班出缺勤總表：依學生分組，每個學生區塊預設收合（比照
// src/app/admin/tutoring/page.tsx 的 <details className="group"> 慣例），
// 點開才看到完整表格。老師／行政共用同一個元件，權限與範圍差異都在 API
// 層（見 /api/classes/[id]/attendance-overview），這裡只負責顯示。
export default function ClassAttendanceOverview({
  classId,
  backHref,
  backLabel,
}: {
  classId: string;
  backHref: string;
  backLabel: string;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/classes/${classId}/attendance-overview`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [classId]);

  return (
    <>
      <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-inkMuted transition-colors hover:text-ink">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        {backLabel}
      </Link>
      {loading ? (
        <p className="text-sm text-inkMuted">載入中…</p>
      ) : !data ? (
        <p className="text-sm text-inkMuted">找不到班級或沒有權限查看</p>
      ) : (
        <>
          <h1 className="mb-1 text-xl font-bold text-ink">{data.class.name}・出缺勤總表</h1>
          <p className="mb-4 text-sm text-inkMuted">
            {data.class.subject}・{data.class.level}｜週{WEEKDAY_LABELS[data.class.weekday]} {data.class.startTime}-{data.class.endTime}｜
            {data.class.teacherName}
          </p>
          {data.students.length === 0 ? (
            <p className="text-sm text-inkMuted">目前沒有學生</p>
          ) : (
            data.students.map((s) => {
              const pendingCount = s.records.filter((r) => r.status === 'ON_LEAVE' && r.makeup === null).length;
              return (
                <Card key={s.studentId} className="mb-3">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <span className="text-inkMuted transition-transform group-open:rotate-180">▾</span>
                        {s.studentName}
                      </span>
                      {pendingCount > 0 && <span className="text-xs text-pending">{pendingCount} 筆待安排補課</span>}
                    </summary>
                    <div className="mt-3">
                      <DataTable columns={recordColumns} rows={s.records} keyField={(r) => r.date} emptyText="尚無紀錄" />
                    </div>
                  </details>
                </Card>
              );
            })
          )}
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Rewrite `src/components/TutoringWindowAttendanceOverview.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import StatusBadge from '@/components/ui/StatusBadge';
import DataTable, { Column } from '@/components/ui/DataTable';
import { WEEKDAY_LABELS, formatDateWithWeekday } from '@/lib/dateFormat';

interface OverviewRecord {
  date: string;
  attendanceStatus: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED' | null;
  bookingStatus: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
  checkInTime: string | null;
  checkOutTime: string | null;
  isMakeup: boolean;
}

interface OverviewStudent {
  studentId: string;
  studentName: string;
  records: OverviewRecord[];
}

interface OverviewResponse {
  window: {
    id: string;
    weekday: number;
    startTime: string;
    endTime: string;
    programName: string;
    teacherName: string;
    teacherName2: string | null;
  };
  todayKey: string;
  students: OverviewStudent[];
}

const recordColumns: Column<OverviewRecord & { _key: string }>[] = [
  { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
  {
    header: '狀態',
    render: (r) => <StatusBadge status={r.attendanceStatus ?? r.bookingStatus} />,
    sortValue: (r) => r.attendanceStatus ?? r.bookingStatus,
  },
  { header: '類型', render: (r) => (r.isMakeup ? '補課' : '—'), sortValue: (r) => (r.isMakeup ? 1 : 0) },
];

// 個別輔導時段出缺勤總表：依學生分組，每個學生區塊預設收合，比照
// ClassAttendanceOverview.tsx 的慣例。跟班級版不同的地方：狀態只有一欄
// （這裡的補課本身就是同一張表裡的另一筆 booking，用「類型」欄的補課標籤
// 標示即可，不需要另一欄「補課狀態」），而且不排除未來日期（學生提前預約
// 是有意義的行為，不是預寫的髒資料）。「N 筆待點名」的過去/未來判斷用伺服器
// 算好的 todayKey 字串比較，不在前端用瀏覽器本機時間做時區換算。
export default function TutoringWindowAttendanceOverview({
  windowId,
  backHref,
  backLabel,
}: {
  windowId: string;
  backHref: string;
  backLabel: string;
}) {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/tutoring-windows/${windowId}/attendance-overview`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .finally(() => setLoading(false));
  }, [windowId]);

  return (
    <>
      <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-sm text-inkMuted transition-colors hover:text-ink">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        {backLabel}
      </Link>
      {loading ? (
        <p className="text-sm text-inkMuted">載入中…</p>
      ) : !data ? (
        <p className="text-sm text-inkMuted">找不到時段或沒有權限查看</p>
      ) : (
        <>
          <h1 className="mb-1 text-xl font-bold text-ink">
            {data.window.programName}・週{WEEKDAY_LABELS[data.window.weekday]} {data.window.startTime}-{data.window.endTime}・出缺勤總表
          </h1>
          <p className="mb-4 text-sm text-inkMuted">{[data.window.teacherName, data.window.teacherName2].filter(Boolean).join('／')}</p>
          {data.students.length === 0 ? (
            <p className="text-sm text-inkMuted">目前沒有預約紀錄</p>
          ) : (
            data.students.map((s) => {
              const pendingCount = s.records.filter(
                (r) => r.bookingStatus === 'BOOKED' && r.attendanceStatus === null && r.date.slice(0, 10) <= data.todayKey
              ).length;
              const rows = s.records.map((r, i) => ({ ...r, _key: `${r.date}-${i}` }));
              return (
                <Card key={s.studentId} className="mb-3">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      <span className="flex items-center gap-2 font-semibold text-ink">
                        <span className="text-inkMuted transition-transform group-open:rotate-180">▾</span>
                        {s.studentName}
                      </span>
                      {pendingCount > 0 && <span className="text-xs text-pending">{pendingCount} 筆待點名</span>}
                    </summary>
                    <div className="mt-3">
                      <DataTable columns={recordColumns} rows={rows} keyField={(r) => r._key} emptyText="尚無紀錄" />
                    </div>
                  </details>
                </Card>
              );
            })
          )}
        </>
      )}
    </>
  );
}
```

(`_key` is synthesized per-render from `date` + array index, reproducing the original hand-rolled table's `key={i}` behavior without requiring `DataTable`'s `keyField` API to accept an index.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as before.

In the dev server, open a class's attendance overview (`/admin/classes/[id]/attendance` or the teacher equivalent) and a tutoring window's attendance overview (`/admin/tutoring/windows/[id]/attendance` or teacher equivalent); expand a student's `<details>` row and confirm the table now has the app's usual brand-colored header row and zebra striping, sorting works by clicking a column header, and empty students show "尚無紀錄" inside the table instead of nothing.

- [ ] **Step 4: Commit**

```bash
git add src/components/ClassAttendanceOverview.tsx src/components/TutoringWindowAttendanceOverview.tsx
git commit -m "refactor: use DataTable inside per-student attendance-overview disclosures"
```

---

### Task 11: Admin points page — convert inline row expansion to a Modal

`src/app/admin/points/page.tsx` is the only admin list using `CollapsibleDataTable`'s `expandedKey`/`renderExpanded` (inline row expansion) instead of the `Modal`-on-row-click pattern every comparable admin list uses. User confirmed: make it consistent with the rest.

**Files:**
- Modify: `src/app/admin/points/page.tsx`

**Interfaces:** N/A — standalone fix.

- [ ] **Step 1: Rename and simplify `renderExpanded` into a no-argument panel renderer**

Replace:

```tsx
  // 展開列內容：三個操作卡片（按鈕底部對齊）＋該生點數紀錄
  function renderExpanded(s: SummaryRow) {
    if (!data) {
      return (
        <div aria-hidden className="flex flex-col gap-2">
          <div className="skeleton-shimmer h-4 w-1/3 rounded" />
          <div className="skeleton-shimmer h-24 w-full rounded" />
        </div>
      );
    }
```

with:

```tsx
  // 點數操作彈窗內容：三個操作卡片（按鈕底部對齊）＋該生點數紀錄
  function renderPointsPanel() {
    if (!selectedStudent || !data) {
      return (
        <div aria-hidden className="flex flex-col gap-2">
          <div className="skeleton-shimmer h-4 w-1/3 rounded" />
          <div className="skeleton-shimmer h-24 w-full rounded" />
        </div>
      );
    }
```

The rest of the function body is unchanged, **except** the one reference to the old parameter `s` in the "點數紀錄" heading — replace:

```tsx
        <div>
          <h3 className="mb-2 font-bold text-ink">
            {s.name} 的點數紀錄
```

with:

```tsx
        <div>
          <h3 className="mb-2 font-bold text-ink">
            {selectedStudent.name} 的點數紀錄
```

(Close out the function with its existing closing `}` — no other lines inside the function body change.)

- [ ] **Step 2: Simplify the table call and add the Modal**

Replace:

```tsx
        <CollapsibleDataTable
          columns={summaryColumns}
          rows={filtered}
          keyField={(s) => s.id}
          maxRows={3}
          loading={summariesLoading}
          emptyText="找不到符合的學生"
          onRowClick={(s) => setSelectedId((prev) => (prev === s.id ? '' : s.id))}
          rowClassName={(s) => (checked[s.id] ? 'bg-stripe cursor-pointer' : 'cursor-pointer hover:bg-stripe')}
          expandedKey={selectedId}
          renderExpanded={renderExpanded}
        />
```

with:

```tsx
        <CollapsibleDataTable
          columns={summaryColumns}
          rows={filtered}
          keyField={(s) => s.id}
          maxRows={3}
          loading={summariesLoading}
          emptyText="找不到符合的學生"
          onRowClick={(s) => setSelectedId(s.id)}
          rowClassName={(s) => (checked[s.id] ? 'bg-stripe cursor-pointer' : 'cursor-pointer hover:bg-stripe')}
        />
```

Then, immediately after that `</Card>` closes (right before the existing `<Modal open={awardTargets !== null} ...>` block), add:

```tsx
      <Modal
        open={selectedId !== ''}
        onClose={() => setSelectedId('')}
        title={selectedStudent ? `${selectedStudent.name} 的點數操作` : ''}
        maxWidthClassName="max-w-2xl"
      >
        {selectedId !== '' && renderPointsPanel()}
      </Modal>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors, and no remaining reference to `expandedKey`/`renderExpanded` in this file.

Run: `npm test`
Expected: same pass/fail set as before.

In the dev server, open `/admin/points`, click a student row: confirm a modal opens (titled "`<name>` 的點數操作") with the three action cards and points history, instead of the row expanding inline; confirm closing the modal (X, backdrop click, or Esc) and re-clicking a different row works; confirm the checkbox-select / "批量加分" flow at the bottom of the card is unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/points/page.tsx
git commit -m "fix: open admin points student panel as a Modal instead of inline row expansion"
```

---

## Not included in this plan (flag for the user before starting)

**Full-site migration to `Button variant="link"`** (the rest of "B2"): grepping for the app's raw text-link button pattern (`hover:underline` on a bare `<button>`) turns up **19 files**: `admin/activities/page.tsx`, `admin/classes/TimetableModal.tsx`, `admin/classes/page.tsx`, `admin/faq/page.tsx`, `admin/go-hall/TicketManager.tsx`, `admin/go-hall/page.tsx`, `admin/makeup-notices/page.tsx`, `admin/makeup-requests/ArrangeMakeupForm.tsx`, `admin/points/PointReasonsManager.tsx`, `admin/points/page.tsx`, `admin/students/page.tsx`, `admin/teachers/page.tsx`, `admin/tutoring/EnrollmentManager.tsx`, `admin/tutoring/page.tsx`, `login/page.tsx`, `student/go-hall/page.tsx`, `components/AttendanceHub.tsx`, `components/AwardRowsForm.tsx`, `components/TeacherClassList.tsx` (plus `teacher/availability/page.tsx`'s bare-`text-rejected` delete button, which has no `hover:underline` at all). That's large enough, and repetitive enough, to warrant its own follow-up plan with one task per file (or small file cluster) rather than folding it into this one. Task 3 above already ships the `variant="link"` API it would consume — ask the user whether to write that follow-up plan now or later.
