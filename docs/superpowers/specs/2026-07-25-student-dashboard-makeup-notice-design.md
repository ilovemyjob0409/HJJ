# 學生儀表板「補課須知」公告 — Design

## Problem

Students have no in-dashboard explanation of the makeup-class quota rules
(2 makeup requests per class per quarter, with a 1-request one-on-one
sub-limit). The rule is only discoverable indirectly — via remaining-count
text on the makeup-request form, or by hitting the quota-exceeded error.
Add a static "補課須知" (makeup notice) block to the student dashboard so
the rule is visible up front.

## Scope

**In scope:**
- A new "補課須知" `Card` block on `/student` (the student dashboard,
  `src/app/student/page.tsx`), positioned directly under the page's `<h1>`
  greeting and above the existing "請假申請與紀錄" / "申請補課" shortcut
  cards.
- Five bullet points explaining: total quota per class per quarter,
  one-on-one sub-limit, per-class independence, rejected requests don't
  count against quota, and where to check remaining count.
- The two numbers in the text (currently 2 and 1) are interpolated from
  the existing `TOTAL_QUARTER_LIMIT` / `ONE_ON_ONE_QUARTER_LIMIT`
  constants already exported from `src/lib/services/makeupRequestService.ts`
  — not hardcoded strings — so the notice can't drift out of sync if the
  rule constants ever change.

**Out of scope:**
- No new shared UI primitive (no `Notice`/`Banner`/`Alert` component) —
  the codebase has none today and this is a single static block; reuse
  the existing `Card`.
- No changes to the teacher or admin dashboards, and no changes to the
  actual quota-enforcement logic itself (`makeupRequestService.ts`'s
  quota functions are read-only inputs here, not modified).
- No per-student dynamic numbers (e.g. "you personally have 1 left") —
  this is the general policy text, not a personalized status; personalized
  remaining-count display already exists on `/student/makeup-request`.
- No dismiss/collapse interaction — always visible, plain static content.

## UI

`src/app/student/page.tsx` gains one new `Card` between the `<h1>` and the
existing shortcut-card grid:

```tsx
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
```

`TOTAL_QUARTER_LIMIT` and `ONE_ON_ONE_QUARTER_LIMIT` are imported into
`student/page.tsx` from `@/lib/services/makeupRequestService` (both are
already-exported plain numeric constants, no new export needed). No new
styling tokens — `text-ink`/`text-inkMuted` and `Card`'s existing
`rounded-xl bg-card p-5 shadow-sm` match the rest of the page.

## Testing

No new unit-testable logic — this is static JSX with two constant
interpolations already covered by `makeupRequestService.test.ts`'s
existing coverage of those constants' values. Verification is manual:
load `/student` as a seeded student account and confirm the block renders
above the shortcut cards with the correct numbers substituted.
