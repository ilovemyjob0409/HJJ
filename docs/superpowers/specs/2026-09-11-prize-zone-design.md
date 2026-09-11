# 獎品專區設計（2026-09-11 定案）

## 目標與範圍

- 學生（小朋友）直接在系統上用點數兌換獎品，到櫃台領獎；行政在後台待領清單看「誰換了什麼」直接核銷（2026-09-11 定案：不用兌換代號）。
- 把現行「行政手動登記兌換」（`pointService.redeemPoints`，無獎品目錄）升級為：**後台獎品目錄＋學生自助兌換＋待領清單核銷**。
- 點數體系不變：兩桶（一般 REGULAR／兌換專用 REDEEM_ONLY）、流水表 `PointTransaction` 維持純流水不可變。
- **排除**：線上抽獎（維持線下登記）、QR code 掃碼核銷、兌換代號（核銷走後台待領清單）。

## 已定案的需求決策

| 決策點 | 定案 |
|---|---|
| 兌換流程 | 按下兌換**立即扣點＋產生待領紀錄**，不送審 |
| 庫存 | 每個獎品設庫存數，兌換扣 1，歸零顯示「已換完」不可再兌；行政補貨加回 |
| 圖片 | 行政上傳獎品圖片（重用活動相簿 Supabase Storage pattern） |
| 核銷方式 | 行政後台「待領獎」清單顯示學生身分，直接按「已領取」核銷；不用代號、不做掃碼（2026-09-11 定案） |
| 取消 | 學生可取消自己未領的兌換；行政也可撤銷。取消＝退點＋庫存加回。已領取不可取消 |
| 領取期限 | 兌換後 **30 天**未領自動逾期退點＋庫存加回；**到期前 7 天推播提醒一次** |
| 限換 | **每人每種獎品限兌換 1 次**；只算 PENDING＋PICKED_UP，已取消／已逾期不佔名額可再換 |
| 頁面 | 學生端併入集點卡頁 `/student/points`（2026-09-11 mockup 檢視後定案，取代原「獨立 /student/prizes」決策）；行政獨立頁 `/admin/prizes` |

## 架構選擇

採**方案 A**：新增 `Prize`＋`PrizeRedemption` 兩張表，狀態機住在 `PrizeRedemption`；`PointTransaction` 只記流水（扣點沿用既有 kind `REDEMPTION`，退點新增 kind `REDEMPTION_REFUND`）。否決方案 B（把代號／狀態欄位塞進 `PointTransaction`）——流水表被狀態機污染，違反「流水不可變、reason 存文字快照」的既有哲學。

## 資料模型（Prisma）

```prisma
model Prize {
  id        String            @id @default(cuid())
  name      String
  points    Int               // 所需點數
  stock     Int               // 庫存；0 = 已換完
  imagePath String?           // Supabase Storage 路徑（prize-images bucket）
  active    Boolean           @default(true) // 上下架
  sortOrder Int
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  redemptions PrizeRedemption[]
}

enum PrizeRedemptionStatus {
  PENDING   // 待領獎
  PICKED_UP // 已領取
  CANCELLED // 已取消（學生自取消或行政撤銷）
  EXPIRED   // 逾期自動退點
}

model PrizeRedemption {
  id               String                @id @default(cuid())
  studentId        String
  student          Student               @relation(fields: [studentId], references: [id])
  prizeId          String
  prize            Prize                 @relation(fields: [prizeId], references: [id])
  prizeName        String                // 文字快照：獎品改名／刪除不影響歷史
  redeemOnlyUsed   Int                   // 兌換專用桶扣了多少（快照）
  regularUsed      Int                   // 一般桶扣了多少（快照）
  status           PrizeRedemptionStatus @default(PENDING)
  createdAt        DateTime              @default(now())
  pickedUpAt       DateTime?
  cancelledAt      DateTime?             // CANCELLED / EXPIRED 共用
  expiryRemindedAt DateTime?             // 到期前提醒只發一次
  operator         String?               // 核銷／撤銷操作者（行政名或「學生本人」）

  @@index([studentId])
  @@index([status])
}
```

`PointKind` enum 加值：`REDEMPTION_REFUND`。

## 核心規則

### 兌換交易（`redeemPrize`）

單一 Serializable 交易（`runSerializableWithRetry`）內依序：

1. 獎品存在、`active`、`stock > 0`，否則 `PRIZE_UNAVAILABLE` / `OUT_OF_STOCK`。
2. 限換檢查：該生對該獎品已有 PENDING／PICKED_UP 紀錄 → `ALREADY_REDEEMED`。
3. 餘額檢查：兩桶合計 ≥ 所需點數，否則 `INSUFFICIENT_POINTS`。
4. 扣點：先扣兌換專用、不足再扣一般（沿用既有 `redeemPoints` 口徑），各桶一筆負向 `REDEMPTION` 流水，reason 記「兌換獎品：{獎品名}」。
5. `stock -= 1`。
6. 建 `PrizeRedemption`（含兩桶扣點快照）。

成功後推播：「兌換成功：{獎品名}，請於 {日期（星期）} 前至櫃台領取」。

### 取消／撤銷（`cancelRedemption`）

- 學生只能取消自己的 PENDING 紀錄；行政可撤銷任何 PENDING 紀錄。已領取／已取消／已逾期報錯。
- 同一交易內：狀態改 CANCELLED＋`cancelledAt`＋`operator`（行政名或「學生本人」）→ 按快照把兩桶各自退回（正向 `REDEMPTION_REFUND` 流水）→ `stock += 1`。
- 推播：「兌換已取消，退回 N 點」。

### 核銷（`pickupRedemption`）

- 行政在待領清單點「已領取」：PENDING → PICKED_UP＋`pickedUpAt`＋`operator`。
- 狀態非 PENDING → 明確錯誤訊息（「已領取」「已取消」「已逾期」分開講）。

### 逾期與提醒（掛既有 `daily-reminders` cron，不開新 cron）

jobs 清單新增兩個獨立任務：

- `prizeExpiryReminder`：PENDING 且 `createdAt` 距今 ≥ 23 天且 `expiryRemindedAt` 為空 → 推播「兌換的 {獎品名} 將於 {日期（星期）} 到期，請盡快領取」＋記 `expiryRemindedAt`。
- `prizeExpireOverdue`：PENDING 且 `createdAt` 距今 ≥ 30 天 → 走與取消相同的退點＋補庫存邏輯，狀態改 EXPIRED，`operator` 記「系統（逾期）」，推播「兌換逾期已自動退點」。

天數比較沿用全站 UTC 日曆日慣例（「今天」用台北）。

## 學生端（併入集點卡頁 `/student/points`）

> **UI 細節（版面、視覺、文案）動工前另出 mockup 跟使用者確認，本節只定資訊架構。**

- 版面順序（單頁）：餘額三卡（既有）→ 獎品目錄 → 我的兌換紀錄（收合）→ 點數紀錄（既有，殿後）。
- 獎品圖卡牌格狀排列：圖片（簽名網址）、名稱、所需點數。按鈕四態：
  - 可兌換
  - 點數不足 → disabled＋「還差 N 點」
  - `stock = 0` → 「已換完」徽章＋disabled（仍顯示，維持吸引力）
  - 已兌換過（限換佔用中）→ 「已兌換」徽章＋disabled
- 兌換：`useConfirm` 確認扣點 → 成功彈窗顯示獎品與領取期限「{日期（星期）} 前」。
- 「我的兌換紀錄」表：獎品、點數、狀態、日期（星期）；PENDING 列有取消鈕（`useConfirm`）。>3 筆用 `CollapsibleDataTable`（紀錄類，符合收合慣例）。
- 入口：即集點卡頁本身——導覽列不加新項、不做入口卡；推播連結一律指向 `/student/points`（`notifyStudent` 的 url 同步改）。
- 下架（`active: false`）獎品不出現在目錄，但歷史紀錄照常顯示（靠快照）。

## 行政端 `/admin/prizes`

> 同上，UI 細節動工前再過一次。

- **待領獎核銷區**（置頂）：待領清單（學生、獎品、點數、兌換日期（星期）、領取期限），每列「已領取」／「撤銷退點」（`useConfirm`）。
- **獎品管理區**：列表（圖、名稱、點數、庫存、狀態、排序）＋新增／編輯 `Modal`（共用 `Input`/`Select`；含圖片上傳，重用活動相簿的前端壓縮＋私有 bucket＋簽名網址 pattern）。刪除為下架（軟性，兌換紀錄靠快照不受影響）。
- 行政導覽加「獎品」入口。
- 所有彈窗走 `Modal`／`useDialogA11y`；動效重用既有 `animate-*`／Button loading／骨架屏。

## API（照現有扁平慣例）

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/prizes` | GET | 學生獎品目錄（active，含簽名圖網址、我的限換狀態）；行政帶完整欄位 |
| `/api/prizes` | POST | 行政新增獎品 |
| `/api/prizes/[id]` | PATCH | 行政編輯（名稱／點數／庫存／排序／上下架） |
| `/api/prizes/[id]/image` | POST | 行政上傳圖片 |
| `/api/prize-redemptions` | POST | 學生兌換 |
| `/api/prize-redemptions` | GET | 學生查自己的紀錄；行政查全部待領 |
| `/api/prize-redemptions/[id]/pickup` | POST | 行政核銷 |
| `/api/prize-redemptions/[id]/cancel` | POST | 學生取消自己的／行政撤銷 |

服務層集中在新的 `src/lib/services/prizeService.ts`；權限沿用既有 session role 檢查，Prisma 原始錯誤不外洩（統一映射成中文錯誤訊息）。

## 儲存

- 新開 Supabase 私有 bucket `prize-images`（與 `activity-images` 分開），`storage.ts` 增加對應 upload／signedUrls／delete helper。
- 上傳沿用活動相簿的副檔名白名單（jpeg/png/webp）與前端壓縮。

## 測試

- `prizeService` 單元測試：兌換扣兩桶順序與快照、餘額不足、庫存歸零與 `OUT_OF_STOCK`、限換（含取消後可再換）、取消退回原桶、非 PENDING 不可取消／核銷、逾期任務（提醒只發一次、退點正確）。
- API 測試：角色權限（學生不能動別人的紀錄、非 ADMIN 不能維護獎品）、錯誤映射。
- 測試 DB 注意跨 session 互咬問題，必要時走隔離 worktree＋專用測試 DB。

## 部署順序

1. 正式站先跑 SQL migration：`Prize`、`PrizeRedemption` 新表＋`PointKind` 加 `REDEMPTION_REFUND`＋`PrizeRedemptionStatus` enum。
2. Supabase 手動建 `prize-images` 私有 bucket。
3. Vercel 部署。
4. 本地 schema 改完要重啟 dev server 才吃到新 Prisma Client。
