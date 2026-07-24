# 全站動效提升（Motion Polish）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全站統一的動效回饋——點按縮放、非同步 loading 按鈕、Toast/Modal 進出場、表格骨架屏＋淡入、頁面切換淡入。

**Architecture:** 純 CSS 動畫（keyframes + utility class 定義在 `globals.css`），元件層只加 class 與少量 state（`loading`/`submitting`）。無新依賴。動效 token：點按 100ms、過渡 150–200ms、進場 200–300ms，簽名曲線 `cubic-bezier(0.22, 1, 0.36, 1)`。

**Tech Stack:** Next.js 14 App Router、Tailwind、既有 CSS 變數主題系統（深淺色）。

**Spec:** `docs/superpowers/specs/2026-07-24-motion-polish-design.md`

## Global Constraints

- 不引入任何動畫函式庫（純 CSS/Tailwind）。
- 只動 `transform` / `opacity` / `filter`，不動會觸發排版的屬性。
- 所有動畫必須被 `prefers-reduced-motion: reduce` 全域關閉（Task 1 的規則負責，後續 task 不需各自處理）。
- pending 狀態一律 `try/finally`，失敗時按鈕必須恢復。
- 骨架屏只在首次載入顯示（`loading` 初始 `true`、`load()` 的 `finally` 設 `false`、之後不再設回 `true`）。
- 驗證環境：`.claude/launch.json` 的「HJJ dev server」（`preview_start`，勿用 Bash 起 server）。深淺色都要看。
- Commit 訊息格式沿用現有慣例（`feat:`/`fix:` 前綴 + Co-Authored-By footer）。

---

### Task 1: globals.css 動效基礎（keyframes、點按回饋、reduced-motion）

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces（後續 task 使用的 class）：`.animate-rise-in`、`.animate-fade-in`、`.animate-modal-in`、`.animate-toast-in`、`.animate-toast-out`、`.skeleton-shimmer`

- [ ] **Step 1: 把現有 hover 亮度區塊改為 hover＋press 合併區塊**

找到 `globals.css` 中的這段（「Universal hover highlight」註解起到第一個 `}` 後的 hover 規則結束）：

```css
/* Universal hover highlight: every clickable element brightens slightly on
   hover — links, buttons, dropdowns, checkboxes, and anything opted into
   clickability via cursor-pointer (e.g. clickable table rows). Scoped to
   (hover: hover) so touch devices don't get sticky highlight states.
   Element-specific hover styles (bg swaps, underlines) still apply on top. */
@media (hover: hover) {
  a,
  button:not(:disabled),
  select,
  input[type='checkbox']:not(:disabled),
  .cursor-pointer {
    transition: filter 0.15s ease;
  }
  a:hover,
  button:not(:disabled):hover,
  select:hover,
  input[type='checkbox']:not(:disabled):hover,
  .cursor-pointer:hover {
    filter: brightness(1.12);
  }
}
```

整段替換為：

```css
/* Universal hover highlight + press feedback for every clickable element —
   links, buttons, dropdowns, checkboxes, and anything opted into
   clickability via cursor-pointer (e.g. clickable table rows).
   Hover brightness is scoped to (hover: hover) so touch devices don't get
   sticky highlight states; the :active press-scale applies everywhere
   (touch fires :active too). Transform-only, so no layout work happens. */
a,
button:not(:disabled),
select,
input[type='checkbox']:not(:disabled),
.cursor-pointer {
  transition: filter 0.15s ease, transform 0.1s ease;
}
@media (hover: hover) {
  a:hover,
  button:not(:disabled):hover,
  select:hover,
  input[type='checkbox']:not(:disabled):hover,
  .cursor-pointer:hover {
    filter: brightness(1.12);
  }
}
a:active,
button:not(:disabled):active,
select:active,
input[type='checkbox']:not(:disabled):active,
.cursor-pointer:active {
  transform: scale(0.97);
}
/* Table rows are large surfaces — a 3% dip looks like a glitch, keep it subtle. */
tr.cursor-pointer:active {
  transform: scale(0.995);
}
```

- [ ] **Step 2: 在 `@layer utilities` 區塊之前加入 keyframes 與動效 utility class**

```css
/* ── Motion tokens ─────────────────────────────────────────────
   Durations: press 100ms / transitions 150-200ms / entrances 200-300ms.
   Signature easing (borrowed from the nav pill): cubic-bezier(0.22, 1, 0.36, 1).
   Only transform/opacity/filter are animated, ever. */

@keyframes rise-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes modal-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
/* Toast keyframes own the full transform, including the -50% centering
   (the component must NOT also apply -translate-x-1/2). */
@keyframes toast-in {
  from { opacity: 0; transform: translate(-50%, 8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
@keyframes toast-out {
  from { opacity: 1; transform: translate(-50%, 0); }
  to { opacity: 0; transform: translate(-50%, 8px); }
}
@keyframes shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

.animate-rise-in {
  animation: rise-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.animate-fade-in {
  animation: fade-in 0.15s ease both;
}
.animate-modal-in {
  animation: modal-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.animate-toast-in {
  animation: toast-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.animate-toast-out {
  animation: toast-out 0.2s ease both;
}
/* Skeleton bars: theme-aware via the existing surface variables. */
.skeleton-shimmer {
  background: linear-gradient(90deg, var(--stripe) 25%, var(--border-subtle) 37%, var(--stripe) 63%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease infinite;
}
```

- [ ] **Step 3: 在檔案最末端加入 reduced-motion 全域關閉**

```css
/* Accessibility: kill all animation for users who asked for less motion.
   Loading spinners remain visible (they just stop rotating) — they're
   state indicators, not decoration. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: 驗證**

用 `preview_start`（HJJ dev server）打開任一頁：按住任何按鈕/連結應看到輕微縮小，放開恢復；表格可點列按住是更輕微的縮小。`npm run lint` 無新錯誤。

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: motion foundation — press feedback, entrance keyframes, shimmer, reduced-motion"
```

---

### Task 2: Button loading 狀態

**Files:**
- Modify: `src/components/ui/Button.tsx`

**Interfaces:**
- Produces: `<Button loading={boolean}>`——loading 時自動 `disabled`、顯示 CSS spinner、游標 `wait`。後續 Task 7–10 全部依賴此 prop。

- [ ] **Step 1: 整檔改寫 `src/components/ui/Button.tsx`**

```tsx
import { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}

export default function Button({
  variant = 'primary',
  loading = false,
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps) {
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
    <button className={`${base} ${cursor} ${styles} ${className}`} disabled={disabled || loading} {...props}>
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

注意：原本的 `rounded-lg px-4 py-2 ...` 前多了 `inline-flex items-center justify-center gap-2`，讓 spinner 與文字並排置中；`w-full` 之類外部 className 行為不變。

- [ ] **Step 2: 驗證**

暫時把任一頁的 `<Button type="submit">新增</Button>` 加上 `loading`（手動改成 `loading={true}` 看一眼再改回來），確認：spinner 轉動、按鈕半透明、點不動。深淺色都看（spinner 用 `border-current` 會自動跟文字色）。

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Button.tsx
git commit -m "feat: Button loading state with CSS spinner and double-submit guard"
```

---

### Task 3: Toast 進出場動畫

**Files:**
- Modify: `src/components/ui/Toast.tsx`

**Interfaces:**
- Consumes: Task 1 的 `.animate-toast-in` / `.animate-toast-out`
- Produces: `showToast(message)` 介面不變（呼叫端零改動）

- [ ] **Step 1: 整檔改寫 `src/components/ui/Toast.tsx`**

```tsx
'use client';

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react';

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VISIBLE_MS = 2500;
const EXIT_MS = 200; // must match .animate-toast-out's duration

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const removeTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((msg: string) => {
    clearTimeout(hideTimerRef.current);
    clearTimeout(removeTimerRef.current);
    setLeaving(false);
    setMessage(msg);
    hideTimerRef.current = setTimeout(() => {
      setLeaving(true);
      removeTimerRef.current = setTimeout(() => {
        setMessage(null);
        setLeaving(false);
      }, EXIT_MS);
    }, VISIBLE_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {message && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 rounded-lg bg-approvedBg px-4 py-2 text-sm font-medium text-approved shadow-md ${
            leaving ? 'animate-toast-out' : 'animate-toast-in'
          }`}
        >
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
```

關鍵：原本 class 裡的 `-translate-x-1/2` 已移除——水平置中改由 toast keyframes 的 `translate(-50%, …)` 負責（兩者同時存在會互相覆蓋）。

- [ ] **Step 2: 驗證**

dev server 上做任何會出 toast 的操作（例如登入成功）：應從下方浮起，2.5 秒後下沉淡出；期間再觸發一次 toast 會重置計時。

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Toast.tsx
git commit -m "feat: toast enter/exit animations"
```

---

### Task 4: Modal 進場動畫

**Files:**
- Modify: `src/components/ui/Modal.tsx`

**Interfaces:**
- Consumes: Task 1 的 `.animate-fade-in` / `.animate-modal-in`
- Produces: `<Modal>` props 不變

- [ ] **Step 1: 修改兩個 className**

`src/components/ui/Modal.tsx` 中：

外層背景（原 `className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"`）改為：

```tsx
<div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
```

內層面板（原 `` className={`max-h-[90vh] w-full ${maxWidthClassName} overflow-y-auto rounded-xl bg-card p-5 shadow-lg`} ``）改為：

```tsx
className={`animate-modal-in max-h-[90vh] w-full ${maxWidthClassName} overflow-y-auto rounded-xl bg-card p-5 shadow-lg`}
```

- [ ] **Step 2: 驗證**

dev server 開任一 Modal（例如 admin 老師名單點「編輯」）：遮罩淡入、面板從 96% 放大浮現；關閉是即時的（預期行為）。

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Modal.tsx
git commit -m "feat: modal entrance animation"
```

---

### Task 5: DataTable 骨架屏＋內容淡入、CollapsibleDataTable 透傳

**Files:**
- Modify: `src/components/ui/DataTable.tsx`
- Modify: `src/components/ui/CollapsibleDataTable.tsx`

**Interfaces:**
- Consumes: Task 1 的 `.skeleton-shimmer` / `.animate-fade-in`
- Produces: `DataTable` 與 `CollapsibleDataTable` 各新增選用 prop `loading?: boolean`。Task 8–10 依賴。

- [ ] **Step 1: DataTable 加 `loading` prop 與骨架 tbody**

`src/components/ui/DataTable.tsx`——interface 加一行：

```tsx
interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  onRowMouseLeave?: (row: T) => void;
  footer?: ReactNode;
  loading?: boolean;
}
```

函式簽名解構加入 `loading`，並把現有 `<tbody>…</tbody>` 整段改為條件式：

```tsx
export default function DataTable<T>({ columns, rows, keyField, onRowClick, rowClassName, onRowMouseLeave, footer, loading }: DataTableProps<T>) {
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
        {loading ? (
          <tbody aria-hidden>
            {Array.from({ length: 5 }).map((_, r) => (
              <tr key={r} className={`border-b border-borderSubtle ${r % 2 === 1 ? 'bg-stripe' : 'bg-card'}`}>
                {columns.map((_, c) => (
                  <td key={c} className="px-4 py-3">
                    <div className="skeleton-shimmer mx-auto h-4 w-3/4 rounded" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : (
          <tbody className="animate-fade-in">
            {rows.map((row, index) => {
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
        )}
      </table>
      {footer}
    </div>
  );
}
```

淡入 tbody 只在「骨架 → 資料」切換時重新 mount 播放一次；之後資料更新（新增/刪除後 `load()`）不會重播。

- [ ] **Step 2: CollapsibleDataTable 透傳**

`src/components/ui/CollapsibleDataTable.tsx`——interface 加 `loading?: boolean;`，解構加 `loading`，`<DataTable` 呼叫處加 `loading={loading}`。

- [ ] **Step 3: 驗證**

暫時在任一列表頁把 `<DataTable` 加上 `loading={true}` 看骨架屏（深淺色都看：佔位條顏色應融入主題），改回後表格正常且首次載入淡入。

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/DataTable.tsx src/components/ui/CollapsibleDataTable.tsx
git commit -m "feat: DataTable skeleton rows and content fade-in"
```

---

### Task 6: 頁面切換淡入（AppShell）＋登入頁進場

**Files:**
- Modify: `src/components/ui/AppShell.tsx:136`
- Modify: `src/app/login/page.tsx:42`

**Interfaces:**
- Consumes: Task 1 的 `.animate-rise-in`

- [ ] **Step 1: AppShell 主內容包一層 keyed div**

`src/components/ui/AppShell.tsx` 原：

```tsx
<main className="mx-auto max-w-5xl p-6">{children}</main>
```

改為：

```tsx
<main className="mx-auto max-w-5xl p-6">
  <div key={pathname ?? ''} className="animate-rise-in">
    {children}
  </div>
</main>
```

（`pathname` 已由既有的 `usePathname()` 取得。）

- [ ] **Step 2: 登入頁 Card 進場**

`src/app/login/page.tsx` 原：

```tsx
<Card className="w-full max-w-sm md:shadow-none">
```

改為：

```tsx
<Card className="animate-rise-in w-full max-w-sm md:shadow-none">
```

- [ ] **Step 3: 驗證**

dev server 在導覽列切換頁面：內容應柔和上浮淡入，導覽 pill 動畫不受影響；登入頁重新整理時卡片上浮進場。

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/AppShell.tsx src/app/login/page.tsx
git commit -m "feat: page transition rise-in via AppShell, login card entrance"
```

---

### Task 7: 登入頁 loading 狀態

**Files:**
- Modify: `src/app/login/page.tsx:20-30,49-51`

**Interfaces:**
- Consumes: Task 2 的 `<Button loading>`

- [ ] **Step 1: 加 submitting state 並接上按鈕**

`src/app/login/page.tsx`——在 `const [error, setError] = useState('');` 之後加：

```tsx
const [submitting, setSubmitting] = useState(false);
```

`handleSubmit` 整個函式改為：

```tsx
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setError('');
  setSubmitting(true);
  try {
    const result = await signIn('credentials', { email, password, redirect: false });
    if (result?.error) {
      setError('帳號或密碼錯誤');
      return;
    }
    showToast('登入成功');
    router.push('/');
  } finally {
    setSubmitting(false);
  }
}
```

按鈕（原 `<Button type="submit" className="w-full">`）改為：

```tsx
<Button type="submit" className="w-full" loading={submitting}>
  登入
</Button>
```

- [ ] **Step 2: 驗證**

dev server 登入（帳密 `admin@example.com` / `password123`）：按下後按鈕出現 spinner 且不可再點；輸入錯誤密碼時按鈕會恢復並顯示錯誤訊息。

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat: login pending state on submit button"
```

---

### Task 8: Admin 頁面接上 loading 骨架與 submitting

**Files:**
- Modify: `src/app/admin/teachers/page.tsx`
- Modify: `src/app/admin/students/page.tsx`
- Modify: `src/app/admin/classes/page.tsx`
- Modify: `src/app/admin/activities/page.tsx`
- Modify: `src/app/admin/go-hall/page.tsx`
- Modify: `src/app/admin/makeup-requests/page.tsx`
- Modify: `src/app/admin/substitute-requests/page.tsx`

**Interfaces:**
- Consumes: Task 2 `<Button loading>`、Task 5 `loading` prop

每個檔案套用同一組機械性修改，以下逐檔列出確切位置與內容。

**共用 pattern A——首次載入骨架**（每檔一次）：

1. 在該頁第一個 `useState` 宣告區塊末尾加：
   ```tsx
   const [loading, setLoading] = useState(true);
   ```
2. `async function load()` 的函式體包 `try/finally`，`finally` 裡 `setLoading(false)`。例（admin/teachers）：
   ```tsx
   async function load() {
     try {
       const res = await fetch('/api/teachers');
       setTeachers(await res.json());
     } finally {
       setLoading(false);
     }
   }
   ```
   （各檔 `load()` 原本內容不同——只包 `try/finally`，原內容原樣放進 `try`。）
3. 該檔每個 `<DataTable` / `<CollapsibleDataTable` 元素加 `loading={loading}`。

**共用 pattern B——表單送出 pending**（每個列出的 handler 一次）：

1. 加 state：`const [submitting, setSubmitting] = useState(false);`
2. handler 開頭 `setSubmitting(true);`，原有內容包 `try { … } finally { setSubmitting(false); }`（`e.preventDefault()` 留在 try 外）。
3. 對應的 `<Button type="submit">` 加 `loading={submitting}`。

**共用 pattern C——列級按鈕 pending**（per-row 操作）：

1. 加 state：`const [pendingId, setPendingId] = useState<string | null>(null);`
2. handler 開頭 `setPendingId(id);`，包 `try/finally`，`finally` 裡 `setPendingId(null);`（`id` 用該 handler 既有的參數：`r.id` / `registrationId` 等）。
3. 該列的 `<Button>` 加 `loading={pendingId === r.id}`（以 render 當下那列的 id 比對）。

- [ ] **Step 1: `admin/teachers/page.tsx`**
  - Pattern A（`load()` 在 :29；表格 2 處）
  - Pattern B ×2：`handleSubmit`（:38，「新增」按鈕 :148）與 `handleEditSubmit`（:59，「儲存」按鈕 :181）。兩個 handler 共用同一個 `submitting` state 即可（同時只會有一個表單在送出）。

- [ ] **Step 2: `admin/students/page.tsx`**
  - Pattern A（`load()` :38；表格 2 處）
  - Pattern B ×2：`handleSubmit`（:48，「新增」:182）、`handleEditSubmit`（:82，「儲存」:226），共用 `submitting`。

- [ ] **Step 3: `admin/classes/page.tsx`**
  - Pattern A（`load()` :50；表格 2 處）
  - Pattern B ×2：`handleSubmit`（:60，「新增」:207）、`handleEditSubmit`（:86，「儲存」:239），共用 `submitting`。

- [ ] **Step 4: `admin/activities/page.tsx`**
  - Pattern A（`load()` :70；表格 2 處——`DataTable` 用於活動列表）
  - Pattern B ×2：`handleSubmit`（新增活動，「新增」按鈕）與 `handleAddCategory`（「新增分類」按鈕）。**這兩個要用獨立的 state**（`submitting` 與 `categorySubmitting`），因為兩個表單同時顯示在頁面上，共用會讓另一個表單的按鈕也轉圈。

- [ ] **Step 5: `admin/go-hall/page.tsx`**
  - Pattern A（`load()` :63；表格 3 處）
  - Pattern B ×1：`handleConfirmCreate`（:99，「確認新增」按鈕 :246 `<Button type="button" onClick={handleConfirmCreate}>`）。「預覽日期」（:232）是本地計算不打 API，不加。

- [ ] **Step 6: `admin/makeup-requests/page.tsx`**
  - Pattern A（`load()` :30；表格 2 處）
  - Pattern C：`decide(r.id, 'APPROVED' | 'REJECTED')`（核准/拒絕按鈕 :66/:69）。兩顆按鈕都用 `loading={pendingId === r.id}`——同列兩顆一起轉是可接受的（同列互斥操作）。

- [ ] **Step 7: `admin/substitute-requests/page.tsx`**
  - Pattern A（`load()` :31；表格 2 處）
  - Pattern C：`assign(r.id)`（「指派」按鈕 :67）。

- [ ] **Step 8: 驗證**

dev server 以 admin 登入逐頁打開上述 7 頁：首次進頁看到骨架屏（DevTools Network 設 Slow 3G 較明顯）→ 內容淡入；新增/儲存/核准/指派期間按鈕轉圈且不可連點；失敗（例如新增重複帳號）後按鈕恢復。

- [ ] **Step 9: Commit**

```bash
git add src/app/admin
git commit -m "feat: admin pages — first-load skeleton and submit pending states"
```

---

### Task 9: Student 頁面接上 loading 骨架與 submitting

**Files:**
- Modify: `src/app/student/leave-request/page.tsx`
- Modify: `src/app/student/makeup-request/page.tsx`
- Modify: `src/app/student/go-hall/page.tsx`
- Modify: `src/app/student/activities/page.tsx`

**Interfaces:**
- Consumes: Task 2 `<Button loading>`、Task 5 `loading` prop

**共用 pattern A——首次載入骨架**（每檔一次）：
1. 在該頁第一個 `useState` 宣告區塊末尾加 `const [loading, setLoading] = useState(true);`
2. `async function load()` 的函式體包 `try/finally`，`finally` 裡 `setLoading(false)`（原內容原樣放進 `try`）。
3. 該檔每個 `<DataTable` / `<CollapsibleDataTable` 元素加 `loading={loading}`。

**共用 pattern B——表單送出 pending**（每個列出的 handler 一次）：
1. 加 state：`const [submitting, setSubmitting] = useState(false);`
2. handler 開頭 `setSubmitting(true);`，原有內容包 `try { … } finally { setSubmitting(false); }`（`e.preventDefault()` 留在 try 外）。
3. 對應的 `<Button type="submit">` 加 `loading={submitting}`。

**共用 pattern C——列級按鈕 pending**（per-row 操作）：
1. 加 state：`const [pendingId, setPendingId] = useState<string | null>(null);`
2. handler 開頭 `setPendingId(id);`，包 `try/finally`，`finally` 裡 `setPendingId(null);`。
3. 該列的 `<Button>` 加 `loading={pendingId === 該列id}`。

- [ ] **Step 1: `student/leave-request/page.tsx`**
  - Pattern A（`load()` :34；表格 2 處）
  - Pattern B ×1：`handleSubmit`（:44，「送出請假」:93）。

- [ ] **Step 2: `student/makeup-request/page.tsx`**（無表格，只有表單）
  - Pattern B ×2：`submitInsertion`（「送出插班申請」:209）與 `submitOneOnOne`（「送出一對一申請」:258）。共用 `submitting` 即可（同時只顯示一種表單）。

- [ ] **Step 3: `student/go-hall/page.tsx`**
  - Pattern A（`load()` :46；表格 3 處）
  - Pattern C：`handleRegister(sessionId)`（「報名」按鈕 :99，`loading={pendingId === s.id}`）。取消（:113）是文字連結 `<button>`，不加 spinner。

- [ ] **Step 4: `student/activities/page.tsx`**
  - Pattern A（`load()` :45；表格 3 處）
  - Pattern C：`handleRegister(activityId)`（報名 `<Button>`，`loading={pendingId === a.id}`；取消文字連結不加）。

- [ ] **Step 5: 驗證**

dev server 以 `student@example.com` / `password123` 登入走過 4 頁：骨架屏→淡入；送出請假/補課申請、弈廳與活動報名期間按鈕轉圈防連點。

- [ ] **Step 6: Commit**

```bash
git add src/app/student
git commit -m "feat: student pages — first-load skeleton and submit pending states"
```

---

### Task 10: Teacher 頁面接上 loading 骨架與 submitting

**Files:**
- Modify: `src/app/teacher/leave-request/page.tsx`
- Modify: `src/app/teacher/availability/page.tsx`
- Modify: `src/app/teacher/go-hall/page.tsx`
- Modify: `src/app/teacher/activities/page.tsx`

**Interfaces:**
- Consumes: Task 2 `<Button loading>`、Task 5 `loading` prop

**共用 pattern A——首次載入骨架**（每檔一次）：
1. 在該頁第一個 `useState` 宣告區塊末尾加 `const [loading, setLoading] = useState(true);`
2. `async function load()` 的函式體包 `try/finally`，`finally` 裡 `setLoading(false)`（原內容原樣放進 `try`）。
3. 該檔每個 `<DataTable` / `<CollapsibleDataTable` 元素加 `loading={loading}`。

**共用 pattern B——表單送出 pending**（每個列出的 handler 一次）：
1. 加 state：`const [submitting, setSubmitting] = useState(false);`
2. handler 開頭 `setSubmitting(true);`，原有內容包 `try { … } finally { setSubmitting(false); }`（`e.preventDefault()` 留在 try 外；非 form 的 onClick handler 沒有 event 就直接包）。
3. 對應的 `<Button>` 加 `loading={submitting}`。

- [ ] **Step 1: `teacher/leave-request/page.tsx`**（無表格）
  - Pattern B ×1：`handleSubmit`（:23，「送出」:45）。

- [ ] **Step 2: `teacher/availability/page.tsx`**（無表格）
  - Pattern B ×1：`save`（「儲存」按鈕 :75 `<Button onClick={save}>`——不是 form submit，直接在 `save` 函式套 pattern B 的 try/finally，按鈕加 `loading={submitting}`）。

- [ ] **Step 3: `teacher/go-hall/page.tsx`**（唯讀）
  - Pattern A（`load()` :36；表格 2 處）。

- [ ] **Step 4: `teacher/activities/page.tsx`**（唯讀）
  - Pattern A（`load()` 在 useEffect :33 內呼叫；表格 2 處）。若該檔沒有獨立的 `load()` 函式而是 useEffect 內聯 fetch，就在該 useEffect 的 fetch 鏈末端 `finally` 設 `setLoading(false)`。

- [ ] **Step 5: 驗證**

dev server 以 `teacher@example.com` / `password123` 登入走過 4 頁，驗證同前。

- [ ] **Step 6: Commit**

```bash
git add src/app/teacher
git commit -m "feat: teacher pages — first-load skeleton and submit pending states"
```

---

### Task 11: 全站驗證矩陣＋收尾

**Files:** 無新改動（除非驗證發現問題）

- [ ] **Step 1: Build 檢查**

```bash
npm run lint && npm run build
```
Expected: 無 error（warning 維持既有基準）。

- [ ] **Step 2: 瀏覽器驗證矩陣**（dev server）

1. 淺色＋深色主題各走一遍：登入 → 首頁 → 各列表頁。確認骨架屏顏色、spinner 顏色兩主題都協調。
2. DevTools Network Slow 3G：骨架屏出現→淡入；按鈕 loading 明顯可見；連點無效。
3. DevTools Rendering → Emulate `prefers-reduced-motion: reduce`：所有進場動畫、shimmer、press scale 都消失，功能正常。
4. 手機寬度（375px）抽查兩頁：動效不造成水平捲動或跑版。

- [ ] **Step 3: Safari 驗證（必做——使用者以 Safari 為主）**

本機 Safari 開 dev server URL：press scale、spinner、shimmer、Toast/Modal 動畫、date input 不受影響。

- [ ] **Step 4: 最終 commit 與推送確認**

若驗證有修正則逐項 commit；確認 working tree 乾淨後回報，等待使用者確認再 push。
