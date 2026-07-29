# 學生常見問題專區 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins maintain a flat, reorderable FAQ list from a new `/admin/faq` page, and let students read it as a zero-JS accordion at `/student/faq`.

**Architecture:** One new Prisma model (`FaqItem`) with a `sortOrder` int column, one service file with plain CRUD + a swap-based reorder function, four API routes (list/create, update/delete, reorder) gated ADMIN-only, an admin CRUD page reusing this project's existing `Card`/`DataTable`/`Modal`/`Input`/`Button` components, and a student page that's a plain Server Component querying Prisma directly (no API route, no client JS) using native `<details>`/`<summary>` for the accordion.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma 7 (`@prisma/adapter-pg`), Vitest against the real test database, Tailwind.

## Global Constraints

- Schema changes go through `npx prisma db push` (dev DB) + `npm run test:dbpush` (test DB) — this project has no `prisma/migrations` folder; never run `npx prisma migrate`.
- No categories, no search, no enable/disable flag — a flat list ordered by `sortOrder` only (spec explicitly scopes these out).
- New items get `sortOrder` = current max + 1, or 0 if the list is empty.
- Reordering swaps `sortOrder` with the adjacent item in one `prisma.$transaction`; moving the first item up or the last item down is a no-op, and the corresponding arrow button must not render at all (not just be disabled).
- The answer `<textarea>` must reuse the exact existing inline style already used in `src/app/admin/activities/page.tsx`: `rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25`.
- Admin CRUD UI reuses `Card`, `DataTable`, `Modal`, `Input`, `Button`, `useToast` exactly as `/admin/students` and `/admin/activities` already do — no new form components.
- Student page is a plain `async` Server Component, zero `'use client'`, zero API route of its own — queries `prisma.faqItem.findMany` directly, matching `src/app/student/page.tsx`'s exact pattern (including the `export const dynamic = 'force-dynamic'` line, for the same reason: without it this page would be statically prerendered once at build time and serve a stale snapshot until the next deploy).
- Empty-state copy on the student page is exactly `尚未新增常見問題`.
- Both `/student/*` and `/admin/*` are already role-gated by `src/middleware.ts` — new pages under these paths need no additional in-page role check.
- Project convention: `faqService.ts`'s five functions get real Vitest coverage against the real test database (no mocks). The API routes and both pages get zero test files — verify with `npx tsc --noEmit`, `npx eslint`, and manual browser check only.

---

### Task 1: `FaqItem` schema + service layer + tests

**Files:**
- Modify: `prisma/schema.prisma` (append a new model at the end of the file)
- Create: `src/lib/services/faqService.ts`
- Test: `src/lib/services/faqService.test.ts`

**Interfaces:**
- Produces: `listFaqItems(): Promise<FaqItem[]>`, `createFaqItem(input: { question: string; answer: string }): Promise<FaqItem>`, `updateFaqItem(id: string, input: { question: string; answer: string }): Promise<FaqItem>`, `deleteFaqItem(id: string): Promise<void>`, `moveFaqItem(id: string, direction: 'up' | 'down'): Promise<void>`. Task 2's API routes call these five functions by these exact names/signatures. `FaqItem` here is the Prisma-generated type (`id: string; question: string; answer: string; sortOrder: number; createdAt: Date; updatedAt: Date`).

- [ ] **Step 1: Add the `FaqItem` model**

Append to the end of `prisma/schema.prisma`:

```prisma
model FaqItem {
  id        String   @id @default(cuid())
  question  String
  answer    String
  sortOrder Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Push the schema to the dev and test databases**

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.`

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`

Run: `npm run test:dbpush`
Expected: `Your database is now in sync with your Prisma schema.` (against `tutoring_makeup_system_test`)

- [ ] **Step 3: Write the failing tests**

Create `src/lib/services/faqService.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { listFaqItems, createFaqItem, updateFaqItem, deleteFaqItem, moveFaqItem } from './faqService';

beforeEach(async () => {
  await prisma.faqItem.deleteMany();
});

describe('listFaqItems', () => {
  it('returns items ordered by sortOrder ascending', async () => {
    await prisma.faqItem.create({ data: { question: 'B', answer: 'b', sortOrder: 1 } });
    await prisma.faqItem.create({ data: { question: 'A', answer: 'a', sortOrder: 0 } });

    const items = await listFaqItems();

    expect(items.map((i) => i.question)).toEqual(['A', 'B']);
  });
});

describe('createFaqItem', () => {
  it('assigns sortOrder 0 to the first item', async () => {
    const item = await createFaqItem({ question: 'Q1', answer: 'A1' });
    expect(item.sortOrder).toBe(0);
  });

  it('assigns sortOrder one higher than the current max', async () => {
    await prisma.faqItem.create({ data: { question: 'Q1', answer: 'A1', sortOrder: 5 } });

    const item = await createFaqItem({ question: 'Q2', answer: 'A2' });

    expect(item.sortOrder).toBe(6);
  });
});

describe('updateFaqItem', () => {
  it('updates question and answer without touching sortOrder', async () => {
    const created = await prisma.faqItem.create({ data: { question: 'Q1', answer: 'A1', sortOrder: 3 } });

    const updated = await updateFaqItem(created.id, { question: 'Q1 改', answer: 'A1 改' });

    expect(updated.question).toBe('Q1 改');
    expect(updated.answer).toBe('A1 改');
    expect(updated.sortOrder).toBe(3);
  });
});

describe('deleteFaqItem', () => {
  it('removes the item', async () => {
    const created = await prisma.faqItem.create({ data: { question: 'Q1', answer: 'A1', sortOrder: 0 } });

    await deleteFaqItem(created.id);

    const items = await listFaqItems();
    expect(items).toHaveLength(0);
  });
});

describe('moveFaqItem', () => {
  async function setupThree() {
    const a = await prisma.faqItem.create({ data: { question: 'A', answer: 'a', sortOrder: 0 } });
    const b = await prisma.faqItem.create({ data: { question: 'B', answer: 'b', sortOrder: 1 } });
    const c = await prisma.faqItem.create({ data: { question: 'C', answer: 'c', sortOrder: 2 } });
    return { a, b, c };
  }

  it('swaps sortOrder with the previous item when moving up', async () => {
    const { b } = await setupThree();

    await moveFaqItem(b.id, 'up');

    const items = await listFaqItems();
    expect(items.map((i) => i.question)).toEqual(['B', 'A', 'C']);
  });

  it('swaps sortOrder with the next item when moving down', async () => {
    const { b } = await setupThree();

    await moveFaqItem(b.id, 'down');

    const items = await listFaqItems();
    expect(items.map((i) => i.question)).toEqual(['A', 'C', 'B']);
  });

  it('is a no-op when moving the first item up', async () => {
    const { a } = await setupThree();

    await moveFaqItem(a.id, 'up');

    const items = await listFaqItems();
    expect(items.map((i) => i.question)).toEqual(['A', 'B', 'C']);
  });

  it('is a no-op when moving the last item down', async () => {
    const { c } = await setupThree();

    await moveFaqItem(c.id, 'down');

    const items = await listFaqItems();
    expect(items.map((i) => i.question)).toEqual(['A', 'B', 'C']);
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/services/faqService.test.ts`
Expected: FAIL — `Cannot find module './faqService'` (the file doesn't exist yet).

- [ ] **Step 5: Implement the service functions**

Create `src/lib/services/faqService.ts`:

```ts
import { prisma } from '@/lib/db';

export function listFaqItems() {
  return prisma.faqItem.findMany({ orderBy: { sortOrder: 'asc' } });
}

export async function createFaqItem(input: { question: string; answer: string }) {
  const last = await prisma.faqItem.findFirst({ orderBy: { sortOrder: 'desc' } });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  return prisma.faqItem.create({ data: { question: input.question, answer: input.answer, sortOrder } });
}

export function updateFaqItem(id: string, input: { question: string; answer: string }) {
  return prisma.faqItem.update({ where: { id }, data: { question: input.question, answer: input.answer } });
}

export async function deleteFaqItem(id: string) {
  await prisma.faqItem.delete({ where: { id } });
}

export async function moveFaqItem(id: string, direction: 'up' | 'down') {
  const item = await prisma.faqItem.findUniqueOrThrow({ where: { id } });
  const neighbor =
    direction === 'up'
      ? await prisma.faqItem.findFirst({ where: { sortOrder: { lt: item.sortOrder } }, orderBy: { sortOrder: 'desc' } })
      : await prisma.faqItem.findFirst({ where: { sortOrder: { gt: item.sortOrder } }, orderBy: { sortOrder: 'asc' } });
  if (!neighbor) return;
  await prisma.$transaction([
    prisma.faqItem.update({ where: { id: item.id }, data: { sortOrder: neighbor.sortOrder } }),
    prisma.faqItem.update({ where: { id: neighbor.id }, data: { sortOrder: item.sortOrder } }),
  ]);
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/services/faqService.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/services/faqService.ts src/lib/services/faqService.test.ts`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma src/lib/services/faqService.ts src/lib/services/faqService.test.ts
git commit -m "feat: add FaqItem model and faqService CRUD/reorder functions"
```

---

### Task 2: API routes

**Files:**
- Create: `src/app/api/faq/route.ts`
- Create: `src/app/api/faq/[id]/route.ts`
- Create: `src/app/api/faq/[id]/reorder/route.ts`

**Interfaces:**
- Consumes: `listFaqItems`, `createFaqItem`, `updateFaqItem`, `deleteFaqItem`, `moveFaqItem` from `@/lib/services/faqService` (Task 1).
- Produces: `GET /api/faq` → `FaqItem[]`; `POST /api/faq` body `{ question, answer }` → created `FaqItem` (201); `PATCH /api/faq/[id]` body `{ question, answer }` → updated `FaqItem`; `DELETE /api/faq/[id]` → `{ success: true }`; `POST /api/faq/[id]/reorder` body `{ direction: 'up' | 'down' }` → the fresh `FaqItem[]` list (already re-sorted), so the caller can just replace its local state wholesale. Task 3's admin page calls all five.

- [ ] **Step 1: Write the list/create route**

Create `src/app/api/faq/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listFaqItems, createFaqItem } from '@/lib/services/faqService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listFaqItems());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { question, answer } = await req.json();
  const item = await createFaqItem({ question, answer });
  return NextResponse.json(item, { status: 201 });
}
```

- [ ] **Step 2: Write the update/delete route**

Create `src/app/api/faq/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateFaqItem, deleteFaqItem } from '@/lib/services/faqService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { question, answer } = await req.json();
  const item = await updateFaqItem(params.id, { question, answer });
  return NextResponse.json(item);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await deleteFaqItem(params.id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Write the reorder route**

Create `src/app/api/faq/[id]/reorder/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { moveFaqItem, listFaqItems } from '@/lib/services/faqService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { direction } = await req.json();
  await moveFaqItem(params.id, direction);
  return NextResponse.json(await listFaqItems());
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/faq/route.ts "src/app/api/faq/[id]/route.ts" "src/app/api/faq/[id]/reorder/route.ts"`
Expected: no errors.

Per project convention there are no route test files — Task 3's manual browser verification exercises all four routes end-to-end.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/faq
git commit -m "feat: add /api/faq routes (list/create/update/delete/reorder)"
```

---

### Task 3: Admin page (`/admin/faq`)

**Files:**
- Create: `src/app/admin/faq/page.tsx`
- Modify: `src/components/ui/AppShell.tsx` (add one line to the `ADMIN` array in `NAV_LINKS`)

**Interfaces:**
- Consumes: `GET/POST /api/faq`, `PATCH/DELETE /api/faq/[id]`, `POST /api/faq/[id]/reorder` from Task 2.
- Produces: the `/admin/faq` page and its ADMIN nav entry; nothing else depends on this task.

- [ ] **Step 1: Add the ADMIN nav entry**

In `src/components/ui/AppShell.tsx`, the `ADMIN` array inside `NAV_LINKS` currently ends with:

```ts
    { href: '/admin/activities', label: '活動專區' },
  ],
```

Change it to:

```ts
    { href: '/admin/activities', label: '活動專區' },
    { href: '/admin/faq', label: '常見問題' },
  ],
```

- [ ] **Step 2: Write the admin page**

Create `src/app/admin/faq/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface FaqItemRow {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
}

export default function AdminFaqPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<FaqItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ question: '', answer: '' });
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<FaqItemRow | null>(null);
  const [editForm, setEditForm] = useState({ question: '', answer: '' });

  async function load() {
    try {
      const res = await fetch('/api/faq');
      setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/faq', { method: 'POST', body: JSON.stringify(form) });
      if (!res.ok) {
        showToast('新增失敗，請稍後再試');
        return;
      }
      setForm({ question: '', answer: '' });
      setShowAddForm(false);
      showToast('已新增問題');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(item: FaqItemRow) {
    setEditing(item);
    setEditForm({ question: item.question, answer: item.answer });
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/faq/${editing.id}`, { method: 'PATCH', body: JSON.stringify(editForm) });
      if (!res.ok) {
        showToast('儲存失敗，請稍後再試');
        return;
      }
      setEditing(null);
      showToast('已儲存');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm(`確定要刪除「${editing.question}」嗎？此操作無法復原。`)) return;
    await fetch(`/api/faq/${editing.id}`, { method: 'DELETE' });
    setEditing(null);
    showToast('已刪除');
    load();
  }

  async function handleMove(id: string, direction: 'up' | 'down') {
    const res = await fetch(`/api/faq/${id}/reorder`, { method: 'POST', body: JSON.stringify({ direction }) });
    setItems(await res.json());
  }

  const columns: Column<FaqItemRow>[] = [
    { header: '問題', render: (item) => item.question },
    {
      header: '排序',
      render: (item) => {
        const index = items.findIndex((i) => i.id === item.id);
        return (
          <div className="flex items-center justify-center gap-2">
            {index > 0 && (
              <button
                type="button"
                aria-label="上移"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMove(item.id, 'up');
                }}
                className="text-inkMuted hover:text-ink"
              >
                ↑
              </button>
            )}
            {index < items.length - 1 && (
              <button
                type="button"
                aria-label="下移"
                onClick={(e) => {
                  e.stopPropagation();
                  handleMove(item.id, 'down');
                }}
                className="text-inkMuted hover:text-ink"
              >
                ↓
              </button>
            )}
          </div>
        );
      },
    },
    {
      header: '操作',
      render: (item) => (
        <button className="text-brandDark hover:underline" onClick={() => openEdit(item)}>
          編輯
        </button>
      ),
    },
  ];

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">常見問題管理</h1>
      <div className="mb-6">{!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增問題</Button>}</div>

      {showAddForm && (
        <Card className="mb-6 max-w-xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增問題</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <Input placeholder="問題" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} required />
            <textarea
              placeholder="答案"
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
              className="rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25"
              rows={4}
              required
            />
            <Button type="submit" loading={submitting}>新增</Button>
          </form>
        </Card>
      )}

      <Card>
        <DataTable
          columns={columns}
          rows={items}
          keyField={(item) => item.id}
          loading={loading}
          onRowClick={openEdit}
          rowClassName={() => 'cursor-pointer hover:bg-stripe'}
        />
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯問題">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <Input
            placeholder="問題"
            value={editForm.question}
            onChange={(e) => setEditForm({ ...editForm, question: e.target.value })}
            required
          />
          <textarea
            placeholder="答案"
            value={editForm.answer}
            onChange={(e) => setEditForm({ ...editForm, answer: e.target.value })}
            className="rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25"
            rows={4}
            required
          />
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除此問題
        </button>
      </Modal>
    </>
  );
}
```

- [ ] **Step 3: Type-check, lint, and build**

Run: `npx tsc --noEmit && npx eslint src/app/admin/faq/page.tsx src/components/ui/AppShell.tsx`
Expected: no errors.

Run: `rm -rf .next && npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Manual browser verification**

Start the dev server (`preview_start` with the `HJJ dev server` launch config) and log in as `admin@example.com` / `password123`.

1. Navigate to `/admin/faq` via the new "常見問題" nav link — confirm it's there and the page loads with an empty list.
2. Click "＋ 新增問題", fill in a question and a multi-line answer (use an actual newline in the textarea), submit — confirm a toast appears and the new row shows up in the table.
3. Add two more questions the same way — confirm all three appear, and the middle and later rows show the expected ↑/↓ buttons (first row has no ↑, last row has no ↓).
4. Click ↓ on the first row — confirm it moves to second position and the button set updates accordingly (re-fetch the list or re-render from the reorder response to check).
5. Click a row to open the edit modal — confirm the question and full multi-line answer are pre-filled correctly, edit the answer, save — confirm the toast and updated row.
6. Delete one item via the modal's delete link — confirm the `confirm()` dialog appears, and after confirming, the row disappears and a toast shows.
7. Toggle light/dark mode and confirm the textarea and buttons remain legible in both.

Clean up all test data created during verification (delete every FAQ item you added) so the database is left as found.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/faq/page.tsx src/components/ui/AppShell.tsx
git commit -m "feat: add /admin/faq management page"
```

---

### Task 4: Student page (`/student/faq`)

**Files:**
- Create: `src/app/student/faq/page.tsx`
- Modify: `src/components/ui/AppShell.tsx` (add one line to the `STUDENT` array in `NAV_LINKS`)

**Interfaces:**
- Consumes: `prisma.faqItem.findMany` directly (no service-layer call needed — this is a simple ordered read, matching how `src/app/student/page.tsx` queries some of its own data directly via `prisma` rather than through a service function).
- Produces: the `/student/faq` page and its STUDENT nav entry. Nothing else depends on this task.

- [ ] **Step 1: Add the STUDENT nav entry**

In `src/components/ui/AppShell.tsx`, the `STUDENT` array inside `NAV_LINKS` currently ends with:

```ts
    { href: '/student/activities', label: '活動專區' },
  ],
```

Change it to:

```ts
    { href: '/student/activities', label: '活動專區' },
    { href: '/student/faq', label: '常見問題' },
  ],
```

- [ ] **Step 2: Write the student page**

Create `src/app/student/faq/page.tsx`:

```tsx
import { prisma } from '@/lib/db';
import Card from '@/components/ui/Card';

// Without this, Next.js prerenders this page once at build time and
// serves that frozen snapshot to every student until the next deploy.
export const dynamic = 'force-dynamic';

export default async function StudentFaqPage() {
  const items = await prisma.faqItem.findMany({ orderBy: { sortOrder: 'asc' } });

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">常見問題</h1>
      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-inkMuted">尚未新增常見問題</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <details key={item.id} className="group rounded-xl border border-borderSubtle bg-card p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-ink [&::-webkit-details-marker]:hidden">
                {item.question}
                <span className="ml-2 shrink-0 text-inkMuted transition-transform group-open:rotate-180">▾</span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm text-inkMuted">{item.answer}</p>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Type-check, lint, and build**

Run: `npx tsc --noEmit && npx eslint src/app/student/faq/page.tsx src/components/ui/AppShell.tsx`
Expected: no errors.

Run: `rm -rf .next && npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Manual browser verification**

Using the dev server started in Task 3 (or restart it if stopped), log in as `student@example.com` (check `prisma/seed.ts` for the seeded student password if `password123` doesn't work).

1. With no FAQ items in the database, navigate to `/student/faq` via the new "常見問題" nav link — confirm it shows "尚未新增常見問題", not a blank page.
2. Log in as admin in a separate step (or the same session if already admin) and add 2-3 FAQ items via `/admin/faq`, including at least one answer with a blank line in the middle.
3. Back on `/student/faq`, confirm all items appear as collapsed rows showing only the question, with a chevron on the right.
4. Click a question — confirm the answer expands below it, the chevron rotates, and a multi-line answer's blank line is preserved (not collapsed to one line).
5. Click the same question again — confirm it collapses.
6. Confirm this page has no visible client-side interactivity failure with JavaScript-independent behavior: reload the page with an item already expanded (via the browser's native state) — this is inherent to `<details>`, no explicit test action needed beyond confirming expand/collapse works via mouse click.
7. Toggle light/dark mode and confirm both card and chevron remain legible.

Clean up all FAQ items created during verification (delete them via `/admin/faq`) so the database is left as found.

- [ ] **Step 5: Commit**

```bash
git add src/app/student/faq/page.tsx src/components/ui/AppShell.tsx
git commit -m "feat: add /student/faq accordion page"
```
