# 班級出缺勤總表（依學生分組，含補課狀態）

日期：2026-08-13
狀態：使用者已核准設計

## 需求

老師要能看到自己帶的整個班級的出缺勤總表（不是逐日點名，是整學期歷史），依學生分組；請假的紀錄要額外顯示補課狀態（尚未安排／待確認／已核准＋補到哪班或哪天）。行政帳號也要能用同一個頁面看任一班級。

## 現況

- `getClassAttendanceLedger`（`src/lib/services/attendanceService.ts`）是學生自己的扣堂帳本，**刻意排除** `ON_LEAVE`／`NOT_REGISTERED`（只列真的動到餘額的事件），不是出缺勤總表，不能直接拿來用。
- `LeaveRequest` 是獨立的表，**不會**自動在 `ClassAttendance` 產生對應紀錄——請假與點名紀錄要分開查、合併顯示，比照 `getClassRoster`（單日點名頁）已經在用的合併邏輯：`ClassEnrollment` + `ClassAttendance`（當天）+ `LeaveRequest`（當天）+ 已核准的插班 `MakeupRequest`。
- 老師首頁「我的帶班班級」（`TeacherClassList.tsx`）點班級開的彈窗只顯示學生名單＋堂數進度，沒有出缺勤歷史。
- 老師只看得到自己是 `class.teacherId` 的班；行政目前完全沒有「整班出缺勤」的畫面（首頁的請假/補課表是全校跨班的請假清單，不是單一班級的完整出缺勤）。

## 設計

### 資料層（新）

`src/lib/services/attendanceService.ts` 新增：

```ts
interface ClassAttendanceOverviewRecord {
  date: Date;
  status: AttendanceStatusValue; // PRESENT/LATE/LEFT_EARLY/ON_LEAVE/ABSENT/NOT_REGISTERED
  checkInTime: string | null;
  checkOutTime: string | null;
  makeup: null | {
    status: 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED';
    type: 'INSERTION' | 'ONE_ON_ONE';
    label: string; // 「補到 8/24（一）週一基礎2A」或「王老師 一對一 8/24 14:00-14:40」
  };
}
interface ClassAttendanceOverviewStudent {
  studentId: string;
  studentName: string;
  records: ClassAttendanceOverviewRecord[]; // 新到舊
}

export async function getClassAttendanceOverview(classId: string): Promise<ClassAttendanceOverviewStudent[]>
```

合併邏輯：
1. 撈 `ClassEnrollment`（誰在這班）、`ClassAttendance`（這班全部點名紀錄）、`LeaveRequest`（這班全部請假，含 `makeupRequest` 關聯）。
2. 每個學生：以「有 `ClassAttendance` 紀錄的日期」∪「有 `LeaveRequest` 的日期」為列，去重合併——同一天若兩者都有，`status` 以 `ClassAttendance.status` 為準（老師實際點名結果，可能仍是 `ON_LEAVE` 或已改點成別的狀態），沒有點名紀錄但有請假就顯示 `ON_LEAVE`。
3. 只列**有紀錄的日期**，不枚舉整學期理論上課日再補空白列。
4. 每筆若對應到 `LeaveRequest`：
   - 有 `makeupRequest`：組出 `makeup` 欄位——`status` 直接用 `MakeupRequest.status`（`PENDING_ADMIN`／`APPROVED`／`REJECTED`）；`label` 依 `type` 組字串，`INSERTION` 用 `targetClass.name` + `targetDate`，`ONE_ON_ONE` 用 `teacher.user.name` + `slotDate`/`slotStartTime`-`slotEndTime`。
   - 沒有 `makeupRequest`（請假了但還沒安排補課）：`makeup: null`。前端看到 `status === 'ON_LEAVE' && makeup === null` 就顯示「尚未安排」（灰階文案），不需要新增 enum 值。
   - `status !== 'ON_LEAVE'` 的列（出席／遲到／早退／缺席未請假／未報名）一律 `makeup: null`，前端該欄顯示「—」。
5. 依學生分組回傳，每組內 `records` 新到舊排序。

### API（新）

`GET /api/classes/[id]/attendance-overview`：
- 權限：`session.user.role === 'ADMIN'`，或 `role === 'TEACHER'` 且該班 `teacherId` 等於自己（查一次 `class.teacherId`）。
- 回 `getClassAttendanceOverview(classId)`。

### 畫面（新頁面）

兩個角色共用同一個頁面元件（例如 `src/components/ClassAttendanceOverview.tsx`），各自一層薄薄的 route 包起來：
- `src/app/teacher/classes/[id]/attendance/page.tsx`
- `src/app/admin/classes/[id]/attendance/page.tsx`

頁面內容：
- 頂部：班級名稱＋科目/級別/時段/老師（比照現有班級資訊呈現方式），一個「返回」連結。
- 每個學生一個區塊，**預設全部收合**：收合狀態只顯示學生姓名（可以附一個小提示，例如有「尚未安排」的補課筆數就標個提示色小字，方便老師掃視誰需要處理）；點擊展開才顯示完整表格（日期／狀態／補課狀態，新到舊）。這是**學生層級的收合**（accordion，用簡單的 per-student expanded state 或原生 `<details>`），跟現有 `CollapsibleDataTable` 的「同一張表超過 3 筆才收合多餘列」是不同機制，這裡不套用 `CollapsibleDataTable`。
- 狀態欄位沿用既有 `StatusBadge`／既有色彩慣例：出席綠、遲到早退橘、請假藍（`assigned` 色系）、缺席未請假紅、未報名灰。
- 補課狀態欄位（只有 `ON_LEAVE` 列才有值）：尚未安排（灰階）／待確認（橘）／已核准＋補課去向（綠）／已拒絕（紅）。

### 入口

- 老師端：`TeacherClassList.tsx` 的「學生名單」彈窗加一顆「查看出缺勤」按鈕，連到 `/teacher/classes/[id]/attendance`。
- 行政端：`/admin/classes` 班級列表每列（或編輯彈窗）加同樣入口，連到 `/admin/classes/[id]/attendance`。

### 測試

- `getClassAttendanceOverview`：正常出席／請假無補課／請假已核准插班／請假已核准一對一／缺席未請假／未報名，各自組出正確的 `status`／`makeup` 欄位；多學生分組正確；日期新到舊排序正確。
- API 權限：ADMIN 可查任何班；TEACHER 是該班老師可查；TEACHER 不是該班老師回 403；未登入回 403。

### 不做的事

- 不枚舉「理論上課日但完全沒紀錄」的空白列。
- 不在這個頁面提供編輯/點名功能（純檢視，點名還是走既有的 `/teacher/attendance` 或 `/admin/attendance`）。
- 不含個別輔導／弈廳／活動——這次只做「班級」，其他到場類型如果之後也要類似總表，另外開需求。
