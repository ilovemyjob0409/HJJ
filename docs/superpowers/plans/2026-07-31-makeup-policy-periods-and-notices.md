# 補課規則改版（期別制＋依科目分流＋補課須知可維護）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 補課額度改為「圍棋班每期 1 次一對一、插班全科不限次數」，新增「期」（每次報課一筆），學生首頁補課須知改為後台逐條維護。

**Architecture:** 兩個新 Prisma model（`EnrollmentPeriod`、`MakeupNoticeItem`）。期紀錄只標記一對一額度重置點與報課歷史，剩餘堂數計算不變。補課須知完整比照既有 FAQ 三層（service → API → admin 頁）。規則邏輯集中在 `makeupRequestService`，一對一額度窗口＝該報名最新一期的 `createdAt` 起算。

**Tech Stack:** Next.js App Router、Prisma 7（`@prisma/adapter-pg`）、PostgreSQL、Vitest、next-auth、Tailwind。

**Spec:** `docs/superpowers/specs/2026-07-31-makeup-policy-periods-and-notices-design.md`

## Global Constraints

- 專案根目錄：`/Users/s.w.kung/Downloads/Wade Claude/HJJ`（所有指令在此執行）。
- 測試指令：`npm test`（先 db push 到測試庫再跑全部）；單檔：`npx vitest run src/lib/services/xxx.test.ts`（測試庫 URL 由 `vitest.setup.ts` 設定，但 schema 變更後要先跑過 `npm run test:dbpush`）。
- 測試檔沿用「各檔 beforeEach 自掃」慣例（resetDb 重構在另一條未合併分支上，本計畫不依賴它）。清表順序必須 FK-safe（子表先刪）。`EnrollmentPeriod` 掛 `onDelete: Cascade`，隨 `classEnrollment.deleteMany()` 自動清除，**不需要**改任何既有測試檔的清理程式。
- 科目判斷用字串常數 `GO_SUBJECT = '圍棋'`（沿用 `classService.SUBJECT_ORDER` 先例）。
- 中文文案一律繁體中文；日期顯示沿用 `formatDateWithWeekday`；UI 沿用既有 Card/Button/Input/Modal/DataTable/Toast 元件與 `animate-*` 動效、深夜模式 token。
- 錯誤代碼字串：`NOT_AVAILABLE`（非圍棋申請一對一）、`QUOTA_EXCEEDED`（本期一對一已用）。
- 每個 Task 結尾 commit（訊息用英文 conventional prefix，如既有 git log 慣例）。

---

### Task 1: Prisma schema — EnrollmentPeriod 與 MakeupNoticeItem

**Files:**
- Modify: `prisma/schema.prisma`（`ClassEnrollment` 加反向關聯；檔尾加兩個 model）

**Interfaces:**
- Produces: `prisma.enrollmentPeriod`（欄位 `id/enrollmentId/sessions/createdAt`）、`prisma.makeupNoticeItem`（欄位 `id/content/sortOrder/createdAt/updatedAt`）、`ClassEnrollment.periods` 關聯。後續所有 Task 依賴。

- [ ] **Step 1: 修改 schema**

`ClassEnrollment`（`prisma/schema.prisma:107`）加一行關聯欄位：

```prisma
model ClassEnrollment {
  id                 String    @id @default(cuid())
  studentId          String
  classId            String
  student            Student   @relation(fields: [studentId], references: [id])
  class              Class     @relation(fields: [classId], references: [id])
  totalSessions      Int?
  lowQuotaNotifiedAt DateTime?
  periods            EnrollmentPeriod[]

  @@unique([studentId, classId])
}
```

檔尾（`FaqItem` 之後）新增：

```prisma
model EnrollmentPeriod {
  id           String          @id @default(cuid())
  enrollmentId String
  enrollment   ClassEnrollment @relation(fields: [enrollmentId], references: [id], onDelete: Cascade)
  sessions     Int
  createdAt    DateTime        @default(now())
}

model MakeupNoticeItem {
  id        String   @id @default(cuid())
  content   String
  sortOrder Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: 驗證並推送 schema**

Run: `npx prisma validate && npm run test:dbpush && npx prisma db push && npx prisma generate`
Expected: validate 通過；測試庫與本機 dev 庫 push 成功；client 重新生成無錯。

- [ ] **Step 3: 既有測試不受影響（cascade 驗證）**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: 全數 PASS（新表為空、cascade 不影響既有清理）。

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add EnrollmentPeriod and MakeupNoticeItem models"
```

---

### Task 2: makeupNoticeService（TDD）

**Files:**
- Create: `src/lib/services/makeupNoticeService.ts`
- Test: `src/lib/services/makeupNoticeService.test.ts`

**Interfaces:**
- Produces: `listMakeupNoticeItems(): Promise<MakeupNoticeItem[]>`、`createMakeupNoticeItem(input: { content: string })`、`updateMakeupNoticeItem(id: string, input: { content: string })`、`deleteMakeupNoticeItem(id: string): Promise<void>`、`moveMakeupNoticeItem(id: string, direction: 'up' | 'down'): Promise<void>`。Task 3 的 API 與 Task 5 的首頁使用。

- [ ] **Step 1: 寫失敗測試**（完整比照 `faqService.test.ts`，欄位換成 `content`）

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import {
  listMakeupNoticeItems,
  createMakeupNoticeItem,
  updateMakeupNoticeItem,
  deleteMakeupNoticeItem,
  moveMakeupNoticeItem,
} from './makeupNoticeService';

beforeEach(async () => {
  await prisma.makeupNoticeItem.deleteMany();
});

describe('listMakeupNoticeItems', () => {
  it('returns items ordered by sortOrder ascending', async () => {
    await prisma.makeupNoticeItem.create({ data: { content: 'B', sortOrder: 1 } });
    await prisma.makeupNoticeItem.create({ data: { content: 'A', sortOrder: 0 } });

    const items = await listMakeupNoticeItems();

    expect(items.map((i) => i.content)).toEqual(['A', 'B']);
  });
});

describe('createMakeupNoticeItem', () => {
  it('assigns sortOrder 0 to the first item', async () => {
    const item = await createMakeupNoticeItem({ content: '第一條' });
    expect(item.sortOrder).toBe(0);
  });

  it('assigns sortOrder one higher than the current max', async () => {
    await prisma.makeupNoticeItem.create({ data: { content: 'X', sortOrder: 5 } });

    const item = await createMakeupNoticeItem({ content: 'Y' });

    expect(item.sortOrder).toBe(6);
  });
});

describe('updateMakeupNoticeItem', () => {
  it('updates content without touching sortOrder', async () => {
    const created = await prisma.makeupNoticeItem.create({ data: { content: '原文', sortOrder: 3 } });

    const updated = await updateMakeupNoticeItem(created.id, { content: '改文' });

    expect(updated.content).toBe('改文');
    expect(updated.sortOrder).toBe(3);
  });
});

describe('deleteMakeupNoticeItem', () => {
  it('removes the item', async () => {
    const created = await prisma.makeupNoticeItem.create({ data: { content: 'X', sortOrder: 0 } });

    await deleteMakeupNoticeItem(created.id);

    expect(await listMakeupNoticeItems()).toHaveLength(0);
  });
});

describe('moveMakeupNoticeItem', () => {
  async function setupThree() {
    const a = await prisma.makeupNoticeItem.create({ data: { content: 'A', sortOrder: 0 } });
    const b = await prisma.makeupNoticeItem.create({ data: { content: 'B', sortOrder: 1 } });
    const c = await prisma.makeupNoticeItem.create({ data: { content: 'C', sortOrder: 2 } });
    return { a, b, c };
  }

  it('swaps sortOrder with the previous item when moving up', async () => {
    const { b } = await setupThree();
    await moveMakeupNoticeItem(b.id, 'up');
    expect((await listMakeupNoticeItems()).map((i) => i.content)).toEqual(['B', 'A', 'C']);
  });

  it('swaps sortOrder with the next item when moving down', async () => {
    const { b } = await setupThree();
    await moveMakeupNoticeItem(b.id, 'down');
    expect((await listMakeupNoticeItems()).map((i) => i.content)).toEqual(['A', 'C', 'B']);
  });

  it('is a no-op when moving the first item up', async () => {
    const { a } = await setupThree();
    await moveMakeupNoticeItem(a.id, 'up');
    expect((await listMakeupNoticeItems()).map((i) => i.content)).toEqual(['A', 'B', 'C']);
  });

  it('is a no-op when moving the last item down', async () => {
    const { c } = await setupThree();
    await moveMakeupNoticeItem(c.id, 'down');
    expect((await listMakeupNoticeItems()).map((i) => i.content)).toEqual(['A', 'B', 'C']);
  });
});
```

- [ ] **Step 2: 確認測試失敗**

Run: `npx vitest run src/lib/services/makeupNoticeService.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作 service**（完整比照 `faqService.ts`）

```ts
import { prisma } from '@/lib/db';

export function listMakeupNoticeItems() {
  // createdAt is a tiebreaker for the (rare, since createMakeupNoticeItem's
  // max+1 read and write aren't transactional) case of two rows sharing a
  // sortOrder — without it, Postgres doesn't guarantee those rows compare
  // the same way between the admin list and the student page's query.
  return prisma.makeupNoticeItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}

export async function createMakeupNoticeItem(input: { content: string }) {
  const last = await prisma.makeupNoticeItem.findFirst({ orderBy: { sortOrder: 'desc' } });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  return prisma.makeupNoticeItem.create({ data: { content: input.content, sortOrder } });
}

export function updateMakeupNoticeItem(id: string, input: { content: string }) {
  return prisma.makeupNoticeItem.update({ where: { id }, data: { content: input.content } });
}

export async function deleteMakeupNoticeItem(id: string) {
  await prisma.makeupNoticeItem.delete({ where: { id } });
}

export async function moveMakeupNoticeItem(id: string, direction: 'up' | 'down') {
  const item = await prisma.makeupNoticeItem.findUniqueOrThrow({ where: { id } });
  const neighbor =
    direction === 'up'
      ? await prisma.makeupNoticeItem.findFirst({ where: { sortOrder: { lt: item.sortOrder } }, orderBy: { sortOrder: 'desc' } })
      : await prisma.makeupNoticeItem.findFirst({ where: { sortOrder: { gt: item.sortOrder } }, orderBy: { sortOrder: 'asc' } });
  if (!neighbor) return;
  await prisma.$transaction([
    prisma.makeupNoticeItem.update({ where: { id: item.id }, data: { sortOrder: neighbor.sortOrder } }),
    prisma.makeupNoticeItem.update({ where: { id: neighbor.id }, data: { sortOrder: item.sortOrder } }),
  ]);
}
```

- [ ] **Step 4: 確認測試通過**

Run: `npx vitest run src/lib/services/makeupNoticeService.test.ts`
Expected: 全數 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/makeupNoticeService.ts src/lib/services/makeupNoticeService.test.ts
git commit -m "feat: add makeupNoticeService for admin-maintained makeup notices"
```

---

### Task 3: 補課須知 API 路由

**Files:**
- Create: `src/app/api/makeup-notices/route.ts`
- Create: `src/app/api/makeup-notices/[id]/route.ts`
- Create: `src/app/api/makeup-notices/[id]/reorder/route.ts`

**Interfaces:**
- Consumes: Task 2 的五個 service 函式。
- Produces: `GET/POST /api/makeup-notices`、`PATCH/DELETE /api/makeup-notices/[id]`、`POST /api/makeup-notices/[id]/reorder`，全部 ADMIN 限定（比照 `/api/faq`，含 GET）。Task 4 的後台頁使用。

- [ ] **Step 1: `src/app/api/makeup-notices/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { listMakeupNoticeItems, createMakeupNoticeItem } from '@/lib/services/makeupNoticeService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json(await listMakeupNoticeItems());
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { content } = await req.json();
  const item = await createMakeupNoticeItem({ content });
  return NextResponse.json(item, { status: 201 });
}
```

- [ ] **Step 2: `src/app/api/makeup-notices/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateMakeupNoticeItem, deleteMakeupNoticeItem } from '@/lib/services/makeupNoticeService';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { content } = await req.json();
  const item = await updateMakeupNoticeItem(params.id, { content });
  return NextResponse.json(item);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  await deleteMakeupNoticeItem(params.id);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: `src/app/api/makeup-notices/[id]/reorder/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { moveMakeupNoticeItem, listMakeupNoticeItems } from '@/lib/services/makeupNoticeService';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { direction } = await req.json();
  await moveMakeupNoticeItem(params.id, direction);
  return NextResponse.json(await listMakeupNoticeItems());
}
```

- [ ] **Step 4: 驗證編譯**

Run: `npx tsc --noEmit`
Expected: 無錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/app/api/makeup-notices
git commit -m "feat: add admin-only makeup notice API routes"
```

---

### Task 4: 後台「補課須知管理」頁 + 導覽連結

**Files:**
- Create: `src/app/admin/makeup-notices/page.tsx`
- Modify: `src/components/ui/AppShell.tsx:23`（ADMIN 導覽陣列）

**Interfaces:**
- Consumes: Task 3 的 API。

- [ ] **Step 1: 建立頁面**（比照 `src/app/admin/faq/page.tsx`，欄位剩 `content`，文案改補課須知）

```tsx
'use client';

import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface NoticeRow {
  id: string;
  content: string;
  sortOrder: number;
}

const TEXTAREA_CLASS =
  'rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25';

export default function AdminMakeupNoticesPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<NoticeRow | null>(null);
  const [editContent, setEditContent] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/makeup-notices');
      if (!res.ok) {
        showToast('載入失敗，請稍後再試');
        return;
      }
      setItems(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/makeup-notices', { method: 'POST', body: JSON.stringify({ content }) });
      if (!res.ok) {
        showToast('新增失敗，請稍後再試');
        return;
      }
      setContent('');
      setShowAddForm(false);
      showToast('已新增須知');
      load();
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(item: NoticeRow) {
    setEditing(item);
    setEditContent(item.content);
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/makeup-notices/${editing.id}`, { method: 'PATCH', body: JSON.stringify({ content: editContent }) });
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
    if (!confirm('確定要刪除這條補課須知嗎？此操作無法復原。')) return;
    await fetch(`/api/makeup-notices/${editing.id}`, { method: 'DELETE' });
    setEditing(null);
    showToast('已刪除');
    load();
  }

  async function handleMove(id: string, direction: 'up' | 'down') {
    const res = await fetch(`/api/makeup-notices/${id}/reorder`, { method: 'POST', body: JSON.stringify({ direction }) });
    if (!res.ok) {
      showToast('排序失敗，請稍後再試');
      return;
    }
    setItems(await res.json());
  }

  const columns: Column<NoticeRow>[] = [
    {
      header: '內容',
      render: (item) => (
        <span className="block max-w-[28rem] truncate text-left" title={item.content}>
          {item.content}
        </span>
      ),
    },
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
      <h1 className="mb-4 text-xl font-bold text-ink">補課須知管理</h1>
      <p className="mb-4 text-sm text-inkMuted">這裡的內容會依序顯示在學生首頁的「補課須知」區塊；沒有任何內容時該區塊不會顯示。</p>
      <div className="mb-6">{!showAddForm && <Button onClick={() => setShowAddForm(true)}>＋ 新增須知</Button>}</div>

      {showAddForm && (
        <Card className="mb-6 max-w-xl">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-ink">新增須知</h2>
            <button type="button" className="text-sm text-inkMuted hover:underline" onClick={() => setShowAddForm(false)}>
              收合
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <textarea
              placeholder="須知內容"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className={TEXTAREA_CLASS}
              rows={3}
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

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="編輯須知">
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-3">
          <textarea
            placeholder="須知內容"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className={TEXTAREA_CLASS}
            rows={3}
            required
          />
          <Button type="submit" loading={submitting}>儲存</Button>
        </form>
        <button type="button" className="mt-3 text-sm text-rejected hover:underline" onClick={handleDelete}>
          刪除此須知
        </button>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: AppShell 導覽**

`src/components/ui/AppShell.tsx` ADMIN 陣列中，`{ href: '/admin/faq', label: '常見問題' }` **之前**插入：

```ts
    { href: '/admin/makeup-notices', label: '補課須知' },
```

- [ ] **Step 3: 驗證**

Run: `npx tsc --noEmit && npm run lint`
Expected: 無錯誤（lint 對既有警告維持原狀即可）。

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/makeup-notices/page.tsx src/components/ui/AppShell.tsx
git commit -m "feat: add admin makeup-notices management page"
```

---

### Task 5: 學生首頁補課須知改讀資料庫

**Files:**
- Modify: `src/app/student/page.tsx`

**Interfaces:**
- Consumes: `listMakeupNoticeItems()`（Task 2）。
- Produces: 首頁不再 import `TOTAL_QUARTER_LIMIT`/`ONE_ON_ONE_QUARTER_LIMIT`（Task 7 刪常數的前置條件）。

- [ ] **Step 1: 修改首頁**

`src/app/student/page.tsx`：

1. 刪除 `import { TOTAL_QUARTER_LIMIT, ONE_ON_ONE_QUARTER_LIMIT } from '@/lib/services/makeupRequestService';`，改為 `import { listMakeupNoticeItems } from '@/lib/services/makeupNoticeService';`
2. `StudentDashboard` 內取資料（與既有 Promise.all 並列即可，注意 notices 與 student 無關，放在外面）：

```tsx
  const notices = await listMakeupNoticeItems();
```

3. 補課須知 Card（原 92–101 行）改為：

```tsx
      {notices.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-2 font-bold text-ink">補課須知</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-inkMuted">
            {notices.map((n) => (
              <li key={n.id} className="whitespace-pre-wrap">{n.content}</li>
            ))}
          </ul>
        </Card>
      )}
```

- [ ] **Step 2: 驗證**

Run: `npx tsc --noEmit && npm run lint`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/app/student/page.tsx
git commit -m "feat: student homepage reads makeup notices from database"
```

---

### Task 6: classService — 報課建立期紀錄（TDD）

**Files:**
- Modify: `src/lib/services/classService.ts`（`setStudentEnrollments`、`addEnrollmentSessions`）
- Test: `src/lib/services/classService.test.ts`

**Interfaces:**
- Consumes: `prisma.enrollmentPeriod`（Task 1）。
- Produces: `addEnrollmentSessions(classId, studentId, amount)` 簽名不變，行為多「建立一筆期」；`setStudentEnrollments` 新報名含堂數會建第一期。Task 7 的額度窗口、Task 9 的 UI 依賴此行為。

- [ ] **Step 1: 加失敗測試**（附加在 `classService.test.ts` 對應 describe 內）

`describe('setStudentEnrollments', ...)` 內新增：

```ts
  it('creates the first enrollment period when a new enrollment has totalSessions', async () => {
    const { student, cls } = await setupStudentAndClass();
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    const periods = await prisma.enrollmentPeriod.findMany({ where: { enrollment: { studentId: student.id, classId: cls.id } } });
    expect(periods).toHaveLength(1);
    expect(periods[0].sessions).toBe(12);
  });

  it('does not create a period when a new enrollment has no totalSessions', async () => {
    const { student, cls } = await setupStudentAndClass();
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: null }]);

    expect(await prisma.enrollmentPeriod.count()).toBe(0);
  });

  it('does not create a period when correcting an existing enrollment totalSessions', async () => {
    const { student, cls } = await setupStudentAndClass();
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 18 }]);

    expect(await prisma.enrollmentPeriod.count()).toBe(1);
  });
```

（`setupStudentAndClass` 為該檔既有 helper 名稱——以檔內實際 helper 為準，若名稱不同就沿用該檔慣例建 student+class。）

`describe('addEnrollmentSessions', ...)` 內新增：

```ts
  it('creates a new enrollment period recording the added sessions', async () => {
    const { student, cls } = await setupStudentAndClass();
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    await addEnrollmentSessions(cls.id, student.id, 6);

    const periods = await prisma.enrollmentPeriod.findMany({
      where: { enrollment: { studentId: student.id, classId: cls.id } },
      orderBy: { createdAt: 'asc' },
    });
    expect(periods.map((p) => p.sessions)).toEqual([12, 6]);
  });
```

`describe('unenrollStudent', ...)` 內新增（cascade 驗證）：

```ts
  it('cascades enrollment periods when the enrollment is removed', async () => {
    const { student, cls } = await setupStudentAndClass();
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    await unenrollStudent(cls.id, student.id);

    expect(await prisma.enrollmentPeriod.count()).toBe(0);
  });
```

- [ ] **Step 2: 確認失敗**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: 新測試 FAIL（period 數為 0 或 1），既有測試 PASS。

- [ ] **Step 3: 實作**

`setStudentEnrollments` 的 `toAdd` 段改為：

```ts
    ...toAdd.map((e) =>
      prisma.classEnrollment.create({
        data: {
          studentId,
          classId: e.classId,
          totalSessions: e.totalSessions,
          // 首次報名且有堂數＝第一期。之後的期由「新增一期」
          // (addEnrollmentSessions) 建立；直接改 totalSessions 是校正，不建期。
          ...(e.totalSessions !== null ? { periods: { create: { sessions: e.totalSessions } } } : {}),
        },
      })
    ),
```

`addEnrollmentSessions` 改為（保留原註解的原子更新理由）：

```ts
export async function addEnrollmentSessions(classId: string, studentId: string, amount: number) {
  const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } } });
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE "ClassEnrollment" SET "totalSessions" = COALESCE("totalSessions", 0) + ${amount} WHERE "id" = ${enrollment.id}`,
    prisma.enrollmentPeriod.create({ data: { enrollmentId: enrollment.id, sessions: amount } }),
  ]);
  return prisma.classEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
}
```

- [ ] **Step 4: 確認通過**

Run: `npx vitest run src/lib/services/classService.test.ts`
Expected: 全數 PASS（含既有的並發 addEnrollmentSessions 測試——原子 UPDATE 保留）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/classService.ts src/lib/services/classService.test.ts
git commit -m "feat: enrollment top-ups create EnrollmentPeriod records"
```

---

### Task 7: makeupRequestService 規則改版（TDD）

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts`
- Test: `src/lib/services/makeupRequestService.test.ts`（整檔改寫額度相關測試）
- Delete: `src/lib/quarter.ts`、`src/lib/quarter.test.ts`

**Interfaces:**
- Consumes: `prisma.enrollmentPeriod`、`addEnrollmentSessions`（測試中用來換期）。
- Produces: `GO_SUBJECT = '圍棋'`、`ONE_ON_ONE_PERIOD_LIMIT = 1`、`MakeupQuotaStatus = { oneOnOneAvailable: boolean; oneOnOneRemaining: number }`、錯誤 `NOT_AVAILABLE`。`TOTAL_QUARTER_LIMIT`/`ONE_ON_ONE_QUARTER_LIMIT` 刪除。Task 8 的 UI 依賴新型別。

- [ ] **Step 1: 改寫測試**

`makeupRequestService.test.ts` 修改重點（beforeEach 清單不動——`EnrollmentPeriod` 由 cascade 清）：

1. import 增 `setStudentEnrollments`、`addEnrollmentSessions`（自 `./classService`），移除不再匯出的常數（原本就沒 import 常數，只需確認）。
2. `setup()` 改為圍棋班，且報名帶堂數（建立第一期）：

```ts
async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const classA = await createClass({ name: '圍棋A班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
  const classB = await createClass({ name: '圍棋B班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
  await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: 12 }]);
  const leave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 20), reason: '感冒' });
  return { teacher, student, classA, classB, leave };
}
```

3. `formatMakeupSlot` 三個測試**不動**（純格式化，無 DB）。
4. `createInsertionMakeupRequest` describe：保留建立測試；原「2 次上限」測試改為**無上限**：

```ts
  it('allows a third insertion in the same period (insertions are unlimited)', async () => {
    const { student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });
    const thirdLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 30), reason: '事假' });

    const third = await createInsertionMakeupRequest({ leaveRequestId: thirdLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 7, 1) });

    expect(third.status).toBe('PENDING_ADMIN');
  });
```

5. `createOneOnOneMakeupRequest` describe：
   - 「creates a PENDING_ADMIN…」「OUTSIDE_AVAILABILITY」「SLOT_CONFLICT」「同 slot 並發」四個測試邏輯不動（班級已是圍棋）。
   - 原「this quarter」QUOTA_EXCEEDED 測試改名「when the student already used the one-on-one makeup this period」，內容邏輯不變。
   - 原「total quarterly quota (2) used by insertions」測試改為**插班不吃一對一額度**：

```ts
  it('still allows a one-on-one after two insertions (insertions do not consume the quota)', async () => {
    const { teacher, student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    const thirdLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 30), reason: '事假' });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: thirdLeave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    expect(makeup.status).toBe('PENDING_ADMIN');
  });
```

   - 新增**非圍棋拒絕**：

```ts
  it('throws NOT_AVAILABLE for a non-Go class', async () => {
    const { teacher, student } = await setup();
    const mathClass = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(mathClass.id, student.id);
    const mathLeave = await createLeaveRequest({ studentId: student.id, classId: mathClass.id, date: new Date(2026, 6, 21), reason: '事假' });
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    await expect(
      createOneOnOneMakeupRequest({
        leaveRequestId: mathLeave.id,
        studentId: student.id,
        teacherId: teacher.id,
        slotDate: new Date('2026-07-15'),
        slotStartTime: '16:00',
        slotEndTime: '17:00',
      })
    ).rejects.toThrow('NOT_AVAILABLE');
  });
```

   - 新增**換期重置**：

```ts
  it('allows a new one-on-one after a new enrollment period is added', async () => {
    const { teacher, student, classA, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    await addEnrollmentSessions(classA.id, student.id, 10); // 新的一期

    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: secondLeave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-29'),
      slotStartTime: '17:00',
      slotEndTime: '18:00',
    });

    expect(makeup.status).toBe('PENDING_ADMIN');
  });
```

   - 「同學生並發兩筆一對一」測試保留（斷言不變：一成一敗 QUOTA_EXCEEDED）。
6. `getMakeupQuotaStatus` describe 全面改寫：

```ts
describe('getMakeupQuotaStatus', () => {
  it('returns full quota for a Go class with a fresh period', async () => {
    const { student, classA } = await setup();
    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 1 });
  });

  it('marks one-on-one unavailable for a non-Go class', async () => {
    const { teacher, student } = await setup();
    const mathClass = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(mathClass.id, student.id);

    const quota = await getMakeupQuotaStatus(student.id, mathClass.id);

    expect(quota).toEqual({ oneOnOneAvailable: false, oneOnOneRemaining: 0 });
  });

  it('reduces remaining to zero after a one-on-one request this period', async () => {
    const { teacher, student, classA, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 0 });
  });

  it('keeps remaining untouched by insertions', async () => {
    const { student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });

    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 1 });
  });

  it('releases quota back after a one-on-one request is rejected', async () => {
    const { teacher, student, classA, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    await decideMakeupRequest(makeup.id, 'REJECTED');

    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 1 });
  });

  it('resets remaining when a new period is added', async () => {
    const { teacher, student, classA, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    await addEnrollmentSessions(classA.id, student.id, 10);

    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 1 });
  });

  it('counts all history when the enrollment has no period on record', async () => {
    const { teacher, student, classB } = await setup();
    await enrollStudent(classB.id, student.id); // 無堂數 → 無期紀錄
    const leaveB = await createLeaveRequest({ studentId: student.id, classId: classB.id, date: new Date(2026, 6, 28), reason: '事假' });
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leaveB.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    const quota = await getMakeupQuotaStatus(student.id, classB.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 0 });
  });

  it('tracks quota independently per class', async () => {
    const { teacher, student, classA, classB, leave } = await setup();
    await setStudentEnrollments(student.id, [
      { classId: classA.id, totalSessions: 12 },
      { classId: classB.id, totalSessions: 12 },
    ]);
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    expect(await getMakeupQuotaStatus(student.id, classA.id)).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 0 });
    expect(await getMakeupQuotaStatus(student.id, classB.id)).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 1 });
  });
});
```

7. `listInsertionsForTeacherClasses` 測試中 `expect(results[0].targetClass?.name).toBe('數學B班')` 改為 `'圍棋B班'`。
8. 其餘（listPending/decide、LINE 案例）不動。

- [ ] **Step 2: 確認失敗**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts`
Expected: 新／改測試 FAIL（舊邏輯擋額度、無 NOT_AVAILABLE、quota 型別不符）。

- [ ] **Step 3: 實作 service**

`makeupRequestService.ts`：

1. 刪 `import { getQuarterRange } from '@/lib/quarter';`
2. 常數與型別：

```ts
export const GO_SUBJECT = '圍棋';
export const ONE_ON_ONE_PERIOD_LIMIT = 1;

export interface MakeupQuotaStatus {
  oneOnOneAvailable: boolean;
  oneOnOneRemaining: number;
}
```

3. 刪 `getQuotaCounts`，改為：

```ts
// The one-on-one window starts at this enrollment's newest period (each
// 報課 = one period). No period on record — pre-backfill data or an
// enrollment created without sessions — falls back to all-time, the
// conservative reading; after the launch backfill every enrollment has
// at least one period.
async function getOneOnOnePeriodStart(client: ClientType, studentId: string, classId: string) {
  const latest = await client.enrollmentPeriod.findFirst({
    where: { enrollment: { studentId, classId } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return latest?.createdAt ?? null;
}

// Shared by getMakeupQuotaStatus (read-only snapshot for display) and the
// write-path check in createOneOnOneMakeupRequestTx (which passes its `tx`
// client so the count is read inside the same serializable transaction as
// the check-then-act).
async function countOneOnOneUsed(client: ClientType, studentId: string, classId: string, since: Date | null) {
  return client.makeupRequest.count({
    where: {
      type: 'ONE_ON_ONE',
      status: { in: ['PENDING_ADMIN', 'APPROVED'] },
      leaveRequest: { studentId, classId },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
  });
}
```

4. `getMakeupQuotaStatus`：

```ts
export async function getMakeupQuotaStatus(studentId: string, classId: string): Promise<MakeupQuotaStatus> {
  const cls = await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { subject: true } });
  if (cls.subject !== GO_SUBJECT) return { oneOnOneAvailable: false, oneOnOneRemaining: 0 };

  const since = await getOneOnOnePeriodStart(prisma, studentId, classId);
  const used = await countOneOnOneUsed(prisma, studentId, classId, since);
  return { oneOnOneAvailable: true, oneOnOneRemaining: Math.max(0, ONE_ON_ONE_PERIOD_LIMIT - used) };
}
```

5. 插班無上限——`createInsertionMakeupRequest` 收斂為單一 create（不再需要交易與 leave 查詢；`createInsertionMakeupRequestTx` 刪除）：

```ts
export function createInsertionMakeupRequest(input: CreateInsertionInput) {
  return prisma.makeupRequest.create({
    data: {
      leaveRequestId: input.leaveRequestId,
      type: 'INSERTION',
      status: 'PENDING_ADMIN',
      targetClassId: input.targetClassId,
      targetDate: input.targetDate,
    },
  });
}
```

6. `createOneOnOneMakeupRequestTx` 開頭改為：

```ts
    const leave = await tx.leaveRequest.findUniqueOrThrow({
      where: { id: input.leaveRequestId },
      select: { classId: true, class: { select: { subject: true } } },
    });
    if (leave.class.subject !== GO_SUBJECT) throw new Error('NOT_AVAILABLE');

    const since = await getOneOnOnePeriodStart(tx, input.studentId, leave.classId);
    const used = await countOneOnOneUsed(tx, input.studentId, leave.classId, since);
    if (used >= ONE_ON_ONE_PERIOD_LIMIT) throw new Error('QUOTA_EXCEEDED');
```

（availability 檢查、slot 衝突、create 段落不動；`runSerializableWithRetry` 包裹保留。）

7. 刪 `src/lib/quarter.ts`、`src/lib/quarter.test.ts`：

```bash
git rm src/lib/quarter.ts src/lib/quarter.test.ts
```

- [ ] **Step 4: 確認通過**

Run: `npx vitest run src/lib/services/makeupRequestService.test.ts && npx tsc --noEmit`
Expected: 全數 PASS；tsc 無錯（Task 5 已先移除首頁的常數 import；`/api/makeup-requests` 只透傳 quota，無型別破壞）。

- [ ] **Step 5: Commit**

```bash
git add -A src/lib
git commit -m "feat: subject-aware makeup rules — unlimited insertions, per-period one-on-one for Go"
```

---

### Task 8: 學生申請補課頁 UI 改版

**Files:**
- Modify: `src/app/student/makeup-request/page.tsx`

**Interfaces:**
- Consumes: `GET /api/makeup-requests?leaveRequestId=` 回傳的新 `quota` 形狀 `{ oneOnOneAvailable, oneOnOneRemaining }`；POST 錯誤碼 `NOT_AVAILABLE`/`QUOTA_EXCEEDED`。

- [ ] **Step 1: 修改頁面**

1. `Quota` interface 改為：

```ts
interface Quota {
  oneOnOneAvailable: boolean;
  oneOnOneRemaining: number;
}
```

2. 型別自動切換 useEffect（原 74–81 行）改為：

```ts
  useEffect(() => {
    if (!quota) return;
    if (makeupType === 'ONE_ON_ONE' && (!quota.oneOnOneAvailable || quota.oneOnOneRemaining === 0)) {
      setMakeupType('INSERTION');
    }
  }, [quota, makeupType]);
```

3. 選項區塊（原 165–198 行）改為——非圍棋班直接進插班表單，圍棋班才顯示切換：

```tsx
          {quota?.oneOnOneAvailable ? (
            <div className="mb-4 flex flex-col gap-3 text-sm text-ink">
              <div className="flex gap-6">
                <label className="flex flex-col gap-1">
                  <span className="flex items-center gap-1">
                    <input type="radio" checked={makeupType === 'INSERTION'} onChange={() => setMakeupType('INSERTION')} />
                    插班補課
                  </span>
                  <span className="text-xs text-inkMuted">不限次數</span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={makeupType === 'ONE_ON_ONE'}
                      disabled={quota.oneOnOneRemaining === 0}
                      onChange={() => setMakeupType('ONE_ON_ONE')}
                    />
                    一對一補課
                  </span>
                  <span className="text-xs text-inkMuted">
                    {quota.oneOnOneRemaining > 0 ? `本期剩餘 ${quota.oneOnOneRemaining} 次` : '本期已使用完畢'}
                  </span>
                </label>
              </div>
              {quota.oneOnOneRemaining === 0 && (
                <p className="text-xs text-inkMuted">
                  本期一對一補課已使用完畢。若無法配合插班補課，該期未補課費用將於下一期學費扣除，詳情請洽櫃檯。
                </p>
              )}
            </div>
          ) : (
            quota && <p className="mb-4 text-xs text-inkMuted">此班級提供插班補課（不限次數）。</p>
          )}
```

4. `submitInsertion` 的錯誤分支：刪除 `QUOTA_EXCEEDED` 分支（插班已無額度）。
5. `submitOneOnOne` 的錯誤分支改為：

```ts
      } else if (data.error === 'QUOTA_EXCEEDED') {
        setMessage('本期一對一補課名額已使用');
      } else if (data.error === 'NOT_AVAILABLE') {
        setMessage('此班級科目不提供一對一補課');
      } else if (data.error === 'OUTSIDE_AVAILABILITY') {
```

6. 一對一表單的顯示條件維持 `makeupType === 'ONE_ON_ONE'`（切換邏輯已保證非圍棋不會進入）。

- [ ] **Step 2: 驗證**

Run: `npx tsc --noEmit && npm run lint`
Expected: 無錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/app/student/makeup-request/page.tsx
git commit -m "feat: makeup request page reflects subject-aware quota rules"
```

---

### Task 9: 學生管理頁「新增一期」控制項

**Files:**
- Modify: `src/app/admin/students/page.tsx`（編輯 Modal 的已加入班級表格）

**Interfaces:**
- Consumes: `PATCH /api/classes/[classId]/enrollments`（body `{ studentId, addSessions }`，回傳更新後 enrollment 含 `totalSessions`；Task 6 已讓它建期）。

- [ ] **Step 1: 加狀態與 handler**

元件內（其他 state 旁）新增：

```ts
  const [periodInputs, setPeriodInputs] = useState<Record<string, string>>({});
  const [addingPeriodClassId, setAddingPeriodClassId] = useState<string | null>(null);
```

`openEdit` 內補 `setPeriodInputs({});`。

新增 handler：

```ts
  async function handleAddPeriod(classId: string) {
    if (!editing) return;
    const amount = Number(periodInputs[classId]);
    if (!Number.isInteger(amount) || amount <= 0) {
      showToast('請輸入本期堂數（正整數）');
      return;
    }
    setAddingPeriodClassId(classId);
    try {
      const res = await fetch(`/api/classes/${classId}/enrollments`, {
        method: 'PATCH',
        body: JSON.stringify({ studentId: editing.id, addSessions: amount }),
      });
      if (!res.ok) {
        showToast('新增一期失敗，請稍後再試');
        return;
      }
      const updated = await res.json();
      // 同步表單裡的總堂數，避免之後按「儲存」把加期前的舊數字
      // 當校正送回去，蓋掉剛加上的堂數。
      setEditEnrollments((prev) => ({ ...prev, [classId]: updated.totalSessions === null ? '' : String(updated.totalSessions) }));
      setPeriodInputs((prev) => ({ ...prev, [classId]: '' }));
      showToast('已新增一期');
      load();
    } finally {
      setAddingPeriodClassId(null);
    }
  }
```

- [ ] **Step 2: 表格加「新增一期」欄**

已加入班級 DataTable 的 columns 中，「已上／剩餘」欄之後、「移除」欄之前插入：

```tsx
                  {
                    header: '新增一期',
                    render: (c) => {
                      const enrollment = editing?.enrollments.find((e) => e.classId === c.id);
                      if (!enrollment) return <span className="text-xs text-inkMuted">儲存後可用</span>;
                      return (
                        <div className="flex items-center justify-center gap-1">
                          <Input
                            type="number"
                            placeholder="堂數"
                            value={periodInputs[c.id] ?? ''}
                            onChange={(e) => setPeriodInputs((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            className="w-20"
                          />
                          <button
                            type="button"
                            disabled={addingPeriodClassId === c.id}
                            onClick={() => handleAddPeriod(c.id)}
                            className="whitespace-nowrap text-xs text-brandDark hover:underline disabled:opacity-50"
                          >
                            ＋一期
                          </button>
                          <HintButton
                            label="新增一期說明"
                            active={openHintClassId === `period-${c.id}`}
                            onToggle={() => setOpenHintClassId((prev) => (prev === `period-${c.id}` ? null : `period-${c.id}`))}
                          >
                            新增一期＝這期報課：堂數會累加到總堂數，圍棋班的一對一補課額度同時重新起算。直接修改「總堂數」欄位則是校正，不會開新的一期。
                          </HintButton>
                        </div>
                      );
                    },
                  },
```

（`openHintClassId` 為既有 state，值型別是 string——用 `period-` 前綴避免跟總堂數說明互撞。）

- [ ] **Step 3: 驗證**

Run: `npx tsc --noEmit && npm run lint`
Expected: 無錯誤。

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/students/page.tsx
git commit -m "feat: admin can add a new enrollment period from the student editor"
```

---

### Task 10: 上線 backfill 腳本

**Files:**
- Create: `prisma/backfill-periods-and-notices.ts`

**Interfaces:**
- Consumes: Task 1 的兩個 model。獨立 PrismaClient（比照 `prisma/create-admin.ts`，不 import `src/lib/db`）。

- [ ] **Step 1: 建立腳本**

```ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// 一次性上線腳本（可重複執行，冪等）：
// 1. 為每筆尚無期紀錄的報名補建第一期（sessions = totalSessions ?? 0）
// 2. 補課須知為空時寫入預設內容
// 執行：npx tsx prisma/backfill-periods-and-notices.ts
// （DATABASE_URL 指向目標資料庫；正式環境帶 Supabase 連線字串執行）

// `sslmode` in the connection string overrides any separate `ssl` option
// passed alongside it (see src/lib/db.ts), so the no-verify override has
// to be baked into the string itself for Supabase's pooler to connect.
function withNoVerifySsl(connectionString: string) {
  if (/localhost|127\.0\.0\.1/.test(connectionString)) return connectionString;
  const url = new URL(connectionString);
  url.searchParams.set('sslmode', 'no-verify');
  return url.toString();
}

const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || '';
const adapter = new PrismaPg({ connectionString: withNoVerifySsl(raw) });
const prisma = new PrismaClient({ adapter });

const DEFAULT_NOTICES = [
  '圍棋班：插班補課不限次數；每期課程可申請一次一對一補課。',
  '英文、數學等其他科目：僅提供插班補課，不限次數。',
  '若家長無法配合插班補課、且該期一對一補課已使用，該期請假未補課之費用將於下一期學費中扣除。',
  '補課申請若被行政人員拒絕，不會計入一對一額度，仍可再次申請。',
];

async function main() {
  const missing = await prisma.classEnrollment.findMany({
    where: { periods: { none: {} } },
    select: { id: true, totalSessions: true },
  });
  for (const e of missing) {
    await prisma.enrollmentPeriod.create({ data: { enrollmentId: e.id, sessions: e.totalSessions ?? 0 } });
  }
  console.log(`已為 ${missing.length} 筆報名補建期紀錄`);

  const noticeCount = await prisma.makeupNoticeItem.count();
  if (noticeCount === 0) {
    await prisma.makeupNoticeItem.createMany({
      data: DEFAULT_NOTICES.map((content, sortOrder) => ({ content, sortOrder })),
    });
    console.log(`已寫入 ${DEFAULT_NOTICES.length} 條預設補課須知`);
  } else {
    console.log(`補課須知已有 ${noticeCount} 筆資料，略過預設寫入`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: 本機驗證（dev DB）**

Run: `npx tsx prisma/backfill-periods-and-notices.ts`
Expected: 印出補建筆數與「已寫入 4 條預設補課須知」。再跑一次應印出 0 筆與「略過預設寫入」（冪等）。

- [ ] **Step 3: Commit**

```bash
git add prisma/backfill-periods-and-notices.ts
git commit -m "feat: add launch backfill script for periods and default notices"
```

---

### Task 11: 全套驗證

- [ ] **Step 1: 全部測試**

Run: `npm test`
Expected: 全數 PASS（含既有 15 個測試檔——beforeEach 清理順序未動，`EnrollmentPeriod` 由 cascade 處理）。

- [ ] **Step 2: Lint 與 build**

Run: `npm run lint && npm run build`
Expected: 無錯誤。

- [ ] **Step 3: 瀏覽器煙霧測試（dev server）**

以 preview 工具起 dev server，驗證：
1. 後台 `/admin/makeup-notices`：新增、編輯、排序、刪除各一次。
2. 學生首頁：須知卡片顯示 DB 內容；後台清空後卡片消失。
3. 學生申請補課頁：圍棋班請假顯示兩選項（一對一「本期剩餘 1 次」）；非圍棋班請假只顯示插班表單。
4. 學生管理頁：對某報名「＋一期」→ toast、總堂數欄位同步增加。
（深夜模式切換確認新頁面無跳色。）

- [ ] **Step 4: 收尾 commit（如有殘餘變更）**

```bash
git add -A && git commit -m "chore: makeup policy revamp follow-ups"
```
