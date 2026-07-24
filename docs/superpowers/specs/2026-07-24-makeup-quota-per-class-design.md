# 補課名額改為依班級獨立計算 — 設計文件

日期：2026-07-24

## 背景與目標

[2026-07-24 補課名額規則調整與剩餘次數顯示](2026-07-24-makeup-quota-display-design.md) 已上線的規則是：本季總名額 2 次（插班+一對一合計）、一對一子名額 1 次，計算範圍是**整個學生**（跨班級加總）。

現調整為：名額改成**依班級（classId）各自獨立計算**。學生若同時在多個班級，每個班級本季都各有自己的「總名額 2 次、一對一子名額 1 次」，班級之間互不影響、不共用。

判斷依據：以該筆**請假紀錄（LeaveRequest）本身所屬的 classId** 為準，不是插班的目標班級。

## 名額計算規則（更新）

- 計入名額的申請：`status` 為 `PENDING_ADMIN` 或 `APPROVED`（不變）
- `totalUsed` = 該學生「該班級」本季插班 + 一對一申請數量（新增 `leaveRequest.classId = 該班級` 條件）
- `oneOnOneUsed` = 該學生「該班級」本季一對一申請數量（同樣加上 classId 條件）
- 其餘換算公式（`totalRemaining`、`oneOnOneRemaining` 的 min/max 關係）不變，只是計算範圍縮小到單一班級

## 後端調整

### `src/lib/services/makeupRequestService.ts`

1. `getQuotaCounts(client, studentId, start, end)` 改為 `getQuotaCounts(client, studentId, classId, start, end)`，兩個 count 查詢的 `where` 都加上 `leaveRequest: { studentId, classId }`（原本只有 `studentId`）。
2. `getMakeupQuotaStatus(studentId: string)` 改為 `getMakeupQuotaStatus(studentId: string, classId: string)`，呼叫 `getQuotaCounts` 時多帶 `classId`。
3. `createOneOnOneMakeupRequestTx`：目前直接用 `input.studentId` 查名額，且從未查詢過 leaveRequest 本身。改成先在交易內查 `tx.leaveRequest.findUniqueOrThrow({ where: { id: input.leaveRequestId }, select: { classId: true } })` 取得 `classId`，再呼叫 `getQuotaCounts(tx, input.studentId, classId, start, end)`。
4. `createInsertionMakeupRequestTx`：目前已經會查 `tx.leaveRequest.findUniqueOrThrow(...)` 取得 `studentId`（見上一版設計），現在 `select` 多加 `classId`，一併傳入 `getQuotaCounts`。

### `src/app/api/makeup-requests/route.ts`

- `GET`：`findOwnLeaveRequest` 回傳的 `leave` 已經 `include: { class: true }`，本來就有 `leave.classId`（或 `leave.class.id`）可用。呼叫改成 `getMakeupQuotaStatus(student.id, leave.classId)`。

## 前端

不需要修改。學生選好請假紀錄後，前端本來就是呼叫 `GET ?leaveRequestId=` 拿該筆請假紀錄對應的名額；後端把計算範圍縮小到該筆請假紀錄的班級後，前端顯示的「剩餘次數」自然就是該班級的名額，UI 邏輯（disable、剩餘次數文字、自動切換）完全不用動。

## 測試更新

### `src/lib/services/makeupRequestService.test.ts`

- 既有測試多數只用同一個班級（`classA`）建立多筆請假紀錄，依班級分開計算後這些測試的計算結果不變，應維持全部通過，不需修改斷言。
- 新增一個測試：同一學生在**兩個不同班級**（`classA`、另一個新班級，例如同科目同等級或不同科目皆可，因為現在不再依 subject/level 分組，只依 classId）各自建立請假與一對一/插班申請，驗證：
  - 在 `classA` 用滿名額後，另一個班級的 `getMakeupQuotaStatus` 仍顯示滿額（不受 `classA` 影響）
  - 呼叫 `createOneOnOneMakeupRequest` 或 `createInsertionMakeupRequest` 時，即使 `classA` 名額已用完，另一個班級的申請仍可正常送出（不會誤觸 `classA` 的 `QUOTA_EXCEEDED`）

## 範圍外（Out of Scope）

- 不改變總名額 2 次、子名額 1 次的數字本身
- 不改變 `REJECTED` 不佔名額的規則
- 不改變前端文案或互動邏輯
- 不新增資料庫欄位或 schema 異動（`classId` 已存在於 `LeaveRequest`）
