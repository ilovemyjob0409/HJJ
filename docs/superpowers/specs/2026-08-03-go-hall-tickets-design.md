# 弈廳報名資格（堂票／季票／單堂）設計

日期：2026-08-03
狀態：已與使用者確認需求與設計

## 目標與背景

弈廳現況：管理端開場次（日期、時間、名額、值班老師），學生自由報名／取消，老師與管理端可點名（`GoHallAttendance`）。目前報名**沒有任何資格與計費概念**。

本功能加入三種報名資格，讓老師／行政知道每位到場學生的計費身分：

1. **堂票**：預先購買固定堂數（如 10 堂），到場一次扣 1 堂，用完再購買
2. **季票**：有效期間內不限次數
3. **單堂**：沒有堂票也沒有季票的學生，單次計費（現場收費，系統不追蹤付款）

使用者確認的關鍵規則：

- 堂票與季票由**管理員後台登記**（學生線下繳費），不做線上金流。
- **到場才扣堂**：報名不扣、取消不扣；老師點名標「到場」當下才扣 1 堂，**缺席／請假不扣**。
- **資格自動判定，季票一律優先**：有效季票 → 季票；否則堂票餘額 > 0 → 堂票；否則單堂。學生不用選。
- 堂票**留異動紀錄**（帳本），餘額由帳本加總。
- 季票效期由管理員**自由設起訖日**。
- 單堂**不追蹤付款狀態**，只在名單上標記資格供現場收費。
- 堂票低堂數時**比照課程低堂數 LINE 提醒**。
- 報名流程**完全不動**：任何學生都能報名（最差就是單堂），與票券無關。

## 第一版不做（明確排除）

線上購票金流、單堂付款追蹤、季票暫停／轉讓、堂票效期、學生端查看他人資格、自助打卡納入弈廳（現況本來就沒有）。

## 方案選擇

採**「點名定案＋票券帳本」**：資格在點名標到場的當下才判定並戳記，而非報名時快照。理由：與「到場才扣、缺席不扣」語意一致；報名到上課之間餘額／季票隨時會變，報名時的快照必然失真，點名時仍得重判。

## 資料模型（Prisma，全部為新增）

```prisma
enum GoHallQualification {
  SEASON_PASS   // 季票
  TICKET        // 堂票
  SINGLE        // 單堂
}

enum GoHallTicketKind {
  PURCHASE      // 購買 +N（管理員登記）
  ATTEND        // 到場扣堂 -1（系統自動，關聯場次）
  ADMIN_ADJUST  // 管理員調整 ±N（附原因）
}

model GoHallTicketTransaction {
  id        String           @id @default(cuid())
  studentId String
  student   Student          @relation(fields: [studentId], references: [id])
  amount    Int              // 正＝加堂、負＝扣堂
  kind      GoHallTicketKind
  reason    String?          // ADMIN_ADJUST 原因等文字快照
  sessionId String?          // ATTEND 時關聯的弈廳場次；場次被刪時保留帳、關聯設 null
  session   GoHallSession?   @relation(fields: [sessionId], references: [id], onDelete: SetNull)
  createdAt DateTime         @default(now())
}

model GoHallSeasonPass {
  id        String   @id @default(cuid())
  studentId String
  student   Student  @relation(fields: [studentId], references: [id])
  startDate DateTime // 含當日
  endDate   DateTime // 含當日
  createdAt DateTime @default(now())
}
```

既有模型加欄位：

- `GoHallAttendance.qualification GoHallQualification?` — 標到場時戳記當次資格；非到場為 null
- `Student.goHallLowQuotaNotifiedAt DateTime?` — 低堂數提醒防重複
- `Student`、`GoHallSession` 增加反向關聯

堂票餘額 = `GoHallTicketTransaction.amount` 加總，不另存欄位（與點數卡一致）。
季票有效判定：場次日期落在任一 `GoHallSeasonPass` 的 `[startDate, endDate]`（含頭尾，date-only 比較）。多筆區間可並存，續買下一季即新增一筆，天然留歷史。

## 核心邏輯（goHallTicketService ＋ attendanceService 掛鉤）

「到場」＝ `PRESENT`／`LATE`／`LEFT_EARLY`；`ON_LEAVE`／`ABSENT`／`NOT_REGISTERED` 不算。

`saveGoHallAttendance` 逐筆在同一資料庫交易內：

1. **轉為到場且尚無資格戳記** → 當下判定：季票有效 → `SEASON_PASS`；否則餘額 > 0 → `TICKET` 並寫入 `ATTEND -1`（帶 sessionId）；否則 `SINGLE`。戳記寫入 `GoHallAttendance.qualification`。
2. **已有戳記且仍是到場**（重複儲存、`PRESENT`↔`LATE` 互改）→ 保留原戳記，不重判、不重扣（冪等）。
3. **從到場轉為非到場** → 刪除該 (studentId, sessionId) 的 `ATTEND` 帳（退堂），戳記清為 null。
4. `clearGoHallAttendance` → 同步刪除對應 `ATTEND` 帳。
5. 併發防重複扣：沿用 `runSerializableWithRetry`（同弈廳報名滿額檢查）。

判定用的是**場次日期**（不是點名操作日），補點名也不會誤判季票效期。

歷史場次（功能上線前）不做回填、不設上線日門檻：若事後補改舊場次點名，一樣依當下票券狀態判定扣堂；不符預期時管理員可用「調整」退回。

## 低堂數 LINE 提醒

- 觸發：`ATTEND` 扣堂後餘額 ≤ 3 且 `goHallLowQuotaNotifiedAt` 為 null → 推播「【MUP】{姓名} 弈廳堂票剩餘：{X} 堂，請盡快與行政人員聯繫續購」，寫入時間戳。
- 重置：登記 `PURCHASE` 或正向 `ADMIN_ADJUST` 時清為 null，下次低堂數會再提醒。
- 推播失敗不影響點名儲存（try/catch，比照 `maybeNotifyLowQuota`）。

## API（權限沿用現有 role 檢查）

| 端點 | 權限 | 用途 |
|---|---|---|
| `GET /api/go-hall-tickets/summary` | ADMIN | 全部學生：堂票餘額＋季票效期（票券管理列表） |
| `GET /api/go-hall-tickets/[studentId]` | ADMIN | 單一學生：餘額＋帳本明細＋季票清單 |
| `POST /api/go-hall-tickets/purchase` | ADMIN | 登記購買 +N 堂（N ≥ 1 整數） |
| `POST /api/go-hall-tickets/adjust` | ADMIN | 調整 ±N（必填原因；餘額不可為負） |
| `POST /api/go-hall-season-passes` | ADMIN | 新增季票（startDate、endDate） |
| `DELETE /api/go-hall-season-passes/[id]` | ADMIN | 刪除季票（登記錯誤時用） |
| `GET /api/go-hall-tickets/me` | STUDENT | 自己的餘額＋季票效期 |

既有名單 API 加資格欄位（僅回給 ADMIN／TEACHER；學生看到的場次名單維持只有名字）：

- `GET /api/go-hall-sessions/[id]`（場次名單 Modal）
- 弈廳點名 roster（`getGoHallRoster`）

已點名 → 回戳記；未點名 → 即時預估（同一套判定函式）。

## UI

**學生弈廳頁**（`student/go-hall`）：頂部加「**票券管理**」卡片（名稱為使用者指定）——

- 有效季票：「季票有效期至 2026/10/31（六）」（日期一律 `formatDateWithWeekday`）
- 有堂票：「堂票剩餘 8 堂」
- 都沒有：「目前以單堂計費（現場收費）」

卡片與 summary 的「季票效期」皆以**今日有效**的那筆為準；只有未來才生效的季票顯示於管理端單人 Modal 的季票清單，不影響學生卡片判定。
- 其餘報名／取消流程不變；骨架屏與動效沿用現有 `animate-*` pattern

**管理端 `admin/go-hall`**：加「**票券管理**」區塊（與場次管理並列）——學生列表（姓名、學號、堂票餘額、季票效期），可搜尋；點開單人 Modal：購買堂票、調整（附原因）、新增／刪除季票、帳本明細。版型比照點數卡後台（`admin/points`）。

**點名名單**（`AttendanceHub` 弈廳 roster，老師＋管理端）：每位學生加資格標籤——季票／堂票／**單堂（醒目樣式，提醒現場收費）**；未點名前顯示「預計」資格。

**管理端場次名單 Modal**：報名者列表同樣加資格標籤。

## 錯誤處理

- `INSUFFICIENT_TICKETS`：調整後餘額為負 → 擋下
- `INVALID_AMOUNT`：購買／調整非整數或購買 < 1
- `INVALID_RANGE`：季票 endDate 早於 startDate
- 併發重複點名：serializable 交易＋重試，不會重複扣堂
- 餘額 0 之後到場 → 自動落單堂，餘額永不為負

## 測試（vitest，沿用 resetDb 共用測試庫 pattern）

- goHallTicketService：購買／調整／餘額加總、負餘額擋下、季票區間含頭尾判定
- 點名扣堂：到場扣 1、缺席不扣、到場改缺席退堂、清除點名退堂、重複儲存冪等、`PRESENT`↔`LATE` 不重扣、季票優先於堂票、餘額 0 落單堂、判定以場次日期為準
- 低堂數提醒：≤3 觸發一次、再扣不重發、購買後重置再觸發、未綁 LINE 不發
- roster 資格欄位：已點名回戳記、未點名回預估

## 上線步驟

Prisma migration 全為新增（兩張表、兩個 enum、兩個欄位），無需回填。比照先前功能：產出 production SQL（`docs/superpowers/`）→ 正式站 Supabase 跑 SQL → push → Vercel 部署。
