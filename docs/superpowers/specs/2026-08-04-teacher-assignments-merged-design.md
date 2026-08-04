# 老師首頁「被指派代課／一對一補課」合併區塊 — 設計文件

日期：2026-08-04
狀態：已與使用者確認（視覺稿已核可）

## 問題

行政指派一對一補課後（`MakeupRequest` type=ONE_ON_ONE 帶 teacherId／slotDate／slot 時段），老師事前完全看不到：首頁沒有一對一區塊、無通知；只有當天才會出現在「今日點名」。

## 方案（使用者選定）

把現有「被指派代課」區塊改為「**被指派代課／一對一補課**」單一表格，用「類型」欄位區分。

## 表格規格

| 欄位 | 代課 | 一對一補課 |
|---|---|---|
| 類型 | 藍底徽章「代課」（assigned 色票） | 灰底徽章「一對一補課」（stripe 色票） |
| 日期 | `formatDateWithWeekday`；台北當日加「今天」brand 徽章 | 同左（slotDate） |
| 時間 | 班級 startTime–endTime | slotStartTime–slotEndTime |
| 班級 | 代課班級 | 原班級（leaveRequest.class） |
| 對象 | 原老師姓名＋muted 小字「（原老師・原因）」 | 學生姓名 |
| 狀態 | StatusBadge | StatusBadge（PENDING_ADMIN／APPROVED） |

- 範圍：兩種都只列**今天（含）以後**（沿用全站 `setHours(0,0,0,0)` 邊界）；依日期升冪、同日依開始時間。
- 一對一含「待確認」（PENDING_ADMIN）——時段建立時即為老師保留（SLOT_CONFLICT 檢查含 PENDING），先讓老師看到。
- 空狀態：「目前沒有被指派的工作」（DataTable 現有空狀態機制）。
- 「今天」判定用台北日曆日（日期慣例：儲存為 UTC 日曆日、「今天」用台北）。

## 實作

1. `substituteRequestService.listAssignedSubstituteRequestsForTeacher`：加 `date >= today` 過濾、select 班級 startTime/endTime、改 orderBy asc（僅老師首頁使用，無其他呼叫點）。
2. `makeupRequestService.listAssignedOneOnOneForTeacher(teacherId)`：新函式，type=ONE_ON_ONE、teacherId、status in (PENDING_ADMIN, APPROVED)、slotDate >= today；帶學生姓名與原班級名。
3. `dateFormat.isTodayTaipei(date)`：UTC 日曆日 vs 台北今天（en-CA 格式比對）。
4. `teacher/page.tsx`：合併兩來源成單一列陣列排序後渲染；移除舊「被指派代課」表格。

## 不做（YAGNI）

- LINE 通知老師被指派（另案）。
- 歷史紀錄（點名／出席已涵蓋）。
- 學生插班紀錄區塊不動。

## 測試

- service 測試：一對一列表（過濾他人／過去／REJECTED；排序）；代課列表（過去不出現、含班級時間）。
- `isTodayTaipei`：fake timer 設 UTC 18:00（台北已跨日）驗證邊界。
- 瀏覽器實測老師帳號首頁（手機＋桌機）。
