# UI/UX 改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle all 13 existing pages of the tutoring-center makeup-class system with a warm amber/cream visual language (referencing HJJ GO's design), introduce a shared component library, and add a persistent role-aware navigation shell — with zero changes to business logic, API routes, or Prisma queries.

**Architecture:** New shared UI primitives live in `src/components/ui/` (Button, Input, Select, Card, StatusBadge, DataTable, AppShell). Every existing page is edited in place to import and use these primitives instead of ad-hoc Tailwind classes, and wrapped in `<AppShell role="...">` for consistent navigation. No page's data-fetching, state management, or event handlers change — only the returned JSX.

**Tech Stack:** Next.js 14 (App Router) + TypeScript + Tailwind CSS (existing stack, no new dependencies).

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-07-15-ui-ux-redesign-design.md`
- Design tokens: primary `#FFBD5A` (brand), background `#FFF1DE` (cream), text `#3a332b` (ink) / `#8a7f70` (ink-muted), status colors — pending `#F2994A`/`#FFF3E0`, approved `#1E7A46`/`#E8F8EE`, rejected `#C0392B`/`#FDECEC`, assigned `#2C5FBB`/`#EAF2FF`.
- Border radius: cards 10–12px (`rounded-xl`), buttons/inputs 6–8px (`rounded-lg`).
- No dark mode, no i18n, no hamburger/drawer nav, no new test framework, no change to any API route, Prisma query, or business logic.
- Every page's Chinese copy (labels, button text, messages) stays byte-for-byte identical — only the JSX structure and CSS classes change.
- Existing 36 Vitest tests (service layer) must stay green throughout; `npx tsc --noEmit` and `npx next build` must stay clean after every task.

---

## File Structure Overview

```
tailwind.config.ts                          # extended with design tokens
src/app/globals.css                         # dark-mode media query removed, Noto Sans TC added
src/components/ui/
  Button.tsx
  Input.tsx
  Select.tsx
  Card.tsx
  StatusBadge.tsx
  StatusBadge.test.ts
  DataTable.tsx
  AppShell.tsx
src/app/login/page.tsx                      # redesigned (split-screen desktop / centered card mobile)
src/app/admin/page.tsx                      # AppShell + Card stat tiles
src/app/admin/teachers/page.tsx             # AppShell + DataTable + Card + form primitives
src/app/admin/students/page.tsx             # same pattern
src/app/admin/classes/page.tsx              # same pattern + Select
src/app/admin/makeup-requests/page.tsx      # AppShell + DataTable + StatusBadge
src/app/admin/substitute-requests/page.tsx  # AppShell + DataTable + StatusBadge
src/app/teacher/page.tsx                    # AppShell + Card link tiles
src/app/teacher/availability/page.tsx       # AppShell + Card + form primitives
src/app/teacher/leave-request/page.tsx      # AppShell + Card + form primitives
src/app/student/page.tsx                    # AppShell + Card link tiles
src/app/student/leave-request/page.tsx      # AppShell + DataTable + StatusBadge
src/app/student/makeup-request/page.tsx     # AppShell + form primitives
```

---

### Task 1: Design tokens (Tailwind config + globals.css fix)

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: Tailwind color utilities `bg-brand`, `bg-brandDark`, `bg-cream`, `text-ink`, `text-inkMuted`, `bg-pendingBg`/`text-pending`, `bg-approvedBg`/`text-approved`, `bg-rejectedBg`/`text-rejected`, `bg-assignedBg`/`text-assigned` — every later task's components and pages use these class names verbatim.

- [ ] **Step 1: Extend Tailwind config with design tokens**

`tailwind.config.ts` (full replacement):
```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: "#FFBD5A",
        brandDark: "#E8A94A",
        cream: "#FFF1DE",
        ink: "#3a332b",
        inkMuted: "#8a7f70",
        pending: "#F2994A",
        pendingBg: "#FFF3E0",
        approved: "#1E7A46",
        approvedBg: "#E8F8EE",
        rejected: "#C0392B",
        rejectedBg: "#FDECEC",
        assigned: "#2C5FBB",
        assignedBg: "#EAF2FF",
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 2: Remove dark-mode override and set the light theme as the only theme**

The current `globals.css` has a `@media (prefers-color-scheme: dark)` block that flips `--background`/`--foreground` to near-black whenever the visitor's OS is in dark mode — this is why every page has looked black-on-white throughout this project's development, not by design. The spec says no dark mode, so remove that block entirely.

`src/app/globals.css` (full replacement):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #ffffff;
  --foreground: #3a332b;
}

body {
  color: var(--foreground);
  background: var(--background);
  font-family: "Noto Sans TC", Arial, Helvetica, sans-serif;
}

@layer utilities {
  .text-balance {
    text-wrap: balance;
  }
}
```

- [ ] **Step 3: Verify the build picks up the new tokens**

Run: `npx tsc --noEmit`
Expected: clean, no errors (config files are type-checked as part of the project).

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts src/app/globals.css
git commit -m "feat(ui): add warm design tokens, remove unintended dark-mode override"
```

---

### Task 2: Form primitives — Button, Input, Select

**Files:**
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Input.tsx`
- Create: `src/components/ui/Select.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1 (`bg-brand`, `bg-brandDark`, `text-ink`).
- Produces: `Button` (props: standard `ButtonHTMLAttributes` + optional `variant?: 'primary' | 'secondary'`, default `'primary'`), `Input` (standard `InputHTMLAttributes`, no extra props), `Select` (standard `SelectHTMLAttributes`, no extra props) — every later page task imports these three by default export.

- [ ] **Step 1: Button**

`src/components/ui/Button.tsx`:
```tsx
import { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

export default function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? 'bg-brand text-ink hover:bg-brandDark'
      : 'border border-gray-300 bg-white text-ink hover:bg-gray-50';
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}
```

- [ ] **Step 2: Input**

`src/components/ui/Input.tsx`:
```tsx
import { InputHTMLAttributes } from 'react';

export default function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-lg border border-gray-300 px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 3: Select**

`src/components/ui/Select.tsx`:
```tsx
import { SelectHTMLAttributes } from 'react';

export default function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`rounded-lg border border-gray-300 px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ${className}`}
      {...props}
    />
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Button.tsx src/components/ui/Input.tsx src/components/ui/Select.tsx
git commit -m "feat(ui): add Button, Input, Select primitives"
```

---

### Task 3: Card

**Files:**
- Create: `src/components/ui/Card.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1.
- Produces: `Card` (standard `HTMLAttributes<HTMLDivElement>`, no extra props) — default export, used as a white rounded container by every page task.

- [ ] **Step 1: Card**

`src/components/ui/Card.tsx`:
```tsx
import { HTMLAttributes } from 'react';

export default function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl bg-white p-5 shadow-sm ${className}`} {...props} />;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Card.tsx
git commit -m "feat(ui): add Card primitive"
```

---

### Task 4: StatusBadge (TDD)

**Files:**
- Create: `src/components/ui/StatusBadge.tsx`
- Test: `src/components/ui/StatusBadge.test.ts`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1.
- Produces: `getStatusBadgeConfig(status: string): { label: string; bg: string; text: string }` (named export) and `StatusBadge` (default export, props `{ status: string }`) — consumed by Tasks 12 and 14 (admin review queues) and Task 15 (student leave-request table).

- [ ] **Step 1: Write the failing test**

`src/components/ui/StatusBadge.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { getStatusBadgeConfig } from './StatusBadge';

describe('getStatusBadgeConfig', () => {
  it('maps APPROVED to 已核准', () => {
    expect(getStatusBadgeConfig('APPROVED').label).toBe('已核准');
  });
  it('maps PENDING_ADMIN to 待確認', () => {
    expect(getStatusBadgeConfig('PENDING_ADMIN').label).toBe('待確認');
  });
  it('maps PENDING_ASSIGNMENT to 待確認', () => {
    expect(getStatusBadgeConfig('PENDING_ASSIGNMENT').label).toBe('待確認');
  });
  it('maps REJECTED to 已拒絕', () => {
    expect(getStatusBadgeConfig('REJECTED').label).toBe('已拒絕');
  });
  it('maps ASSIGNED to 已指派', () => {
    expect(getStatusBadgeConfig('ASSIGNED').label).toBe('已指派');
  });
  it('falls back to the raw value for an unknown status', () => {
    expect(getStatusBadgeConfig('WEIRD').label).toBe('WEIRD');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/StatusBadge.test.ts`
Expected: FAIL — `Cannot find module './StatusBadge'`

- [ ] **Step 3: Implement**

`src/components/ui/StatusBadge.tsx`:
```tsx
export type KnownStatus = 'APPROVED' | 'PENDING_ADMIN' | 'PENDING_ASSIGNMENT' | 'REJECTED' | 'ASSIGNED';

interface StatusConfig {
  label: string;
  bg: string;
  text: string;
}

const STATUS_CONFIG: Record<KnownStatus, StatusConfig> = {
  APPROVED: { label: '已核准', bg: 'bg-approvedBg', text: 'text-approved' },
  PENDING_ADMIN: { label: '待確認', bg: 'bg-pendingBg', text: 'text-pending' },
  PENDING_ASSIGNMENT: { label: '待確認', bg: 'bg-pendingBg', text: 'text-pending' },
  REJECTED: { label: '已拒絕', bg: 'bg-rejectedBg', text: 'text-rejected' },
  ASSIGNED: { label: '已指派', bg: 'bg-assignedBg', text: 'text-assigned' },
};

export function getStatusBadgeConfig(status: string): StatusConfig {
  return STATUS_CONFIG[status as KnownStatus] ?? { label: status, bg: 'bg-gray-100', text: 'text-gray-600' };
}

export default function StatusBadge({ status }: { status: string }) {
  const { label, bg, text } = getStatusBadgeConfig(status);
  return <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${bg} ${text}`}>{label}</span>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/StatusBadge.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Run full suite to confirm no regression**

Run: `npm test`
Expected: 9 test files (8 pre-existing + this one), 42 tests passing (36 pre-existing + 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/StatusBadge.tsx src/components/ui/StatusBadge.test.ts
git commit -m "feat(ui): add StatusBadge with tested status-to-label mapping"
```

---

### Task 5: DataTable

**Files:**
- Create: `src/components/ui/DataTable.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1.
- Produces: `DataTable<T>` (default export, generic, props `{ columns: Column<T>[]; rows: T[]; keyField: (row: T) => string }`) and `Column<T>` (named export type, `{ header: string; render: (row: T) => React.ReactNode }`) — consumed by every list-page task (8, 9, 10, 13).

- [ ] **Step 1: DataTable**

`src/components/ui/DataTable.tsx`:
```tsx
import { ReactNode } from 'react';

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
}

export default function DataTable<T>({ columns, rows, keyField }: DataTableProps<T>) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-inkMuted">
          {columns.map((col, i) => (
            <th key={i} className="py-2 pr-4 font-medium">
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={keyField(row)} className="border-b border-gray-100">
            {columns.map((col, i) => (
              <td key={i} className="py-3 pr-4 text-ink">
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/DataTable.tsx
git commit -m "feat(ui): add generic DataTable component"
```

---

### Task 6: AppShell (navigation)

**Files:**
- Create: `src/components/ui/AppShell.tsx`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1, `signOut` from `next-auth/react`.
- Produces: `AppShell` (default export, props `{ role: 'ADMIN' | 'TEACHER' | 'STUDENT'; children: React.ReactNode }`) — wraps every page from Task 7 onward. Can be imported and rendered from both server components (e.g. `src/app/admin/page.tsx`) and client components, since Next.js allows a server component to render an imported client component directly.

- [ ] **Step 1: AppShell**

`src/components/ui/AppShell.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { ReactNode } from 'react';

type Role = 'ADMIN' | 'TEACHER' | 'STUDENT';

const NAV_LINKS: Record<Role, { href: string; label: string }[]> = {
  ADMIN: [
    { href: '/admin/teachers', label: '老師名單' },
    { href: '/admin/students', label: '學生名單' },
    { href: '/admin/classes', label: '班級名單' },
    { href: '/admin/makeup-requests', label: '補課申請' },
    { href: '/admin/substitute-requests', label: '代課安排' },
  ],
  TEACHER: [
    { href: '/teacher/leave-request', label: '請假/調課申請' },
    { href: '/teacher/availability', label: '設定可補課時段' },
  ],
  STUDENT: [
    { href: '/student/leave-request', label: '請假申請' },
    { href: '/student/makeup-request', label: '補課申請' },
  ],
};

const HOME_HREF: Record<Role, string> = {
  ADMIN: '/admin',
  TEACHER: '/teacher',
  STUDENT: '/student',
};

export default function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-cream/40">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-white px-6 py-3">
        <Link href={HOME_HREF[role]} className="flex items-center gap-2 font-bold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-base">😊</span>
          補習班補課系統
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm text-ink">
          {NAV_LINKS[role].map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-brandDark">
              {link.label}
            </Link>
          ))}
          <button onClick={() => signOut()} className="text-inkMuted hover:text-ink">
            登出
          </button>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/AppShell.tsx
git commit -m "feat(ui): add AppShell navigation shell"
```

---

### Task 7: Login page redesign

**Files:**
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `Button`, `Input`, `Card` from Tasks 2–3.

- [ ] **Step 1: Replace the page**

`src/app/login/page.tsx` (full replacement):
```tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = await signIn('credentials', { email, password, redirect: false });
    if (result?.error) {
      setError('帳號或密碼錯誤');
      return;
    }
    router.push('/');
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="hidden flex-1 flex-col items-center justify-center gap-2 bg-cream p-10 text-center md:flex">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand text-2xl">😊</span>
        <h1 className="text-xl font-bold text-ink">補習班補課系統</h1>
        <p className="text-sm text-inkMuted">一站式請假／補課／調課平台</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-cream p-6 md:bg-white md:p-10">
        <Card className="w-full max-w-sm md:shadow-none">
          <h2 className="mb-4 text-lg font-bold text-ink md:hidden">補習班補課系統</h2>
          <h2 className="mb-4 hidden text-lg font-bold text-ink md:block">登入</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input type="password" placeholder="密碼" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error && <p className="text-sm text-rejected">{error}</p>}
            <Button type="submit" className="w-full">
              登入
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npx next build` (must succeed), then `npm run dev`. Open `http://localhost:3000/login` at desktop width (≥768px) — expect left cream brand panel + right white form. Resize/use a mobile viewport (e.g. 375px) — expect only a centered white card on a cream background, no split. Log in with `teacher@example.com` / `password123` and confirm it still redirects correctly.

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat(ui): redesign login page with warm split-screen/centered-card layout"
```

---

### Task 8: Admin dashboard redesign

**Files:**
- Modify: `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 6), `Card` (Task 3).

- [ ] **Step 1: Replace the page**

`src/app/admin/page.tsx` (full replacement):
```tsx
import { listPendingMakeupRequests } from '@/lib/services/makeupRequestService';
import { listPendingSubstituteRequests } from '@/lib/services/substituteRequestService';
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';

export default async function AdminDashboard() {
  const [pendingMakeups, pendingSubstitutes] = await Promise.all([
    listPendingMakeupRequests(),
    listPendingSubstituteRequests(),
  ]);

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">行政儀表板</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
    </AppShell>
  );
}
```

Note: the old bottom nav row (老師名單/學生名單/班級名單 links) is removed here — `AppShell`'s top nav already covers all five admin links, so keeping both would duplicate navigation.

- [ ] **Step 2: Manual verification**

Run: `npx next build`, then `npm run dev`. Log in as `admin@example.com` / `password123`, confirm `/admin` shows the two stat cards with correct counts and the top nav has all five admin links plus 登出.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(ui): redesign admin dashboard with AppShell and stat cards"
```

---

### Task 9: Admin teachers + students pages redesign

**Files:**
- Modify: `src/app/admin/teachers/page.tsx`
- Modify: `src/app/admin/students/page.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 6), `Card` (Task 3), `Button`/`Input` (Task 2), `DataTable`/`Column` (Task 5).

- [ ] **Step 1: Replace the teachers page**

`src/app/admin/teachers/page.tsx` (full replacement):
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';

interface TeacherRow {
  id: string;
  subjects: string;
  phone: string | null;
  user: { name: string; email: string };
}

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', subjects: '', phone: '' });

  async function load() {
    const res = await fetch('/api/teachers');
    setTeachers(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/teachers', { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', email: '', password: '', subjects: '', phone: '' });
    load();
  }

  const columns: Column<TeacherRow>[] = [
    { header: '姓名', render: (t) => t.user.name },
    { header: 'Email', render: (t) => t.user.email },
    { header: '科目', render: (t) => t.subjects },
    { header: '電話', render: (t) => t.phone ?? '-' },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">老師名單</h1>
      <Card className="mb-6">
        <DataTable columns={columns} rows={teachers} keyField={(t) => t.id} />
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 font-bold text-ink">新增老師</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Input
            placeholder="初始密碼"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Input placeholder="任教科目" value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} required />
          <Input placeholder="電話" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Button type="submit">新增</Button>
        </form>
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 2: Replace the students page**

`src/app/admin/students/page.tsx` (full replacement):
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import DataTable, { Column } from '@/components/ui/DataTable';

interface StudentRow {
  id: string;
  parentPhone: string | null;
  user: { name: string; email: string };
}

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', parentPhone: '' });

  async function load() {
    const res = await fetch('/api/students');
    setStudents(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/students', { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', email: '', password: '', parentPhone: '' });
    load();
  }

  const columns: Column<StudentRow>[] = [
    { header: '姓名', render: (s) => s.user.name },
    { header: 'Email', render: (s) => s.user.email },
    { header: '家長電話', render: (s) => s.parentPhone ?? '-' },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">學生名單</h1>
      <Card className="mb-6">
        <DataTable columns={columns} rows={students} keyField={(s) => s.id} />
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 font-bold text-ink">新增學生</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input placeholder="姓名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <Input
            placeholder="初始密碼"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Input placeholder="家長電話" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
          <Button type="submit">新增</Button>
        </form>
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `npx next build`, then `npm run dev`. As admin, visit `/admin/teachers` and `/admin/students` — confirm the tables render via the new styling, and that adding a teacher/student still works (submits, list refreshes).

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/teachers/page.tsx src/app/admin/students/page.tsx
git commit -m "feat(ui): redesign admin teachers and students pages"
```

---

### Task 10: Admin classes page redesign

**Files:**
- Modify: `src/app/admin/classes/page.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 6), `Card` (Task 3), `Button`/`Input`/`Select` (Task 2), `DataTable`/`Column` (Task 5).

- [ ] **Step 1: Replace the page**

`src/app/admin/classes/page.tsx` (full replacement):
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface ClassRow {
  id: string;
  name: string;
  subject: string;
  level: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
  enrollments: { id: string }[];
}

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [form, setForm] = useState({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });

  async function load() {
    const [classesRes, teachersRes] = await Promise.all([fetch('/api/classes'), fetch('/api/teachers')]);
    setClasses(await classesRes.json());
    setTeachers(await teachersRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/classes', {
      method: 'POST',
      body: JSON.stringify({ ...form, weekday: Number(form.weekday) }),
    });
    setForm({ name: '', subject: '', level: '', teacherId: '', weekday: '1', startTime: '19:00', endTime: '21:00' });
    load();
  }

  const columns: Column<ClassRow>[] = [
    { header: '班名', render: (c) => c.name },
    { header: '科目/等級', render: (c) => `${c.subject} / ${c.level}` },
    { header: '老師', render: (c) => c.teacher.user.name },
    { header: '時間', render: (c) => `週${WEEKDAYS[c.weekday]} ${c.startTime}-${c.endTime}` },
    { header: '人數', render: (c) => c.enrollments.length },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">班級名單</h1>
      <Card className="mb-6">
        <DataTable columns={columns} rows={classes} keyField={(c) => c.id} />
      </Card>

      <Card className="max-w-md">
        <h2 className="mb-3 font-bold text-ink">新增班級</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Input placeholder="班名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="科目" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
          <Input placeholder="等級" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} required />
          <Select value={form.teacherId} onChange={(e) => setForm({ ...form, teacherId: e.target.value })} required>
            <option value="">選擇老師</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.user.name}
              </option>
            ))}
          </Select>
          <Select value={form.weekday} onChange={(e) => setForm({ ...form, weekday: e.target.value })}>
            {WEEKDAYS.map((w, i) => (
              <option key={i} value={i}>
                週{w}
              </option>
            ))}
          </Select>
          <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          <Input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          <Button type="submit">新增</Button>
        </form>
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npx next build`, then `npm run dev`. As admin, visit `/admin/classes` — confirm the table and form render correctly and creating a class still works.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/classes/page.tsx
git commit -m "feat(ui): redesign admin classes page"
```

---

### Task 11: Admin makeup-requests + substitute-requests pages redesign

**Files:**
- Modify: `src/app/admin/makeup-requests/page.tsx`
- Modify: `src/app/admin/substitute-requests/page.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 6), `Card` (Task 3), `Button`/`Select` (Task 2), `DataTable`/`Column` (Task 5), `StatusBadge` (Task 4).

- [ ] **Step 1: Replace the makeup-requests page**

`src/app/admin/makeup-requests/page.tsx` (full replacement):
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';

interface PendingRow {
  id: string;
  type: 'INSERTION' | 'ONE_ON_ONE';
  leaveRequest: { student: { user: { name: string } }; class: { name: string } };
  targetClass: { name: string } | null;
  targetDate: string | null;
  teacher: { user: { name: string } } | null;
  slotDate: string | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
}

export default function AdminMakeupRequestsPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);

  async function load() {
    const res = await fetch('/api/makeup-requests/pending');
    setRows(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    await fetch(`/api/makeup-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
    load();
  }

  const columns: Column<PendingRow>[] = [
    { header: '學生', render: (r) => r.leaveRequest.student.user.name },
    { header: '原班級', render: (r) => r.leaveRequest.class.name },
    { header: '類型', render: (r) => (r.type === 'INSERTION' ? '插班' : '一對一') },
    {
      header: '目標',
      render: (r) =>
        r.type === 'INSERTION'
          ? `${r.targetClass?.name} @ ${r.targetDate ? new Date(r.targetDate).toLocaleDateString() : ''}`
          : `${r.teacher?.user.name} @ ${r.slotDate ? new Date(r.slotDate).toLocaleDateString() : ''} ${r.slotStartTime}-${r.slotEndTime}`,
    },
    { header: '狀態', render: () => <StatusBadge status="PENDING_ADMIN" /> },
    {
      header: '操作',
      render: (r) => (
        <div className="flex gap-2">
          <Button className="px-3 py-1 text-xs" onClick={() => decide(r.id, 'APPROVED')}>
            核准
          </Button>
          <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => decide(r.id, 'REJECTED')}>
            拒絕
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">待確認補課申請</h1>
      <Card>
        <DataTable columns={columns} rows={rows} keyField={(r) => r.id} />
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 2: Replace the substitute-requests page**

`src/app/admin/substitute-requests/page.tsx` (full replacement):
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';

interface TeacherOption {
  id: string;
  user: { name: string };
}

interface PendingRow {
  id: string;
  date: string;
  reason: string;
  class: { name: string };
  originalTeacher: { user: { name: string } };
}

export default function AdminSubstituteRequestsPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});

  async function load() {
    const [reqRes, teacherRes] = await Promise.all([fetch('/api/substitute-requests'), fetch('/api/teachers')]);
    setRows(await reqRes.json());
    setTeachers(await teacherRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function assign(id: string) {
    const substituteTeacherId = selected[id];
    if (!substituteTeacherId) return;
    await fetch(`/api/substitute-requests/${id}`, { method: 'PATCH', body: JSON.stringify({ substituteTeacherId }) });
    load();
  }

  const columns: Column<PendingRow>[] = [
    { header: '班級', render: (r) => r.class.name },
    { header: '原老師', render: (r) => r.originalTeacher.user.name },
    { header: '日期', render: (r) => new Date(r.date).toLocaleDateString() },
    { header: '原因', render: (r) => r.reason },
    { header: '狀態', render: () => <StatusBadge status="PENDING_ASSIGNMENT" /> },
    {
      header: '指派代課',
      render: (r) => (
        <div className="flex items-center gap-2">
          <Select onChange={(e) => setSelected({ ...selected, [r.id]: e.target.value })}>
            <option value="">選擇代課老師</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.user.name}
              </option>
            ))}
          </Select>
          <Button className="px-3 py-1 text-xs" onClick={() => assign(r.id)}>
            指派
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AppShell role="ADMIN">
      <h1 className="mb-4 text-xl font-bold text-ink">待安排代課</h1>
      <Card>
        <DataTable columns={columns} rows={rows} keyField={(r) => r.id} />
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `npx next build`, then `npm run dev`. As admin, visit `/admin/makeup-requests` and `/admin/substitute-requests` — confirm status badges render, and 核准/拒絕/指派 actions still work end-to-end (row disappears from the pending list after the action).

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/makeup-requests/page.tsx src/app/admin/substitute-requests/page.tsx
git commit -m "feat(ui): redesign admin review queues with StatusBadge"
```

---

### Task 12: Teacher dashboard + availability page redesign

**Files:**
- Modify: `src/app/teacher/page.tsx`
- Modify: `src/app/teacher/availability/page.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 6), `Card` (Task 3), `Button`/`Input`/`Select` (Task 2).

- [ ] **Step 1: Replace the teacher dashboard**

`src/app/teacher/page.tsx` (full replacement):
```tsx
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';

export default function TeacherDashboard() {
  return (
    <AppShell role="TEACHER">
      <h1 className="mb-4 text-xl font-bold text-ink">老師首頁</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/teacher/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假/調課申請</Card>
        </Link>
        <Link href="/teacher/availability">
          <Card className="text-ink transition-shadow hover:shadow-md">設定我的可補課時段</Card>
        </Link>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Replace the availability page**

`src/app/teacher/availability/page.tsx` (full replacement):
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface Window {
  weekday: number;
  startTime: string;
  endTime: string;
}

export default function AvailabilityPage() {
  const [windows, setWindows] = useState<Window[]>([]);

  async function load() {
    const res = await fetch('/api/availability');
    setWindows(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  function addWindow() {
    setWindows([...windows, { weekday: 1, startTime: '16:00', endTime: '18:00' }]);
  }

  function updateWindow(index: number, patch: Partial<Window>) {
    setWindows(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  }

  function removeWindow(index: number) {
    setWindows(windows.filter((_, i) => i !== index));
  }

  async function save() {
    await fetch('/api/availability', { method: 'PUT', body: JSON.stringify({ windows }) });
    load();
  }

  return (
    <AppShell role="TEACHER">
      <h1 className="mb-4 text-xl font-bold text-ink">我的每週可補課時段</h1>
      <Card className="max-w-lg">
        <div className="flex flex-col gap-2">
          {windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={w.weekday} onChange={(e) => updateWindow(i, { weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((label, idx) => (
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
          <Button onClick={save}>儲存</Button>
        </div>
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `npx next build`, then `npm run dev`. As teacher, visit `/teacher` and `/teacher/availability` — confirm the dashboard tiles link correctly and adding/removing/saving availability windows still works.

- [ ] **Step 4: Commit**

```bash
git add src/app/teacher/page.tsx src/app/teacher/availability/page.tsx
git commit -m "feat(ui): redesign teacher dashboard and availability page"
```

---

### Task 13: Teacher leave-request page redesign

**Files:**
- Modify: `src/app/teacher/leave-request/page.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 6), `Card` (Task 3), `Button`/`Input`/`Select` (Task 2).

- [ ] **Step 1: Replace the page**

`src/app/teacher/leave-request/page.tsx` (full replacement):
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';

interface ClassOption {
  id: string;
  name: string;
}

export default function TeacherLeaveRequestPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [form, setForm] = useState({ classId: '', date: '', reason: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/classes').then((r) => r.json()).then(setClasses);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/substitute-requests', { method: 'POST', body: JSON.stringify(form) });
    setMessage(res.ok ? '已送出，行政將安排代課老師' : '送出失敗');
    setForm({ classId: '', date: '', reason: '' });
  }

  return (
    <AppShell role="TEACHER">
      <h1 className="mb-4 text-xl font-bold text-ink">請假/調課申請（代課安排）</h1>
      <Card className="max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
            <option value="">選擇班級</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <Input placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          <Button type="submit">送出</Button>
        </form>
        {message && <p className="mt-4 text-sm text-ink">{message}</p>}
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npx next build`, then `npm run dev`. As teacher, visit `/teacher/leave-request` — confirm submitting still creates a substitute request (check `/admin/substitute-requests` as admin afterward).

- [ ] **Step 3: Commit**

```bash
git add src/app/teacher/leave-request/page.tsx
git commit -m "feat(ui): redesign teacher leave-request page"
```

---

### Task 14: Student dashboard + leave-request page redesign

**Files:**
- Modify: `src/app/student/page.tsx`
- Modify: `src/app/student/leave-request/page.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 6), `Card` (Task 3), `Button`/`Input`/`Select` (Task 2), `DataTable`/`Column` (Task 5), `StatusBadge` (Task 4).

- [ ] **Step 1: Replace the student dashboard**

`src/app/student/page.tsx` (full replacement):
```tsx
import Link from 'next/link';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';

export default function StudentDashboard() {
  return (
    <AppShell role="STUDENT">
      <h1 className="mb-4 text-xl font-bold text-ink">學生首頁</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/student/leave-request">
          <Card className="text-ink transition-shadow hover:shadow-md">請假申請與紀錄</Card>
        </Link>
        <Link href="/student/makeup-request">
          <Card className="text-ink transition-shadow hover:shadow-md">申請補課</Card>
        </Link>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 2: Replace the leave-request page**

`src/app/student/leave-request/page.tsx` (full replacement):
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import DataTable, { Column } from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';

interface ClassOption {
  id: string;
  name: string;
}

interface LeaveRow {
  id: string;
  date: string;
  reason: string;
  status: string;
  class: { name: string };
  makeupRequest: { type: string; status: string } | null;
}

export default function StudentLeaveRequestPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [form, setForm] = useState({ classId: '', date: '', reason: '' });

  async function load() {
    const [classesRes, leavesRes] = await Promise.all([fetch('/api/classes'), fetch('/api/leave-requests')]);
    setClasses(await classesRes.json());
    setLeaves(await leavesRes.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/leave-requests', { method: 'POST', body: JSON.stringify(form) });
    setForm({ classId: '', date: '', reason: '' });
    load();
  }

  const columns: Column<LeaveRow>[] = [
    { header: '班級', render: (l) => l.class.name },
    { header: '日期', render: (l) => new Date(l.date).toLocaleDateString() },
    { header: '原因', render: (l) => l.reason },
    { header: '狀態', render: (l) => <StatusBadge status={l.status} /> },
    {
      header: '補課狀態',
      render: (l) =>
        l.makeupRequest ? <StatusBadge status={l.makeupRequest.status} /> : <span className="text-inkMuted">尚未申請</span>,
    },
  ];

  return (
    <AppShell role="STUDENT">
      <h1 className="mb-4 text-xl font-bold text-ink">請假申請</h1>
      <Card className="mb-6 max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <Select value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
            <option value="">選擇班級</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          <Input placeholder="原因" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          <Button type="submit">送出請假</Button>
        </form>
      </Card>

      <h2 className="mb-2 font-bold text-ink">我的請假紀錄</h2>
      <Card>
        <DataTable columns={columns} rows={leaves} keyField={(l) => l.id} />
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 3: Manual verification**

Run: `npx next build`, then `npm run dev`. As student, visit `/student` and `/student/leave-request` — confirm dashboard tiles link correctly, the leave table shows StatusBadge pills instead of raw enum text, and submitting a leave request still works.

- [ ] **Step 4: Commit**

```bash
git add src/app/student/page.tsx src/app/student/leave-request/page.tsx
git commit -m "feat(ui): redesign student dashboard and leave-request page"
```

---

### Task 15: Student makeup-request page redesign

**Files:**
- Modify: `src/app/student/makeup-request/page.tsx`

**Interfaces:**
- Consumes: `AppShell` (Task 6), `Card` (Task 3), `Button`/`Input`/`Select` (Task 2).

- [ ] **Step 1: Replace the page**

`src/app/student/makeup-request/page.tsx` (full replacement):
```tsx
'use client';

import { useEffect, useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

interface LeaveRow {
  id: string;
  date: string;
  class: { name: string; subject: string; level: string };
  makeupRequest: { id: string } | null;
}

interface ClassOption {
  id: string;
  name: string;
  weekday: number;
  startTime: string;
  endTime: string;
  enrollments: { id: string }[];
}

interface TeacherOption {
  id: string;
  user: { name: string };
  subjects: string;
}

interface AvailabilityWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

export default function MakeupRequestPage() {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [selectedLeaveId, setSelectedLeaveId] = useState('');
  const [makeupType, setMakeupType] = useState<'INSERTION' | 'ONE_ON_ONE'>('INSERTION');
  const [eligibleClasses, setEligibleClasses] = useState<ClassOption[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [message, setMessage] = useState('');

  const [insertionForm, setInsertionForm] = useState({ targetClassId: '', targetDate: '' });
  const [oneOnOneForm, setOneOnOneForm] = useState({ teacherId: '', slotDate: '', slotStartTime: '16:00', slotEndTime: '17:00' });

  useEffect(() => {
    fetch('/api/leave-requests').then((r) => r.json()).then(setLeaves);
    fetch('/api/teachers').then((r) => r.json()).then(setTeachers);
  }, []);

  useEffect(() => {
    if (!selectedLeaveId) return;
    fetch(`/api/makeup-requests?leaveRequestId=${selectedLeaveId}`)
      .then((r) => r.json())
      .then((data) => setEligibleClasses(data.eligibleClasses));
  }, [selectedLeaveId]);

  useEffect(() => {
    if (!oneOnOneForm.teacherId) {
      setAvailability([]);
      return;
    }
    fetch(`/api/makeup-requests?teacherId=${oneOnOneForm.teacherId}`)
      .then((r) => r.json())
      .then((data) => setAvailability(data.availability));
  }, [oneOnOneForm.teacherId]);

  async function submitInsertion(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    const res = await fetch('/api/makeup-requests', {
      method: 'POST',
      body: JSON.stringify({ type: 'INSERTION', leaveRequestId: selectedLeaveId, ...insertionForm }),
    });
    const data = await res.json();
    setMessage(res.ok ? '已送出插班申請，待行政確認' : `錯誤：${data.error}`);
  }

  async function submitOneOnOne(e: React.FormEvent) {
    e.preventDefault();
    setMessage('');
    const res = await fetch('/api/makeup-requests', {
      method: 'POST',
      body: JSON.stringify({
        type: 'ONE_ON_ONE',
        leaveRequestId: selectedLeaveId,
        teacherId: oneOnOneForm.teacherId,
        slotDate: oneOnOneForm.slotDate,
        slotStartTime: oneOnOneForm.slotStartTime,
        slotEndTime: oneOnOneForm.slotEndTime,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessage('已送出一對一補課申請，待行政確認');
    } else if (data.error === 'QUOTA_EXCEEDED') {
      setMessage('本季一對一補課名額已使用');
    } else if (data.error === 'OUTSIDE_AVAILABILITY') {
      setMessage('該時段不在老師可補課時段內');
    } else if (data.error === 'SLOT_CONFLICT') {
      setMessage('該時段已被其他學生預約');
    } else {
      setMessage(`錯誤：${data.error}`);
    }
  }

  const leavesWithoutMakeup = leaves.filter((l) => !l.makeupRequest);

  return (
    <AppShell role="STUDENT">
      <h1 className="mb-4 text-xl font-bold text-ink">申請補課</h1>

      <Select className="mb-4" value={selectedLeaveId} onChange={(e) => setSelectedLeaveId(e.target.value)}>
        <option value="">選擇要補課的請假紀錄</option>
        {leavesWithoutMakeup.map((l) => (
          <option key={l.id} value={l.id}>
            {l.class.name} - {new Date(l.date).toLocaleDateString()}
          </option>
        ))}
      </Select>

      {selectedLeaveId && (
        <Card className="max-w-md">
          <div className="mb-4 flex gap-4 text-sm text-ink">
            <label className="flex items-center gap-1">
              <input type="radio" checked={makeupType === 'INSERTION'} onChange={() => setMakeupType('INSERTION')} /> 插班補課
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={makeupType === 'ONE_ON_ONE'} onChange={() => setMakeupType('ONE_ON_ONE')} /> 一對一補課
            </label>
          </div>

          {makeupType === 'INSERTION' && (
            <form onSubmit={submitInsertion} className="flex flex-col gap-2">
              <Select
                value={insertionForm.targetClassId}
                onChange={(e) => setInsertionForm({ ...insertionForm, targetClassId: e.target.value })}
                required
              >
                <option value="">選擇班級</option>
                {eligibleClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}（週{WEEKDAYS[c.weekday]} {c.startTime}-{c.endTime}，目前 {c.enrollments.length} 人）
                  </option>
                ))}
              </Select>
              <Input
                type="date"
                value={insertionForm.targetDate}
                onChange={(e) => setInsertionForm({ ...insertionForm, targetDate: e.target.value })}
                required
              />
              <Button type="submit">送出插班申請</Button>
            </form>
          )}

          {makeupType === 'ONE_ON_ONE' && (
            <form onSubmit={submitOneOnOne} className="flex flex-col gap-2">
              <Select
                value={oneOnOneForm.teacherId}
                onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, teacherId: e.target.value })}
                required
              >
                <option value="">選擇老師</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.user.name}（{t.subjects}）
                  </option>
                ))}
              </Select>
              {oneOnOneForm.teacherId && (
                <p className="text-sm text-inkMuted">
                  可補課時段：
                  {availability.length === 0
                    ? '尚未設定'
                    : availability.map((w, i) => (
                        <span key={i}>
                          週{WEEKDAYS[w.weekday]} {w.startTime}-{w.endTime}
                          {i < availability.length - 1 ? '、' : ''}
                        </span>
                      ))}
                </p>
              )}
              <Input
                type="date"
                value={oneOnOneForm.slotDate}
                onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotDate: e.target.value })}
                required
              />
              <div className="flex gap-2">
                <Input
                  type="time"
                  value={oneOnOneForm.slotStartTime}
                  onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotStartTime: e.target.value })}
                />
                <Input
                  type="time"
                  value={oneOnOneForm.slotEndTime}
                  onChange={(e) => setOneOnOneForm({ ...oneOnOneForm, slotEndTime: e.target.value })}
                />
              </div>
              <Button type="submit">送出一對一申請</Button>
            </form>
          )}
        </Card>
      )}

      {message && <p className="mt-4 text-sm text-ink">{message}</p>}
    </AppShell>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npx next build`, then `npm run dev`. As student, visit `/student/makeup-request` — confirm both the insertion and one-on-one forms still submit correctly and the availability hint text still displays.

- [ ] **Step 3: Commit**

```bash
git add src/app/student/makeup-request/page.tsx
git commit -m "feat(ui): redesign student makeup-request page"
```

---

### Task 16: Final build, full test suite, and manual smoke test across roles/breakpoints

**Files:** none (verification-only task)

**Interfaces:** none — this task only verifies Tasks 1–15 together.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: 9 test files, 42 tests passing (36 original + 6 `StatusBadge` tests from Task 4).

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: clean, no errors.

- [ ] **Step 3: Production build**

Run: `npx next build`
Expected: `✓ Compiled successfully`, no ESLint errors, all 26 routes present in the route table (same set as before this plan — this plan adds no new routes).

- [ ] **Step 4: Manual smoke test — desktop (≥768px)**

Run `npm run dev`, open a desktop-width browser window:
1. `/login` — confirm the left cream brand panel + right white form split layout.
2. Log in as `admin@example.com` / `password123` — confirm the top nav bar (brand name + 5 links + 登出) appears on `/admin`, and the two stat cards show correct counts.
3. Visit `/admin/teachers`, `/admin/students`, `/admin/classes` — confirm tables use the new styling, adding a row still works.
4. Visit `/admin/makeup-requests`, `/admin/substitute-requests` — confirm StatusBadge pills render, approve/reject/assign actions still work.
5. Log in as `teacher@example.com` / `password123` — confirm `/teacher` dashboard tiles, `/teacher/availability` add/remove/save, `/teacher/leave-request` submit.
6. Log in as `student@example.com` / `password123` — confirm `/student` dashboard tiles, `/student/leave-request` table with StatusBadge, `/student/makeup-request` both insertion and one-on-one flows.
7. Click 登出 from the nav bar on any page — confirm it signs out and redirects to `/login`.

- [ ] **Step 5: Manual smoke test — mobile (375px width)**

Resize the browser (or use a mobile viewport) to 375px wide:
1. `/login` — confirm only the centered white card shows, no split panel, no horizontal overflow.
2. Log in and check 2–3 representative pages (e.g. `/student`, `/student/makeup-request`) — confirm the `AppShell` nav wraps onto multiple lines instead of overflowing, and content stays within the viewport width with no horizontal scrollbar.

- [ ] **Step 6: Commit (if any fixes were needed during verification)**

If Steps 1–5 required any fixes, commit them now with an appropriately descriptive message. If everything passed as-is, this task requires no commit — it is a checkpoint, not a code change.
