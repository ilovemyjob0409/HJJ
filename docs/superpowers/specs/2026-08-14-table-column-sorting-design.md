# 表格欄位排序按鈕

日期：2026-08-14
狀態：使用者已核准設計

## 需求

全站所有表格的欄位標題都要能點擊排序（升冪／降冪／清除），排序狀態不用記住——換頁面（元件重新掛載）就要還原成預設順序。

## 現況

全站表格清一色透過兩個共用元件渲染，沒有另外手刻的 table：

- `src/components/ui/DataTable.tsx`：吃 `columns`（含 `header: ReactNode`、`render: (row) => ReactNode`）＋ `rows`，渲染表頭／表身／載入骨架／空狀態／展開列。
- `src/components/ui/CollapsibleDataTable.tsx`：包一層 `DataTable`，超過 `maxRows` 先切片、加「展開全部」footer 按鈕（用 `dataTableRows.ts` 的 `getVisibleRows`）。

兩者合計被 36 個檔案使用（admin/teacher/student 都有），列表詳見附錄。`Column` 目前沒有排序相關欄位，`header` 是任意 ReactNode，沒辦法直接拿來當排序依據。

`WeeklyTimetableGrid`／`TimetableModal` 是另一種格狀排版（不是 `columns`+`rows` 的表格），不在這次範圍內。

## 設計

### 排序邏輯（新檔）

`src/components/ui/dataTableSort.ts`：

```ts
export type SortDirection = 'asc' | 'desc';
export interface SortState { columnIndex: number; direction: SortDirection; }

// 同一欄：無→升→降→無（清除）；換欄位：直接以該欄升冪開始
export function nextSortState(current: SortState | null, columnIndex: number): SortState | null

// 依 columns[sort.columnIndex].sortValue 取值排序；null/undefined 一律排最後（不分方向）
// 同型別比較：Date 用 getTime()、number 直接減、其餘用 Intl.Collator('zh-Hant') 比較字串
export function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState | null): T[]
```

用陣列 index 當欄位識別（跟現有 `key={i}` 渲染方式一致），因為 `columns` 是每張表固定定義、不會動態重排。

配對 `dataTableSort.test.ts`：涵蓋三態循環、換欄重置、null 值排序、日期/數字/中文字串各自的比較邏輯。

### `Column` 型別新增

```ts
sortValue?: (row: T) => string | number | Date | null | undefined;
```

沒給這個欄位＝該欄不可排序，`header` 照舊原樣渲染，完全不受影響（向下相容，現有呼叫端不用改就能維持原樣）。

### `DataTable` 改動：受控／非受控排序

```ts
sort?: SortState | null;
onSortChange?: (next: SortState | null) => void;
```

- 有傳 `onSortChange`＝受控模式：不自己排序 `rows`（信任外層已經排好），表頭圖示狀態看 `sort` prop，點擊時把算好的 `nextSortState` 丟給 `onSortChange`，不自己改資料順序。
- 沒傳 `onSortChange`＝非受控模式：內部 `useState<SortState | null>`，點擊時自己算下一個狀態、自己用 `sortRows` 排序 `rows` 再渲染。單獨用 `DataTable`（沒被 `CollapsibleDataTable` 包住）的呼叫端不用做任何額外接線就能動。

有 `sortValue` 的欄位，表頭渲染成 `<button>`（同一個 `<th>` 內），未排序時圖示淡（opacity .35），hover 或已排序時變深咖啡色 `#4A2E1D`、hover 背景疊 `rgba(74,46,29,.1)`（跟已核准的 demo 一致）。圖示是手刻 inline SVG 上下箭頭（比照 `CollapsibleDataTable` 現有展開按鈕的箭頭做法，不另外裝圖示套件）。`<th>` 加 `aria-sort`（`ascending`/`descending`/未排序時不加這個屬性）。

### `CollapsibleDataTable` 改動：排序在切片之前

```ts
const [sort, setSort] = useState<SortState | null>(null);
const sortedRows = sortRows(rows, columns, sort);
const visibleRows = getVisibleRows(sortedRows, maxRows, expanded);
// <DataTable columns={columns} rows={visibleRows} sort={sort} onSortChange={setSort} ... />
```

先排序完整資料集、再切片，這樣「展開前只顯示前 N 筆」永遠是排序後的前 N 筆，不是切片後才在小範圍內排序。

### 排序狀態不持久化

刻意不寫 `localStorage`、不寫網址查詢參數、不送後端存偏好。排序狀態就是元件的 React state，換頁（元件卸載）自然歸零——不需要額外程式碼特別處理「還原預設順序」，這是這個設計本身的副作用。

### 全站套用範圍

中央邏輯改完後，逐一走過附錄裡的 36 個檔案，幫每張表決定哪些欄位加 `sortValue`。判斷原則：
- 欄位顯示值是單一 row 欄位的純量（文字／狀態標籤／日期／數字）→ 加 `sortValue`。
- 欄位是按鈕／連結／多值徽章／純裝飾（例如序號、操作、勾選框）→ 不加，維持現狀不可排序。

這部分工作量大，會拆成任務逐一過（依模組分批：admin／teacher／student）。

## 測試

- `dataTableSort.test.ts`：如上述涵蓋範圍。
- `DataTable`／`CollapsibleDataTable` 既有測試（如有）不能因為新增可選 prop 而壞掉；新增測試涵蓋受控／非受控兩種模式下點擊表頭確實改變列順序、圖示狀態正確、`CollapsibleDataTable` 排序後切片正確。
- 逐一表格的 `sortValue` 走既有該檔案的測試（如果原本就有測試涵蓋該表格渲染）。

## 不做的事

- 不做伺服器端／分頁感知排序，全部是拿到 `rows` 之後在前端排序。
- 不記住使用者的排序選擇（不寫 localStorage／網址／後端）。
- 不支援多欄同時排序，一次只認一欄。
- 不做每張表客製化的排序圖示或樣式，全站統一一套視覺。
- 不處理 `WeeklyTimetableGrid`／`TimetableModal` 這類非 `columns`+`rows` 的格狀排版。

## 附錄：目前使用 DataTable／CollapsibleDataTable 的檔案（36）

```
src/app/admin/LeaveRecordsTable.tsx
src/app/admin/SubstituteHistoryTable.tsx
src/app/admin/activities/page.tsx
src/app/admin/classes/page.tsx
src/app/admin/faq/page.tsx
src/app/admin/go-hall/TicketManager.tsx
src/app/admin/go-hall/page.tsx
src/app/admin/makeup-notices/page.tsx
src/app/admin/makeup-requests/LeaveRequestList.tsx
src/app/admin/makeup-requests/page.tsx
src/app/admin/points/PointReasonsManager.tsx
src/app/admin/points/page.tsx
src/app/admin/students/FamilySiblingModal.tsx
src/app/admin/students/page.tsx
src/app/admin/substitute-requests/page.tsx
src/app/admin/teachers/page.tsx
src/app/admin/tutoring/EnrollmentManager.tsx
src/app/admin/tutoring/bookings/page.tsx
src/app/student/LeaveHistoryTable.tsx
src/app/student/activities/page.tsx
src/app/student/attendance/page.tsx
src/app/student/go-hall/page.tsx
src/app/student/leave-request/page.tsx
src/app/student/points/PointsHistoryTable.tsx
src/app/student/tutoring/page.tsx
src/app/teacher/TeacherLeaveTable.tsx
src/app/teacher/activities/page.tsx
src/app/teacher/go-hall/page.tsx
src/components/AssignmentsTable.tsx
src/components/AttendanceHub.tsx
src/components/AwardRowsForm.tsx
src/components/ClassAttendanceLedgerModal.tsx
src/components/GoHallSummaryTable.tsx
src/components/GoHallTicketHistoryModal.tsx
src/components/TeacherClassList.tsx
src/components/TeacherTutoringWindowList.tsx
src/components/TutoringDeductionLedgerModal.tsx
```
