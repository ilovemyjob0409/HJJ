# 尖峰負載優化（免升級版）設計

日期：2026-08-26
狀態：已與使用者定案（2026-08-26 壅塞事故的免費止血包第二彈；第一彈＝推播非同步化已上線）
背景：[[project-production-congestion-analysis]]——兩次全站壅塞都是尖峰時段 DB 連線被打滿。DATABASE_URL 已確認走 pooler（無紅利）。本篇拿掉三個最大的免費浪費源。

## 範圍（三項，皆不改行為、只降查詢量）

### ① `listEnrollments` 額度計算批次化（`tutoringProgramService.ts`）

- 現況：每筆報名各呼叫一次 `getMonthlyQuotaStatus`（每次 2 個查詢：enrollment findUnique＋bookings findMany）。學生首頁 ×N 報名；**行政個輔頁列全部報名 → 2N 個查詢**（N=學生總數等級）。
- 改法：enrollments 查詢的 `program` select 加 `defaultMonthlyQuota`；一次 `tutoringBooking.findMany({ where: { enrollmentId: { in: ids }, kind: 'REGULAR', date: 當月範圍 } })` 撈全部，JS 端按 enrollmentId 分組計算。
- **口徑單一來源（超額審核的教訓）**：把 `getMonthlyQuotaStatus` 的分類迴圈抽成純函式 `classifyQuotaBookings(bookings, todayKey)`（同檔 export），`getMonthlyQuotaStatus` 與批次路徑共用——分類邏輯永遠只有一份。
- 查詢量：2N＋1 → 2（enrollments＋bookings）。

### ② `listStudentEnrolledClasses` 堂數批次化（`classService.ts`）

- 現況：每班各呼叫 `getClassEnrollmentQuota`（2 查詢：enrollment findUniqueOrThrow＋attendance count）。
- 改法：一次 `classEnrollment.findMany({ where: { studentId, classId: { in: ids } } })`＋一次 `classAttendance.groupBy({ by: ['classId'], where: { studentId, classId: { in: ids }, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } }, _count: { _all: true } })`，JS 端組回每班 `{ totalSessions, usedSessions, remaining }`。
- 扣堂語意（請假、未報名不扣）與 `getClassEnrollmentQuota` 完全一致；`getClassEnrollmentQuota` 本身保留（其他呼叫點不動）。
- 查詢量：2N＋1 → 3。

### ③ `NotificationBell` visibilitychange 節流

- 現況：每次切回分頁就重抓 `/api/notifications`（2 查詢），家長頻繁切換時是尖峰的瑣碎查詢源。
- 改法：記錄上次載入時間，`visibilitychange` 觸發時 60 秒內不重抓。掛載與打開面板的載入**不變**（打開面板永遠拿最新）。

## 不變的行為保證

- ①②回傳形狀與數值逐位不變（既有測試就是證明；①另加「批次結果＝逐筆 getMonthlyQuotaStatus 結果」的對照測試）。
- ③只影響背景徽章刷新頻率；打開面板即時性不變。
- 不改 schema、無正式 SQL、無 API 介面變更。

## 測試

- ①：多筆報名（不同 locked/upcoming/pendingOverQuota 組合）下 `listEnrollments` 每欄位與逐筆 `getMonthlyQuotaStatus` 相等；既有測試全綠。
- ②：多班（有/無 totalSessions、含 ON_LEAVE/NOT_REGISTERED 點名）下 quota 與逐筆 `getClassEnrollmentQuota` 相等；既有測試全綠。
- ③：無單元測試（元件慣例），tsc/eslint/build＋全量綠。
