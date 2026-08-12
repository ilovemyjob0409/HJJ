# 個別輔導預約日曆：已約日期標示＋按掉取消＋取消留紀錄

日期：2026-08-12
狀態：使用者已核准設計

## 需求

1. 預約日曆（行政「新增預約」彈窗與學生端共用 `TutoringBookingCalendar`）上，這位學生**自己已預約的日期要用不同顏色標示**，方便看出已約哪些天、要改哪些天。
2. 點已約日期＝**取消該天預約**（按掉），確認後即取消，日曆即時刷新。
3. **提前取消要留紀錄**：學生端預約紀錄要多出一條「已取消」紀錄（現況提前取消是直接刪除資料、不留痕跡）。

## 現況

- 日曆資料來源 `listAvailability(enrollmentId, days)` 只回每天 `{date, windowId, capacity, remaining}`，不含本人已約資訊。
- 取消：`cancelBooking`（學生）提前取消＝`delete`；當天取消＝`CANCELLED_LATE`（計次）。`adminCancelBooking(countsTowardQuota)`：false＝`delete`、true＝`CANCELLED_LATE`。
- `TutoringBookingStatus` enum：`PENDING_ADMIN / BOOKED / CANCELLED_LATE / REJECTED`，沒有「提前取消」狀態。

## 設計

### Schema

`TutoringBookingStatus` 新增 `CANCELLED`（提前取消、不計次、留紀錄）。
正式站需跑：`ALTER TYPE "TutoringBookingStatus" ADD VALUE 'CANCELLED';`

### Service（tutoringBookingService）

- `cancelBooking`：提前取消改為 `update status: 'CANCELLED'`（原本是 delete）；當天取消照舊 `CANCELLED_LATE`。
- `adminCancelBooking`：`countsTowardQuota=false` 改為 `update status: 'CANCELLED'`（原本是 delete）；true 照舊。
- `listAvailability`：一次撈該報名在範圍內 `status in [BOOKED, PENDING_ADMIN]` 的預約，`AvailabilityDay` 新增 `myBookingId`、`myBookingStatus`（同日多筆時優先 BOOKED）。
- `getMonthlyQuotaStatus`：**排除 `CANCELLED`**（否則取消的預約日期一過就被誤算成 locked 已用額度）。
- `getTutoringDeductionLedger`：同上，計算扣堂時**排除 `CANCELLED`**。
- 其餘查詢已是白名單（容量、點名名單、kiosk 都只算 `BOOKED`／`PENDING_ADMIN`），不受影響；`listMissedBookingsForEnrollment` 只認 `CANCELLED_LATE`／缺席，`CANCELLED` 不會產生補課資格（正確）。
- `listBookingsForStudent`：`CANCELLED` 列會自然出現在學生預約紀錄（需求 3）；`canCancelFree`／`canRequestMakeup` 對 `CANCELLED` 必為 false。
- `listBookingsOverview`（行政預約列表）：`CANCELLED` 列照常顯示、掛「已取消」徽章。

### UI

- `TutoringBookingCalendar`：
  - 新格子狀態「已約」：`bg-pendingBg text-pending`＋「已約」字樣（與綠色可約、灰色已滿、黃色已選區隔）。
  - 一般模式點「已約」格＝取消流程：`useConfirm` 確認 → `DELETE /api/tutoring-bookings/[id]`（body 帶 `countsTowardQuota:false`，行政端即免計次；學生端 API 本來就走學生取消規則）。台北「今天」的預約套用當天取消警語（會計次）。
  - `PENDING_ADMIN`（補課待核准）只顯示「已約」不可按掉，回列表處理。
  - 補課模式下已約日期同樣顯示且不可點。
  - 新增 `onCancelled` callback：學生端刷新預約紀錄；行政端刷新父列表但**不關閉彈窗**。
- `StatusBadge`：新增 `CANCELLED: 已取消`（灰階）。
- 學生端／行政端預約列表的 status union 加 `CANCELLED`。

### 測試

- 提前取消 → 紀錄保留、狀態 `CANCELLED`；當天取消照舊 `CANCELLED_LATE`。
- 行政免計次取消 → `CANCELLED`；計次 → `CANCELLED_LATE`。
- `getMonthlyQuotaStatus`／`getTutoringDeductionLedger` 不把過期的 `CANCELLED` 算進已用。
- `listAvailability` 正確標記本人已約日（含 `PENDING_ADMIN`），容量不受 `CANCELLED` 影響。
- 既有斷言「提前取消＝刪除」的測試改為斷言留下 `CANCELLED`。

### 上線順序

先在正式站跑 enum SQL，再部署程式（避免新程式寫入 `CANCELLED` 時 enum 不存在）。
