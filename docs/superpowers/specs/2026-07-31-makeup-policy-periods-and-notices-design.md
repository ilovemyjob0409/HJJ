# 補課規則改版：期別制、依科目分流、補課須知可維護

日期：2026-07-31
狀態：已與使用者確認

## 背景與目標

補課政策改版（見 2026-07 政策討論）：

- **圍棋班**：插班補課不限次數；「一期課程」可申請 1 次一對一補課。
- **非圍棋班**（英文、數學等）：僅提供插班補課（不限次數），完全沒有一對一選項。
- 若家長無法配合插班補課、且該期一對一額度已用完，該期請假未補課的費用於**下一期學費扣除**——此條**僅寫入須知文案**，系統不做金額功能（使用者選定方案 A）。
- 「一期」＝每次報課程（使用者確認）：行政人員每次幫學生報課（新增堂數）即開新的一期，一對一額度重置，未用額度不累積。
- 學生首頁的「補課須知」由寫死改為後台逐條維護（比照常見問題管理，使用者選定方案 A）。

取代的現行規則：每班每日曆季合計 2 次（`TOTAL_QUARTER_LIMIT`）、一對一 1 次（`ONE_ON_ONE_QUARTER_LIMIT`），不分科目。

## 資料模型

```prisma
model EnrollmentPeriod {
  id           String          @id @default(cuid())
  enrollmentId String
  enrollment   ClassEnrollment @relation(fields: [enrollmentId], references: [id], onDelete: Cascade)
  sessions     Int      // 該期報名堂數
  createdAt    DateTime @default(now())
}

model MakeupNoticeItem {
  id        String   @id @default(cuid())
  content   String
  sortOrder Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- `ClassEnrollment` 增加 `periods EnrollmentPeriod[]` 反向關聯。
- **剩餘堂數計算不變**：仍為 `totalSessions` − 非請假出席數（`getClassEnrollmentQuota`）。期紀錄只負責（1）一對一額度重置點（2）報課歷史。
- 刪除報名（`unenrollStudent`、`setStudentEnrollments` 移除、`deleteClass`）靠 `onDelete: Cascade` 連帶清除期紀錄。

## 報課流程

- 「**新增一期**」控制項放在**學生管理頁的編輯表單**（實查後修正：班級管理頁並沒有「加堂」UI；`PATCH /api/classes/[id]/enrollments` 的 `addEnrollmentSessions` 目前無任何前端呼叫者）。每個已報名班級一列，提供「本期堂數」輸入與「＋一期」按鈕，呼叫該 PATCH。
- `addEnrollmentSessions` 改造：同一交易內累加 `totalSessions` ＋ 建立期紀錄；成功後前端同步更新編輯表單中該班的總堂數欄位，避免之後按「儲存」把加期前的舊數字當校正覆蓋回去。
- 學生管理頁編輯表單（`setStudentEnrollments`）：**新報名**且有填堂數 → 建立第一期；修改既有報名的堂數＝校正，不建期、不重置額度。
- 既有資料遷移：為每筆現有報名補建一筆期（`sessions = totalSessions ?? 0`，`createdAt` ＝ 執行時間）。效果：上線起所有圍棋學生重新享有 1 次一對一額度。

## 補課規則邏輯（makeupRequestService）

- 移除 `TOTAL_QUARTER_LIMIT`、`ONE_ON_ONE_QUARTER_LIMIT`、`getQuarterRange` 依賴；`src/lib/quarter.ts` 無其他使用者即刪除。
- 新常數：`GO_SUBJECT = '圍棋'`（程式已有 `classService.SUBJECT_ORDER` 依字串判斷之先例）、`ONE_ON_ONE_PERIOD_LIMIT = 1`。
- `getMakeupQuotaStatus` 回傳改為 `{ oneOnOneAvailable: boolean; oneOnOneRemaining: number }`：
  - 非圍棋 → `oneOnOneAvailable: false`、remaining 0。
  - 圍棋 → 以該報名**最新一期**的 `createdAt` 為窗口起點，計 `PENDING_ADMIN`／`APPROVED` 的一對一申請數（被拒不計）。查無期紀錄時窗口起點為報名以來全部歷史（保守 fallback，遷移後正常不會發生）。
- `createInsertionMakeupRequestTx`：移除額度檢查（任何科目不限次數）。
- `createOneOnOneMakeupRequestTx`：非圍棋 → `throw Error('NOT_AVAILABLE')`；本期額度已用 → `QUOTA_EXCEEDED`。維持 serializable 交易內 check-then-act。

## 學生端 UI

- **申請補課頁**（`/student/makeup-request`）：
  - API `GET /api/makeup-requests?leaveRequestId=` 回傳的 quota 換新型別。
  - 非圍棋班：不顯示類型切換，直接呈現插班表單。
  - 圍棋班：兩個選項；插班標示「不限次數」；一對一標示「本期剩餘 X 次」，用完時 disabled 並顯示「若無法配合插班補課，未補課費用將於下一期學費扣除，請洽櫃檯」。
  - 錯誤文案去掉「本季」字眼。
- **學生首頁**（`/student/page.tsx`）：補課須知卡片改讀 `MakeupNoticeItem`（server component 直接呼叫 service，同 FAQ 頁模式）；無資料時整張卡隱藏；移除對常數的 import。

## 後台補課須知管理

- 新頁 `/admin/makeup-notices`「補課須知管理」：完全比照 `/admin/faq`（新增／編輯／刪除／上下移排序），每條一個 textarea。
- Service `makeupNoticeService`（比照 `faqService`，含 sortOrder max+1 與 reorder 交易換位）。
- API `/api/makeup-notices`、`/api/makeup-notices/[id]`、`/api/makeup-notices/[id]/reorder`，全部 ADMIN 限定（比照 `/api/faq` 的權限寫法，含 GET）。
- `AppShell` 後台導覽加「補課須知」連結。
- 預設須知內容（一次性 seed，行政之後可自行維護）：
  1. 圍棋班：插班補課不限次數；每期課程可申請一次一對一補課。
  2. 英文、數學等其他科目：僅提供插班補課，不限次數。
  3. 若家長無法配合插班補課、且該期一對一補課已使用，該期請假未補課之費用將於下一期學費中扣除。
  4. 補課申請若被行政人員拒絕，不會計入一對一額度，仍可再次申請。

## 遷移與上線

- 專案無 Prisma migrations 目錄（採 `prisma db push`）。schema 推送後執行一次性 backfill script：（1）為每筆報名建期（2）寫入預設須知（僅在 `MakeupNoticeItem` 為空時）。
- Vercel + Supabase 正式環境：先 push schema、跑 backfill，再部署程式（新程式的 fallback 讓短暫空窗也安全）。

## 測試

- `makeupRequestService.test.ts` 改寫：圍棋／非圍棋分流、換期（新增一期）後額度重置、插班無上限、非圍棋一對一遭拒、被拒申請不計額度。
- 新增 `makeupNoticeService.test.ts`（比照 `faqService.test.ts`：CRUD、排序、換位）。
- `classService.test.ts` 補期建立案例：新增一期會累加堂數＋建期；校正堂數不建期；新報名含堂數建第一期。
- 沿用全域 `resetDb()` 清理（vitest.setup.ts），新表自動納入動態表清單。

## UI 規範

- 沿用既有 `animate-*` 動效 class、Button loading、骨架屏 pattern；深夜模式沿用現有 token（textarea 比照 FAQ 頁既有樣式）；日期顯示沿用 `formatDateWithWeekday`。
