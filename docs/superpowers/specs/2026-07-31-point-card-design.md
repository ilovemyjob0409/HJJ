# 集點卡功能設計

日期：2026-07-31
狀態：已與使用者確認需求

## 目標與背景

鼓勵學生出席與課堂表現。老師手動給點，學生累積點數兌換獎品；教室另有**線下**抽獎活動（20 點抽一次，抽中點數），系統負責記帳，不做系統內抽獎。

使用者確認的關鍵規則：

- 點數**只由老師手動給**（出席、課堂表現），不做簽到自動集點。
- 兩種點數桶：**一般點數**（老師給的）與**兌換專用點數**（線下抽獎抽中、由行政登記）。兌換專用點數**不能**再拿去抽獎，只能兌換獎品。
- 兌換**不設獎品目錄**（使用者 2026-07-31 追加決定「不用獎品模組」）：行政兌換時直接輸入「扣多少點＋換了什麼（文字）」，系統自動優先扣兌換專用點數、不足扣一般點數。
- 抽獎固定 **20 點／次**（程式常數 `DRAW_COST = 20`），行政登記時填「抽幾次」與「抽中總點數」。
- 點數**不分班級**，跟著學生一份。

## 第一版不做（明確排除）

系統內抽獎（含機率、動畫）、LINE 通知、點數過期、排行榜、學生自助兌換、老師輸入兌換專用點數。

## 儲存方案

**純流水帳**（使用者同意）：單一 `PointTransaction` 表記錄每筆 ±點數，餘額由加總導出。單一事實來源、天然具備歷史紀錄；學生量級小，加總無效能疑慮。與現行補課額度「以查詢導出」風格一致。

## 資料模型（Prisma）

```prisma
enum PointBucket {
  REGULAR      // 一般點數（老師給、可用於線下抽獎與兌換）
  REDEEM_ONLY  // 兌換專用點數（線下抽中，只能兌換）
}

enum PointKind {
  TEACHER_AWARD  // 老師給點（+，REGULAR）
  LOTTERY_COST   // 抽獎登記扣點（−，REGULAR）
  LOTTERY_WIN    // 抽獎登記得點（+，REDEEM_ONLY）
  REDEMPTION     // 兌換獎品（−，任一桶）
  ADMIN_ADJUST   // 行政調整（±，任一桶）
}

model PointTransaction {
  id        String      @id @default(cuid())
  studentId String
  student   Student     @relation(fields: [studentId], references: [id])
  bucket    PointBucket
  amount    Int         // 正＝得點、負＝扣點
  kind      PointKind
  reason    String      // 快照文字：給點理由／獎品名稱／「抽獎 n 次」／調整原因
  teacherId String?     // TEACHER_AWARD 時記錄給點老師
  teacher   Teacher?    @relation(fields: [teacherId], references: [id])
  createdAt DateTime    @default(now())
}

model PointReason {   // 給點理由選項（行政維護）
  id        String   @id @default(cuid())
  label     String
  sortOrder Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model RewardItem {    // 獎品目錄（行政維護）
  id         String   @id @default(cuid())
  name       String
  pointsCost Int
  sortOrder  Int
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

- `PointTransaction.reason` 為**文字快照**：理由選項或獎品之後改名／刪除不影響歷史。
- `Student`、`Teacher` 增加反向關聯。
- 理由與獎品的維護（含 sortOrder max+1、上下移）完全比照 `makeupNoticeService`／`faqService` 既有模式。

## Service 層（pointService）

常數：`DRAW_COST = 20`、`AWARD_MAX = 10`。

- `getPointBalances(studentId)` → `{ regular, redeemOnly }`（各桶 `sum(amount)`，無資料為 0）
- `listPointHistory(studentId)` → 流水（新到舊；含 kind、bucket、amount、reason、老師名、時間）
- `awardPoints({ teacherId, studentIds, amount, reasonId })`：驗證 `1 ≤ amount ≤ AWARD_MAX`、理由存在；每位學生寫入一筆 `TEACHER_AWARD`（+amount，REGULAR，reason＝理由 label 快照）
- `recordLottery({ studentId, draws, wonPoints })`：驗證 `draws ≥ 1`、`wonPoints ≥ 0`（皆整數）；serializable 交易內檢查 REGULAR 餘額 ≥ `draws × DRAW_COST`，不足 throw `INSUFFICIENT_POINTS`；寫入 `LOTTERY_COST`（−draws×20，REGULAR，reason＝`抽獎 ${draws} 次`）＋（wonPoints > 0 時）`LOTTERY_WIN`（+wonPoints，REDEEM_ONLY，reason＝`抽獎獲得`）
- `redeemReward({ studentId, rewardItemId })`：serializable 交易內檢查兩桶合計 ≥ 獎品點數，不足 throw `INSUFFICIENT_POINTS`；**優先扣 REDEEM_ONLY、不足再扣 REGULAR**（各桶一筆負向 `REDEMPTION`，reason＝獎品名稱快照；某桶扣 0 則不寫該桶）
- `adjustPoints({ studentId, bucket, amount, reason })`：`amount ≠ 0`、reason 必填；負向調整在 serializable 交易內檢查該桶餘額不得為負，不足 throw `INSUFFICIENT_POINTS`
- 並發安全：`recordLottery`／`redeemReward`／負向 `adjustPoints` 沿用 `runSerializableWithRetry` 既有機制（check-then-act 同一交易）

## API 路由（全走既有 session 權限模式）

| 路由 | 方法 | 權限 | 用途 |
|---|---|---|---|
| `/api/points?studentId=` | GET | ADMIN（或本人 STUDENT 不帶參數） | 餘額＋歷史 |
| `/api/points/award` | POST | TEACHER | 老師給點 |
| `/api/points/lottery` | POST | ADMIN | 抽獎登記 |
| `/api/points/redeem` | POST | ADMIN | 兌換 |
| `/api/points/adjust` | POST | ADMIN | 點數調整 |
| `/api/point-reasons`（含 `[id]`、`reorder`） | GET/POST/PATCH/DELETE | GET 另開放 TEACHER（給點頁下拉用）；寫入 ADMIN | 理由維護 |
| `/api/reward-items`（含 `[id]`、`reorder`） | GET/POST/PATCH/DELETE | GET 另開放 STUDENT（目錄顯示）；寫入 ADMIN | 獎品維護 |

STUDENT 的 GET `/api/points` 一律以 session 推得自己的 studentId，不可查他人。

## 頁面

**老師「給點」頁 `/teacher/points`**（導覽新增「給點」）
選班級（自己任教的班）→ 勾選學生（可多選）→ 點數（1–10）＋理由下拉 → 送出 → toast 成功。學生清單來自該班 enrollments。

**學生「集點卡」頁 `/student/points`**（導覽新增「集點卡」）
1. 餘額卡片：一般點數／兌換專用點數（合計亦顯示）
2. 獎品目錄：名稱＋所需點數，合計買得起的高亮標示「可兌換」
3. 點數歷史 DataTable：日期（`formatDateWithWeekday`）、項目（給點理由／抽獎／兌換／調整）、±點數、（給點時）老師名

**行政「集點管理」頁 `/admin/points`**（導覽新增「集點」）
區塊式單頁（比照既有後台頁風格）：
1. **學生查詢＋操作**：搜尋選學生 → 顯示兩桶餘額 → 三個操作：
   - 兌換：選獎品 → 確認 → 扣點
   - 抽獎登記：填抽幾次（顯示將扣 n×20）＋抽中總點數 → 送出
   - 點數調整：選桶別＋±點數＋原因
2. **獎品目錄維護**：新增／編輯／刪除／排序（比照補課須知管理）
3. **給點理由維護**：同上模式

UI 沿用既有 Card/Button/Input/Select/Modal/DataTable/Toast、`animate-*` 動效、深夜模式 token；日期一律 `formatDateWithWeekday`。

## 錯誤處理

- `INSUFFICIENT_POINTS` → 前端顯示「點數不足」（含目前餘額）
- 給點 amount 超界／理由不存在 → 422 擋下
- 並發（兩端同時兌換／登記）→ serializable 重試後仍不足者收到點數不足

## 測試（沿用全域 resetDb）

`pointService.test.ts`（TDD）：

- 兩桶餘額計算（空、多筆、含負向）
- awardPoints：多學生各一筆、amount 超界擋下、理由快照
- recordLottery：扣 n×20＋得點入兌換專用；餘額不足擋；wonPoints=0 只扣不加
- redeemReward：優先扣 REDEEM_ONLY、跨桶分兩筆、合計不足擋下
- adjustPoints：正負向、負向不足擋下
- 並發：同時兩筆兌換僅一筆成功（serializable）
- 理由／獎品維護測試比照 `makeupNoticeService.test.ts` 模式

## 上線

`prisma db push`（新增三表二 enum，純新增）；正式環境比照本次補課改版流程——產出等效 SQL 供 Supabase SQL Editor 執行後再部署程式。無需 backfill（新功能從零開始）。

## 修訂紀錄

- 2026-07-31（實作中）：移除獎品模組（RewardItem 資料表、獎品目錄維護、學生端目錄、選獎品兌換），兌換改為自由輸入點數＋名目；`redeemReward` → `redeemPoints({ studentId, points, description })`。其餘規則不變。
