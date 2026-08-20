# MUP 網頁推播通知（取代 LINE）設計

日期：2026-08-20
狀態：已與使用者確認定案

## 背景與目標

現行通知走 LINE 官方帳號（`lineService.ts`），使用者決定不再使用 LINE，
改為「直接推到手機」——即自架 Web Push（VAPID），網站升級為 PWA。
LINE 相關程式碼全數移除，不做過渡期雙發。

已確認的決策：

- 技術方案：自架 Web Push（`web-push` npm 套件＋VAPID 金鑰），不用 FCM、不用 SaaS。
- iOS 門檻可接受：iPhone 需 iOS 16.4+，且必須先「加入主畫面」（安裝 PWA）
  再開啟通知；系統內提供圖文引導。
- 推播對象：學生（家長）＋老師＋行政。
- LINE 直接停用並移除所有相關程式碼與欄位。

## 架構總覽

- 網站加上 `manifest.webmanifest` 與 Service Worker（`public/sw.js`），成為可安裝的 PWA。
- 新增 `src/lib/services/pushService.ts` 作為唯一通知出口，取代 `lineService.ts`。
- 所有原本呼叫 `pushLineMessage` 的觸發點改呼叫 pushService；另新增老師／行政的觸發點。
- 訂閱資料存自家 Supabase Postgres（Prisma model）。

## 資料模型

新增 model：

```prisma
model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  endpoint  String
  p256dh    String
  auth      String
  userAgent String?
  createdAt DateTime @default(now())

  @@unique([userId, endpoint])
}
```

要點：

- 唯一鍵是 **(userId, endpoint)**，不是 endpoint 單獨唯一。同一支手機（同一 endpoint）
  可綁多個帳號——配合「手足帳號快速切換」，家長一支手機收得到所有小孩的通知。
  每次登入某帳號並啟用（或已啟用）通知時，前端把目前訂閱 upsert 到該帳號名下。
- 推播回應 404/410（訂閱失效）時，刪除該 endpoint 的**所有**列（跨帳號）。
- `Student.lineUserId`、`Student.lineBindCode` 從 schema 移除；正式站跑 DROP COLUMN。

## pushService（伺服器端）

- `saveSubscription(userId, subscription, userAgent?)`：upsert 訂閱。
- `removeSubscription(userId, endpoint)`：使用者主動關閉通知時移除。
- `pushToUser(userId, payload)`：發給該 user 的所有訂閱。
- `pushToUsers(userIds, payload)`。
- `pushToAdmins(payload)`：發給所有 role=ADMIN 的 user。
- payload 形狀：`{ title, body, url }`（url 為點擊後開啟的站內路徑）。
- VAPID 環境變數：`NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`。
- 容錯沿用 LINE 模式：發送失敗只 `console.error`，絕不影響主流程；
  未設定金鑰時 log 後直接略過（本地開發不炸）。

## API 路由

- `POST /api/push/subscribe`：需登入；body 為瀏覽器 PushSubscription JSON＋userAgent，
  綁到 session user。
- `DELETE /api/push/subscribe`：需登入；依 endpoint 移除 session user 名下的訂閱。

## Service Worker 與 PWA

- `public/sw.js`：`push` 事件 → `showNotification(title, { body, icon, badge, data: { url } })`；
  `notificationclick` → 聚焦既有分頁或開新視窗導向 `data.url`。
- `public/manifest.webmanifest`：name/short_name「MUP」、`display: standalone`、
  `start_url: /`、theme/background 顏色配合現有深淺色設計、192/512 icon
  （從現有 `public/logo.png` 產生）。
- `layout.tsx` metadata 加 manifest 連結、`apple-touch-icon`、iOS standalone 相關 meta。

## 通知事件對照表

| 事件 | 觸發點 | 收件人 | 點擊開啟 |
|---|---|---|---|
| 簽到／簽退完成 | attendanceService | 學生 | 學生首頁 |
| 剩餘堂數過低 | attendanceService | 學生 | 學生首頁 |
| 弈廳堂票過低 | attendanceService | 學生 | 學生首頁 |
| 補課核准／駁回／撤銷 | makeupRequestService | 學生 | 學生首頁 |
| 個輔月額度提醒 | tutoring-quota-reminder cron | 學生 | 個輔預約頁 |
| 新補課申請送出 | 請假／補課申請建立流程 | 全體行政 | 補課審核頁 |
| 學生預約個輔 | tutoringBookingService | 全體行政＋該時段老師 | 各自管理頁 |
| 學生取消個輔 | tutoringBookingService | 全體行政＋該時段老師 | 各自管理頁 |
| 被指派代課／一對一 | 指派流程 | 該老師 | 老師首頁 |

訊息格式：標題放事件名（例：「簽到完成」），內文為原【MUP】訊息去掉前綴的內容
（推播本身已顯示來源為 MUP）。日期一律沿用 `formatDateWithWeekday`（日期＋星期慣例）。

## 前端 UX

- 共用元件 `NotificationSetupCard`，放在學生／老師／行政三端首頁：
  - 瀏覽器支援且未訂閱 → 顯示說明＋「開啟通知」按鈕（用共用 Button／loading 慣例）。
  - iPhone Safari 未安裝 PWA（`!navigator.standalone` 且 UA 為 iOS）→
    顯示「加入主畫面」圖文步驟，不顯示按鈕。
  - 已訂閱 → 低調的已啟用狀態（可收合／可關閉通知）。
  - 權限被拒 → 顯示如何到瀏覽器設定重新允許。
- 動效與元件遵守現有慣例（animate-*、共用 Input/Select、Modal）。
- `/guide` 使用教學：移除 LINE 綁定章節，新增「開啟通知」章節
  （Android 與 iPhone 分開圖解）。PDF 重製列為後續步驟（重製方法已有紀錄）。

## 要移除的 LINE 程式碼

- `src/lib/services/lineService.ts`＋`lineService.test.ts`
- `src/app/api/line/webhook/route.ts`
- `src/app/api/students/[id]/line-bind-code/route.ts`
- `src/app/api/students/[id]/line-unbind/route.ts`
- `src/app/admin/line-setup/` 整頁
- `src/app/admin/students/page.tsx` 內的 LINE 綁定 UI
- `src/app/guide/page.tsx` 的 LINE 章節
- schema 的 `lineUserId`、`lineBindCode`
- LINE 環境變數（`LINE_OA_BASIC_ID`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`）

## 錯誤處理

- 推播失敗（網路錯誤、閘道 5xx）：log 後略過，主流程不受影響。
- 404/410：刪除該 endpoint 全部訂閱列。
- 未設 VAPID 金鑰：log 後跳過（開發環境友善）。
- 訂閱 API：未登入 403 `{ error: 'Forbidden' }`（全站慣例，不用 401）；body 格式不符 400。

## 測試

- pushService 單元測試：mock `web-push`，驗證多裝置發送、410 自動清理、
  pushToAdmins 的角色篩選、金鑰未設定時安全略過。
- 各事件觸發點的既有 service 測試：由斷言 `pushLineMessage` 改為斷言 pushService。
- 訂閱 API 測試：授權、upsert、刪除。
- 瀏覽器手動驗證：dev server 實測訂閱→發送→點擊導向。

## 部署（上線時）

1. `npx web-push generate-vapid-keys` 產生金鑰；Vercel 設
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`。
2. 正式站 SQL：`CREATE TABLE "PushSubscription" ...`＋
   `ALTER TABLE "Student" DROP COLUMN "lineUserId", DROP COLUMN "lineBindCode"`。
3. push 觸發 Vercel 部署。
4. LINE Developers 後台 channel 由使用者自行停用。
