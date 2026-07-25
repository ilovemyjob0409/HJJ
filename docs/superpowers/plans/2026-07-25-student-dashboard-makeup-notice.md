# 學生儀表板「補課須知」公告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static "補課須知" card to the student dashboard (`/student`) explaining the makeup-class quota rule, with the two limit numbers pulled live from the existing quota constants instead of hardcoded.

**Architecture:** Single-file change to `src/app/student/page.tsx` — import the two already-exported numeric constants from `src/lib/services/makeupRequestService.ts` and render one new `Card` with a bullet list between the page's `<h1>` and its existing shortcut-card grid. No new components, no new logic, no schema change.

**Tech Stack:** Next.js 14 (App Router, server component), React 18, TypeScript, Tailwind.

## Global Constraints

- The two numbers shown in the notice ("每季最多 N 次", "一對一最多 N 次") MUST be interpolated from `TOTAL_QUARTER_LIMIT` and `ONE_ON_ONE_QUARTER_LIMIT` (both exported from `src/lib/services/makeupRequestService.ts`) — never hardcoded literals — so the text can't drift from the actually-enforced rule.
- No new shared UI component (no `Notice`/`Banner`/`Alert`) — reuse the existing `Card` from `@/components/ui/Card`.
- Placement: directly under the `<h1>{session?.user.name}您好！</h1>` line and above the existing `<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">` shortcut-card block.
- Out of scope: teacher dashboard, admin dashboard, the quota-enforcement logic itself, and any personalized/dynamic remaining-count display (that already exists separately on `/student/makeup-request`).

---

## File Structure

Modified files:
- `src/app/student/page.tsx` — add one import line and one new `Card` block. No other file changes.

---

### Task 1: Add the 補課須知 card to the student dashboard

**Files:**
- Modify: `src/app/student/page.tsx`

**Interfaces:**
- Consumes: `TOTAL_QUARTER_LIMIT: number` and `ONE_ON_ONE_QUARTER_LIMIT: number`, both already exported (as plain `export const`) from `src/lib/services/makeupRequestService.ts:8-9`. No changes needed to that file — just importing two existing exports.

- [ ] **Step 1: Add the import**

In `src/app/student/page.tsx`, add this import alongside the existing service imports at the top of the file (after the `listStudentEnrolledClasses` import on line 7):

```ts
import { TOTAL_QUARTER_LIMIT, ONE_ON_ONE_QUARTER_LIMIT } from '@/lib/services/makeupRequestService';
```

- [ ] **Step 2: Add the notice card**

In `src/app/student/page.tsx`, find this block (currently lines 85-95):

```tsx
  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/student/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假申請與紀錄</Card>
        </Link>
        <Link href="/student/makeup-request">
          <Card className="text-ink transition-shadow hover:shadow-md">申請補課</Card>
        </Link>
      </div>
```

Replace it with:

```tsx
  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">{session?.user.name}您好！</h1>

      <Card className="mb-6">
        <h2 className="mb-2 font-bold text-ink">補課須知</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-inkMuted">
          <li>每位學生在每個班級，每一季最多可申請 {TOTAL_QUARTER_LIMIT} 次補課機會（插班、一對一合計計算）。</li>
          <li>一對一補課每季最多使用 {ONE_ON_ONE_QUARTER_LIMIT} 次，包含在上述總額度內。</li>
          <li>補課額度依「班級」各自獨立計算，不同班級的名額互不影響。</li>
          <li>若申請被行政人員拒絕，該次不會計入額度，仍可以再次申請。</li>
          <li>額度用完後將無法再送出補課申請，剩餘次數請至「申請補課」頁面查看。</li>
        </ul>
      </Card>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/student/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假申請與紀錄</Card>
        </Link>
        <Link href="/student/makeup-request">
          <Card className="text-ink transition-shadow hover:shadow-md">申請補課</Card>
        </Link>
      </div>
```

(Everything below this block — the "我的班級" section onward — is unchanged.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification in the browser**

This is a static-content change with no new unit-testable logic (the two constants already have coverage in `makeupRequestService.test.ts`), so verification is manual:

Start the dev server, log in as a seeded student account (`student@example.com` / `password123`), and load `/student`. Confirm:
- A "補課須知" card renders directly below the "OOO您好！" heading and above the "請假申請與紀錄" / "申請補課" shortcut cards.
- The five bullet points render, and the two numeric placeholders show `2` and `1` respectively (matching the current `TOTAL_QUARTER_LIMIT` / `ONE_ON_ONE_QUARTER_LIMIT` values).
- The rest of the page (我的班級, 我的請假與插班紀錄, 弈廳報名紀錄) still renders exactly as before, unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/app/student/page.tsx
git commit -m "feat: add makeup-quota notice card to student dashboard"
```
