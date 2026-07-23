# Class Weekly Timetable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "週課表" button on `/admin/classes` that opens a wide modal showing all classes in a 7-day color-coded grid, with admin-editable subject colors.

**Architecture:** One new Prisma table (`SubjectColor`) + service + API route pair for persisted subject colors. The timetable itself is a client component colocated with the admin classes page, fed by the classes array the page already fetches. Pure display helpers (`stripWeekday`, `levelColor`) live in `src/lib/` with unit tests, mirroring `maskName.ts`.

**Tech Stack:** Next.js 14 App Router, Prisma + Postgres, Tailwind (CSS-variable tokens), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-class-weekly-timetable-design.md`

## Global Constraints

- All UI copy in Traditional Chinese; button labels exactly: 「週課表」, 「色塊調整」, 「收合」, 「尚未設定」, 「無課程」. No emoji/icons in the 色塊調整 button.
- Weekday header badges show single characters 日一二三四五六 (no 週 prefix), pill-shaped, brand yellow `bg-brand` background with `text-brandInk`.
- Card colors: subject color from DB or neutral gray `#9a9a9a` fallback; level accent bar from the fixed 8-color hash palette.
- Panel open/close animation must use `grid-template-rows` (0fr↔1fr), never `max-height`/`padding` transitions.
- Dark mode: use existing token classes (`bg-card`, `text-ink`, `text-inkMuted`, `border-borderSubtle`, `bg-stripe`) — no raw `bg-white`/`gray-*` classes anywhere.
- Follow existing role-guard pattern on API routes: `getServerSession(authOptions)` + `session.user.role !== 'ADMIN'` → 403.
- Tests: service + pure-helper level only (no API route tests — repo has none).
- Every test file's `beforeEach` must delete child tables before parents (see existing test files for order).

---

### Task 1: `stripWeekday` and `levelColor` display helpers

**Files:**
- Create: `src/lib/timetable.ts`
- Test: `src/lib/timetable.test.ts`

**Interfaces:**
- Produces: `stripWeekday(name: string): string`, `levelColor(level: string): string`, `UNSET_SUBJECT_COLOR = '#9a9a9a'` (const), `LEVEL_PALETTE: readonly string[]` (8 entries). Task 4 imports all of these.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/timetable.test.ts
import { describe, it, expect } from 'vitest';
import { stripWeekday, levelColor, LEVEL_PALETTE } from './timetable';

describe('stripWeekday', () => {
  it('removes a 週X prefix from the name', () => {
    expect(stripWeekday('週一基礎2A')).toBe('基礎2A');
  });

  it('removes a parenthesized 週X and the emptied parentheses', () => {
    expect(stripWeekday('MPM（週一）')).toBe('MPM');
  });

  it('leaves a name without any weekday reference unchanged', () => {
    expect(stripWeekday('數學A班')).toBe('數學A班');
  });

  it('removes multiple weekday references', () => {
    expect(stripWeekday('週三物理（週三）')).toBe('物理');
  });
});

describe('levelColor', () => {
  it('returns the same color for the same level string', () => {
    expect(levelColor('基礎2')).toBe(levelColor('基礎2'));
  });

  it('always returns a palette entry', () => {
    for (const level of ['基礎', '基礎1', '基礎2', '進階', '段位1', '國一', '-', '']) {
      expect(LEVEL_PALETTE).toContain(levelColor(level));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/timetable.test.ts`
Expected: FAIL — `Cannot find module './timetable'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/timetable.ts
// Display helpers for the admin weekly timetable
// (docs/superpowers/specs/2026-07-23-class-weekly-timetable-design.md).

// The weekday is implied by which column a card sits in, so the 週X
// substring inside a class name is redundant there — strip it, including
// parentheses left empty by the removal (MPM（週一） → MPM）.
export function stripWeekday(name: string): string {
  return name
    .replace(/週[日一二三四五六]/g, '')
    .replace(/（\s*）/g, '')
    .trim();
}

export const LEVEL_PALETTE = [
  '#F2C14E',
  '#6FCF97',
  '#EB5757',
  '#56CCF2',
  '#BB6BD9',
  '#F2994A',
  '#27AE60',
  '#9B51E0',
] as const;

export const UNSET_SUBJECT_COLOR = '#9a9a9a';

// Level is freeform text, so its accent color is derived by hashing the
// string into a fixed palette — stable per string, zero maintenance,
// collisions acceptable (it's a secondary cue, not an identifier).
export function levelColor(level: string): string {
  let hash = 0;
  for (let i = 0; i < level.length; i++) {
    hash = (hash * 31 + level.charCodeAt(i)) >>> 0;
  }
  return LEVEL_PALETTE[hash % LEVEL_PALETTE.length];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/timetable.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/timetable.ts src/lib/timetable.test.ts
git commit -m "feat: add stripWeekday and levelColor timetable display helpers"
```

---

### Task 2: `SubjectColor` table + service

**Files:**
- Modify: `prisma/schema.prisma` (append model at end of file)
- Create: `src/lib/services/subjectColorService.ts`
- Test: `src/lib/services/subjectColorService.test.ts`

**Interfaces:**
- Produces: `listSubjectColors(): Promise<{ subject: string; color: string }[]>`, `setSubjectColor(subject: string, color: string): Promise<{ subject: string; color: string }>`. Task 3's route calls both.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`** (append after `GoHallRegistration`)

```prisma
model SubjectColor {
  id      String @id @default(cuid())
  subject String @unique
  color   String
}
```

- [ ] **Step 2: Push schema to dev DB and regenerate client**

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync with your Prisma schema" / client generated without errors.

- [ ] **Step 3: Write the failing tests**

```ts
// src/lib/services/subjectColorService.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { listSubjectColors, setSubjectColor } from './subjectColorService';

beforeEach(async () => {
  await prisma.subjectColor.deleteMany();
});

describe('setSubjectColor', () => {
  it('creates a color entry for a new subject', async () => {
    const saved = await setSubjectColor('圍棋', '#B8763F');
    expect(saved.subject).toBe('圍棋');
    expect(saved.color).toBe('#B8763F');
  });

  it('updates in place when the subject already has a color', async () => {
    await setSubjectColor('圍棋', '#B8763F');
    await setSubjectColor('圍棋', '#123456');

    const all = await listSubjectColors();
    expect(all).toHaveLength(1);
    expect(all[0].color).toBe('#123456');
  });
});

describe('listSubjectColors', () => {
  it('returns every saved subject/color pair', async () => {
    await setSubjectColor('圍棋', '#B8763F');
    await setSubjectColor('數學', '#8B6BC9');

    const all = await listSubjectColors();
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.subject).sort()).toEqual(['圍棋', '數學'].sort());
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- subjectColorService`
Expected: FAIL — `Cannot find module './subjectColorService'`
(`npm test` runs `test:dbpush` first, which pushes the new table to the test DB.)

- [ ] **Step 5: Write the service**

```ts
// src/lib/services/subjectColorService.ts
import { prisma } from '@/lib/db';

const SUBJECT_COLOR_SELECT = { subject: true, color: true } as const;

export function listSubjectColors() {
  return prisma.subjectColor.findMany({
    select: SUBJECT_COLOR_SELECT,
    orderBy: { subject: 'asc' },
  });
}

export function setSubjectColor(subject: string, color: string) {
  return prisma.subjectColor.upsert({
    where: { subject },
    create: { subject, color },
    update: { color },
    select: SUBJECT_COLOR_SELECT,
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- subjectColorService`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma src/lib/services/subjectColorService.ts src/lib/services/subjectColorService.test.ts
git commit -m "feat: add SubjectColor table and service for admin-managed subject colors"
```

---

### Task 3: `/api/subject-colors` route

**Files:**
- Create: `src/app/api/subject-colors/route.ts`

**Interfaces:**
- Consumes: `listSubjectColors()`, `setSubjectColor(subject, color)` from Task 2.
- Produces: `GET /api/subject-colors` → `[{ subject, color }]` (ADMIN only); `POST /api/subject-colors` body `{ subject: string, color: string }` → saved pair, 400 on missing fields. Task 4 fetches both.

- [ ] **Step 1: Write the route** (no route-level tests — repo convention)

```ts
// src/app/api/subject-colors/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listSubjectColors, setSubjectColor } from '@/lib/services/subjectColorService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listSubjectColors());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { subject, color } = await req.json();
  if (typeof subject !== 'string' || !subject || typeof color !== 'string' || !color) {
    return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
  }
  return NextResponse.json(await setSubjectColor(subject, color));
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/subject-colors/route.ts
git commit -m "feat: add admin-only subject-colors API route"
```

---

### Task 4: Wide-modal support + TimetableModal component + page button

**Files:**
- Modify: `src/components/ui/Modal.tsx` (add optional `maxWidthClassName` prop)
- Create: `src/app/admin/classes/TimetableModal.tsx`
- Modify: `src/app/admin/classes/page.tsx` (button in header row, render modal)

**Interfaces:**
- Consumes: `stripWeekday`, `levelColor`, `UNSET_SUBJECT_COLOR` from Task 1; `GET/POST /api/subject-colors` from Task 3; the page's existing `ClassRow[]` state.
- Produces: `<TimetableModal open classes onClose />` where `classes` is the page's existing `ClassRow[]`.

- [ ] **Step 1: Add `maxWidthClassName` to Modal** — replace the inner div's className in `src/components/ui/Modal.tsx`:

```tsx
// props interface gains:
//   maxWidthClassName?: string;
// signature becomes:
export default function Modal({ open, onClose, title, children, maxWidthClassName = 'max-w-md' }: ModalProps) {
```

and the inner div:

```tsx
<div
  className={`max-h-[90vh] w-full ${maxWidthClassName} overflow-y-auto rounded-xl bg-card p-5 shadow-lg`}
  onClick={(e) => e.stopPropagation()}
>
```

- [ ] **Step 2: Write `TimetableModal.tsx`**

```tsx
// src/app/admin/classes/TimetableModal.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { stripWeekday, levelColor, UNSET_SUBJECT_COLOR } from '@/lib/timetable';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface TimetableClass {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
}

interface TimetableModalProps {
  open: boolean;
  onClose: () => void;
  classes: TimetableClass[];
}

export default function TimetableModal({ open, onClose, classes }: TimetableModalProps) {
  const [colors, setColors] = useState<Record<string, string>>({});
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/subject-colors')
      .then((res) => res.json())
      .then((rows: { subject: string; color: string }[]) => {
        setColors(Object.fromEntries(rows.map((r) => [r.subject, r.color])));
      });
  }, [open]);

  const subjects = useMemo(() => [...new Set(classes.map((c) => c.subject))], [classes]);

  const byDay = useMemo(() => {
    const days: TimetableClass[][] = Array.from({ length: 7 }, () => []);
    for (const c of classes) days[c.weekday].push(c);
    for (const day of days) day.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return days;
  }, [classes]);

  async function handleColorChange(subject: string, color: string) {
    setColors((prev) => ({ ...prev, [subject]: color }));
    await fetch('/api/subject-colors', { method: 'POST', body: JSON.stringify({ subject, color }) });
  }

  return (
    <Modal open={open} onClose={onClose} title="週課表" maxWidthClassName="max-w-5xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink">
          {subjects.map((subject) => (
            <span key={subject} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: colors[subject] ?? UNSET_SUBJECT_COLOR }}
              />
              {subject}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-brandInk hover:bg-brandDark"
        >
          色塊調整
        </button>
      </div>

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: panelOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="mb-3 rounded-lg bg-stripe p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-bold text-ink">科目顏色</span>
              <button
                type="button"
                className="text-xs text-inkMuted hover:underline"
                onClick={() => setPanelOpen(false)}
              >
                收合
              </button>
            </div>
            {subjects.map((subject) => (
              <div key={subject} className="flex items-center gap-2 py-1 text-sm text-ink">
                <span className="w-20 font-medium">{subject}</span>
                <input
                  type="color"
                  value={colors[subject] ?? UNSET_SUBJECT_COLOR}
                  onChange={(e) => handleColorChange(subject, e.target.value)}
                  className="h-6 w-6 cursor-pointer border-none bg-transparent p-0"
                />
                {!colors[subject] && (
                  <span className="rounded-full bg-pendingBg px-2 py-0.5 text-xs text-pending">尚未設定</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[840px] grid-cols-7 bg-card p-2">
          {WEEKDAYS.map((w) => (
            <div key={w} className="flex justify-center pb-2">
              <span className="flex h-6 min-w-[40px] items-center justify-center rounded-full bg-brand px-2.5 text-xs font-bold text-brandInk">
                {w}
              </span>
            </div>
          ))}
          {byDay.map((day, d) => (
            <div
              key={d}
              className={`flex min-h-[90px] flex-col gap-1.5 rounded-lg px-1.5 pb-2 pt-1 ${d % 2 === 1 ? 'bg-stripe' : ''}`}
            >
              {day.length === 0 ? (
                <p className="pt-3 text-center text-xs text-inkMuted">無課程</p>
              ) : (
                day.map((c) => (
                  <div
                    key={c.id}
                    className="relative overflow-hidden rounded-md py-1.5 pl-2 pr-3.5"
                    style={{ background: colors[c.subject] ?? UNSET_SUBJECT_COLOR }}
                  >
                    <span
                      className="absolute bottom-0 right-0 top-0 w-1.5"
                      style={{ background: levelColor(c.level) }}
                    />
                    <p className="text-xs font-bold text-white">{stripWeekday(c.name)}</p>
                    <p className="mt-0.5 text-[11px] text-white/85">
                      {c.startTime}-{c.endTime}
                    </p>
                    <p className="text-[10px] text-white/70">
                      {c.teacher.user.name}・{c.level}
                    </p>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Wire into the page** — in `src/app/admin/classes/page.tsx`:

Add import:

```tsx
import TimetableModal from './TimetableModal';
```

Add state next to the other `useState` calls:

```tsx
const [showTimetable, setShowTimetable] = useState(false);
```

Change the header row (currently `搜尋 input` + `＋ 新增班級`) to right-align the new button:

```tsx
<div className="mb-6 flex flex-wrap items-center gap-3">
  <Input
    placeholder="搜尋班名、科目、等級或老師"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="max-w-md"
  />
  {!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增班級</Button>}
  <Button variant="secondary" className="ml-auto" onClick={() => setShowTimetable(true)}>
    週課表
  </Button>
</div>
```

Render the modal next to the existing edit `Modal` (before the closing fragment):

```tsx
<TimetableModal open={showTimetable} onClose={() => setShowTimetable(false)} classes={classes} />
```

- [ ] **Step 4: Typecheck, lint, full test suite**

Run: `npx tsc --noEmit && npx next lint && npm test`
Expected: all clean, all tests pass.

- [ ] **Step 5: Browser verification** (dev server via preview tooling, logged in as admin):
1. `/admin/classes` shows 週課表 button at the right end of the header row.
2. Clicking it opens the wide modal: 7 pill badges (日–六, yellow), zebra columns, cards colored gray (no colors saved yet) with 尚未設定 visible in the 色塊調整 panel.
3. Open 色塊調整, pick a color for 圍棋 → cards and legend dot recolor immediately; reload page, reopen modal → color persisted.
4. Confirm card text shows stripped names (基礎2A not 週一基礎2A), time, 老師・程度.
5. Toggle dark mode → modal surfaces use dark tokens, no white flashes.
6. Screenshot for the user.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Modal.tsx src/app/admin/classes/TimetableModal.tsx src/app/admin/classes/page.tsx
git commit -m "feat: add weekly timetable modal with admin-managed subject colors"
```

---

## Deploy

After all tasks pass review: `git push origin main` (Vercel auto-deploys). Then run `npx prisma db push` against production DATABASE_URL — **ask the user first**, since it's a production schema change (adds the `SubjectColor` table; purely additive).
