# 個別輔導：個別學生出缺勤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 個別輔導能以「報名（學生 × 課程）」為單位看完整出缺勤：行政在報名編輯彈窗看＋匯出 Excel、學生在預約紀錄看，報名列表整列可點開編輯。

**Architecture:** 新增一支共用服務 `getTutoringEnrollmentAttendance(enrollmentId)`（record 形狀比照既有時段總表），一支 API `GET /api/tutoring-enrollments/[id]/attendance`（ADMIN 任查、STUDENT 只能查自己）。行政端在 `EnrollmentManager` 的編輯彈窗加出缺勤區塊＋`ExportExcelButton`，列表加 `onRowClick`；學生端擴充 `listBookingsForStudent` 帶出席欄位、預約紀錄表加欄。

**Tech Stack:** Next.js App Router、Prisma、vitest（測試打真的測試 DB）、既有 UI 元件（`DataTable`／`CollapsibleDataTable`／`StatusBadge`／`ExportExcelButton`／`Modal`）。

**Spec:** `docs/superpowers/specs/2026-08-19-tutoring-per-student-attendance-design.md`

## Global Constraints

- 無 schema 變更、無正式站 SQL；純程式碼。
- 日期顯示一律 `formatDateWithWeekday`（`@/lib/dateFormat`）。
- 表單／表格沿用共用元件；紀錄類表格用 `CollapsibleDataTable maxRows={3}`。
- 測試 fixture 日期用 `new Date(Date.UTC(...))`，不用 `new Date(Y, M, D)` 本機時間建構子。
- `npm test` 會 reset 測試 DB（`test:dbpush`），不要與其他 session 的測試同時跑。
- 測試 email 一律帶 `${Date.now()}` 避免撞 unique。
- commit 訊息結尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: 服務層 `getTutoringEnrollmentAttendance`

**Files:**
- Modify: `src/lib/services/attendanceService.ts`（檔尾，接在 `getTutoringWindowAttendanceOverview` 之後）
- Test: `src/lib/services/attendanceService.test.ts`（檔尾加一個 describe）

**Interfaces:**
- Consumes: 既有 `TutoringWindowOverviewRecord`（同檔已定義）、`NAME_SELECT`（同檔 const）、`AttendanceStatusValue`（同檔已有）。
- Produces（後續 Task 2/4 依賴，簽名照抄）:

```ts
export interface TutoringEnrollmentAttendanceRecord extends TutoringWindowOverviewRecord {
  id: string; // booking id，前端列 key 用（同日可能有「取消後重約」兩筆，日期當 key 會撞）
}

export interface TutoringEnrollmentAttendanceResult {
  studentName: string;
  programName: string;
  records: TutoringEnrollmentAttendanceRecord[];
}

export async function getTutoringEnrollmentAttendance(enrollmentId: string): Promise<TutoringEnrollmentAttendanceResult>
// 找不到報名 → throw new Error('ENROLLMENT_NOT_FOUND')
```

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/services/attendanceService.test.ts` 檔尾新增（`createTeacher`／`createStudent`／`createProgram`／`createWindow`／`createEnrollment`／`createBooking`／`adminCancelBooking`／`saveTutoringAttendance` 皆已在檔頭 import，只需把 `getTutoringEnrollmentAttendance` 加進第 10 行從 `./attendanceService` 的 import 清單）：

```ts
describe('getTutoringEnrollmentAttendance', () => {
  async function setup() {
    const teacher = await createTeacher({ name: '米奇老師', email: `enr-att-mickey-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id });
    const student = await createStudent({ name: '小明', email: `enr-att-ming-${Date.now()}@example.com`, password: 'x' });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });
    return { window, enrollment };
  }

  it('returns student/program names and all bookings newest first, including cancelled and unmarked ones', async () => {
    const { window, enrollment } = await setup();
    const marked = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await saveTutoringAttendance('marker-1', [{ bookingId: marked.id, status: 'PRESENT', checkInTime: '17:00', checkOutTime: '19:00' }]);
    const cancelled = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 10)) });
    await adminCancelBooking(cancelled.id);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2099, 0, 2)) });

    const result = await getTutoringEnrollmentAttendance(enrollment.id);
    expect(result.studentName).toBe('小明');
    expect(result.programName).toBe('英文個別輔導');
    expect(result.records.map((r) => r.date)).toEqual([
      new Date(Date.UTC(2099, 0, 2)),
      new Date(Date.UTC(2020, 0, 10)),
      new Date(Date.UTC(2020, 0, 3)),
    ]);
    expect(result.records[0]).toMatchObject({ bookingStatus: 'BOOKED', attendanceStatus: null });
    expect(result.records[1]).toMatchObject({ bookingStatus: 'CANCELLED', attendanceStatus: null });
    expect(result.records[2]).toMatchObject({
      attendanceStatus: 'PRESENT',
      bookingStatus: 'BOOKED',
      checkInTime: '17:00',
      checkOutTime: '19:00',
      isMakeup: false,
    });
    expect(typeof result.records[2].id).toBe('string');
  });

  it('throws ENROLLMENT_NOT_FOUND for a missing enrollment', async () => {
    await expect(getTutoringEnrollmentAttendance('nonexistent-id')).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/attendanceService.test.ts -t getTutoringEnrollmentAttendance`
Expected: FAIL（`getTutoringEnrollmentAttendance` 不存在 / import 錯誤）。
（若測試 DB schema 不是最新，先跑一次 `npm run test:dbpush`。）

- [ ] **Step 3: 最小實作**

在 `src/lib/services/attendanceService.ts` 檔尾（`getTutoringWindowAttendanceOverview` 函式之後）加入：

```ts
export interface TutoringEnrollmentAttendanceRecord extends TutoringWindowOverviewRecord {
  id: string;
}

export interface TutoringEnrollmentAttendanceResult {
  studentName: string;
  programName: string;
  records: TutoringEnrollmentAttendanceRecord[];
}

// 單一報名（學生 × 課程）的完整出缺勤：全部 booking（含取消／逾時取消）依日期
// 新→舊。record 形狀比照 getTutoringWindowAttendanceOverview，多帶 booking id
// 當列 key（同日可能有「取消後重約」兩筆，日期不唯一）。
export async function getTutoringEnrollmentAttendance(enrollmentId: string): Promise<TutoringEnrollmentAttendanceResult> {
  const enrollment = await prisma.tutoringEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { student: { select: NAME_SELECT }, program: { select: { name: true } } },
  });
  if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');

  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollmentId },
    select: {
      id: true,
      date: true,
      status: true,
      kind: true,
      attendance: { select: { status: true, checkInTime: true, checkOutTime: true } },
    },
    orderBy: { date: 'desc' },
  });

  return {
    studentName: enrollment.student.user.name,
    programName: enrollment.program.name,
    records: bookings.map((b) => ({
      id: b.id,
      date: b.date,
      attendanceStatus: (b.attendance?.status as AttendanceStatusValue) ?? null,
      bookingStatus: b.status as TutoringWindowOverviewRecord['bookingStatus'],
      checkInTime: b.attendance?.checkInTime ?? null,
      checkOutTime: b.attendance?.checkOutTime ?? null,
      isMakeup: b.kind === 'MAKEUP',
    })),
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/attendanceService.test.ts -t getTutoringEnrollmentAttendance`
Expected: PASS（2 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/attendanceService.ts src/lib/services/attendanceService.test.ts
git commit -m "feat: per-enrollment tutoring attendance service

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: API `GET /api/tutoring-enrollments/[id]/attendance`

**Files:**
- Create: `src/app/api/tutoring-enrollments/[id]/attendance/route.ts`
- Test: `src/app/api/tutoring-enrollments/[id]/attendance/route.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `getTutoringEnrollmentAttendance(enrollmentId)`。
- Produces: `GET /api/tutoring-enrollments/[id]/attendance` → 200 時 body 即 `TutoringEnrollmentAttendanceResult`（`{ studentName, programName, records }`，`records[].date` 序列化成 ISO 字串）。ADMIN 任查；STUDENT 只能查自己的（否則 404 `ENROLLMENT_NOT_FOUND`）；其他角色／未登入 403。

- [ ] **Step 1: 寫失敗測試**

建立 `src/app/api/tutoring-enrollments/[id]/attendance/route.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionMock = vi.fn();
vi.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => sessionMock(...args) }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { GET } from './route';
import { prisma } from '@/lib/db';
import { createTeacher } from '@/lib/services/teacherService';
import { createStudent } from '@/lib/services/studentService';
import { createProgram, createWindow, createEnrollment } from '@/lib/services/tutoringProgramService';
import { createBooking } from '@/lib/services/tutoringBookingService';
import { saveTutoringAttendance } from '@/lib/services/attendanceService';

beforeEach(() => {
  sessionMock.mockReset();
});

const asAdmin = () => sessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
const asAnon = () => sessionMock.mockResolvedValue(null);
const asTeacher = () => sessionMock.mockResolvedValue({ user: { id: 't-1', role: 'TEACHER' } });

async function setup() {
  const teacher = await createTeacher({ name: '米奇老師', email: `enr-att-route-mickey-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id });
  const student = await createStudent({ name: '小明', email: `enr-att-route-ming-${Date.now()}@example.com`, password: 'x' });
  const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });
  const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
  await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'PRESENT', checkInTime: '17:00', checkOutTime: '19:00' }]);
  return { student, enrollment };
}

async function studentUserId(studentId: string): Promise<string> {
  const { userId } = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } });
  return userId;
}

describe('GET /api/tutoring-enrollments/[id]/attendance', () => {
  it('403 when not logged in', async () => {
    asAnon();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('403 for a TEACHER', async () => {
    asTeacher();
    const res = await GET({} as never, { params: { id: 'x' } });
    expect(res.status).toBe(403);
  });

  it('404 for ADMIN when the enrollment does not exist', async () => {
    asAdmin();
    const res = await GET({} as never, { params: { id: 'nonexistent-enrollment-id' } });
    expect(res.status).toBe(404);
  });

  it('200 for ADMIN with names and records', async () => {
    const { enrollment } = await setup();
    asAdmin();
    const res = await GET({} as never, { params: { id: enrollment.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.studentName).toBe('小明');
    expect(body.programName).toBe('英文個別輔導');
    expect(body.records).toHaveLength(1);
    expect(body.records[0]).toMatchObject({ attendanceStatus: 'PRESENT', bookingStatus: 'BOOKED', checkInTime: '17:00', checkOutTime: '19:00', isMakeup: false });
    expect(body.records[0].date.slice(0, 10)).toBe('2020-01-03');
  });

  it('200 for the STUDENT who owns the enrollment', async () => {
    const { student, enrollment } = await setup();
    sessionMock.mockResolvedValue({ user: { id: await studentUserId(student.id), role: 'STUDENT' } });
    const res = await GET({} as never, { params: { id: enrollment.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.records).toHaveLength(1);
  });

  it("404 for a STUDENT reading another student's enrollment", async () => {
    const { enrollment } = await setup();
    const other = await createStudent({ name: '小華', email: `enr-att-route-hua-${Date.now()}@example.com`, password: 'x' });
    sessionMock.mockResolvedValue({ user: { id: await studentUserId(other.id), role: 'STUDENT' } });
    const res = await GET({} as never, { params: { id: enrollment.id } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run "src/app/api/tutoring-enrollments/[id]/attendance/route.test.ts"`
Expected: FAIL（`./route` 不存在）。

- [ ] **Step 3: 最小實作**

建立 `src/app/api/tutoring-enrollments/[id]/attendance/route.ts`（權限寫法比照同目錄 `../ledger/route.ts`）：

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTutoringEnrollmentAttendance } from '@/lib/services/attendanceService';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'STUDENT')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (session.user.role === 'STUDENT') {
    const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
    const enrollment = await prisma.tutoringEnrollment.findUnique({ where: { id: params.id } });
    if (!enrollment || enrollment.studentId !== student.id) {
      return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
    }
  }
  try {
    return NextResponse.json(await getTutoringEnrollmentAttendance(params.id));
  } catch (e) {
    if (e instanceof Error && e.message === 'ENROLLMENT_NOT_FOUND') {
      return NextResponse.json({ error: 'ENROLLMENT_NOT_FOUND' }, { status: 404 });
    }
    throw e;
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run "src/app/api/tutoring-enrollments/[id]/attendance/route.test.ts"`
Expected: PASS（6 tests）。

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/tutoring-enrollments/[id]/attendance"
git commit -m "feat: per-enrollment tutoring attendance API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 行政端——報名列表整列可點＋編輯彈窗出缺勤區塊＋匯出

**Files:**
- Modify: `src/app/admin/tutoring/EnrollmentManager.tsx`

**Interfaces:**
- Consumes: Task 2 的 API（`fetch('/api/tutoring-enrollments/${id}/attendance')` → `{ studentName, programName, records }`；`records[].date` 是 ISO 字串）。既有元件：`CollapsibleDataTable`（props：`columns`、`rows`、`keyField`、`maxRows`、`emptyText`、`loading`）、`StatusBadge`／`getStatusBadgeConfig`（`@/components/ui/StatusBadge`）、`ExportExcelButton`（`@/components/ui/ExportExcelButton`，props：`rows`、`columns: {header, value}[]`、`filename`、`className`）、`formatDateWithWeekday`（`@/lib/dateFormat`）。
- Produces: 無（純 UI，無其他 task 依賴）。

- [ ] **Step 1: 加 import 與型別**

`EnrollmentManager.tsx` 檔頭 import 區加：

```ts
import CollapsibleDataTable from '@/components/ui/CollapsibleDataTable';
import StatusBadge, { getStatusBadgeConfig } from '@/components/ui/StatusBadge';
import ExportExcelButton from '@/components/ui/ExportExcelButton';
import { formatDateWithWeekday } from '@/lib/dateFormat';
```

在 `interface EnrollmentRow` 之後加：

```ts
interface AttendanceRecord {
  id: string;
  date: string;
  attendanceStatus: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED' | null;
  bookingStatus: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
  checkInTime: string | null;
  checkOutTime: string | null;
  isMakeup: boolean;
}
```

- [ ] **Step 2: 彈窗開啟時抓出缺勤**

在 `const [editingEnrollment, setEditingEnrollment] = ...` 之後加 state 與 effect（用 id 當依賴，`load()` 重抓報名清單時物件會換新、id 不變，避免重複 fetch）：

```ts
const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[] | null>(null);

// 編輯彈窗開啟時載入該報名的完整出缺勤；null = 載入中（表格顯示骨架屏）
const editingEnrollmentId = editingEnrollment?.id ?? null;
useEffect(() => {
  setAttendanceRecords(null);
  if (!editingEnrollmentId) return;
  fetch(`/api/tutoring-enrollments/${editingEnrollmentId}/attendance`)
    .then((res) => (res.ok ? res.json() : { records: [] }))
    .then((data) => setAttendanceRecords(data.records))
    .catch(() => setAttendanceRecords([]));
}, [editingEnrollmentId]);
```

- [ ] **Step 3: 列表整列可點、移除「操作」欄**

`columns` 陣列刪掉整個 `{ header: '操作', ... }` 項目；列表的 `<DataTable>` 加 `onRowClick`：

```tsx
<DataTable
  columns={columns}
  rows={filteredEnrollments}
  keyField={(r) => r.id}
  onRowClick={(r) => setEditingEnrollment(r)}
  emptyText={listSearch.trim() ? '沒有符合搜尋的學生' : '目前沒有學生報名個別輔導'}
/>
```

- [ ] **Step 4: 彈窗內加「出缺勤紀錄」區塊**

編輯彈窗 `<Modal>` 加寬（5 欄表格，比照堂票紀錄彈窗的教訓）：`title={...}` 之後加 `maxWidthClassName="max-w-2xl"`。

在彈窗內容 `<div className="flex flex-col gap-3">` 裡、「移除」`<Button>` 之後加：

```tsx
<div>
  <div className="mb-1 flex items-center justify-between">
    <p className="text-xs font-medium text-inkMuted">出缺勤紀錄</p>
    <ExportExcelButton
      rows={attendanceRecords ?? []}
      columns={attendanceExportColumns}
      filename={`個別輔導出缺勤_${editingEnrollment.studentName}_${editingEnrollment.programName}`}
      className="px-2 py-1 text-xs"
    />
  </div>
  <CollapsibleDataTable
    columns={attendanceColumns}
    rows={attendanceRecords ?? []}
    loading={attendanceRecords === null}
    keyField={(r) => r.id}
    maxRows={3}
    emptyText="尚無預約紀錄"
  />
</div>
```

在 component 裡（`columns` 定義附近）加兩份欄位定義：

```tsx
const attendanceColumns: Column<AttendanceRecord>[] = [
  { header: '日期', render: (r) => formatDateWithWeekday(r.date), sortValue: (r) => r.date },
  {
    header: '狀態',
    render: (r) => <StatusBadge status={r.attendanceStatus ?? r.bookingStatus} />,
    sortValue: (r) => r.attendanceStatus ?? r.bookingStatus,
  },
  { header: '類型', render: (r) => (r.isMakeup ? '補課' : '一般'), sortValue: (r) => (r.isMakeup ? 1 : 0) },
  { header: '簽到', render: (r) => r.checkInTime ?? '-', sortValue: (r) => r.checkInTime ?? null },
  { header: '簽退', render: (r) => r.checkOutTime ?? '-', sortValue: (r) => r.checkOutTime ?? null },
];

// 匯出欄位：畫面欄位是 React 節點，匯出要另外給純文字（ExportExcelButton 慣例）
const attendanceExportColumns = [
  { header: '日期', value: (r: AttendanceRecord) => formatDateWithWeekday(r.date) },
  { header: '狀態', value: (r: AttendanceRecord) => getStatusBadgeConfig(r.attendanceStatus ?? r.bookingStatus).label },
  { header: '類型', value: (r: AttendanceRecord) => (r.isMakeup ? '補課' : '一般') },
  { header: '簽到', value: (r: AttendanceRecord) => r.checkInTime ?? '' },
  { header: '簽退', value: (r: AttendanceRecord) => r.checkOutTime ?? '' },
];
```

- [ ] **Step 5: 型別與 lint 檢查**

Run: `npx tsc --noEmit && npm run lint`
Expected: 皆無錯誤（lint 既有 warning 不算）。

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/tutoring/EnrollmentManager.tsx
git commit -m "feat: enrollment row click + attendance section with Excel export in admin tutoring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 學生端——預約紀錄帶出席狀態與簽到/簽退

**Files:**
- Modify: `src/lib/services/tutoringBookingService.ts`（`StudentBookingRow`＋`listBookingsForStudent`，約 265-294 行）
- Modify: `src/app/student/tutoring/page.tsx`（`BookingRow`＋`bookingColumns`）
- Test: `src/lib/services/tutoringBookingService.test.ts`（`listBookingsForStudent` describe 內加一測）

**Interfaces:**
- Consumes: 既有 `listBookingsForStudent`、`saveTutoringAttendance`（測試用，需加進檔頭 import：`import { saveTutoringAttendance } from './attendanceService';`）。
- Produces: `StudentBookingRow` 新增欄位（`GET /api/tutoring-bookings` 回應隨之多這三個欄位，舊欄位不變）：

```ts
attendanceStatus: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED' | null;
checkInTime: string | null;
checkOutTime: string | null;
```

- [ ] **Step 1: 寫失敗測試**

`src/lib/services/tutoringBookingService.test.ts` 檔頭加 `import { saveTutoringAttendance } from './attendanceService';`，`describe('listBookingsForStudent', ...)` 內加：

```ts
  it('carries attendance status and check-in/out times; null when unmarked', async () => {
    const { window, enrollment } = await setupProgramWithEnrollment();
    const marked = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date('2020-08-07') });
    await saveTutoringAttendance('marker-1', [{ bookingId: marked.id, status: 'PRESENT', checkInTime: '16:00', checkOutTime: '17:00' }]);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2099, 0, 2)) });

    const rows = await listBookingsForStudent(enrollment.studentId);
    expect(rows[0]).toMatchObject({ attendanceStatus: null, checkInTime: null, checkOutTime: null });
    expect(rows[1]).toMatchObject({ attendanceStatus: 'PRESENT', checkInTime: '16:00', checkOutTime: '17:00' });
  });
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/services/tutoringBookingService.test.ts -t "carries attendance"`
Expected: FAIL（`attendanceStatus` 是 `undefined`，不是 `null`）。

- [ ] **Step 3: 實作服務端**

`src/lib/services/tutoringBookingService.ts`——`StudentBookingRow` 加欄位：

```ts
export interface StudentBookingRow {
  id: string;
  programName: string;
  date: Date;
  // MAKEUP／PENDING_ADMIN／CANCELLED_LATE／REJECTED 僅存在於歷史資料
  //（收費規範已無補課概念），保留型別讓舊紀錄能正常顯示。
  kind: 'REGULAR' | 'MAKEUP';
  status: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
  attendanceStatus: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED' | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}
```

`listBookingsForStudent` 的 `select` 加 `attendance: { select: { status: true, checkInTime: true, checkOutTime: true } },`，`map` 改為：

```ts
  return bookings.map((b) => ({
    id: b.id,
    programName: b.window.program.name,
    date: b.date,
    kind: b.kind as 'REGULAR' | 'MAKEUP',
    status: b.status as StudentBookingRow['status'],
    attendanceStatus: (b.attendance?.status as StudentBookingRow['attendanceStatus']) ?? null,
    checkInTime: b.attendance?.checkInTime ?? null,
    checkOutTime: b.attendance?.checkOutTime ?? null,
  }));
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/services/tutoringBookingService.test.ts`
Expected: PASS（整檔，含新測試）。

- [ ] **Step 5: 實作學生頁**

`src/app/student/tutoring/page.tsx`——`interface BookingRow` 加同樣三個欄位：

```ts
  attendanceStatus: 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED' | null;
  checkInTime: string | null;
  checkOutTime: string | null;
```

`bookingColumns` 在「狀態」欄之後、「操作」欄之前插入：

```tsx
    {
      header: '出席',
      render: (r) => (r.attendanceStatus ? <StatusBadge status={r.attendanceStatus} /> : '-'),
      sortValue: (r) => r.attendanceStatus ?? null,
    },
    { header: '簽到', render: (r) => r.checkInTime ?? '-', sortValue: (r) => r.checkInTime ?? null },
    { header: '簽退', render: (r) => r.checkOutTime ?? '-', sortValue: (r) => r.checkOutTime ?? null },
```

- [ ] **Step 6: 型別與 lint 檢查**

Run: `npx tsc --noEmit && npm run lint`
Expected: 皆無錯誤。

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/tutoringBookingService.ts src/lib/services/tutoringBookingService.test.ts src/app/student/tutoring/page.tsx
git commit -m "feat: attendance status and check-in/out in student tutoring booking list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 全量驗證＋瀏覽器實測

**Files:**
- 無新檔；只驗證。

**Interfaces:**
- Consumes: Task 1-4 全部成果。

- [ ] **Step 1: 全量測試**

Run: `npm test`
Expected: 全綠。（會 reset 測試 DB；確認沒有其他 session 同時在跑測試。）

- [ ] **Step 2: 型別與 lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: 皆無錯誤。

- [ ] **Step 3: 瀏覽器實測（dev server）**

用 preview 工具開 dev server（勿用 Bash 起 server），依序驗證：

1. 以 ADMIN 登入 `/admin/tutoring`：報名列表點「整列」→ 編輯彈窗開啟；彈窗內「出缺勤紀錄」表格載入（骨架屏→資料）；>3 筆時預設收合；「匯出 Excel」按鈕存在且有紀錄時可點。確認原「操作」欄已移除。
2. 以 STUDENT 登入 `/student/tutoring`：「我的預約紀錄」多出「出席／簽到／簽退」欄；已點名的列顯示出席徽章與時間、未點名顯示 `-`。
3. 檢查 console 無錯誤。（測試登入切換技巧見 memory `project_student_guide`：NextAuth API 測試登入。）

- [ ] **Step 4: 截圖存證**

行政彈窗與學生預約紀錄各一張截圖，附在完成回報裡。

- [ ] **Step 5: 最終 commit（若驗證過程有修正）**

```bash
git add -A ':!.impeccable'
git commit -m "fix: adjustments from browser verification of per-student tutoring attendance

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

（若無修正則略過。）
