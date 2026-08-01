# 行政代排補課＋補課撤銷 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 行政在「補課申請」頁一步完成代排（直接核准、自動進點名）；已核准補課可撤銷——行政直接撤銷、家長申請撤銷由行政確認；撤銷後原請假可重新申請。

**Architecture:** `makeupRequestService` 新增 `arrangeInsertionMakeup`／`arrangeOneOnOneMakeup`：serializable 交易內「驗證就讀 → 建請假（APPROVED）→ 建補課（APPROVED）」，一對一沿用既有科目／每期額度／老師時段／時段衝突檢查；LINE 通知抽出共用 helper 與核准流程一致。點名端零改動（插班點名撈 APPROVED 插班單、一對一點名以補課單為主鍵，已確認）。

**Tech Stack:** 同專案（Next.js／Prisma／Vitest 全域 resetDb）。

## Global Constraints

- 錯誤碼：`NOT_ENROLLED`（未就讀原班）、`NOT_AVAILABLE`、`QUOTA_EXCEEDED`、`OUTSIDE_AVAILABILITY`、`SLOT_CONFLICT`（沿用既有語意）。
- 請假原因預設「行政代辦」（UI 預填、可改）。
- 規則照舊：一對一僅圍棋、每期 1 次；插班不限次數（插班無額度檢查）。
- UI 做在 `/admin/makeup-requests` 頁內（不新增導覽）。

---

### Task 1: service 代排函式（TDD）

**Files:**
- Modify: `src/lib/services/makeupRequestService.ts`
- Test: `src/lib/services/makeupRequestService.test.ts`（新增 describe）

**Interfaces:**
- Produces:
  - `arrangeInsertionMakeup(input: { studentId; classId; date: Date; reason: string; targetClassId; targetDate: Date })` → 回傳 makeup（APPROVED）
  - `arrangeOneOnOneMakeup(input: { studentId; classId; date: Date; reason: string; teacherId; slotDate: Date; slotStartTime; slotEndTime })` → 回傳 makeup（APPROVED）
  - 兩者交易外嘗試 LINE 通知（沿用核准文案，失敗僅 console.error）。`decideMakeupRequest` 的通知程式抽成共用 `notifyMakeupDecision`。

測試重點：插班代排建立「請假＋APPROVED 補課」且 `getClassAttendance(targetClass, targetDate)` 名單包含該生；未就讀 → NOT_ENROLLED 且不留殘料；一對一代排 happy path＋非圍棋 NOT_AVAILABLE＋每期額度＋時段衝突照擋。

- [ ] 寫失敗測試 → RED → 實作 → GREEN → commit `feat: admin arrange functions create pre-approved makeups`

### Task 2: API

**Files:**
- Create: `src/app/api/makeup-requests/arrange/route.ts`（POST，ADMIN；body `{ type: 'INSERTION'|'ONE_ON_ONE', studentId, classId, date, reason, targetClassId?, targetDate?, teacherId?, slotDate?, slotStartTime?, slotEndTime? }`；錯誤 422 透傳訊息）
- Modify: `src/app/api/makeup-requests/route.ts` GET——`teacherId` 可補課時段查詢分支同時允許 ADMIN（其餘分支維持 STUDENT）。

- [ ] 實作 → `tsc` 乾淨 → commit `feat: admin arrange-makeup API`

### Task 3: UI（補課申請頁）

**Files:**
- Modify: `src/app/admin/makeup-requests/page.tsx`
- Create: `src/app/admin/makeup-requests/ArrangeMakeupForm.tsx`（client）

頁面頂部加「＋ 代排補課」按鈕展開表單卡（收合模式比照補課須知管理）：

1. 選學生：搜尋（姓名／學號／班級名稱；資料來自 `/api/students`＋`/api/classes` 組合，比照集點頁做法）
2. 原課程：該生就讀班級 Select ＋ 請假日期 ＋ 原因（預填「行政代辦」）
3. 方式 radio：插班／一對一（原班科目非圍棋時只有插班）
   - 插班：同科目同程度其他班級 Select（由 `/api/classes` 前端過濾）＋插班日期
   - 一對一：老師 Select（`/api/teachers`）＋顯示可補課時段（`/api/makeup-requests?teacherId=`）＋日期＋起訖時間
4. 送出 POST `/api/makeup-requests/arrange` → 成功 toast「已完成代排，點名名單已更新」收合表單；錯誤碼對應中文提示（額度不足／不在可補課時段／時段衝突／未就讀該班）

- [ ] 實作 → `tsc`＋lint → commit `feat: arrange-makeup form on admin makeup-requests page`

### Task 4: 驗證＋上線

- [ ] `npm test` 全綠 ×2、lint、build
- [ ] 瀏覽器實測：代排插班 → 點名頁該班該日名單出現該生；代排一對一 → 一對一點名出現；錯誤案例（非圍棋一對一不可選、額度不足擋）
- [ ] 合併 main → push 部署（無 schema 變更，不需 SQL）

---

### Task 5（追加）: 撤銷機制

**Schema:** `MakeupRequest` 加 `cancelRequestedAt DateTime?`（家長申請撤銷的時間戳；不影響點名與額度）。正式環境 SQL：`ALTER TABLE "MakeupRequest" ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMP(3);`

**Service（makeupRequestService，TDD）：**
- `requestMakeupCancellation(makeupRequestId, studentId)`：本人＋狀態 APPROVED → 設 cancelRequestedAt；非 APPROVED → `NOT_APPROVED`；非本人 → `NOT_FOUND`
- `rejectMakeupCancellation(id)`：清空 cancelRequestedAt（行政駁回）
- `revokeMakeup(id)`：有已點名紀錄（ClassAttendance／OneOnOneAttendance 存在該 makeupRequestId）→ `MAKEUP_HAS_ATTENDANCE`；否則刪除補課單（請假保留、回到未申請）→ 交易外 LINE 通知「補課已撤銷」
- `listApprovedMakeups()`：目標日／時段日 >= 今天的 APPROVED 單（含 cancelRequestedAt、學生名、目標資訊），撤銷申請置頂、其餘依日期近到遠
- 測試：申請撤銷後點名名單不受影響；撤銷後 (1) 點名名單消失 (2) 一對一額度釋放 (3) 原請假可再建補課；已點名擋撤銷

**API：**
- POST `/api/makeup-requests/[id]/cancel-request`（STUDENT 本人）
- POST `/api/makeup-requests/[id]/revoke`（ADMIN）
- POST `/api/makeup-requests/[id]/reject-cancellation`（ADMIN）
- GET `/api/makeup-requests/approved`（ADMIN）

**UI：**
- 行政補課申請頁加「已核准補課（未來）」區：清單＋撤銷按鈕（confirm）；有撤銷申請者高亮並提供「同意撤銷／駁回」
- 學生首頁「我的請假與插班紀錄」補課狀態欄：APPROVED 顯示「申請撤銷」小按鈕（client 元件），已申請顯示「撤銷申請中」；撤銷完成後該列回到「尚未申請」
