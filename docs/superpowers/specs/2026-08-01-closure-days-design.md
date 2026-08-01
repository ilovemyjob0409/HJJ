# 停課日（國定假日／颱風假）設計

日期：2026-08-01
狀態：已與使用者確認

## 目標

讓系統知道「哪些日子全教室停課」（國定假日、颱風假、臨時休館），並在點名、掃碼、排課、續報等所有日期相關介面正確反映，避免行政與家長在停課日誤操作。

## 非目標

- 不自動匯入政府行事曆（國定假日由行政手動建立；颱風假本來就只能手動）
- 不做班級層級的停課例外（已確認全教室統一停課）
- 不自動處理停課日上的弈廳場次與活動（僅列出提醒，行政自行處理）
- 不回溯清理既有的 NOT_REGISTERED 預標記（無害：當天不上課也不扣堂）

## 資料模型

```prisma
model ClosureDay {
  id        String   @id @default(cuid())
  date      DateTime @unique   // 日期（UTC 午夜，同既有日期慣例）
  name      String             // 例如「中秋節」「颱風假」
  createdAt DateTime @default(now())
}
```

需要一次 schema migration（正式站需跑 SQL）。

## 行為規格

### 1. 點名頁（AttendanceHub）

- `listAttendanceSessionsForDate` 查到該日為停課日時，回傳 `{ closure: { name }, sessions: [] }`
- 前端顯示「今日停課（名稱）」橫幅（日期＋（星期）格式沿用 `formatDateWithWeekday`），不列任何班級／一對一／弈廳／活動
- API 回傳形狀改變：原本直接回陣列，改為物件包裝；點名頁同步調整

### 2. 掃碼報到（kiosk）

- `checkInByStudentNumber` / `resolveCheckIn` 在停課日直接回新結果型別 `CLOSED`（含停課名稱），不寫任何出勤紀錄
- kiosk 顯示「今日停課（名稱）」，紅色 X 樣式同其他失敗結果

### 3. 擋新增（選到停課日一律報錯）

| 介面 | 錯誤碼 | 提示 |
|---|---|---|
| 代辦請假／補課：請假日期 | `CLOSED_DAY` | 該日停課（名稱），無需請假 |
| 插班日期、一對一時段 | `CLOSED_DAY` | 該日停課（名稱），無法排課 |
| 家長請假、家長申請補課 | `CLOSED_DAY` | 同上 |
| 弈廳開場次 | `CLOSED_DAY` | 同上 |

服務層驗證（單一 helper `assertNotClosureDay(date)`），前端加對應錯誤訊息。

### 4. 續報的未報名日期清單

- 產生日期時跳過停課日並往後遞補（報 16 堂仍列出 16 個實際上課日）
- 清單旁註記跳過的停課日（例如「已跳過 9/29（二）中秋節」）
- 需要 `GET /api/closure-days?from=&to=`（ADMIN）供前端過濾；日期產生邏輯維持前端

### 5. 停課日管理（入口：點名頁頂部收合卡片）

- 「停課日」卡片，預設收合（沿用現有展開／收合 pattern）
- 列表：未來的停課日（日期＋（星期）＋名稱＋刪除）
- 新增：日期＋名稱 → 先查衝突 → 有衝突時彈確認視窗 → 確認後建立
- API：`GET/POST/DELETE /api/closure-days`（ADMIN only）

### 6. 新增時的衝突處理（颱風假情境）

- `GET /api/closure-days/conflicts?date=` 回傳當天：
  - 已核准的插班／一對一補課（學生、時段）→ 可自動處理
  - 弈廳場次、進行中活動 → 僅列出提醒
- 確認視窗列出全部衝突；按「確認停課並取消補課」→ 建立停課日＋逐筆撤銷補課，撤銷走現有 `revokeMakeup`（沿用 LINE「補課已取消…請洽行政人員」通知；LINE 推播在交易外逐筆送，與現行撤銷一致）
- 弈廳／活動不自動動，視窗內文字提醒行政自行處理

## 測試重點

- ClosureDay CRUD 與 date unique
- listAttendanceSessionsForDate 停課日回 closure＋空 sessions
- 掃碼停課日回 CLOSED、不寫紀錄
- 各排課入口停課日擋下（CLOSED_DAY）
- 續報日期產生跳過停課日且總數不減
- 衝突查詢＋確認後撤銷＋通知（mock LINE）
- 非停課日行為全部不變（回歸）

## 部署注意

- 需跑 migration SQL（新表），依既有流程：本機驗證 → 正式站跑 SQL → push 部署
