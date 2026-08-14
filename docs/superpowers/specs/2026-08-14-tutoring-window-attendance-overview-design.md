# 個別輔導出缺勤總表（依時段、依學生分組）

日期：2026-08-14
狀態：使用者已核准設計

## 需求

比照 [2026-08-13-class-attendance-overview-design.md](2026-08-13-class-attendance-overview-design.md)（班級出缺勤總表），個別輔導也要有同樣性質的畫面：依學生分組的完整歷史（不是逐日點名）。行政、老師都要能看。

## 現況

- 個別輔導沒有像 `Class` 那樣固定的「一個班」單位。結構是 `TutoringProgram`（課程，如「英文個別輔導」）底下掛多個 `TutoringWindow`（時段，如「PLUS 週一 17:00-21:00」），每個時段才有自己的 `teacherId`／`teacherId2`。`TutoringEnrollment`（學生報名某課程）不綁時段，實際上課紀錄靠 `TutoringBooking`（某時段＋某日期）；`TutoringBooking` 與 `TutoringAttendance` 是 1:1（有點名才有這筆）。
- 老師端目前**完全沒有**個別輔導相關頁面或導覽連結（`src/app/teacher/page.tsx` 的「被指派代課／一對一補課」是 `MakeupType.ONE_ON_ONE`，屬於班級請假補課系統，跟這裡的 `TutoringWindow` 是兩回事，不要混用）。
- 行政端 `/admin/tutoring`（`EnrollmentManager.tsx` 掛在下面）目前每個時段列（`page.tsx` 內 `program.windows.map(...)`）只有「編輯／停用／刪除」，沒有查看功能。

## 設計

### 單位與範圍

以 `TutoringWindow` 為單位（比照班級版以 `Class` 為單位）。老師只能看自己是 `teacherId` 或 `teacherId2` 的時段；行政能看任何時段。

### 資料層（新）

`src/lib/services/attendanceService.ts` 新增（緊接 `getClassAttendanceOverview` 之後）：

```ts
export interface TutoringWindowOverviewRecord {
  date: Date;
  attendanceStatus: AttendanceStatusValue | null; // 有 TutoringAttendance 才有值
  bookingStatus: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED'; // 沿用既有寫法（見 tutoringBookingService.ts），不另外取型別名稱
  checkInTime: string | null;
  checkOutTime: string | null;
  isMakeup: boolean; // booking.kind === 'MAKEUP'
}
export interface TutoringWindowOverviewStudent {
  studentId: string;
  studentName: string;
  records: TutoringWindowOverviewRecord[]; // 新到舊
}

export async function getTutoringWindowAttendanceOverview(windowId: string): Promise<TutoringWindowOverviewStudent[]>
```

查詢邏輯（比班級版單純，因為 booking 與 attendance 是 1:1，不必合併兩個獨立表）：

1. 撈 `TutoringBooking.findMany({ where: { windowId } })`，`include` 對應的 `enrollment.studentId`／`enrollment.student.user.name`／`attendance`。**不排除未來日期**——學生提前預約未來場次是有意義的行為（不是預寫髒資料），未來場次照樣排進清單，天然排在新到舊排序的最上面。
2. 每筆 booking 一列（不用像班級版按「日期」去重合併，因為一個 booking 本身就是一筆完整、不會跟別的來源撞的紀錄）：
   - `attendanceStatus`：有 `booking.attendance` 就填其 `status`，否則 `null`。
   - `bookingStatus`：`booking.status` 原樣帶出。
   - `isMakeup`：`booking.kind === 'MAKEUP'`。
3. 依 `enrollment.studentId` 分組（同一學生若換過報名紀錄也不會分裂，因為 booking 本身就綁著 enrollment）；組內按 `date` 新到舊排序。
4. 不從 `TutoringEnrollment` 出發撈「目前報名學生」再補空清單——沒有任何 booking 的學生不會出現在總表（跟班級版「已加入但沒紀錄的學生仍顯示空清單」不同，這裡改成沒 booking 就不佔一個區塊，避免每次新開時段都要看一堆空的學生卡片）。時段完全沒有任何 booking 時，`students` 回傳空陣列，畫面顯示「目前沒有預約紀錄」（沿用班級版「目前沒有學生」的位置，但文案改成對應「沒有 booking」而不是「沒有學生」）。

### API（新）

`GET /api/tutoring-windows/[id]/attendance-overview`：
- 權限：`ADMIN` 全通；`TEACHER` 需查一次 `window.teacherId`／`window.teacherId2`，等於自己才放行，否則 403；其餘（含未登入、`STUDENT`）403。
- 找不到時段回 404。
- 回傳 `{ window: { id, weekday, startTime, endTime, programName, teacherName, teacherName2: string | null }, students: getTutoringWindowAttendanceOverview(windowId) }`。

### 畫面（新元件＋新頁面）

新共用元件 `src/components/TutoringWindowAttendanceOverview.tsx`（結構比照 `ClassAttendanceOverview.tsx`：每位學生一個 `<Card>` 包 `<details className="group">`，預設收合，`StatusBadge`／`overflow-x-auto` 表格慣例都沿用），但狀態欄只有一欄（不像班級版分「狀態」＋「補課狀態」兩欄，因為個別輔導的補課是同一張表裡的另一筆 booking，不是外掛欄位）：

- 表格欄位：日期／狀態／類型。「狀態」直接 `<StatusBadge status={r.attendanceStatus ?? r.bookingStatus} />`——`StatusBadge` 已經內建 `BOOKED`／`CANCELLED`／`CANCELLED_LATE`／`PENDING_ADMIN`／`REJECTED` 五種樣式（`src/components/ui/StatusBadge.tsx` 原本就是為個別輔導預約狀態做的），不用另外造「已約，尚未到」之類的自訂字串。「類型」欄：`isMakeup` 為真顯示「補課」小標籤，否則「—」。
- 收合摘要行：算 `pendingCount = records.filter(r => r.bookingStatus === 'BOOKED' && r.attendanceStatus === null && date <= 今天).length`，>0 時顯示「N 筆待點名」提示色小字（比照班級版「N 筆待安排補課」的位置與樣式）。
- 頂部：時段資訊（課程名稱・週幾・時間・老師／副老師）＋返回連結。

頁面：
- `src/app/admin/tutoring/windows/[id]/attendance/page.tsx`
- `src/app/teacher/tutoring/windows/[id]/attendance/page.tsx`

（路由刻意帶 `windows` 這一段，跟 `/admin/tutoring`〔課程列表〕、未來若有的 `/admin/tutoring/[programId]` 區隔開，避免歧義。）

### 入口

- **行政端**：`src/app/admin/tutoring/page.tsx` 的時段列（`program.windows.map` 非編輯狀態的那個 `<div>`，`編輯`／`停用`／`刪除` 按鈕那排）加一顆「查看出缺勤」按鈕，連到 `/admin/tutoring/windows/${window.id}/attendance`。
- **老師端**：
  - `src/lib/services/tutoringProgramService.ts` 新增 `listWindowsForTeacher(teacherId: string)`：查 `TutoringWindow.findMany({ where: { OR: [{ teacherId }, { teacherId2: teacherId }] } })`，含 `program.name`。
  - 新元件 `src/components/TeacherTutoringWindowList.tsx`（卡片列表，樣式比照 `TeacherClassList.tsx`），每張卡「課程名稱・週幾・時間」＋一顆「查看出缺勤 →」連結；沒有時段時顯示「目前沒有個別輔導時段」。
  - `src/app/teacher/page.tsx` 在「我的帶班班級」區塊後面加一個新區塊「我的個別輔導時段」，掛 `TeacherTutoringWindowList`（伺服器端呼叫 `listWindowsForTeacher(teacher.id)`，跟現有 `listClassesForTeacher` 同一種資料抓取模式）。

### 測試

- `getTutoringWindowAttendanceOverview`：一般已點名（出席/遲到/早退/請假/缺席/未報名）、`BOOKED` 未來場次無點名紀錄、`BOOKED` 過去場次無點名紀錄（待點名）、`CANCELLED`、`CANCELLED_LATE`、補課 booking（`kind: MAKEUP`）的 `isMakeup` 正確、多學生分組正確、沒有任何 booking 的時段回空陣列、日期新到舊排序正確（含未來排最上面）。
- API 權限：`ADMIN` 可查任何時段；`TEACHER` 是 `teacherId` 可查；`TEACHER` 是 `teacherId2` 可查；`TEACHER` 兩者都不是回 403；未登入回 403；`STUDENT` 回 403；時段不存在回 404。
- `listWindowsForTeacher`：只回自己是主/副老師的時段，不含別人的。

### 不做的事

- 不枚舉「理論上可以約但沒人約」的空白列。
- 不在這頁提供點名/編輯功能，純檢視。
- 不做課程（Program）層級的彙總視圖——如果之後要看「整個課程、跨所有時段」的總表，是另一個需求。
- 不特別處理 `makeupForId`/`makeupChild` 之間的關聯連結（例如點補課列跳去原始被取消的那堂）——`isMakeup` 標籤已經足夠說明「這是一筆補課」，不做更深的追溯 UI。
