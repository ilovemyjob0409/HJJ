# 合併「已核准補課（未來場次）」與「請假申請紀錄」— 設計文件

日期：2026-08-05
狀態：已與使用者確認並實作完成

## 問題

行政「請假管理」頁原本有兩張表格資訊重疊：「已核准補課（未來場次）」只列
APPROVED＋未來日期的補課，「請假申請紀錄」列出全部請假（含補課類型／狀態）。
行政要同時看兩張表才能掌握全貌。

## 決策

合併成單一「請假申請紀錄」表，刪除獨立的已核准補課表與其專用 API
（`listApprovedMakeups`、`/api/makeup-requests/approved`）。

## 撤銷語意（保留兩種，使用者確認）

- **撤銷請假**（`RevokeLeaveButton`）：連補課一起刪，請假整筆消失。
- **只撤銷補課**（新按鈕，沿用 `revokeMakeup`／`/api/makeup-requests/{id}/revoke`）：
  請假保留，補課刪除，之後可重新安排。僅在補課狀態為 APPROVED 時顯示。

## 操作欄邏輯

| 狀態 | 操作 |
|---|---|
| 無補課／待確認／已拒絕 | 撤銷請假 |
| 已核准，無撤銷申請中 | 撤銷請假 ＋ 只撤銷補課 |
| 已核准，家長申請撤銷中 | 同意撤銷 ＋ 駁回（沿用原邏輯，隱藏撤銷請假避免混淆） |

狀態欄：家長申請撤銷中時顯示橘色「家長申請撤銷」徽章取代「已核准」。
列樣式：`cancelRequestedAt` 存在時整列淡橘底（`bg-pendingBg/40`），與原表一致。

## 連動修改

- `page.tsx` 的 `ArrangeMakeupForm.onArranged` 與 `decide()` 原本 reload
  `ApprovedMakeupListHandle`，改 reload `LeaveRequestListHandle`。
- `leaveRequestService.listAllLeaveRequests` select 補上 `cancelRequestedAt`。
- 行政首頁表格標題「學生請假與插班紀錄」→「學生請假與補課紀錄」（不再只限插班）。

## 驗證

瀏覽器實測三條路徑：只撤銷補課（請假保留、補課刪除）、駁回撤銷申請
（補課保留 APPROVED、cancelRequestedAt 清空）；同意撤銷與只撤銷補課共用
同一段程式碼，邏輯等價。tsc／lint／測試全過（415/415，無新增測試——
純 UI 重組＋沿用既有已測試過的 service 函式）。
