# LINE 官方帳號通知 Design

## 目的

現有系統完全沒有對外通知管道（沒有 Email、簡訊、LINE）。這個功能讓家長透過 LINE 官方帳號收到三種即時通知：簽到/簽退、低餘堂提醒、補課申請審核結果。

系統裡所謂「學生帳號」實際使用者就是家長本人（家長用學生的帳號登入），所以「通知家長」等同「通知這個學生帳號綁定的 LINE」。系統目前只有 ADMIN / TEACHER / STUDENT 三種登入角色，沒有獨立的家長登入，因此綁定流程由行政人員在後台代為完成，不需要家長自己登入系統操作。

**技術現況**：LINE Notify 已於 2025-03-31 停用，本設計採用官方目前推薦的 **LINE 官方帳號 + Messaging API**。

## 前提：LINE 官方帳號需開通 Messaging API（一次性，需使用者自行操作）

使用者已有 LINE 官方帳號，但尚未開通 Messaging API。開通步驟（會寫成 `/admin/line-setup` 頁面的教學內容，操作本身需使用者自己完成，因為需要驗證官方帳號擁有權）：

1. 登入 [LINE Official Account Manager](https://manager.line.biz/)，選擇該官方帳號
2. 設定（右上角）→ Messaging API → 「啟用 Messaging API」
3. 選擇既有 Provider 或建立新的（填公司/單位名稱）
4. 開通後會產生一個 Channel，記下畫面上的 **Channel ID** 與 **Channel secret**
5. 到 [LINE Developers](https://developers.line.biz/) 主控台，找到剛剛建立的 Channel → Messaging API 分頁 → 「Channel access token（長期）」→ 點擊「發行」，複製 token
6. 同一頁面記下 Bot 的 **Basic ID**（`@xxx` 格式），用來組合「加好友＋預填訊息」連結
7. Webhook URL 欄位填入 `https://hjj-phi.vercel.app/api/line/webhook`，並開啟「使用 Webhook」
8. 建議關閉 LINE Official Account Manager 內建的「自動回應訊息」「加入好友歡迎訊息」，避免跟我們自己的機器人回覆邏輯打架
9. 把 Channel access token / Channel secret / Basic ID 貼到 Vercel 環境變數（跟先前資料庫遷移一樣，這步驟需使用者自己到 Vercel 後台操作，因為正式站環境變數對本工具不可見）

新增環境變數（`.env.example` 需同步更新，本機開發若沒有真實憑證，LINE 相關功能在本機會是 no-op）：

```
LINE_CHANNEL_ACCESS_TOKEN=""
LINE_CHANNEL_SECRET=""
LINE_OA_BASIC_ID=""
```

## 資料模型變更

`prisma/schema.prisma`（透過 `npx prisma db push` + `npm run test:dbpush` 套用，本專案沒有 migrations 資料夾，不使用 `prisma migrate`；正式站需使用者自行在 Supabase SQL Editor 執行對應 SQL，做法比照先前的 FaqItem）：

```prisma
model Student {
  // ...existing fields...
  lineUserId    String?  @unique   // 已綁定家長的 LINE userId，null 代表未綁定
  lineBindCode  String?  @unique   // 行政人員產生、待家長掃碼送出的綁定碼；綁定成功後清空
}

model ClassEnrollment {
  // ...existing fields...
  lowQuotaNotifiedAt DateTime?  // 這一輪低餘堂通知是否已發過；行政人員調整 totalSessions 時重置為 null
}
```

## 綁定流程（行政人員代為操作，家長不需登入系統）

1. 行政人員打開 `/admin/students` 學生編輯頁，新增「LINE 通知」區塊，未綁定時顯示「未綁定」狀態
2. 按「產生綁定 QR code」→ 呼叫 API 產生一組隨機 `lineBindCode` 存進該學生資料 → 畫面顯示 QR code
3. QR code 內容是 `https://line.me/R/oaMessage/@{LINE_OA_BASIC_ID}/?{綁定碼}`（LINE 官方支援的「加好友＋預填訊息」URL scheme，家長掃碼後直接進入對話框、文字已預填好，按送出即可，不需要自己輸入）
4. 行政人員把畫面給家長看（櫃檯當面出示，或視訊/電話時用手機拍給對方）掃碼
5. 家長掃碼、加官方帳號好友（若還不是好友）、送出訊息
6. `/api/line/webhook` 收到訊息事件，比對 `lineBindCode`：
   - 找到相符的學生 → 寫入 `Student.lineUserId`，清空 `lineBindCode` → 機器人回覆「綁定成功，之後會通知您 {學生姓名} 的點名與補課申請結果」
   - 找不到相符的（碼過期/打錯字）→ 機器人回覆「綁定碼無效，請洽行政人員重新產生」
7. 編輯頁狀態變成「已綁定」，並提供「解除綁定」按鈕（家長換手機號碼/封鎖官方帳號時，行政人員可以手動解除、重新綁定）

若行政人員在舊綁定碼還沒被使用前又按了一次「產生」，新碼會直接覆蓋舊碼（舊碼自動失效），不需要額外的碼過期機制。

綁定碼格式：8 碼隨機大寫英數字（`crypto.randomBytes` 產生），webhook 比對時取訊息文字 trim 後完全比對（QR 預填訊息只會是這組碼本身，不需要子字串搜尋）。

## 通知事件與內容

三種通知都是「附加動作」：對應的主流程（簽到、審核）一定要先成功，LINE 推播失敗只記錄伺服器 log，不影響主流程、不讓使用者看到錯誤。學生若未綁定 LINE（`lineUserId` 為 null）則直接跳過推播，不算錯誤。

### 1. 簽到／簽退

觸發點：`attendanceService.ts` 的 `checkInByStudentNumber` 與 `resolveCheckIn`，在對應課程的出席紀錄成功寫入後。

- 簽到：`【MUP】{學生姓名} 已於 {時間} 完成簽到（{課程名稱}）`
- 簽退：`【MUP】{學生姓名} 已於 {時間} 完成簽退（{課程名稱}）`

### 2. 低餘堂提醒

觸發點：僅在櫃檯點名（`checkInByStudentNumber` / `resolveCheckIn`）成功寫入**班級**出席後檢查，行政人員在班級點名表手動補記**不**觸發（避免大量補登資料時對舊資料重複觸發）。一對一補課簽到（`applyOneOnOneAttendance`，沒有對應的 `ClassEnrollment.totalSessions` 堂數概念）不觸發此檢查。

寫入出席後，重新計算該學生在該班級的 `remaining = totalSessions - usedSessions`；若 `remaining !== null && remaining <= 3 && enrollment.lowQuotaNotifiedAt === null`：推播訊息、並將 `lowQuotaNotifiedAt` 設為現在時間（同一輪只發一次，不會每天報到都收到）。

行政人員之後在學生編輯頁調整該堂課的「總堂數」（幫家長續費）時，把 `lowQuotaNotifiedAt` 重置為 `null`，下一輪低於門檻會重新觸發。

訊息內容：`【MUP】{學生姓名} 目前剩餘堂數：{remaining} 堂，請盡快與行政人員聯繫續費`

### 3. 補課申請審核結果

觸發點：`makeupRequestService.ts` 的 `decideMakeupRequest`，決定結果（含 REJECTED）寫入成功後。

- 核准：`【MUP】{學生姓名}的補課申請已核准：{日期}（{星期}）{班級名稱} {時段}`
- 拒絕：`【MUP】{學生姓名}的補課申請未通過，請洽行政人員`

### 明確不做（範圍外）

- 請假申請：資料庫裡請假是即時自動核准（`LeaveStatus` 只有 `APPROVED` 一個值，沒有審核流程），本輪不加送出通知
- 老師、行政人員收到的 LINE 通知：本輪三個事件都只通知家長，之後若有老師/行政人員要收通知的需求再另外設計綁定方式（他們已有系統登入帳號，屆時可以走更簡單的登入內綁定，不需要今天這套代客綁定流程）
- 家長取消好友（unfollow）不會自動解除綁定，行政人員需手動在編輯頁按「解除綁定」

## 頁面與 API

### `/admin/line-setup`（新頁面，ADMIN 專用）

不放進主導覽列，避免佔用既有導覽空間。從學生編輯頁「LINE 通知」區塊的「查看設定教學」連結進入。內容分兩塊：
1. 一次性技術設定教學（前面「前提」章節的步驟）
2. 日常操作教學：行政人員如何幫家長綁定（產生 QR → 給家長掃 → 確認已綁定的畫面流程文字說明）

### API 路由

- `POST /api/line/webhook`：LINE 平台呼叫，需驗證 `x-line-signature` header（用 Channel secret 對原始 request body 算 HMAC-SHA256 比對，簽章邏輯拆成 `lineService.ts` 裡的獨立函式以便測試）。處理文字訊息事件：比對綁定碼、寫入 `Student.lineUserId`、呼叫 LINE Reply API 回覆結果。非文字訊息或不符合綁定碼格式的訊息忽略即可。
- `POST /api/students/[id]/line-bind-code`（ADMIN）：產生新的 `lineBindCode`，回傳碼與組好的 QR 連結內容
- `POST /api/students/[id]/line-unbind`（ADMIN）：清空該學生的 `lineUserId`

### 服務層 `src/lib/services/lineService.ts`

- `generateBindCode(studentId): Promise<{ code: string; addFriendUrl: string }>`
- `unbindStudent(studentId): Promise<void>`
- `verifyWebhookSignature(rawBody: string, signature: string): boolean`（純邏輯，可真實測試）
- `handleIncomingMessage(lineUserId: string, text: string): Promise<{ replyText: string }>`（比對綁定碼、寫入綁定，回傳要回覆的文字；不含實際發送）
- `pushLineMessage(lineUserId: string, text: string): Promise<void>`（呼叫 LINE Push API，包一層 try/catch，失敗只 log 不 throw）
- `replyLineMessage(replyToken: string, text: string): Promise<void>`（呼叫 LINE Reply API，用於 webhook 內的綁定成功/失敗回覆）

`attendanceService.ts`（`checkInByStudentNumber`、`resolveCheckIn`）與 `makeupRequestService.ts`（`decideMakeupRequest`）在對應成功路徑後呼叫 `pushLineMessage`，呼叫失敗不影響回傳結果。

## 測試方式（含現有慣例的例外）

- `generateBindCode`、`unbindStudent`、`handleIncomingMessage`、低餘堂旗標重置邏輯：比照現有慣例，寫真實資料庫 Vitest 測試，不 mock
- `verifyWebhookSignature`：純邏輯，用已知 secret/簽章配對做真實單元測試
- `pushLineMessage`、`replyLineMessage`：這是目前專案「服務層一律真實測試、不 mock」慣例裡唯一的例外——需要 mock 掉對 LINE 伺服器的 HTTP 呼叫本身（沒有真實憑證可用，也不該在測試中真的發訊息給人）
- API 路由與 `/admin/students`、`/admin/line-setup` 頁面：零測試檔案，比照慣例只靠 `tsc --noEmit` + `eslint` + 手動瀏覽器檢查驗證
