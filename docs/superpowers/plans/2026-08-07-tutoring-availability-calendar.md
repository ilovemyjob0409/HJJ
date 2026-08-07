# 個別輔導可預約時段改月曆網格 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/student/tutoring`'s "未來兩週可預約時段" day-card list with a static (non-navigable), current-month-only calendar grid; clicking a day cell expands the existing booking/makeup time-picker panel below the grid, exactly as it does today for a day-card.

**Architecture:** Backend: `listAvailability(enrollmentId, days)` is unchanged (already generic); a new pure helper `daysRemainingInTaipeiMonth(now)` computes how many days are left in the current Taipei calendar month, and `GET /api/tutoring-availability` passes that as `days` instead of the implicit default of 14. Frontend: `src/app/student/tutoring/page.tsx` builds a 7-column month grid client-side (using the browser's local date for "which month," matching existing precedent in this codebase), looks up each cell's date against the `AvailabilityDay[]` the API already returns, and reuses the existing expanded-panel JSX and all booking/cancel/makeup handlers unchanged — only the trigger element changes from a day-card button to a calendar-cell button.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma, Vitest, existing design system components (`Card`, `Button`, `WEEKDAY_LABELS`).

## Global Constraints

- Dates are stored as UTC-midnight pure calendar dates and compared as calendar-date strings, never as instants.
- "今天" at the service/API layer is evaluated in Asia/Taipei time — the new `daysRemainingInTaipeiMonth` function must use the existing `taipeiDateKey` helper for this, not server-local time.
- Test convention: `src/**/*.test.ts` only (no component tests in this codebase) — `daysRemainingInTaipeiMonth` is a pure function and gets unit tests; the frontend calendar grid change has no automated test, verify manually in the browser.
- No change to any business rule: capacity math, cancellation rules (free vs. late), makeup request/approval rules, and monthly quota calculation are all completely untouched by this plan.
- Chinese UI copy and the existing design system (`Card`, `Button`, existing Tailwind color tokens `bg-approvedBg`/`text-approved`/`bg-brand`/`text-brandInk`/`text-inkMuted`/`border-borderSubtle`) are reused as-is — no new visual patterns.
- Decisions already confirmed with the user (do not revisit): calendar is locked to the current month only, no prev/next navigation; the expanded time-picker panel renders below the calendar grid (not a modal/bottom-sheet); day cells show no capacity information before being clicked — only "this day has a class" (highlighted) vs. not (muted), identical treatment for past days and non-class days.

---

### Task 1: `daysRemainingInTaipeiMonth` + wire into the availability route

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`
- Modify: `src/lib/services/tutoringBookingService.test.ts`
- Modify: `src/app/api/tutoring-availability/route.ts`

**Interfaces:**
- Consumes: `taipeiDateKey` (same file, already exists).
- Produces: `daysRemainingInTaipeiMonth(now: Date): number`. Task 2 does not consume this directly (it's route-layer only), but the route's behavior change (only-this-month results) is what Task 2's frontend renders against.

- [ ] **Step 1: Write the failing tests**

Add `daysRemainingInTaipeiMonth` to the existing import block at the top of `src/lib/services/tutoringBookingService.test.ts` (currently reads `import { toMinutes, minutesToHHMM, utcDateKey, taipeiDateKey, countOverlapsInSlot, buildSlotRemaining, hasCapacityForRange, isCancellationLate } from './tutoringBookingService';` — add the new name to this same list):

```ts
import {
  toMinutes,
  minutesToHHMM,
  utcDateKey,
  taipeiDateKey,
  countOverlapsInSlot,
  buildSlotRemaining,
  hasCapacityForRange,
  isCancellationLate,
  daysRemainingInTaipeiMonth,
} from './tutoringBookingService';
```

Append this new `describe` block anywhere at the top level of the file (e.g. right after the existing `describe('utcDateKey / taipeiDateKey', ...)` block):

```ts
describe('daysRemainingInTaipeiMonth', () => {
  it('returns the full month length on the 1st', () => {
    expect(daysRemainingInTaipeiMonth(new Date('2026-08-01T00:00:00.000Z'))).toBe(31);
  });

  it('returns the correct count mid-month', () => {
    expect(daysRemainingInTaipeiMonth(new Date('2026-08-15T00:00:00.000Z'))).toBe(17);
  });

  it('returns 1 on the last day of the month', () => {
    expect(daysRemainingInTaipeiMonth(new Date('2026-08-31T00:00:00.000Z'))).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ/.claude/worktrees/tutoring-module" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: FAIL — `daysRemainingInTaipeiMonth` is not exported from `./tutoringBookingService`.

- [ ] **Step 3: Implement `daysRemainingInTaipeiMonth`**

In `src/lib/services/tutoringBookingService.ts`, immediately after the existing `taipeiDateKey` function (ends right before `export function countOverlapsInSlot`), add:

```ts
export function daysRemainingInTaipeiMonth(now: Date): number {
  const todayKey = taipeiDateKey(now);
  const [y, m, d] = todayKey.split('-').map(Number);
  const lastDayOfMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return lastDayOfMonth - d + 1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ/.claude/worktrees/tutoring-module" && npx vitest run src/lib/services/tutoringBookingService.test.ts
```
Expected: PASS, all tests including the 3 new ones.

- [ ] **Step 5: Wire it into the availability route**

In `src/app/api/tutoring-availability/route.ts`, change the import line from:

```ts
import { listAvailability } from '@/lib/services/tutoringBookingService';
```

to:

```ts
import { listAvailability, daysRemainingInTaipeiMonth } from '@/lib/services/tutoringBookingService';
```

Change the final line of the `GET` handler from:

```ts
  return NextResponse.json(await listAvailability(enrollmentId));
```

to:

```ts
  const days = daysRemainingInTaipeiMonth(new Date());
  return NextResponse.json(await listAvailability(enrollmentId, days));
```

- [ ] **Step 6: Verify the whole file compiles**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ/.claude/worktrees/tutoring-module" && npx tsc --noEmit
```
Expected: clean, no errors. (No route-level test exists for this codebase's convention — this route has no `.test.ts` file; the pure-function test in Step 1-4 is the only automated coverage, matching this codebase's established pattern of testing service-layer date math directly rather than the route wrapper.)

- [ ] **Step 7: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ/.claude/worktrees/tutoring-module" && git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts src/app/api/tutoring-availability/route.ts && git commit -m "feat: 個別輔導可預約時段 API 限制在當月剩餘天數"
```

---

### Task 2: Replace the day-card list with a month calendar grid

**Files:**
- Modify: `src/app/student/tutoring/page.tsx`

**Interfaces:**
- Consumes: `GET /api/tutoring-availability` (Task 1's changed behavior — now returns only the current month's remaining days instead of 14); `WEEKDAY_LABELS` from `@/lib/dateFormat` (already exists, unused by this file until now).
- Produces: no new exports — this is a leaf page component. The `AvailabilityDay`/`BookingRow` interfaces and every existing handler (`openDayForBooking`, `submitBooking`, `cancelBooking`, `submitMakeup`) keep their exact current signatures so this task is a pure UI-trigger change, not a logic change.

- [ ] **Step 1: Add the `WEEKDAY_LABELS` import**

In `src/app/student/tutoring/page.tsx`, change:

```tsx
import { formatDateWithWeekday } from '@/lib/dateFormat';
```

to:

```tsx
import { formatDateWithWeekday, WEEKDAY_LABELS } from '@/lib/dateFormat';
```

- [ ] **Step 2: Add the month-grid helper**

Immediately after the existing `addMinutes` function (ends right before `export default function StudentTutoringPage()`), add:

```tsx
interface MonthCell {
  day: number;
  dateKey: string;
}

function buildMonthCells(year: number, month: number): MonthCell[] {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: MonthCell[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateKey: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
  }
  return cells;
}
```

- [ ] **Step 3: Add the derived calendar values**

Change:

```tsx
  const selectedEnrollment = enrollments.find((e) => e.id === selectedEnrollmentId);
```

to:

```tsx
  const selectedEnrollment = enrollments.find((e) => e.id === selectedEnrollmentId);

  const now = new Date();
  const calendarYear = now.getFullYear();
  const calendarMonth = now.getMonth() + 1;
  const monthCells = buildMonthCells(calendarYear, calendarMonth);
  const leadingBlankCount = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).getUTCDay();
  const availabilityByDate = new Map(availability.map((day) => [day.date, day]));
  const openDayData = openDay ? availabilityByDate.get(openDay) : undefined;
```

(`calendarYear`/`calendarMonth` use the browser's local date, matching the existing `todayDateInput()` pattern already used elsewhere in this codebase's admin pages — the backend, via Task 1, is the actual source of truth for which specific days are bookable. `availabilityByDate` and `openDayData` replace the need to search `availability` by `.date` inside the render — every day cell and the expanded panel below read from this map instead of from a loop variable.)

- [ ] **Step 4: Replace the day-card list JSX with the calendar grid**

Change this entire block (starts at the `<h2>` right after the quota `Card`, ends at the `</div>` immediately before `{makeupFor && (`):

```tsx
          <h2 className="mb-2 font-bold text-ink">未來兩週可預約時段</h2>
          <div className="mb-6 flex flex-col gap-2">
            {availability.length === 0 && (
              <Card>
                <p className="text-sm text-inkMuted">目前沒有開放的時段</p>
              </Card>
            )}
            {availability.map((day) => (
              <Card key={day.date}>
                <button className="flex w-full items-center justify-between" onClick={() => openDayForBooking(day)}>
                  <span className="font-semibold text-ink">{formatDateWithWeekday(day.date)}</span>
                  <span className="text-xs text-inkMuted">
                    {day.windowStartTime}-{day.windowEndTime}
                  </span>
                </button>
                <div className="mt-2 flex flex-wrap gap-1">
                  {day.slots.map((s) => (
                    <span
                      key={s.startTime}
                      title={`${s.startTime}：剩 ${s.remaining} 位`}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        s.remaining === 0 ? 'bg-rejectedBg text-rejected' : 'bg-approvedBg text-approved'
                      }`}
                    >
                      {s.startTime}・{s.remaining}
                    </span>
                  ))}
                </div>

                {openDay === day.date && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-borderSubtle pt-3">
                    <label className="text-xs text-inkMuted">
                      開始
                      <select
                        value={startTime}
                        onChange={(e) => {
                          setStartTime(e.target.value);
                          setEndTime(addMinutes(e.target.value, selectedEnrollment?.defaultDurationMinutes ?? 120));
                        }}
                        className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                      >
                        {day.slots.map((s) => (
                          <option key={s.startTime} value={s.startTime} disabled={s.remaining === 0}>
                            {s.startTime}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-inkMuted">
                      結束
                      <select
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                      >
                        {day.slots
                          .map((s) => s.startTime)
                          .concat(day.windowEndTime)
                          .filter((t) => t > startTime)
                          .map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button loading={submitting} onClick={() => (makeupFor ? submitMakeup(day) : submitBooking(day))}>
                      {makeupFor ? '確定補課時間' : '確定預約'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setOpenDay(null);
                        setMakeupFor(null);
                      }}
                    >
                      取消
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
```

to:

```tsx
          <h2 className="mb-2 font-bold text-ink">本月可預約時段</h2>
          <Card className="mb-6">
            <p className="mb-3 text-center font-semibold text-ink">
              {calendarYear}年{calendarMonth}月
            </p>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-inkMuted">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {Array.from({ length: leadingBlankCount }).map((_, i) => (
                <span key={`blank-${i}`} />
              ))}
              {monthCells.map((cell) => {
                const day = availabilityByDate.get(cell.dateKey);
                return (
                  <button
                    key={cell.dateKey}
                    disabled={!day}
                    onClick={() => day && openDayForBooking(day)}
                    className={`rounded-lg py-2 text-sm ${
                      openDay === cell.dateKey
                        ? 'bg-brand font-semibold text-brandInk'
                        : day
                          ? 'bg-approvedBg font-semibold text-approved'
                          : 'text-inkMuted opacity-50'
                    }`}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>

            {openDayData && (
              <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-borderSubtle pt-3">
                <label className="text-xs text-inkMuted">
                  開始
                  <select
                    value={startTime}
                    onChange={(e) => {
                      setStartTime(e.target.value);
                      setEndTime(addMinutes(e.target.value, selectedEnrollment?.defaultDurationMinutes ?? 120));
                    }}
                    className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                  >
                    {openDayData.slots.map((s) => (
                      <option key={s.startTime} value={s.startTime} disabled={s.remaining === 0}>
                        {s.startTime}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-inkMuted">
                  結束
                  <select
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="mt-1 block rounded-lg border border-borderSubtle bg-card px-2 py-1 text-sm text-ink"
                  >
                    {openDayData.slots
                      .map((s) => s.startTime)
                      .concat(openDayData.windowEndTime)
                      .filter((t) => t > startTime)
                      .map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                  </select>
                </label>
                <Button loading={submitting} onClick={() => (makeupFor ? submitMakeup(openDayData) : submitBooking(openDayData))}>
                  {makeupFor ? '確定補課時間' : '確定預約'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setOpenDay(null);
                    setMakeupFor(null);
                  }}
                >
                  取消
                </Button>
              </div>
            )}
          </Card>
```

Note what did NOT change: `openDayForBooking`, `submitBooking`, `cancelBooking`, `submitMakeup`, the `makeupFor` banner `Card` right after this block, the `bookingColumns`/`CollapsibleDataTable` for "我的預約紀錄", and every piece of state (`openDay`, `startTime`, `endTime`, `submitting`, `makeupFor`) — all untouched. Only the JSX that decides *which button, showing what,* calls `openDayForBooking`/`submitBooking`/`submitMakeup` has changed; the functions themselves and what they do are identical to before this task.

- [ ] **Step 5: Verify it compiles**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ/.claude/worktrees/tutoring-module" && npx tsc --noEmit
```
Expected: clean, no errors.

- [ ] **Step 6: Manually verify in the browser**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ/.claude/worktrees/tutoring-module" && npm run dev -- -p 3010
```

Log in as the seed student (`student@example.com` / `password123`, an active tutoring enrollment already exists in this worktree's dev DB from prior verification work), open `/student/tutoring`, and confirm:
- The calendar shows the current month's name and a full 7-column grid with the correct number of leading blank cells (the 1st lands under the correct weekday column).
- Days matching the enrolled program's window weekday (and today-or-later) are highlighted; every other day (past days and non-class weekdays alike) is muted and unclickable — no capacity number is visible anywhere on the grid itself.
- Clicking a highlighted day expands the same start/end-time picker and "確定預約" button as before, directly below the grid; submitting creates a booking and the grid/quota/booking-list all refresh correctly (unchanged behavior from before this task).
- Cancelling a booking that's eligible for makeup, then clicking "申請補課", then clicking a highlighted day again correctly shows "確定補課時間" and submits via the makeup endpoint (unchanged flow, only reached through the new grid).
- Test in both light and dark mode (this codebase's dark-mode convention) — the grid's muted/highlighted/selected states should remain legible in both.

- [ ] **Step 7: Commit**

```bash
cd "/Users/s.w.kung/Downloads/Wade Claude/HJJ/.claude/worktrees/tutoring-module" && git add src/app/student/tutoring/page.tsx && git commit -m "feat: 個別輔導預約頁改用月曆網格挑選日期"
```

---
