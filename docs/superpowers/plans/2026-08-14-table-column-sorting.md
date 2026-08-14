# 表格欄位排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全站所有透過 `DataTable`/`CollapsibleDataTable` 渲染的表格，欄位標題都能點擊排序（升冪／降冪／清除），且排序狀態不持久化。

**Architecture:** 在共用元件 `DataTable`（提供受控/非受控排序＋表頭按鈕渲染）與 `CollapsibleDataTable`（在切片展開/收合之前先排序）中集中實作排序能力，排序比較邏輯抽成獨立、無元件依賴的 `dataTableSort.ts`。核心能力完成並試點驗證後，逐檔案幫既有 37 個表格的可排序欄位補上 `sortValue`。

**Tech Stack:** Next.js 14 App Router、React 18、TypeScript、Tailwind CSS 3、Vitest。

**Spec:** `docs/superpowers/specs/2026-08-14-table-column-sorting-design.md`

## Global Constraints

- 排序狀態不持久化：不寫 localStorage、不寫網址查詢參數、不送後端。狀態就是元件的 React state，換頁（元件卸載）自然歸零。
- 只支援單欄排序，不做多欄同時排序。
- 排序在前端對已經拿到的 `rows` 做（不做伺服器端／分頁感知排序）。
- 排序值為 `null`/`undefined` 一律排在最後，不分排序方向。
- 中文字串比較一律用 `new Intl.Collator('zh-Hant')`，不用預設 `<`/`>` 或 `localeCompare()`（沒指定 locale 會用瀏覽器預設 locale，不保證是中文排序）。
- 排序圖示與互動樣式全站統一，比照使用者在 brainstorming 階段用互動 demo 確認過的配色（不要另外調整）：**只有圖示**變色，欄位標題文字顏色永遠不變。圖示未排序時 opacity 0.35；hover 該按鈕時圖示變 opacity 1、顏色變 `#4A2E1D`（深咖啡）；該欄已排序時圖示同樣是 opacity 1、`#4A2E1D`（不論有沒有 hover，這個狀態要持續顯示，不能只在 hover 時才看得到）。按鈕背景疊色 `bg-[#4A2E1D]/10` **只在滑鼠實際 hover 時**出現，已排序但沒有 hover 時不疊背景色——這點刻意跟「已排序時圖示常駐變色」不同，照 demo 原樣（`.sd-th-btn:hover { background }` 是 hover-only，`.sd-sort-icon.active` 才是常駐）。
- 圖示手刻 inline SVG（沿用 `CollapsibleDataTable.tsx` 既有展開箭頭的做法），不安裝圖示套件（專案目前沒有任何圖示套件依賴）。
- 這個專案的測試慣例是：純邏輯／utils 用 Vitest 單元測試（例如 `dataTableRows.test.ts`），React 元件本身沒有元件測試（沒有 React Testing Library 之類的依賴），一律用瀏覽器手動驗證。這次不要新增元件測試慣例，維持現狀。
- 沒有給 `sortValue` 的欄位＝不可排序，`header` 原樣渲染，不能有任何視覺或行為改變（向下相容）。

---

## Task 1: 排序比較邏輯（`dataTableSort.ts`）

**Files:**
- Create: `src/components/ui/dataTableSort.ts`
- Test: `src/components/ui/dataTableSort.test.ts`

**Interfaces:**
- Produces：
  - `type SortDirection = 'asc' | 'desc'`
  - `interface SortState { columnIndex: number; direction: SortDirection }`
  - `interface SortableColumn<T> { sortValue?: (row: T) => string | number | Date | null | undefined }`
  - `function nextSortState(current: SortState | null, columnIndex: number): SortState | null`
  - `function sortRows<T>(rows: T[], columns: SortableColumn<T>[], sort: SortState | null): T[]`
- 這個檔案不依賴 `DataTable.tsx`（`SortableColumn<T>` 是獨立定義，`Column<T>` 之後會結構相容它），Task 2 才會反過來 import 這裡的東西。

- [ ] **Step 1: 寫失敗測試**

Create `src/components/ui/dataTableSort.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextSortState, sortRows } from './dataTableSort';

describe('nextSortState', () => {
  it('sets ascending when no current sort', () => {
    expect(nextSortState(null, 0)).toEqual({ columnIndex: 0, direction: 'asc' });
  });

  it('sets ascending when switching to a different column', () => {
    expect(nextSortState({ columnIndex: 0, direction: 'desc' }, 1)).toEqual({ columnIndex: 1, direction: 'asc' });
  });

  it('cycles the same column from ascending to descending', () => {
    expect(nextSortState({ columnIndex: 0, direction: 'asc' }, 0)).toEqual({ columnIndex: 0, direction: 'desc' });
  });

  it('clears the sort when cycling past descending on the same column', () => {
    expect(nextSortState({ columnIndex: 0, direction: 'desc' }, 0)).toBeNull();
  });
});

describe('sortRows', () => {
  interface Row {
    id: number;
    name: string;
    date: Date | null;
    count: number;
  }

  const rows: Row[] = [
    { id: 1, name: '王小明', date: new Date('2026-08-05'), count: 3 },
    { id: 2, name: '陳小華', date: new Date('2026-08-01'), count: 1 },
    { id: 3, name: '林小美', date: null, count: 2 },
  ];

  const columns = [
    { sortValue: (r: Row) => r.name },
    { sortValue: (r: Row) => r.date },
    { sortValue: (r: Row) => r.count },
    {},
  ];

  it('returns the same array reference when sort is null', () => {
    expect(sortRows(rows, columns, null)).toBe(rows);
  });

  it('returns rows unchanged when the target column has no sortValue', () => {
    expect(sortRows(rows, columns, { columnIndex: 3, direction: 'asc' })).toEqual(rows);
  });

  it('sorts strings using zh-Hant collation, ascending', () => {
    const result = sortRows(rows, columns, { columnIndex: 0, direction: 'asc' });
    expect(result.map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it('sorts strings descending', () => {
    const result = sortRows(rows, columns, { columnIndex: 0, direction: 'desc' });
    expect(result.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('sorts dates ascending and puts null last', () => {
    const result = sortRows(rows, columns, { columnIndex: 1, direction: 'asc' });
    expect(result.map((r) => r.id)).toEqual([2, 1, 3]);
  });

  it('sorts dates descending and still puts null last', () => {
    const result = sortRows(rows, columns, { columnIndex: 1, direction: 'desc' });
    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('sorts numbers descending', () => {
    const result = sortRows(rows, columns, { columnIndex: 2, direction: 'desc' });
    expect(result.map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it('does not mutate the input array', () => {
    const original = [...rows];
    sortRows(rows, columns, { columnIndex: 2, direction: 'asc' });
    expect(rows).toEqual(original);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/components/ui/dataTableSort.test.ts`
Expected: FAIL — `Cannot find module './dataTableSort'` (檔案還不存在)

- [ ] **Step 3: 實作**

Create `src/components/ui/dataTableSort.ts`:

```ts
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  columnIndex: number;
  direction: SortDirection;
}

export interface SortableColumn<T> {
  sortValue?: (row: T) => string | number | Date | null | undefined;
}

const collator = new Intl.Collator('zh-Hant');

export function nextSortState(current: SortState | null, columnIndex: number): SortState | null {
  if (!current || current.columnIndex !== columnIndex) return { columnIndex, direction: 'asc' };
  if (current.direction === 'asc') return { columnIndex, direction: 'desc' };
  return null;
}

export function sortRows<T>(rows: T[], columns: SortableColumn<T>[], sort: SortState | null): T[] {
  if (!sort) return rows;
  const sortValue = columns[sort.columnIndex]?.sortValue;
  if (!sortValue) return rows;

  return [...rows].sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;

    let cmp: number;
    if (av instanceof Date && bv instanceof Date) {
      cmp = av.getTime() - bv.getTime();
    } else if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv;
    } else {
      cmp = collator.compare(String(av), String(bv));
    }
    return sort.direction === 'asc' ? cmp : -cmp;
  });
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/components/ui/dataTableSort.test.ts`
Expected: PASS（10 個測試全過）

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/dataTableSort.ts src/components/ui/dataTableSort.test.ts
git commit -m "feat: add sortRows/nextSortState for table column sorting"
```

---

## Task 2: `DataTable` 支援排序（受控／非受控）＋表頭按鈕

**Files:**
- Modify: `src/components/ui/DataTable.tsx`

**Interfaces:**
- Consumes：Task 1 的 `SortState`、`nextSortState`、`sortRows`。
- Produces：
  - `Column<T>.sortValue?: (row: T) => string | number | Date | null | undefined`（新欄位）
  - `DataTableProps<T>.sort?: SortState | null`、`DataTableProps<T>.onSortChange?: (next: SortState | null) => void`（新 prop，Task 3 會用）
  - 判斷受控模式的規則：`onSortChange !== undefined` 就是受控（不自己排序 `rows`，信任呼叫端已排好）；沒傳就是非受控（內部 `useState` 自己排序）。

這個檔案目前沒有 `'use client'`（能運作是因為所有呼叫端本來就都在 client 邊界內），現在元件內部要用 `useState`，明確加上 `'use client'`。

- [ ] **Step 1: 替換整份檔案**

Replace `src/components/ui/DataTable.tsx` entirely with:

```tsx
'use client';

import { Fragment, ReactNode, useState } from 'react';
import { getCellClass } from './dataTableCellClass';
import { SortState, nextSortState, sortRows } from './dataTableSort';

export interface Column<T> {
  header: ReactNode;
  render: (row: T) => ReactNode;
  // 欄寬 class（如 w-40）：md:table-fixed 下由表頭寬度決定整欄，其餘未指定的欄平分剩餘寬度
  width?: string;
  // 額外套用到該欄 th 與 td 的 class
  className?: string;
  // 有給這個欄位，表頭才會顯示排序按鈕；回傳可比較的值，null/undefined 一律排最後
  sortValue?: (row: T) => string | number | Date | null | undefined;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  onRowMouseLeave?: (row: T) => void;
  footer?: ReactNode;
  loading?: boolean;
  // 展開列：expandedKey 對到哪一列，就在該列下方插入一列跨欄內容
  expandedKey?: string | null;
  renderExpanded?: (row: T) => ReactNode;
  // 無資料時顯示的提示文字；未傳則維持只剩表頭的現狀
  emptyText?: string;
  // 受控排序：有傳 onSortChange 就不自己排序 rows（信任呼叫端已經排好），只負責顯示狀態與回報點擊
  sort?: SortState | null;
  onSortChange?: (next: SortState | null) => void;
}

function SortIcon({ direction }: { direction: 'asc' | 'desc' | null }) {
  if (direction === 'asc') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0 text-[#4A2E1D]"
        aria-hidden="true"
      >
        <polyline points="6 15 12 9 18 15" />
      </svg>
    );
  }
  if (direction === 'desc') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0 text-[#4A2E1D]"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0 opacity-35 transition-opacity group-hover:opacity-100 group-hover:text-[#4A2E1D]"
      aria-hidden="true"
    >
      <polyline points="7 10 12 6 17 10" />
      <polyline points="7 14 12 18 17 14" />
    </svg>
  );
}

export default function DataTable<T>({
  columns,
  rows,
  keyField,
  onRowClick,
  rowClassName,
  onRowMouseLeave,
  footer,
  loading,
  expandedKey,
  renderExpanded,
  emptyText,
  sort,
  onSortChange,
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = useState<SortState | null>(null);
  const controlled = onSortChange !== undefined;
  const activeSort = controlled ? (sort ?? null) : internalSort;
  const displayRows = controlled ? rows : sortRows(rows, columns, internalSort);

  function handleSortClick(columnIndex: number) {
    const next = nextSortState(activeSort, columnIndex);
    if (controlled) {
      onSortChange!(next);
    } else {
      setInternalSort(next);
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-borderSubtle">
      <table className="w-full table-auto border-collapse text-sm md:table-fixed">
        <thead>
          <tr className="border-b border-brandDark bg-brand text-center text-brandInk">
            {columns.map((col, i) => {
              const isSortable = !!col.sortValue;
              const direction = activeSort?.columnIndex === i ? activeSort.direction : null;
              return (
                <th
                  key={i}
                  aria-sort={isSortable ? (direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none') : undefined}
                  className={getCellClass(
                    isSortable
                      ? 'whitespace-nowrap font-semibold md:whitespace-normal'
                      : 'whitespace-nowrap px-4 py-2 font-semibold md:whitespace-normal',
                    col
                  )}
                >
                  {isSortable ? (
                    <button
                      type="button"
                      onClick={() => handleSortClick(i)}
                      className="group flex w-full items-center justify-center gap-1 px-4 py-2 transition-colors hover:bg-[#4A2E1D]/10"
                    >
                      {col.header}
                      <SortIcon direction={direction} />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        {loading ? (
          <tbody aria-hidden>
            {Array.from({ length: 5 }).map((_, r) => (
              <tr key={r} className={`border-b border-borderSubtle ${r % 2 === 1 ? 'bg-stripe' : 'bg-card'}`}>
                {columns.map((col, c) => (
                  <td key={c} className={getCellClass('px-4 py-3', col)}>
                    <div className="skeleton-shimmer mx-auto h-4 w-3/4 rounded" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : displayRows.length === 0 && emptyText ? (
          <tbody>
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-inkMuted">
                {emptyText}
              </td>
            </tr>
          </tbody>
        ) : (
          <tbody className="animate-fade-in">
            {displayRows.map((row, index) => {
              const key = keyField(row);
              const customClass = rowClassName?.(row) ?? '';
              // Only a base bg-* utility (e.g. a highlight override) should suppress
              // the zebra stripe — a variant like hover:bg-stripe shouldn't, since it
              // only paints on hover and layers fine on top of the stripe underneath.
              const hasBaseBackground = customClass.split(/\s+/).some((c) => c.startsWith('bg-'));
              const stripeClass = hasBaseBackground ? '' : index % 2 === 1 ? 'bg-stripe' : 'bg-card';
              return (
                <Fragment key={key}>
                  <tr
                    id={key}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onMouseLeave={onRowMouseLeave ? () => onRowMouseLeave(row) : undefined}
                    className={`border-b border-borderSubtle ${stripeClass} ${customClass}`}
                  >
                    {columns.map((col, i) => (
                      <td
                        key={i}
                        className={getCellClass('whitespace-nowrap px-4 py-3 text-center text-ink md:whitespace-normal', col)}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                  {renderExpanded && expandedKey === key && (
                    <tr className="border-b border-borderSubtle bg-stripe">
                      <td colSpan={columns.length} className="px-4 py-4">
                        <div className="animate-fade-in text-left">{renderExpanded(row)}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
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

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 沒有新增的型別錯誤（既有錯誤如果本來就有，跟這次改動無關可以忽略；如果是這次改動導致的新錯誤要修到乾淨）

- [ ] **Step 3: 執行既有測試確認沒壞**

Run: `npx vitest run src/components/ui`
Expected: PASS（`dataTableRows.test.ts`、`dataTableCellClass.test.ts`、`dataTableSort.test.ts` 全過）

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/DataTable.tsx
git commit -m "feat: DataTable supports controlled/uncontrolled column sorting"
```

---

## Task 3: `CollapsibleDataTable` 排序在切片之前

**Files:**
- Modify: `src/components/ui/CollapsibleDataTable.tsx`

**Interfaces:**
- Consumes：Task 1 的 `SortState`、`sortRows`；Task 2 的 `DataTable` 新 prop `sort`/`onSortChange`。
- Produces：無（`CollapsibleDataTableProps<T>` 對外介面不變，排序是內部行為）。

**Why：** 展開/收合是「排序後的前 N 筆」，不是「切片後才在小範圍內排序」——排序狀態要提到這一層，排序完整資料集之後才交給 `getVisibleRows` 切片。

- [ ] **Step 1: 替換整份檔案**

Replace `src/components/ui/CollapsibleDataTable.tsx` entirely with:

```tsx
'use client';

import { useState } from 'react';
import DataTable, { Column } from './DataTable';
import { getVisibleRows } from './dataTableRows';
import { SortState, sortRows } from './dataTableSort';

interface CollapsibleDataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyField: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  onRowMouseLeave?: (row: T) => void;
  maxRows?: number;
  loading?: boolean;
  emptyText?: string;
}

export default function CollapsibleDataTable<T>({
  columns,
  rows,
  keyField,
  onRowClick,
  rowClassName,
  onRowMouseLeave,
  maxRows,
  loading,
  emptyText,
}: CollapsibleDataTableProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const sortedRows = sortRows(rows, columns, sort);
  const visibleRows = getVisibleRows(sortedRows, maxRows, expanded);
  const showFooter = maxRows != null && rows.length > maxRows;

  return (
    <DataTable
      columns={columns}
      rows={visibleRows}
      keyField={keyField}
      onRowClick={onRowClick}
      rowClassName={rowClassName}
      onRowMouseLeave={onRowMouseLeave}
      loading={loading}
      emptyText={emptyText}
      sort={sort}
      onSortChange={setSort}
      footer={
        showFooter ? (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex w-full cursor-pointer items-center justify-center gap-1 border-t border-borderSubtle px-4 py-2 text-sm font-medium text-brandDark transition-colors hover:bg-stripe"
          >
            {expanded ? '收合' : `展開全部（共 ${rows.length} 筆）`}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        ) : undefined
      }
    />
  );
}
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 沒有新增的型別錯誤

- [ ] **Step 3: 執行既有測試確認沒壞**

Run: `npx vitest run src/components/ui`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/CollapsibleDataTable.tsx
git commit -m "feat: CollapsibleDataTable sorts full dataset before collapsing"
```

---

## Task 4: 試點套用（`LeaveRecordsTable.tsx`）＋瀏覽器端到端驗證

**Files:**
- Modify: `src/app/admin/LeaveRecordsTable.tsx`

**Interfaces:**
- Consumes：Task 2 的 `Column<T>.sortValue`。

這是全站套用的第一個檔案，同時用來驗證 Task 2／3 的排序能力在真實頁面（`CollapsibleDataTable`，有 `maxRows={3}`）上如預期運作。判斷原則（詳見 spec「全站套用範圍」）：欄位顯示值是單一 row 欄位的純量（文字／狀態／日期／數字）→ 加 `sortValue`；欄位是按鈕／連結／多值徽章/純裝飾 → 不加。這個檔案裡「補課安排」欄同時顯示徽章＋多行文字，屬於多值欄位，不給排序。

- [ ] **Step 1: 幫可排序欄位補上 `sortValue`**

In `src/app/admin/LeaveRecordsTable.tsx`, replace the `columns` array with:

```tsx
  const columns: Column<LeaveRow>[] = [
    { header: '學生', render: (r) => r.student.user.name, sortValue: (r) => r.student.user.name },
    {
      header: '請假班級',
      render: (r) => <span className="whitespace-nowrap">{r.class.name}</span>,
      sortValue: (r) => r.class.name,
    },
    {
      header: '請假日期',
      render: (r) => formatDateWithWeekday(r.date, 'zh-TW'),
      sortValue: (r) => r.date,
    },
    {
      header: '補課日期',
      render: (r) => {
        const m = r.makeupRequest;
        if (!m) return <span className="text-inkMuted">—</span>;
        const d = m.type === 'INSERTION' ? m.targetDate : m.slotDate;
        return <span className="whitespace-nowrap">{d ? formatDateWithWeekday(d, 'zh-TW') : '-'}</span>;
      },
      sortValue: (r) => {
        const m = r.makeupRequest;
        if (!m) return null;
        return m.type === 'INSERTION' ? m.targetDate : m.slotDate;
      },
    },
    {
      header: '補課安排',
      render: (r) => {
        const m = r.makeupRequest;
        if (!m) return <span className="text-inkMuted">—</span>;
        if (m.type === 'INSERTION') {
          return (
            <div className="flex flex-col items-center gap-1">
              <span className="whitespace-nowrap rounded-full bg-approvedBg px-2.5 py-0.5 text-xs font-bold text-approved">插班</span>
              <span className="whitespace-nowrap">{m.targetClass?.name ?? '-'}</span>
            </div>
          );
        }
        return (
          <div className="flex flex-col items-center gap-1">
            <span className="whitespace-nowrap rounded-full bg-assignedBg px-2.5 py-0.5 text-xs font-bold text-assigned">一對一</span>
            <span className="whitespace-nowrap">{m.teacher?.user.name ?? '-'}</span>
            <span className="whitespace-nowrap">{m.slotStartTime}-{m.slotEndTime}</span>
          </div>
        );
      },
    },
    {
      header: '補課狀態',
      render: (r) => (r.makeupRequest ? <StatusBadge status={r.makeupRequest.status} /> : <span className="text-inkMuted">尚未申請</span>),
      sortValue: (r) => r.makeupRequest?.status ?? null,
    },
  ];
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無新增錯誤

- [ ] **Step 3: 瀏覽器端到端驗證**

啟動 dev server（`npm run dev`），登入 admin，開啟有這張表的頁面（請假／補課紀錄）：
- 「學生」「請假班級」「補課狀態」欄位標題會變成按鈕，未排序時箭頭圖示淡淡的
- hover 該按鈕：背景與圖示轉深咖啡色 `#4A2E1D`
- 點「請假日期」：資料依日期升冪排列，圖示變實心向上箭頭且變深咖啡色，`aria-sort="ascending"`（用瀏覽器 DevTools 檢查該 `<th>`）
- 再點一次：降冪，箭頭朝下
- 再點一次：清除排序，回到原始順序，圖示變回淡的雙箭頭
- 資料筆數 > 3（收合狀態）時，排序後「展開全部」看到的仍是全體資料裡正確排序的結果，不是先取前 3 筆才排序
- 「補課安排」欄標題維持純文字，沒有按鈕/hover 效果（未受影響的驗證）

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/LeaveRecordsTable.tsx
git commit -m "feat: make LeaveRecordsTable columns sortable"
```

---

## Task 5–11：全站套用（其餘 36 個檔案，依模組分批）

以下每個任務都是同一套機械式流程，套用在不同檔案清單上。每個檔案都**還沒讀過**，要先打開檔案裡的 `columns`（`Column<T>[]`，傳給 `DataTable`／`CollapsibleDataTable` 的那個陣列——不是 `exportColumns` 或其他跟 CSV 匯出/篩選相關的陣列）：

1. 逐一看每個 `column` 的 `render`：
   - 如果回傳值是**單一 row 欄位的純量**（文字、狀態字串、日期、數字）→ 補上對應的 `sortValue`，寫法比照 Task 4 的 `LeaveRecordsTable.tsx`（`sortValue` 回傳跟 `render` 邏輯上同一個值，但回傳原始型別而不是格式化後的 JSX/字串——例如 `render` 用 `formatDateWithWeekday(r.date, ...)` 顯示，`sortValue` 直接回傳 `r.date`）。
   - 如果回傳值是按鈕／連結／多個徽章或多行文字組合／checkbox／純序號或「操作」欄 → 不加 `sortValue`，維持原樣。
   - 值可能不存在時（optional chaining 出來的），`sortValue` 回傳 `null`，不要回傳空字串 `''`（空字串會被當成正常字串排序，`null` 才會被排到最後——這是 `dataTableSort.ts` 的既定行為）。
2. 型別檢查：`npx tsc --noEmit`，確認沒有新增錯誤。
3. 啟動 dev server，實際點開每個改過的頁面/表格，確認：新增的排序按鈕能點、循環正確（升→降→清除）、沒有 `sortValue` 的欄位維持原樣不受影響。
4. Commit，訊息列出這批檔案。

如果同一個檔案裡有多組 `columns`（例如某個彈窗有一組、外層列表又有一組），每一組都要各自檢查一次。

### Task 5（admin 第 1 批，6 檔）

**Files:**
- Modify: `src/app/admin/SubstituteHistoryTable.tsx`
- Modify: `src/app/admin/activities/page.tsx`
- Modify: `src/app/admin/classes/page.tsx`
- Modify: `src/app/admin/faq/page.tsx`
- Modify: `src/app/admin/go-hall/TicketManager.tsx`
- Modify: `src/app/admin/go-hall/page.tsx`

- [ ] **Step 1–4：套用上面的機械式流程到這 6 個檔案**
- [ ] **Step 5: Commit**

```bash
git add src/app/admin/SubstituteHistoryTable.tsx src/app/admin/activities/page.tsx src/app/admin/classes/page.tsx src/app/admin/faq/page.tsx src/app/admin/go-hall/TicketManager.tsx src/app/admin/go-hall/page.tsx
git commit -m "feat: add column sorting to admin tables (batch 1)"
```

### Task 6（admin 第 2 批，6 檔）

**Files:**
- Modify: `src/app/admin/makeup-notices/page.tsx`
- Modify: `src/app/admin/makeup-requests/LeaveRequestList.tsx`
- Modify: `src/app/admin/makeup-requests/page.tsx`
- Modify: `src/app/admin/points/PointReasonsManager.tsx`
- Modify: `src/app/admin/points/page.tsx`
- Modify: `src/app/admin/students/FamilySiblingModal.tsx`

- [ ] **Step 1–4：套用機械式流程到這 6 個檔案**
- [ ] **Step 5: Commit**

```bash
git add src/app/admin/makeup-notices/page.tsx src/app/admin/makeup-requests/LeaveRequestList.tsx src/app/admin/makeup-requests/page.tsx src/app/admin/points/PointReasonsManager.tsx src/app/admin/points/page.tsx src/app/admin/students/FamilySiblingModal.tsx
git commit -m "feat: add column sorting to admin tables (batch 2)"
```

### Task 7（admin 第 3 批，5 檔）

**Files:**
- Modify: `src/app/admin/students/page.tsx`
- Modify: `src/app/admin/substitute-requests/page.tsx`
- Modify: `src/app/admin/teachers/page.tsx`
- Modify: `src/app/admin/tutoring/EnrollmentManager.tsx`
- Modify: `src/app/admin/tutoring/bookings/page.tsx`

- [ ] **Step 1–4：套用機械式流程到這 5 個檔案**（`students/page.tsx` 裡有多組 `columns`，每組都要檢查）
- [ ] **Step 5: Commit**

```bash
git add src/app/admin/students/page.tsx src/app/admin/substitute-requests/page.tsx src/app/admin/teachers/page.tsx src/app/admin/tutoring/EnrollmentManager.tsx src/app/admin/tutoring/bookings/page.tsx
git commit -m "feat: add column sorting to admin tables (batch 3)"
```

### Task 8（student，7 檔）

**Files:**
- Modify: `src/app/student/LeaveHistoryTable.tsx`
- Modify: `src/app/student/activities/page.tsx`
- Modify: `src/app/student/attendance/page.tsx`
- Modify: `src/app/student/go-hall/page.tsx`
- Modify: `src/app/student/leave-request/page.tsx`
- Modify: `src/app/student/points/PointsHistoryTable.tsx`
- Modify: `src/app/student/tutoring/page.tsx`

- [ ] **Step 1–4：套用機械式流程到這 7 個檔案**
- [ ] **Step 5: Commit**

```bash
git add src/app/student/LeaveHistoryTable.tsx src/app/student/activities/page.tsx src/app/student/attendance/page.tsx src/app/student/go-hall/page.tsx src/app/student/leave-request/page.tsx src/app/student/points/PointsHistoryTable.tsx src/app/student/tutoring/page.tsx
git commit -m "feat: add column sorting to student tables"
```

### Task 9（teacher，3 檔）

**Files:**
- Modify: `src/app/teacher/TeacherLeaveTable.tsx`
- Modify: `src/app/teacher/activities/page.tsx`
- Modify: `src/app/teacher/go-hall/page.tsx`

- [ ] **Step 1–4：套用機械式流程到這 3 個檔案**
- [ ] **Step 5: Commit**

```bash
git add src/app/teacher/TeacherLeaveTable.tsx src/app/teacher/activities/page.tsx src/app/teacher/go-hall/page.tsx
git commit -m "feat: add column sorting to teacher tables"
```

### Task 10（共用元件第 1 批，5 檔）

**Files:**
- Modify: `src/components/AssignmentsTable.tsx`
- Modify: `src/components/AttendanceHub.tsx`
- Modify: `src/components/AwardRowsForm.tsx`
- Modify: `src/components/ClassAttendanceLedgerModal.tsx`
- Modify: `src/components/GoHallSummaryTable.tsx`

- [ ] **Step 1–4：套用機械式流程到這 5 個檔案**（`AssignmentsTable.tsx` 裡有兩組 `columns`，都要檢查）
- [ ] **Step 5: Commit**

```bash
git add src/components/AssignmentsTable.tsx src/components/AttendanceHub.tsx src/components/AwardRowsForm.tsx src/components/ClassAttendanceLedgerModal.tsx src/components/GoHallSummaryTable.tsx
git commit -m "feat: add column sorting to shared table components (batch 1)"
```

### Task 11（共用元件第 2 批，4 檔）

**Files:**
- Modify: `src/components/GoHallTicketHistoryModal.tsx`
- Modify: `src/components/TeacherClassList.tsx`
- Modify: `src/components/TeacherTutoringWindowList.tsx`
- Modify: `src/components/TutoringDeductionLedgerModal.tsx`

- [ ] **Step 1–4：套用機械式流程到這 4 個檔案**（`TeacherClassList.tsx` 裡有兩組 `columns`，都要檢查）
- [ ] **Step 5: Commit**

```bash
git add src/components/GoHallTicketHistoryModal.tsx src/components/TeacherClassList.tsx src/components/TeacherTutoringWindowList.tsx src/components/TutoringDeductionLedgerModal.tsx
git commit -m "feat: add column sorting to shared table components (batch 2)"
```

---

## Task 12: 全站驗收

**Files:** 無新增/修改（純驗證）

- [ ] **Step 1: 型別檢查**

Run: `npx tsc --noEmit`
Expected: PASS，無錯誤

- [ ] **Step 2: 完整測試**

Run: `npm test`
Expected: PASS（含 `test:dbpush` 起手式，需要本機測試 DB 跑得起來）

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: 瀏覽器抽測**

啟動 dev server，用 admin／teacher／student 三種身分各登入一次，每個模組（admin/student/teacher/共用元件）至少抽一個頁面，確認：
- 排序按鈕視覺一致（未排序淡、hover/已排序深咖啡）
- 排序切換頁面後（換一頁再換回來）確實還原成預設順序，不會記住上次排序
- 深色模式（Safari 或系統深色模式）下排序按鈕文字/圖示仍清楚可讀（表頭底色固定是暖金色，不隨深色模式變化，理論上不受影響，但仍要肉眼確認一次）

- [ ] **Step 5: 更新 spec 檔案的檔案數量誤植**

`docs/superpowers/specs/2026-08-14-table-column-sorting-design.md` 的「全站套用範圍」段落寫「36 個檔案」，附錄實際列了 37 個，修正文字為「37 個檔案」。

```bash
git add docs/superpowers/specs/2026-08-14-table-column-sorting-design.md
git commit -m "docs: fix file count in table sorting spec"
```
