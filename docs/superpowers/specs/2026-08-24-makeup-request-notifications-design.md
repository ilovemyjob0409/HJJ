# 補課申請通知（四情境）設計

日期：2026-08-24
狀態：已與使用者定案
前置依賴：[2026-08-24-notification-center-design.md](2026-08-24-notification-center-design.md)（通知中心——本篇所有通知一律走統一入口 `notifyUser`／`notifyAdmins`＝推播＋收件夾）

## 背景

班級補課申請（`MakeupRequest`，掛在 `LeaveRequest` 之下）現有通知：學生送出（PENDING_ADMIN）→ 推播行政；核准／駁回／撤銷 → 推播家長（一對一另通知被指派老師）。使用者選定補上四個情境。

## 四個情境（已定案）

### ① 補課前一天提醒家長

- 每天台北 09:00（每日 cron）檢查**明天**（台北日）的已核准補課：
  - `INSERTION`：`targetDate` = 明天
  - `ONE_ON_ONE`：`slotDate` = 明天
- 對該請假單學生的家長帳號 `notifyUser`：「明天 M/D（週N）有《班名》補課，請準時出席」（一對一顯示「一對一補課（HH:mm–HH:mm）」）。
- `cancelRequestedAt` 已填（家長申請撤銷、行政未確認）者**照提醒**——行政確認前補課仍有效（既有規則）。

### ② 缺課 3 天未申請補課提醒

- 每天台北 09:00 檢查：`LeaveRequest.status = APPROVED`、`date`（缺課日）＝**3 天前**（台北日）、**沒有任何 `makeupRequest`** 的請假單。
- 對家長 `notifyUser`：「M/D（週N）《班名》缺課尚未申請補課，請至系統安排」，url 指向 `/student/makeup-request`。
- 「date 恰好等於 3 天前」的選法天然只提醒一次，不需要 schema 加已提醒欄位；當天推播失敗不重試（與既有提醒慣例一致）。
- 已有補課申請（不論狀態，含 REJECTED）不提醒——被駁回代表行政已裁定，不再催。

### ③ 插班補課通知目標班級老師

- 修改 `notifyMakeup`（核准／撤銷共用的通知函式）：`type = INSERTION` 且有 `targetClass` 時，除家長外**另通知目標班級老師**（`targetClass.teacher.userId`）：
  - `APPROVED`：「M/D（週N）補課學生 XXX 將加入《班名》」
  - `REVOKED`：「M/D（週N）補課學生 XXX 取消加入《班名》」
- **駁回不通知老師**——老師從未被告知這筆申請存在（沿用 2026-08-24 超額審核定下的「老師只收確定成立的通知」原則）。
- 一對一的被指派老師通知維持現狀不動。

### ④ 行政待審件每日彙總

- 每天台北 09:00：
  - 待審補課申請數 N＝`MakeupRequest.status = PENDING_ADMIN` 且 `createdAt` < 現在 − 24 小時
  - 待確認撤銷數 M＝`status = APPROVED` 且 `cancelRequestedAt` 非 null（不設 24 小時門檻，撤銷本來就該儘快處理）
- N＋M > 0 時 `notifyAdmins` **一則彙總**：「有 N 件補課申請待審核」（M > 0 時加「，另有 M 件撤銷申請待確認」；N = 0 只有 M 時只講撤銷），url 指向 `/admin/makeup-requests`。
- 每天最多一則，直到清空為止；不逐件推播（送出當下已各推過一次）。

## Cron 整併（Vercel 免費方案上限 2 個 cron，目前已用滿）

- 新增總路由 `GET /api/cron/daily-reminders`（`CRON_SECRET` Bearer 驗證，沿用現有 cron route pattern），依序執行並彙整結果回傳：
  1. `sendMissedSessionReminders()`（既有：個輔昨日未到提醒）
  2. 情境①（補課前一天提醒）
  3. 情境②（缺課 3 天未申請提醒）
  4. 情境④（行政待審彙總）
  任一子任務失敗記 log 後繼續跑其餘子任務（互不影響），回應標明各子任務通知數。
- `vercel.json`：`/api/cron/tutoring-missed-session-reminder` 條目改為 `/api/cron/daily-reminders`（schedule 維持 `0 1 * * *`＝台北 09:00）；舊 route 檔刪除。`tutoring-quota-reminder`（每月 20 號）不動。總數維持 2。

## 服務層

- 新函式集中在 `makeupRequestService.ts`（情境①②④；③改既有 `notifyMakeup`）：
  - `sendMakeupDayBeforeReminders(now?: Date): Promise<{ notified: number }>`
  - `sendMakeupNotFiledReminders(now?: Date): Promise<{ notified: number }>`
  - `sendPendingMakeupDigest(now?: Date): Promise<{ notified: boolean }>`
  - `now` 可注入方便測試，cron 用預設值（沿用 `sendMissedSessionReminders` 慣例）。
- 家長帳號＝`leaveRequest.student.user`；日期一律 UTC 日曆日、「今天／明天」以台北換算（`taipeiDateKey`）；顯示用 `formatDateWithWeekday`。

## 測試

- ①：明天有插班／一對一補課各通知一次；今天／後天不通知；REJECTED／PENDING 不通知；cancelRequestedAt 已填照通知。
- ②：缺課日恰為 3 天前且無申請 → 通知；2 天前／4 天前不通知；已有申請（含 REJECTED）不通知。
- ③：INSERTION 核准／撤銷 → 目標班老師收到；駁回不通知老師；一對一路徑不受影響。
- ④：超過 24 小時待審 2 件＋撤銷 1 件 → 一則彙總文案正確；全部 0 件不發；剛送出（<24h）不計。
- cron route：無／錯誤 Bearer 403；子任務其一拋錯其餘照跑。
