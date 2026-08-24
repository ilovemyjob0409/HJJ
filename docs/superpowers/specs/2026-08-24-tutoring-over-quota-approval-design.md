# 個別輔導超額預約審核（第 9 堂以上送審）設計

日期：2026-08-24
狀態：已與使用者定案

## 背景與範圍

- 個別輔導每月額度 8 堂（`enrollment.monthlyQuota ?? program.defaultMonthlyQuota`），目前額度**只有顯示與推播提醒**，`createBooking` 完全沒有在後端強制——學生實際上想約幾天就約幾天。
- 收費規範：「有預約且到場上課才扣堂」。未到、取消都不扣堂，額度自動釋放；學生當月內重約就是「補課」。若上月有課沒補到，家長會希望這個月約超過 8 堂補回來。
- 本次要做：**額度規則第一次在後端落地**——當月第 `quota+1` 堂（預設第 9 堂）以上的預約改為「送行政審核」，8 堂以內照舊直接成立。
- **預約範圍不變**：仍只開放當月（今天～本月底），暫不開放預約其他月份（使用者已明確縮小範圍，原本「開放約下個月」的想法不做）。

## 已定案的決策

1. **審核採純人工判斷**：不做「可補堂數」的自動權益計算，也不設硬上限——第 9、10、11 堂都能送，全部進審核，行政參考近月出席狀況自行判斷。
2. **行政代排與點名現場加入（walk-in）不送審**：直接建成 `BOOKED`。行政本人就是審核者；walk-in 是老師／行政現場確認＝已審核。
3. **待審預約學生可自行取消**（不計次），跟一般預約一致。
4. 待審預約照現況**佔當天名額**，駁回後釋放。

## 判斷規則（後端 `createBooking` 內強制）

- 計數基準（與現有 `getMonthlyQuotaStatus` 額度條一致，以預約日期所屬 UTC 月份計）：
  - **已計次**：當月 `kind: REGULAR`、非取消、有出席紀錄且非 `ABSENT` 的預約。
  - **有效預約**：當月今天（台北日）含以後、狀態 `BOOKED` 或 `PENDING_ADMIN` 的預約。
  - 取消（`CANCELLED`／`CANCELLED_LATE`）、過期未到（日期已過、無出席紀錄）不佔額度。
- 建立預約時，若「已計次＋有效預約」已達 quota → 新預約狀態建成 `PENDING_ADMIN`；未達 → 照舊 `BOOKED`。
- 判斷在既有 Serializable transaction 內進行，與同日重複、容量檢查一樣防並發。
- 既有防呆（星期、停開日、同日重複、容量、停用報名）全部照舊，順序在額度判斷之前。

## 資料模型

不改 schema。重用既有 `TutoringBooking.status` 的 `PENDING_ADMIN`／`REJECTED`；`kind` 維持 `REGULAR`（`MAKEUP` 為舊制遺留，不再產生）。

## 學生端

- 日曆多選送出後，API 回應標明每筆是 `BOOKED` 還是 `PENDING_ADMIN`；toast 顯示例如「已預約 3 天，其中 1 天超過本月額度，已送行政審核」。
- 日曆上待審日期顯示「待審」（沿用 pending 黃色系配色），**點擊可取消**：`PENDING_ADMIN` 一律開放本人取消（含歷史遺留資料，行為以 status 統一，不分新舊）。
- 額度條（`TutoringQuotaBar`）新增「超額待審 N 堂」段：`getMonthlyQuotaStatus` 增加回傳 `pendingOverQuota`（當月今天以後 `PENDING_ADMIN` 的筆數）。
- 審核結果推播通知學生（核准／未核准）。

## 行政端

- 在既有 `/admin/tutoring/bookings` 月曆總覽頁**頂部新增「待審核」佇列**（待處理佇列不收合，符合現有表格慣例）。每筆顯示：
  - 學生、課程、預約日期（含星期，`formatDateWithWeekday`）
  - 這筆是當月第幾堂
  - **近 3 個月額度使用參考**（每月已計次／有效預約堂數），供人工判斷是否真有未補的課。
- 操作：核准（→ `BOOKED`）／駁回（→ `REJECTED`），用 `useConfirm()` 確認。
- API：`PATCH /api/tutoring-bookings/[id]`，ADMIN 限定，body `{ action: 'approve' | 'reject' }`；僅允許 `PENDING_ADMIN` → `BOOKED`／`REJECTED` 的轉換，其他狀態回 409。

## 通知

- 超額預約送審成立 → 推播行政「需要審核」（符合 2026-08-20「行政只收需審核通知」慣例）；時段老師照舊收學生預約通知。
- 核准／駁回 → 推播該學生（`pushToUser`，url 指向 `/student/tutoring`）。
- 推播失敗只記 log，不影響主流程（沿用既有慣例）。

## 邊界情況

- **到了上課日還沒審**：待審預約照現況出現在老師點名名單；學生到場點名即計次（到場才扣堂不變）。行政事後核准／駁回不影響已發生的出席紀錄。
- 學生取消待審預約：走既有取消流程（`CANCELLED`、不計次、保留紀錄）。
- quota 為 per-enrollment 覆寫值時，門檻跟著該報名的 quota，不寫死 8。

## 測試

- 服務層：第 quota 堂 `BOOKED`／第 quota+1 堂 `PENDING_ADMIN` 的分界；取消與過期未到釋放額度後回到直接 `BOOKED`；行政代排與 walk-in 不送審；並發下不會兩筆同時以第 8 堂身分通過。
- API：`PATCH` 的權限（非 ADMIN 403）、狀態轉換限制（非 `PENDING_ADMIN` 回 409）、approve/reject 後狀態與通知。
- UI 相關服務：`getMonthlyQuotaStatus` 的 `pendingOverQuota` 計算。
