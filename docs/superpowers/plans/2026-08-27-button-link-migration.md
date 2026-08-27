# Button Link-Variant Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every raw hand-rolled "text-link action" `<button>` in the app (edit/collapse/delete/remove-style inline text links, styled as bare colored text with `hover:underline`) onto the shared `<Button variant="link">` component shipped in the prior UI-consistency-sweep plan, so the app has one source of truth for this control instead of ~40 copy-pasted className strings.

**Architecture:** Pure JSX substitution, file by file. `src/components/ui/Button.tsx` already has the `variant="link"` / `tone="brand"|"muted"|"danger"` API (added by the prior plan) — this plan does not touch `Button.tsx` at all, it only replaces call sites. Each replacement is mechanical: drop the raw `<button>` tag and its `hover:underline`/color/`disabled:*` classes, replace with `<Button variant="link">` (tone omitted when it was `text-brandDark`, since `tone="brand"` is the default; `tone="muted"` for `text-inkMuted`; `tone="danger"` for `text-rejected`), and carry over only the extra spacing/sizing classes the original had (`text-sm`, `text-xs`, `mt-3`, etc.) via `className`.

**Tech Stack:** Next.js (App Router) + React + TypeScript, Tailwind CSS, existing `src/components/ui/Button.tsx`.

## Global Constraints

- `Button.tsx`'s API is already shipped and must NOT be redesigned or modified by this plan: `variant?: 'primary' | 'secondary' | 'link'`, `tone?: 'brand' | 'muted' | 'danger'` (tone only affects `variant="link"`; default `'brand'` renders `text-brandDark`, `'muted'` renders `text-inkMuted`, `'danger'` renders `text-rejected`). The link variant renders `hover:underline disabled:cursor-not-allowed disabled:opacity-50 ${toneClass} ${className}` with `type={type ?? 'button'}` and no padding/background/border — visually identical to the raw buttons being replaced.
- Every user-facing string (button label text) must stay byte-for-byte identical Traditional Chinese — copy it verbatim from the "before" block in each step, never retype it.
- **Explicitly out of scope — do not touch these in any task:**
  - `src/app/admin/activities/page.tsx` line ~442 (`aria-label="移除報名"` button showing only `✕`) — icon-only, not a text link.
  - `src/app/admin/classes/page.tsx` line ~293 (`<Link href={...}>查看出缺勤 →</Link>`) — a navigation `<Link>`, not a `<button>`.
  - `src/app/admin/students/page.tsx` line ~719 (`<Link href={...}>前往管理</Link>`) — a navigation `<Link>`, not a `<button>`.
  - `src/app/admin/students/page.tsx` line ~811 (`刪除學生`, classes include `w-full border-t border-borderSubtle pt-4 text-left`) — a full-width bordered "danger zone" footer, not a plain inline text link; its border/padding directly conflicts with the link variant's no-border/no-padding design and needs its own deliberate design pass, not a mechanical sweep.
  - `src/app/admin/tutoring/page.tsx` line ~329, `src/app/login/page.tsx` line ~66, `src/components/TeacherClassList.tsx` line ~66 — all three are navigation `<Link>` elements, not buttons. (These 3 files need no changes at all in this plan.)
  - Any button that is icon-only (e.g. `✕` remove-chip buttons), a dropdown-option button inside a search-results list, a tab/toggle pill, or a large card-style clickable button with its own padding/background — none of these match the plain-inline-text-link pattern this plan covers.
- This repo's automated tests are logic/service-layer only (`vitest.config.ts`: `include: ['src/**/*.test.ts']`, node environment) — zero component-rendering tests exist. Do not invent new tests for this JSX-only migration. Verification per task is `npx tsc --noEmit`, `npm test` (expect the same passing baseline as before this plan — confirm the exact current count when starting, since other work may have changed it since this plan was written), and a manual dev-server check that each migrated button still renders and still fires its click handler.
- Execution note (not a task): per this repo's established practice for SDD execution, run this plan in an isolated git worktree with its own dedicated Postgres test database name (see `docs/superpowers/plans/2026-08-27-ui-consistency-sweep.md`'s own execution history for the exact recipe — `EnterWorktree`, then point `vitest.setup.ts` and `package.json`'s `test:dbpush` script at a dedicated `tutoring_makeup_system_test_<tag>` database name, `dropdb` it when done) so `npm test` doesn't collide with other concurrent sessions sharing the default test database.
- `src/app/teacher/availability/page.tsx`'s delete button (Task 5) is the one exception to "visually identical": today it has no `hover:underline` at all, so migrating it adds hover-underline styling that wasn't there before. This is intentional — it brings this one button in line with every other `tone="danger"` text-link button in the app — but call it out explicitly rather than treating it as a silent no-op.

---

### Task 1: `activities`, `TimetableModal`, `faq`, `TicketManager` (10 buttons, 4 files)

**Files:**
- Modify: `src/app/admin/activities/page.tsx` (5 buttons)
- Modify: `src/app/admin/classes/TimetableModal.tsx` (1 button)
- Modify: `src/app/admin/faq/page.tsx` (3 buttons)
- Modify: `src/app/admin/go-hall/TicketManager.tsx` (1 button)

**Interfaces:**
- Consumes: `Button` component's `variant="link"` / `tone` API from `src/components/ui/Button.tsx` (already shipped — do not modify that file). All 4 files already `import Button from '@/components/ui/Button';` — no new imports needed.

- [ ] **Step 1: `src/app/admin/activities/page.tsx` — migrate 5 buttons**

Replace (around line 261):
```tsx
        <button className="text-brandDark hover:underline" onClick={() => setViewing(a)}>
          編輯
        </button>
```
with:
```tsx
        <Button variant="link" onClick={() => setViewing(a)}>
          編輯
        </Button>
```

Replace (around line 285):
```tsx
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={closeAddForm}>
              收合
            </button>
```
with:
```tsx
            <Button variant="link" tone="muted" className="text-sm" onClick={closeAddForm}>
              收合
            </Button>
```

Replace (around line 390):
```tsx
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowCategoryPanel(false)}>
              收合
            </button>
```
with:
```tsx
            <Button variant="link" tone="muted" className="text-sm" onClick={() => setShowCategoryPanel(false)}>
              收合
            </Button>
```

Replace (around line 401):
```tsx
                  <button type="button" className="text-rejected hover:underline" onClick={() => handleDeleteCategory(c.id)}>
                    刪除
                  </button>
```
with:
```tsx
                  <Button variant="link" tone="danger" onClick={() => handleDeleteCategory(c.id)}>
                    刪除
                  </Button>
```

Replace (around line 447):
```tsx
              <button type="button" className="text-left text-sm text-rejected hover:underline" onClick={handleDeleteActivity}>
                刪除此活動
              </button>
```
with:
```tsx
              <Button variant="link" tone="danger" className="text-left text-sm" onClick={handleDeleteActivity}>
                刪除此活動
              </Button>
```

Leave the `aria-label="移除報名"` `✕` button (around line 442) completely untouched — it's icon-only, out of scope per Global Constraints.

- [ ] **Step 2: `src/app/admin/classes/TimetableModal.tsx` — migrate 1 button**

Replace (around line 96):
```tsx
                <button
                  type="button"
                  className="text-xs text-inkMuted hover:underline"
                  onClick={() => setPanelOpen(false)}
                >
                  收合
                </button>
```
with:
```tsx
                <Button
                  variant="link"
                  tone="muted"
                  className="text-xs"
                  onClick={() => setPanelOpen(false)}
                >
                  收合
                </Button>
```

(Indentation above is illustrative — match whatever indentation the surrounding block actually has in the file.)

- [ ] **Step 3: `src/app/admin/faq/page.tsx` — migrate 3 buttons**

Replace (around line 156):
```tsx
        <button className="text-brandDark hover:underline" onClick={() => openEdit(item)}>
          編輯
        </button>
```
with:
```tsx
        <Button variant="link" onClick={() => openEdit(item)}>
          編輯
        </Button>
```

Replace (around line 172):
```tsx
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
```
with:
```tsx
            <Button variant="link" tone="muted" className="text-sm" onClick={() => setShowAddForm(false)}>
              收合
            </Button>
```

Replace (around line 219):
```tsx
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除此問題
        </button>
```
with:
```tsx
        <Button variant="link" tone="danger" className="mt-3 text-sm" onClick={handleDelete}>
          刪除此問題
        </Button>
```

- [ ] **Step 4: `src/app/admin/go-hall/TicketManager.tsx` — migrate 1 button**

Replace (around line 288):
```tsx
                          <button type="button" className="text-rejected hover:underline" onClick={() => handleDeletePass(p.id)} disabled={busy}>
                            刪除
                          </button>
```
with:
```tsx
                          <Button variant="link" tone="danger" onClick={() => handleDeletePass(p.id)} disabled={busy}>
                            刪除
                          </Button>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as the established baseline (no test covers these 4 files' JSX).

In the dev server: open `/admin/activities` (test 編輯/收合/刪除 on a category/activity), `/admin/classes` (open the班級 timetable panel and collapse it), `/admin/faq` (編輯/收合/刪除此問題), `/admin/go-hall` → 季票管理 (刪除 a pass). Confirm every migrated button still looks and behaves identically (color, underline-on-hover, click action).

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/activities/page.tsx src/app/admin/classes/TimetableModal.tsx src/app/admin/faq/page.tsx src/app/admin/go-hall/TicketManager.tsx
git commit -m "refactor: migrate activities/TimetableModal/faq/TicketManager text-links to Button variant=link"
```

---

### Task 2: `admin/classes/page.tsx`, `admin/go-hall/page.tsx` (9 buttons, 2 files)

**Files:**
- Modify: `src/app/admin/classes/page.tsx` (5 buttons)
- Modify: `src/app/admin/go-hall/page.tsx` (4 buttons)

**Interfaces:**
- Consumes: same `Button` API as Task 1. Both files already import `Button` — no new imports needed.

- [ ] **Step 1: `src/app/admin/classes/page.tsx` — migrate 5 buttons**

Replace (around line 205):
```tsx
        <button className="text-brandDark hover:underline" onClick={() => openEdit(c)}>
          編輯
        </button>
```
with:
```tsx
        <Button variant="link" onClick={() => openEdit(c)}>
          編輯
        </Button>
```

Replace (around line 231):
```tsx
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
```
with:
```tsx
            <Button variant="link" tone="muted" className="text-sm" onClick={() => setShowAddForm(false)}>
              收合
            </Button>
```

Replace (around line 284):
```tsx
            <button
              type="button"
              className="ml-auto shrink-0 text-sm text-brandDark hover:underline"
              onClick={() => setShowEditFields((v) => !v)}
            >
              {showEditFields ? '收合' : '編輯班級資料'}
            </button>
```
with:
```tsx
            <Button
              variant="link"
              className="ml-auto shrink-0 text-sm"
              onClick={() => setShowEditFields((v) => !v)}
            >
              {showEditFields ? '收合' : '編輯班級資料'}
            </Button>
```

Leave the immediately-following `<Link href={\`/admin/classes/${editing.id}/attendance\`} ...>查看出缺勤 →</Link>` (around line 293) completely untouched — it's a `Link`, not a button, out of scope.

Replace (around line 323):
```tsx
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除班級
        </button>
```
with:
```tsx
        <Button variant="link" tone="danger" className="mt-3 text-sm" onClick={handleDelete}>
          刪除班級
        </Button>
```

Replace (around line 354):
```tsx
                        <button
                          type="button"
                          className="text-xs text-rejected hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeStudent(en.studentId);
                          }}
                        >
                          移除
                        </button>
```
with:
```tsx
                        <Button
                          variant="link"
                          tone="danger"
                          className="text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeStudent(en.studentId);
                          }}
                        >
                          移除
                        </Button>
```

- [ ] **Step 2: `src/app/admin/go-hall/page.tsx` — migrate 4 buttons**

Replace (around line 216):
```tsx
        <button className="text-brandDark hover:underline" onClick={() => openRoster(s.id)}>
          查看名單
        </button>
```
with:
```tsx
        <Button variant="link" onClick={() => openRoster(s.id)}>
          查看名單
        </Button>
```

Replace (around line 235):
```tsx
              <button
                type="button"
                className="text-sm text-inkMuted hover:underline"
                onClick={() => {
                  setShowAddForm(false);
                  setPreviewDates(null);
                }}
              >
                收合
              </button>
```
with:
```tsx
              <Button
                variant="link"
                tone="muted"
                className="text-sm"
                onClick={() => {
                  setShowAddForm(false);
                  setPreviewDates(null);
                }}
              >
                收合
              </Button>
```

Replace (around line 366):
```tsx
                    <button type="button" className="text-rejected hover:underline" onClick={() => handleRemoveRegistration(r.id)}>
                      移除
                    </button>
```
with:
```tsx
                    <Button variant="link" tone="danger" onClick={() => handleRemoveRegistration(r.id)}>
                      移除
                    </Button>
```

Replace (around line 378):
```tsx
            <button type="button" className="mt-2 text-left text-sm text-rejected hover:underline" onClick={handleDeleteSession}>
              刪除此場次
            </button>
```
with:
```tsx
            <Button variant="link" tone="danger" className="mt-2 text-left text-sm" onClick={handleDeleteSession}>
              刪除此場次
            </Button>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as the established baseline.

In the dev server: `/admin/classes` (編輯/收合/切換編輯班級資料/刪除班級/移除 a student from the nested table), `/admin/go-hall` (查看名單/收合/移除 a registration/刪除此場次). Confirm identical look and behavior.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/classes/page.tsx src/app/admin/go-hall/page.tsx
git commit -m "refactor: migrate admin classes/go-hall page text-links to Button variant=link"
```

---

### Task 3: `makeup-notices`, `ArrangeMakeupForm`, `PointReasonsManager`, `teachers` (9 buttons, 4 files)

**Files:**
- Modify: `src/app/admin/makeup-notices/page.tsx` (3 buttons)
- Modify: `src/app/admin/makeup-requests/ArrangeMakeupForm.tsx` (1 button)
- Modify: `src/app/admin/points/PointReasonsManager.tsx` (2 buttons)
- Modify: `src/app/admin/teachers/page.tsx` (3 buttons)

**Interfaces:**
- Consumes: same `Button` API as Task 1. All 4 files already import `Button` — no new imports needed.

- [ ] **Step 1: `src/app/admin/makeup-notices/page.tsx` — migrate 3 buttons**

Replace (around line 154):
```tsx
        <button className="text-brandDark hover:underline" onClick={() => openEdit(item)}>
          編輯
        </button>
```
with:
```tsx
        <Button variant="link" onClick={() => openEdit(item)}>
          編輯
        </Button>
```

Replace (around line 171):
```tsx
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
```
with:
```tsx
            <Button variant="link" tone="muted" className="text-sm" onClick={() => setShowAddForm(false)}>
              收合
            </Button>
```

Replace (around line 199):
```tsx
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除此須知
        </button>
```
with:
```tsx
        <Button variant="link" tone="danger" className="mt-3 text-sm" onClick={handleDelete}>
          刪除此須知
        </Button>
```

- [ ] **Step 2: `src/app/admin/makeup-requests/ArrangeMakeupForm.tsx` — migrate 1 button**

Replace (around line 228):
```tsx
        <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setExpanded(false)}>
          收合
        </button>
```
with:
```tsx
        <Button variant="link" tone="muted" className="text-sm" onClick={() => setExpanded(false)}>
          收合
        </Button>
```

- [ ] **Step 3: `src/app/admin/points/PointReasonsManager.tsx` — migrate 2 buttons**

Replace (around line 150):
```tsx
        <button className="text-brandDark hover:underline" onClick={() => openEdit(item)}>
          編輯
        </button>
```
with:
```tsx
        <Button variant="link" onClick={() => openEdit(item)}>
          編輯
        </Button>
```

Replace (around line 213):
```tsx
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除此理由
        </button>
```
with:
```tsx
        <Button variant="link" tone="danger" className="mt-3 text-sm" onClick={handleDelete}>
          刪除此理由
        </Button>
```

- [ ] **Step 4: `src/app/admin/teachers/page.tsx` — migrate 3 buttons**

Replace (around line 148):
```tsx
        <button className="text-brandDark hover:underline" onClick={() => openEdit(t)}>
          編輯
        </button>
```
with:
```tsx
        <Button variant="link" onClick={() => openEdit(t)}>
          編輯
        </Button>
```

Replace (around line 171):
```tsx
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
```
with:
```tsx
            <Button variant="link" tone="muted" className="text-sm" onClick={() => setShowAddForm(false)}>
              收合
            </Button>
```

Replace (around line 223):
```tsx
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除老師
        </button>
```
with:
```tsx
        <Button variant="link" tone="danger" className="mt-3 text-sm" onClick={handleDelete}>
          刪除老師
        </Button>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as the established baseline.

In the dev server: `/admin/makeup-notices` (編輯/收合/刪除此須知), `/admin/makeup-requests` (open the arrange-makeup form, 收合), `/admin/points` → 集點原因設定 (編輯/刪除此理由), `/admin/teachers` (編輯/收合/刪除老師). Confirm identical look and behavior.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/makeup-notices/page.tsx src/app/admin/makeup-requests/ArrangeMakeupForm.tsx src/app/admin/points/PointReasonsManager.tsx src/app/admin/teachers/page.tsx
git commit -m "refactor: migrate makeup-notices/ArrangeMakeupForm/PointReasonsManager/teachers text-links to Button variant=link"
```

---

### Task 4: `admin/points/page.tsx`, `admin/students/page.tsx` (8 buttons, 2 files)

**Files:**
- Modify: `src/app/admin/points/page.tsx` (3 buttons)
- Modify: `src/app/admin/students/page.tsx` (5 buttons)

**Interfaces:**
- Consumes: same `Button` API as Task 1. Both files already import `Button` — no new imports needed.

- [ ] **Step 1: `src/app/admin/points/page.tsx` — migrate 3 buttons**

Replace (around line 225):
```tsx
        <button
          className="text-brandDark hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            setAwardTargets([{ id: s.id, name: s.name }]);
          }}
        >
          加分
        </button>
```
with:
```tsx
        <Button
          variant="link"
          onClick={(e) => {
            e.stopPropagation();
            setAwardTargets([{ id: s.id, name: s.name }]);
          }}
        >
          加分
        </Button>
```

Replace (around line 384):
```tsx
            <button
              type="button"
              className="text-brandDark hover:underline"
              onClick={() => setChecked(Object.fromEntries(filtered.map((s) => [s.id, true])))}
            >
              全選目前篩選（{filtered.length}）
            </button>
```
with:
```tsx
            <Button
              variant="link"
              onClick={() => setChecked(Object.fromEntries(filtered.map((s) => [s.id, true])))}
            >
              全選目前篩選（{filtered.length}）
            </Button>
```

Replace (around line 391):
```tsx
            <button type="button" className="text-inkMuted hover:underline" onClick={() => setChecked({})}>
              清除選取
            </button>
```
with:
```tsx
            <Button variant="link" tone="muted" onClick={() => setChecked({})}>
              清除選取
            </Button>
```

(These two bottom buttons sit inside a parent `<div className="flex gap-3 text-xs">` — their small size currently comes from that inherited `text-xs`, not from their own className. `Button`'s link variant doesn't set its own font-size, so this inheritance keeps working unchanged; do not add an explicit `text-xs` to either.)

- [ ] **Step 2: `src/app/admin/students/page.tsx` — migrate 5 buttons**

Replace (around line 437):
```tsx
        <button className="text-brandDark hover:underline" onClick={() => openEdit(s)}>
          編輯
        </button>
```
with:
```tsx
        <Button variant="link" onClick={() => openEdit(s)}>
          編輯
        </Button>
```

Replace (around line 480):
```tsx
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
```
with:
```tsx
            <Button variant="link" tone="muted" className="text-sm" onClick={() => setShowAddForm(false)}>
              收合
            </Button>
```

Replace (around line 672, the "續報" column's `render`):
```tsx
                        render: (c: EnrolledRow) => {
                          if (c.rowKind === 'tutoring') return <span className="text-xs text-inkMuted">—</span>;
                          const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                          if (!enrollment) return <span className="text-xs text-inkMuted">儲存後可用</span>;
                          return (
                            <button
                              type="button"
                              onClick={() => openRenew(c)}
                              className="whitespace-nowrap text-xs text-brandDark hover:underline"
                            >
                              續報
                            </button>
                          );
                        },
```
with:
```tsx
                        render: (c: EnrolledRow) => {
                          if (c.rowKind === 'tutoring') return <span className="text-xs text-inkMuted">—</span>;
                          const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                          if (!enrollment) return <span className="text-xs text-inkMuted">儲存後可用</span>;
                          return (
                            <Button
                              variant="link"
                              onClick={() => openRenew(c)}
                              className="whitespace-nowrap text-xs"
                            >
                              續報
                            </Button>
                          );
                        },
```

Replace (around line 700, the "未報名" column's `render` — note this is a DIFFERENT column definition with the same guard-clause shape, do not confuse it with the block above):
```tsx
                        render: (c: EnrolledRow) => {
                          if (c.rowKind === 'tutoring') return <span className="text-xs text-inkMuted">—</span>;
                          const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                          if (!enrollment) return <span className="text-xs text-inkMuted">儲存後可用</span>;
                          return (
                            <button
                              type="button"
                              onClick={() => openNotRegistered(c)}
                              className="whitespace-nowrap text-xs text-brandDark hover:underline"
                            >
                              調整
                            </button>
                          );
                        },
```
with:
```tsx
                        render: (c: EnrolledRow) => {
                          if (c.rowKind === 'tutoring') return <span className="text-xs text-inkMuted">—</span>;
                          const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                          if (!enrollment) return <span className="text-xs text-inkMuted">儲存後可用</span>;
                          return (
                            <Button
                              variant="link"
                              onClick={() => openNotRegistered(c)}
                              className="whitespace-nowrap text-xs"
                            >
                              調整
                            </Button>
                          );
                        },
```

Replace (around line 726, inside the last column's `render`, the non-tutoring branch — leave the `<Link>` branch immediately above it, around line 719-724, completely untouched):
```tsx
                            <button type="button" className="text-xs text-rejected hover:underline" onClick={() => toggleClass(c.id)}>
                              移除
                            </button>
```
with:
```tsx
                            <Button variant="link" tone="danger" className="text-xs" onClick={() => toggleClass(c.id)}>
                              移除
                            </Button>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as the established baseline.

In the dev server: `/admin/points` (加分 on a student row, 全選目前篩選, 清除選取), `/admin/students` (編輯/收合 a student, then open a student's edit modal and check the 已加入班級 table's 續報/調整/移除 buttons for an already-enrolled class). Confirm identical look and behavior for all 8.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/points/page.tsx src/app/admin/students/page.tsx
git commit -m "refactor: migrate admin points/students page text-links to Button variant=link"
```

---

### Task 5: `EnrollmentManager`, `student/go-hall`, `AttendanceHub`, `AwardRowsForm`, `teacher/availability` (6 buttons, 5 files)

**Files:**
- Modify: `src/app/admin/tutoring/EnrollmentManager.tsx` (1 button)
- Modify: `src/app/student/go-hall/page.tsx` (1 button)
- Modify: `src/components/AttendanceHub.tsx` (2 buttons + new import)
- Modify: `src/components/AwardRowsForm.tsx` (1 button)
- Modify: `src/app/teacher/availability/page.tsx` (1 button — adds `hover:underline` that didn't exist before, see Global Constraints)

**Interfaces:**
- Consumes: same `Button` API as Task 1. `EnrollmentManager.tsx`, `student/go-hall/page.tsx`, `AwardRowsForm.tsx`, and `teacher/availability/page.tsx` already import `Button` — no new import needed in those 4. `AttendanceHub.tsx` does NOT import `Button` yet — Step 3 adds it.

- [ ] **Step 1: `src/app/admin/tutoring/EnrollmentManager.tsx` — migrate 1 button**

Replace (around line 282):
```tsx
          <button type="button" className="text-xs text-inkMuted hover:underline" onClick={() => setAddOpen(false)}>
            收合
          </button>
```
with:
```tsx
          <Button variant="link" tone="muted" className="text-xs" onClick={() => setAddOpen(false)}>
            收合
          </Button>
```

- [ ] **Step 2: `src/app/student/go-hall/page.tsx` — migrate 1 button**

Replace (around line 177):
```tsx
          <button type="button" className="text-rejected hover:underline" onClick={withStopPropagation(() => handleCancel(r.id))}>
            取消
          </button>
```
with:
```tsx
          <Button variant="link" tone="danger" onClick={withStopPropagation(() => handleCancel(r.id))}>
            取消
          </Button>
```

- [ ] **Step 3: `src/components/AttendanceHub.tsx` — add the `Button` import, migrate 2 buttons**

Add the import (this file has no `Button` import today), after the existing `import Card from '@/components/ui/Card';` line near the top:
```tsx
import Button from '@/components/ui/Button';
```

Replace (around line 337):
```tsx
              <button type="button" className="text-sm text-brandDark hover:underline" onClick={() => setWalkInOpen(true)}>
                ＋ 現場加入學生（今日 {walkIn.booked}/{walkIn.capacity}）
              </button>
```
with:
```tsx
              <Button variant="link" className="text-sm" onClick={() => setWalkInOpen(true)}>
                ＋ 現場加入學生（今日 {walkIn.booked}/{walkIn.capacity}）
              </Button>
```

Replace (around line 344):
```tsx
                  <button type="button" className="text-xs text-inkMuted hover:underline" onClick={() => setWalkInOpen(false)}>
                    收合
                  </button>
```
with:
```tsx
                  <Button variant="link" tone="muted" className="text-xs" onClick={() => setWalkInOpen(false)}>
                    收合
                  </Button>
```

- [ ] **Step 4: `src/components/AwardRowsForm.tsx` — migrate 1 button**

Replace (around line 148):
```tsx
          <button type="button" onClick={() => addRow(s.id)} className="text-xs text-brandDark hover:underline">
            ＋ 新增一列
          </button>
```
with:
```tsx
          <Button variant="link" onClick={() => addRow(s.id)} className="text-xs">
            ＋ 新增一列
          </Button>
```

- [ ] **Step 5: `src/app/teacher/availability/page.tsx` — migrate 1 button**

Replace (around line 79):
```tsx
                  <button className="text-rejected" onClick={() => removeWindow(i)}>
                    刪除
                  </button>
```
with:
```tsx
                  <Button variant="link" tone="danger" onClick={() => removeWindow(i)}>
                    刪除
                  </Button>
```

This one is not a pure visual no-op (see Global Constraints): the raw button had no `hover:underline`, so this button will gain hover-underline styling it didn't have before. That's intentional.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: same pass/fail set as the established baseline.

In the dev server: `/admin/tutoring` (open enrollment manager, 收合), `/student/go-hall` (取消 a registration), a class's attendance page (open 現場加入學生 walk-in panel, then 收合 it), `/admin/points` → open the award-points modal for a student (＋新增一列), `/teacher/availability` (刪除 a time window — confirm it now shows an underline on hover, which is the intended change here).

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/tutoring/EnrollmentManager.tsx src/app/student/go-hall/page.tsx src/components/AttendanceHub.tsx src/components/AwardRowsForm.tsx src/app/teacher/availability/page.tsx
git commit -m "refactor: migrate EnrollmentManager/student go-hall/AttendanceHub/AwardRowsForm/teacher availability text-links to Button variant=link"
```

---

## Self-Review Notes

- **Spec coverage:** all 42 confirmed "genuine text-link action" button instances found by re-grepping current main (18 files scanned, 3 turned out to need zero changes since their only hits were `<Link>` elements) are covered across Tasks 1–5. The 4 explicitly-excluded instances (1 icon-only, 3 non-text-link/bespoke-layout) are named in Global Constraints so no task attempts them.
- **Placeholder scan:** every step shows complete before/after code copied verbatim from the current file content (verified via direct `grep -n`/`sed -n` reads against commit `f0393ad`, not from stale earlier research). Line numbers are marked "around" since a fresh implementer's own file read is the source of truth if anything has shifted by the time this plan executes — match by content, not by line number alone.
- **Type consistency:** every replacement uses the same `Button`/`variant="link"`/`tone` vocabulary, consistent with `src/components/ui/Button.tsx`'s already-shipped API — no new props or signatures introduced by this plan.
