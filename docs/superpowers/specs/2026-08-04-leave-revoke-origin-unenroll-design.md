# 請假撤銷（全角色）＋請假管理列表（操作者欄）＋退班點名抽離 — 設計文件

日期：2026-08-04
狀態：已與使用者確認（兩項決策：退班保留歷史只刪未來點名；撤銷請假連補課一併撤銷）

## 1. 退班點名抽離

`setStudentEnrollments` 移除報名（toRemove）時，同一交易內刪除該生在該班
**今天（含）以後**的 `ClassAttendance`（沿用全站 `setHours(0,0,0,0)` upcoming 邊界）。
過去的出席歷史保留備查。

## 2. 請假撤銷（所有角色）

- 新 service：`leaveRequestService.revokeLeaveRequest(leaveRequestId)`
  - 若請假掛有補課（任何狀態）：先走現有 `revokeMakeup`（刪補課＋LINE 通知；
    補課已點名則擋 `MAKEUP_HAS_ATTENDANCE`），再刪請假。
  - 無補課：直接刪請假。
- API：`DELETE /api/leave-requests/[id]`
  - STUDENT：僅能撤自己的請假。
  - TEACHER：僅能撤自己帶班班級的學生請假。
  - ADMIN：不限。
- UI（三端都提供「撤銷」）：
  - 學生「請假申請」頁的我的請假紀錄表。
  - 老師首頁「學生請假紀錄」表。
  - 行政「請假管理」新請假列表（見下）。
  - 有補課時確認視窗加警告：「此請假的補課申請將一併撤銷」。

## 3. 請假管理列表＋操作者欄

- schema：`LeaveRequest.origin LeaveOrigin?`（enum `STUDENT | ADMIN`，nullable）。
  - 學生自行申請（`createLeaveRequest`）→ STUDENT。
  - 行政代辦（`createLeaveForArrangeTx`）→ ADMIN。
  - 舊資料為 null，顯示「—」（無法回溯判斷）。
  - 正式站 SQL（先跑再部署，向後相容）：
    `CREATE TYPE "LeaveOrigin" AS ENUM ('STUDENT','ADMIN');`
    `ALTER TABLE "LeaveRequest" ADD COLUMN "origin" "LeaveOrigin";`
- 行政「請假管理」頁新增「請假申請」區塊：列出全部請假
  （學生／班級／日期／原因／操作者／補課狀態／撤銷），日期新到舊。
  - 操作者徽章：學生（灰）、行政代辦（藍）、—（舊資料）。

## 測試

- 退班：過去點名保留、今天以後刪除；未退班班級不受影響。
- revokeLeaveRequest：無補課直接刪；有補課連動刪＋通知；補課已點名擋下；
  權限（學生撤他人 403、老師撤非帶班 403）。
- origin：兩條建立路徑分別寫入 STUDENT／ADMIN。
