# 過期報名紀錄不可取消

日期：2026-08-03
範圍：弈廳（GoHall）＋活動專區（Activity）
狀態：設計已確認

## 問題

學生端「我的報名紀錄」會列出所有報名（含已過期場次／已結束活動），且「取消」
按鈕與 DELETE API 都沒有過期檢查——學生可以取消已經發生過的報名，破壞出席
與歷史紀錄的正確性。

## 過期定義（沿用既有「開放中」分界）

- 弈廳場次：`session.date < 今天 00:00`（與 `listOpenSessionsForStudent`
  的 `date >= today` 互補；**當天場次仍可取消**）
- 活動：`activity.endDate < 今天 00:00`（與 `listOpenActivitiesForStudent`
  一致；**結束日當天仍可取消**）

## 伺服器端（真正的防線）

- `goHallService.cancelRegistration`：撈 registration 時連 session 一起撈，
  過期即丟 `SESSION_EXPIRED`；route 既有錯誤處理將其轉為 HTTP 400。
- `activityService.cancelRegistration`：同樣邏輯，丟 `ACTIVITY_ENDED`。
- **行政端不變**：`adminRemoveRegistration` 不加限制，行政保留糾錯能力。

## 前端

- 弈廳「我的報名紀錄」操作欄：過期列不顯示「取消」，改顯示灰字「已結束」。
- 活動詳情 modal：已結束活動將「取消報名」按鈕換成灰字「活動已結束」。
- 新增共用純函式 `isBeforeToday(date)`（`src/lib/`，附測試）供兩頁判斷。
- 學生端取消失敗的 toast 對 `SESSION_EXPIRED`／`ACTIVITY_ENDED` 顯示
  「這筆報名已過期，無法取消」。

## 測試

- `goHallService`：昨日場次取消 → 丟 `SESSION_EXPIRED`；今日／未來場次 → 可取消。
- `activityService`：`endDate` 昨日 → 丟 `ACTIVITY_ENDED`；今日結束 → 可取消。
- `isBeforeToday`：昨天 true／今天 false／明天 false。

## 不做的事

- 不改行政端移除報名的行為。
- 不改老師端（唯讀，無取消功能）。
- 不隱藏過期紀錄本身——歷史紀錄仍照常顯示。
