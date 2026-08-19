# 個別輔導：個別學生出缺勤 設計

日期：2026-08-19
狀態：已與使用者確認

## 背景與問題

個別輔導的出缺勤目前只有「時段」視角（`/admin/tutoring/windows/[id]/attendance`、老師首頁時段列表），
一個學生橫跨多個時段預約時，沒有任何地方能一次看完「這個學生」的完整出缺勤。

同時：

- 行政的學生報名管理列表（`EnrollmentManager`）每列只有右側小「編輯」鈕能開編輯彈窗，整列點擊沒作用。
- 學生端 `/student/tutoring` 的「我的預約紀錄」只有預約狀態，看不到出席結果（出席／請假／缺席、簽到時間）；
  「我的出席紀錄」（`/student/attendance`）只有已點名的紀錄，看不到已預約未上課的。

## 需求（已確認）

1. 行政在管理端能查個別學生的個別輔導出缺勤。
2. 學生（家長）登入後能看到自己完整的個別輔導出缺勤。
3. 行政可將個別學生出缺勤匯出成 Excel（.xlsx）。
4. 報名管理列表點「整列」就開編輯彈窗（不用瞄準小編輯鈕），出缺勤區塊放進這個彈窗。
5. 老師端本次不做（使用者未勾選）。

## 方案取捨

- **A（採用）：以「報名」（學生 × 課程）為單位補齊三端。** 一支共用服務＋API，行政端放進報名編輯彈窗、
  學生端擴充現有預約紀錄表。改動小、全部沿用既有慣例。
- B：獨立 `/admin/tutoring/students/[id]` 跨課程彙整頁——多一層導覽，且使用者已決定放編輯彈窗；不做。
  之後若需要「英文＋數學一頁看完」再加。
- C：時段總表加學生篩選——仍是時段視角，解決不了跨時段問題；不做。

已知取捨：編輯彈窗是「學生 × 課程」一筆報名，同時報英文＋數學的學生會分兩列各看各的，
與報名管理現有結構一致。

## 設計

### 服務層（`src/lib/services/attendanceService.ts`）

新增 `getTutoringEnrollmentAttendance(enrollmentId)`：

- 撈該報名**全部** `tutoringBooking`（含 `CANCELLED`／`CANCELLED_LATE`／`REJECTED`），
  每筆帶：日期、預約狀態、出席狀態（可為 null）、簽到／簽退時間、是否補課（`kind === 'MAKEUP'`）。
- 依日期新→舊排序。
- record 形狀比照 `getTutoringWindowAttendanceOverview` 的 `TutoringWindowOverviewRecord`。
- 找不到報名時丟 `ENROLLMENT_NOT_FOUND`。

### API（`GET /api/tutoring-enrollments/[id]/attendance`）

- ADMIN：可查任何報名。
- STUDENT：只能查自己的報名，別人的回 404（`ENROLLMENT_NOT_FOUND`），權限寫法比照同目錄 `ledger/route.ts`。
- 其他角色（含 TEACHER）：403。
- 回傳：`{ studentName, programName, records }`。

### 行政端（`src/app/admin/tutoring/EnrollmentManager.tsx`）

1. 報名列表 `CollapsibleDataTable` 加 `onRowClick` → `setEditingEnrollment(row)`；移除「操作／編輯」欄。
2. 編輯彈窗內新增「出缺勤紀錄」區塊：
   - `CollapsibleDataTable` `maxRows={3}`（紀錄類，符合全站收合慣例）。
   - 欄位：日期（星期，`formatDateWithWeekday`）／狀態（有點名顯示出席徽章、沒點名顯示預約徽章，
     即 `StatusBadge status={attendanceStatus ?? bookingStatus}`）／類型（一般／補課）／簽到／簽退。
   - 彈窗開啟時 fetch 上述 API，載入中顯示骨架屏（比照 `TutoringDeductionLedgerModal`）。
3. 區塊標題旁放 `ExportExcelButton`：
   - 檔名 `個別輔導出缺勤_{學生名}_{課程名}`（元件自動加日期與副檔名）。
   - 欄位同表格，狀態轉純文字中文標籤（用 `StatusBadge.tsx` 現成匯出的 `getStatusBadgeConfig().label`）。

### 學生端（`/student/tutoring` 我的預約紀錄）

- `listBookingsForStudent`（`tutoringBookingService.ts`）加回 `attendanceStatus`、`checkInTime`、`checkOutTime`。
- 表格加「出席」欄：有點名顯示出席徽章，未點名顯示 `-`；簽到／簽退欄一併顯示。
- 匯出鈕只放行政端，學生端不放。

### 測試

- 服務層：含取消紀錄、含未點名紀錄、排序（新→舊）、`ENROLLMENT_NOT_FOUND`。
- API：ADMIN 通過；STUDENT 看自己的通過；STUDENT 看別人的 404；TEACHER／未登入 403。
- `listBookingsForStudent`：新欄位（有出席紀錄帶狀態、無出席紀錄為 null）。

### 不做的事（YAGNI）

- 老師端入口。
- 跨課程彙整頁。
- 學生端匯出。
- 出缺勤區塊內直接改點名（點名仍走時段出缺勤總表／點名頁）。
