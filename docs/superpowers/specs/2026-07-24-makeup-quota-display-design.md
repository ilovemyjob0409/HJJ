# 補課名額規則調整與剩餘次數顯示 — 設計文件

日期：2026-07-24

## 背景與目標

原本一對一補課的名額規則是「每季限一次」（見 [2026-07-14 補課系統設計](2026-07-14-tutoring-makeup-system-design.md) 流程二.B）。現調整為：

- 本季（自然季：1-3月／4-6月／7-9月／10-12月）**總名額 2 次**，插班與一對一合計計算
- 一對一在總名額內**最多只能用 1 次**（不是額外加成的名額）

並在學生選好要補課的請假紀錄後，直接顯示插班／一對一各自的剩餘次數，名額用完時 disable 該選項，避免學生填完表單才被後端拒絕。

## 名額計算規則

- 計入名額的申請：`status` 為 `PENDING_ADMIN` 或 `APPROVED`（`REJECTED` 不佔名額，被拒絕後名額釋放，與原規則一致）
- `totalUsed` = 該學生本季（依 `createdAt`）插班 + 一對一申請數量
- `oneOnOneUsed` = 該學生本季一對一申請數量
- `totalRemaining` = max(0, 2 − totalUsed)
- `oneOnOneRemaining` = min(max(0, 1 − oneOnOneUsed), totalRemaining)
- `insertionRemaining` = totalRemaining

（因為一對一名額本來就包在總名額 2 次之內，不會出現「一對一顯示還有名額、但總名額其實已用完」的矛盾情況。）

## 後端調整

### `src/lib/services/makeupRequestService.ts`

1. 新增常數 `TOTAL_QUARTER_LIMIT = 2`、`ONE_ON_ONE_QUARTER_LIMIT = 1`。
2. 新增唯讀函式 `getMakeupQuotaStatus(studentId: string): Promise<{ insertionRemaining: number; oneOnOneRemaining: number }>`，依上述公式計算，不需要交易（讀取當下快照即可，實際建立時仍由交易保底防競態）。
3. `createOneOnOneMakeupRequestTx`：原本只檢查 `oneOnOneUsed > 0`，改成同時檢查 `oneOnOneUsed >= 1` 或 `totalUsed >= 2`（合計插班+一對一），任一成立就丟 `QUOTA_EXCEEDED`（沿用現有錯誤代碼，前端文案不變）。
4. `createInsertionMakeupRequest`：
   - 改為透過 `runSerializableWithRetry` 包一層交易（比照一對一的作法）
   - `studentId` 不透過參數傳入，改在交易內用 `input.leaveRequestId` 查出 `leaveRequest.studentId`（`LeaveRequest` model 本來就有 `studentId` 欄位），避免變動 `CreateInsertionInput` 介面與呼叫端
   - 交易內檢查 `totalUsed >= 2` 時丟 `QUOTA_EXCEEDED`

### `src/app/api/makeup-requests/route.ts`

- `GET`：當帶 `leaveRequestId` 時，除了原本的 `eligibleClasses`，一併呼叫 `getMakeupQuotaStatus(student.id)`，回傳 `{ eligibleClasses, quota: { insertionRemaining, oneOnOneRemaining } }`
- `POST`：`INSERTION` 分支不需變動（`createInsertionMakeupRequest` 呼叫方式不變）

## 前端調整

### `src/app/student/makeup-request/page.tsx`

- 新增 state 儲存 `quota`（型別 `{ insertionRemaining: number; oneOnOneRemaining: number } | null`），在既有「依 `selectedLeaveId` 抓 `eligibleClasses`」的 `useEffect` 一併從回應中取出 `quota`
- 插班／一對一 兩個單選鈕：
  - `quota` 尚未載入（`selectedLeaveId` 為空或請求中）：不顯示名額文字，選項可正常點擊（維持目前行為，避免畫面閃爍）
  - 對應 `remaining > 0`：單選鈕旁顯示「剩餘 X 次」
  - 對應 `remaining === 0`：單選鈕 `disabled`，文字改為「請洽櫃檯了解補課規範」
- 若使用者已選中的類型，因等待期間名額被其他請求用掉導致剩餘變 0：沿用目前送出流程，由後端 `QUOTA_EXCEEDED` 錯誤訊息擋下作為保底（不特別處理前端 race condition）

## 測試更新

### `src/lib/services/makeupRequestService.test.ts`

- 更新既有「本季已有一對一申請時第二筆丟 QUOTA_EXCEEDED」測試維持通過（子名額 1 次的行為不變）
- 新增：學生本季已有 2 筆插班（或插班+一對一組合）申請時，第 3 筆插班或一對一皆丟 `QUOTA_EXCEEDED`（驗證總名額 2 次）
- 新增：`getMakeupQuotaStatus` 在各種已用數量組合下回傳正確的 `insertionRemaining` / `oneOnOneRemaining`（0 用、用 1 次插班、用 1 次一對一、用滿 2 次）

## 範圍外（Out of Scope）

- 不調整總名額 2 次、子名額 1 次以外的其他補課規則（時段衝突、老師可補課時段檢查等不變）
- 不新增獨立的名額查詢 API endpoint（併入既有 `GET ?leaveRequestId=` 回應）
- 不處理前端顯示與後端實際名額之間的即時同步／race condition，交由後端交易與現有錯誤訊息把關
