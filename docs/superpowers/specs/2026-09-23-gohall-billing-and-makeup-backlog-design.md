# 弈廳收費單＋未補堂數顯示 — 設計

日期：2026-09-23。兩個獨立功能，可分開實作、分開上線。

---

## 功能一：弈廳收費單

### 目標
收費模組的「單獨開單」可以開弈廳收費單（堂票或季票），開單當下自動入帳，行政不用再去票券管理重複登記。

### 使用者定案規則
1. 項目兩種：**堂票 N 堂 × 單價**、**季票（起訖日期）＋金額**。一張單一個項目。
2. **開單即入帳**：堂票寫進堂票帳本，季票直接建立。
3. 價格預設值在收費「設定」分頁維護（堂票單價、季票價格），開單時帶入，每張單可以改。
4. 優惠項目、試算、手動調整金額跟現有單獨開單完全一致。
5. 只有沒有繳款紀錄的帳單可以刪除或編輯，而且要連動扣回或調整入帳內容。

### 資料模型（schema 變更，需要跑正式站 SQL）
- `enum GoHallBillItem { TICKETS, SEASON_PASS }`
- `Bill` 新增欄位：
  - `goHallItem GoHallBillItem?`：非 null 表示這是弈廳帳單。
  - `goHallTickets Int?`：堂票張數。
  - `seasonPassId String? @unique`：關聯 `GoHallSeasonPass`，`onDelete: Restrict`。
- `BillingSetting` 新增欄位：`goHallTicketPrice Int @default(0)`、`goHallSeasonPassPrice Int @default(0)`。值為 0 時視為未設定，開單欄位留空，讓行政自己填。
- 堂票入帳不和 Bill 建外鍵，改用帳本 `reason` 文字快照追溯，比照班級帳單用期別帳本留痕的做法：
  - 開單時寫 `PURCHASE +N`，reason 為 `收費單`。
  - 刪除時寫 `ADMIN_ADJUST −N`，reason 為 `刪除收費單扣回`。
  - 編輯堂數時寫 `ADMIN_ADJUST ±差額`，reason 為 `收費單修改堂數`。
- `Bill.periodStart/periodEnd`：
  - 堂票帳單：開單日（台北今天的 UTC 日曆日）頭尾同一天。
  - 季票帳單：季票的起訖日期。

  這樣收費總覽的「區間重疊」統計可以直接沿用，不必另寫邏輯。

> 原本討論時提過在 `BillingKind` 加 `GO_HALL`。實作時改用 `Bill.goHallItem` 判斷，因為弈廳收費單不走批次，而 `BillingKind` 只給批次用，不需要動它。

### 服務層
新檔案 `goHallBillService.ts`（避免跟 standaloneBillService 或 billingBatchService 形成循環引用）：
- `previewGoHallBill` / `createGoHallBill({ studentId, item, sessions?, startDate?, endDate?, unitPrice?, price?, discounts, amountOverride? })`
  - 在同一個 `$transaction` 裡建立 Bill（FINALIZED），然後寫入堂票帳本或季票。
  - 堂票入帳時，同時把 `goHallLowQuotaNotifiedAt` 清成 null，跟 `purchaseTickets` 的行為一樣。
  - 算式文字：
    - 堂票：`弈廳堂票 N 堂 × 單價 元 ＝ 毛額 元`
    - 季票：`弈廳季票 起（週）～訖（週） 毛額 元`
  - 有優惠時沿用 `buildNetFormula` 產生 netFormula。
- 刪除：擴充既有 `deleteBill` 的分流。
  - 堂票：扣回前先檢查餘額。餘額不足（堂票已經用掉）時丟出 `BILL_TICKETS_CONSUMED`。
  - 季票：季票期間內，只要有這位學生的 `SEASON_PASS` 到場紀錄、而且那一天沒有其他季票涵蓋，就丟出 `BILL_SEASON_PASS_USED`。檢查通過才連同季票一起刪除。
  - `BILL_HAS_PAYMENTS` 的檢查照舊。
- 編輯：擴充既有 `updateFinalizedBill`。
  - 堂票可改堂數，差額寫進帳本；扣回時同樣檢查餘額。
  - 季票可改起訖日期。原本已經用這張季票簽到的日期如果會落到新區間外、而且沒有其他季票涵蓋，就擋下來。
  - 優惠和金額的編輯方式跟現有邏輯一致。
- 票券管理那邊直接刪除「綁著收費單的季票」時要擋下，回傳 `SEASON_PASS_HAS_BILL`，提示去收費清單刪帳單。
- 退班結算不適用於弈廳帳單，操作選單裡不顯示這個選項。

### API
- 單獨開單 route 新增 `kind: 'GO_HALL'` 分支，preview 和 create 共用同一支。
- 設定 API 新增兩個價格欄位，驗證規則：整數且 ≥ 0。
- 錯誤碼一律對應成中文訊息，不讓原始 Prisma 錯誤外洩。

### UI
- `StandaloneBillModal`：類型選擇多一個「弈廳」。選了之後：
  - 先選項目（堂票或季票）。
  - 堂票：輸入堂數、單價（預設帶入）。
  - 季票：輸入起訖日期（沿用共用 Input，顯示日期（星期））、價格（預設帶入）。
  - 優惠區塊直接沿用。
- `EditBillModal`：弈廳帳單顯示對應的可編輯欄位。
- 收費清單（OverviewTab）：
  - 來源篩選多一顆「弈廳」按鈕。
  - overview 資料的 source 新增 `'GO_HALL'`（由 `goHallItem` 推出）。
  - 「項目」欄顯示「弈廳堂票 N 堂」或「弈廳季票」。
  - Excel 匯出沿用現有邏輯。
- 設定分頁：新增「弈廳價格」區塊，放兩個欄位。
- 學生端 `/student/billing`、首頁待繳卡、通知：現有流程直接吃 Bill，不另外改；只要確認項目名稱顯示正確。

### 測試
- service：開單入帳（堂票加帳本、季票建立）、刪除扣回、刪除時堂票已用完被擋、刪除時季票已被用來簽到被擋、編輯差額、有繳款時被擋、票券管理刪除綁單季票被擋。
- route：GO_HALL 參數驗證、錯誤碼對應。

---

## 功能二：未補堂數顯示

### 目標
在行政和學生端，對圍棋班與個別輔導顯示「應到未到、還沒補」的堂數，點下去可以看是哪幾天。

### 計算規則（使用者定案）

**圍棋班（每位學生、每個班級分開算）**
- 範圍：本期，也就是最新一筆 `EnrollmentPeriod.createdAt`（取 UTC 日曆日）起，到台北今天為止。未來日期不算。
- 以日期為單位計算，每一天最多算一次：
  - 當天有請假紀錄，而且補課單不存在、被駁回，或還在待核准 → 算未補，原因記為「請假」。
  - 當天點名是缺席（本班的點名，不含插班補課的紀錄）→ 算未補，原因記為「缺席」。
  - 當天的請假已有**核准**的補課 → 不算。
  - 請假之後當天又點了出席、遲到或早退（人其實有來）→ 不算。
- 缺席在系統裡沒辦法掛補課，所以會一直算到換期為止（使用者確認選 A，目的是提醒行政處理）。

**個別輔導（每筆報名分開算，只算本月）**
- 缺席數：本月 REGULAR 預約中，狀態為 BOOKED、日期在台北今天之前、而且（沒有點名紀錄，或點名為 ABSENT）的堂數。
- 還能約的堂數 ＝ 月額度 − 已上 − 已約，沿用 `getMonthlyQuotaStatus` 的 `quota − locked − upcoming`。
- **未補 ＝ max(0, min(缺席數, 還能約的堂數))**
- 理由：個別輔導的補課就是再約一堂一般預約，兩筆之間沒有關聯。缺席不扣堂，所以會空出額度；另外約了補的，就會把額度用掉。月底未約的堂數歸零，跟 v8 條文一致。
- 明細列出本月缺席的日期，並標示「已另約 N 堂」（N ＝ 缺席數 − 未補）。

### 服務層
新檔案 `makeupBacklogService.ts`，批次查詢，不做 N+1：
- `getClassMakeupBacklogs(pairs: {studentId, classId}[], now)` → `Map<key, { count, items: {date, reason: 'LEAVE'|'ABSENT', makeupPending: boolean}[] }>`
- `getTutoringMakeupBacklogs(enrollmentIds[], now)` → `Map<enrollmentId, { count, absentCount, rebooked, items: {date}[] }>`

  內部依報名批次撈本月預約，共用 `classifyQuotaBookings`。

### 顯示位置（UI 草稿已經使用者確認）
1. **行政學生管理 `/admin/students`**
   - 新增「未補」欄，數字是這位學生所有圍棋班加總，可排序。
   - 展開學生那一列後，每個班級也各自顯示。
2. **行政個別輔導報名管理（EnrollmentManager）**
   - 在「本月狀態」後面加「未補」欄，可排序。
3. **學生首頁票券管理清單（ClassesAndTutoringList）**
   - 大於 0 才顯示一行橘色「尚有 N 堂未補」。
- 共通樣式：
  - 大於 0 時顯示成橘色標籤「N 堂」（警示色，深夜模式要能看清楚），0 顯示灰色「—」。
  - 點標籤開 `Modal` 小彈窗「未補明細・班名/課程」，列出日期（星期）和原因；個別輔導另外顯示已另約堂數。
  - 標籤在可點的列裡面時要 `stopPropagation`，避免同時觸發列的點擊事件。
- 手機卡片模式照現有機制自動轉換，桌機的 markup 不動。

### 測試
- 圍棋：請假無補課、請假待審、請假已核准、缺席、請假後又出席、同一天請假加缺席只算一次、期別起算日之前不算、未來日期不算、插班紀錄不算。
- 個別輔導：沒點名算缺席、今天不算、另約後未補變少、額度用完時未補為 0、已取消的不算。

---

## 上線順序
- 功能一：先跑正式站 SQL（新 enum、Bill 三個欄位加外鍵、BillingSetting 兩個欄位），再 push。
- 功能二：沒有 schema 變更，直接 push。
