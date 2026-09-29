# 活動主動推播通知 設計

日期：2026-09-29
狀態：設計定案（使用者逐段同意），待寫實作計畫

## 目標

活動專區目前沒有任何通知。本次補上七種通知，全部走通知中心統一入口
`notificationService.notifyUsers`（收件夾＋Web Push，best-effort），
不直接呼叫 `pushService`。

## 使用者定案

1. 四類情境全做：新活動發布、行前提醒、異動通知當事人、行政手動推播。
2. 新活動發布：新增表單勾選框「發布後通知全體學生」，**預設勾**。
3. 「學生」的範圍＝**全體 STUDENT 帳號**（系統沒有在學／離開欄位；與能在活動專區報名的範圍一致）。
4. 編輯活動：編輯彈窗勾選框「通知已報名學生與帶隊老師」，**預設不勾**，由行政判斷。
5. 帶隊老師收：被指派／移除帶隊、行前提醒、活動異動（編輯勾選時）／刪除。
6. 手動推播對象：**已報名學生／全體學生二擇一**，另可勾「同時通知帶隊老師」。
7. 手動推播要留**發送紀錄**，顯示在後台活動詳情彈窗。

## 共通規則

- 日期一律 `formatDateWithWeekday`（`日期（星期）`）；日期區間重用既有 `formatActivityDateRange`（起訖同日只顯示一天，否則 `起 ~ 訖`）。
  日期本身已含「（星期）」，文案**不再用括號包日期**（避免「（2026/10/1（四））」括號套括號），一律以逗號或空白串接。
- **已結束的活動（`isBeforeToday(endDate)`）自動通知一律略過**——避免行政補登舊資料時亂發。
  手動推播不受此限（例如「活動照片已上傳到相簿」）。
- 學生自己報名／取消報名**不發通知**；行政端也不收報名通知（維持「行政只收需要處理的通知」）。
- 點擊網址：學生 `/student/activities`、老師 `/teacher/activities`。
- 自動通知是 best-effort：找收件人、寫收件夾、推播任一步失敗只記 log，
  **不得讓新增／編輯／刪除／報名的主流程失敗**。通知一律在寫入成功（transaction commit）後才發。

## 情境與文案

| # | 情境 | 觸發 | 收件人 | 標題 | 內容 |
|---|---|---|---|---|---|
| 1 | 新活動發布 | 新增時 `notifyStudents=true` | 全體學生帳號 | 新活動開放報名 | `{分類}｜{名稱}，{日期}，名額 {N} 位，點擊查看報名` |
| 2a | 老師被指派 | 新增，或編輯後老師名單新增者（自動，不看勾選） | 新增的老師 | 活動帶隊指派 | `你被指派帶領「{名稱}」，{日期}` |
| 2b | 老師被移除 | 編輯後老師名單被拿掉者（自動） | 被移除的老師 | 活動帶隊取消指派 | `你已不再帶領「{名稱}」，{日期}` |
| 3 | 活動資訊更新 | 編輯時 `notifyRegistered=true` | 已報名學生＋**留任**的帶隊老師（新增者只收 2a、被移除者只收 2b，不重複） | 活動資訊更新 | 見下方規則 |
| 4 | 活動取消 | 刪除活動（自動） | 已報名學生＋帶隊老師（刪除前快照） | 活動取消 | `「{名稱}」已取消，原訂 {日期}` |
| 5a | 行政代報名 | `adminRegisterStudent` 成功（自動） | 該學生 | 活動報名成功 | `行政已幫你報名「{名稱}」，{日期}{，地點：X}` |
| 5b | 行政移除報名 | `adminRemoveRegistration` 成功（自動） | 該學生 | 活動報名已取消 | `行政已取消你「{名稱}」的報名，原訂 {日期}` |
| 6 | 行前提醒 | 每日 cron，活動**第一天（startDate）＝台北明天** | 已報名學生＋帶隊老師 | 活動行前提醒 | 學生：`明天 {開始日} 是「{名稱}」{，地點：X}，記得準時參加`；多日活動改 `「{名稱}」明天 {開始日} 開始，至 {結束日}{，地點：X}`。老師：`明天 {開始日} 帶領「{名稱}」，目前報名 {N} 人{，地點：X}` |
| 7 | 手動推播 | 行政在詳情彈窗送出 | 依選擇（見下方） | `活動通知：{名稱}` | 行政輸入的訊息 |

**情境 3 內容規則**（比對編輯前後）：

- 日期有變：`日期改為 {新日期}`；地點有變：`地點改為 {新地點}`（清空寫「地點改為未定」）；兩者都變以「；」串接。
- 前綴 `「{新名稱}」`；名稱有改時寫 `「{新名稱}」（原「{舊名稱}」）`。
- 日期與地點都沒變：`「{名稱}」活動資訊已更新，點擊查看`。

**情境 6**：行前提醒只看第一天，「第一天＝明天」天然只發一次，不需旗標欄位
（比照補課提醒：cron 當天沒跑就永久跳過，接受）。「明天」＝ `taipeiDateKey(now)` 加一天
轉成 UTC 日曆日，與 `startDate` 精確相等比對（日期以 UTC 日曆日儲存的慣例）。
報名 0 人時老師仍收到（寫「目前報名 0 人」）。

## 資料表

新增一張表記錄手動推播，其餘情境不需新欄位。

```prisma
enum ActivityAnnouncementAudience {
  REGISTERED
  ALL_STUDENTS
}

// 活動手動推播的發送紀錄（行政在詳情彈窗送出的訊息）
model ActivityAnnouncement {
  id              String                       @id @default(cuid())
  activityId      String
  activity        Activity                     @relation(fields: [activityId], references: [id])
  senderId        String
  sender          User                         @relation(fields: [senderId], references: [id])
  audience        ActivityAnnouncementAudience
  includeTeachers Boolean
  message         String
  recipientCount  Int
  createdAt       DateTime                     @default(now())

  @@index([activityId, createdAt])
}
```

`Activity` 加 `announcements ActivityAnnouncement[]`、`User` 加 `activityAnnouncements ActivityAnnouncement[]`。
外鍵用 Prisma 預設 RESTRICT（比照 `markedBy` 等操作者欄位；系統沒有刪除行政帳號的功能）。
`deleteActivity` 的 transaction 要加 `activityAnnouncement.deleteMany`（發送紀錄屬於活動的附屬資料，
活動刪除就一併清掉；有出缺勤的活動本來就擋刪除）。

## 後端

### `src/lib/services/activityNotifyService.ts`（新）

負責文案組裝＋找收件人，對外函式：

- `notifyNewActivity(activityId)` — 情境 1
- `notifyTeacherAssignmentChanges(activity, addedTeacherIds, removedTeacherIds)` — 情境 2a/2b
- `notifyActivityUpdated(before, after)` — 情境 3（收件人：已報名學生＋前後都在的老師）
- `notifyActivityCancelled(snapshot)` — 情境 4（snapshot 在刪除前取得）
- `notifyAdminRegistered(activityId, studentId)`／`notifyAdminRemoved(snapshot)` — 情境 5a/5b
- `sendActivityDayBeforeReminders(now = new Date())` — 情境 6，回傳發送統計供 cron 記錄
- `sendActivityAnnouncement({ activityId, senderId, audience, includeTeachers, message })` — 情境 7，
  回傳 `{ recipientCount }`
- `listActivityAnnouncements(activityId)` — 發送紀錄（新到舊，含發送人姓名）

### `activityService.ts` 改動

- `createActivity(input, { notifyStudents })`：建立後 → 情境 2a（全部老師）＋（勾選時）情境 1。
- `updateActivity(id, input, { notifyRegistered })`：更新前抓快照（名稱、日期、地點、老師 id）→
  更新 → 算老師增減發 2a/2b → 勾選時發情境 3。
- `deleteActivity(id)`：刪除前抓報名學生＋帶隊老師快照 → 刪除（transaction 加 announcements）→ 情境 4。
- `adminRegisterStudent`／`adminRemoveRegistration`：成功後發 5a/5b（移除要在刪除前抓活動與學生快照）。
- 以上呼叫一律包 try/catch 記 log，通知失敗不拋出；已結束活動略過自動通知。
- 學生自己的 `registerForActivity`／`cancelRegistration` **不動**。

### API

- `POST /api/activities`：body 多收 `notifyStudents: boolean`；**沒帶一律視為 false**。加 `export const maxDuration = 60`（全體學生推播逐筆送，比照 `admin/billing/notify`）。
- `PUT /api/activities/[id]`：body 多收 `notifyRegistered: boolean`，沒帶視為 false。
- `DELETE /api/activities/[id]`、`/api/activity-registrations`（POST／DELETE）：API 形狀不變，通知在 service 內處理；DELETE 報名路由的學生路徑（`cancelRegistration`）不發通知。
- **新增** `GET /api/activities/[id]/announcements`（僅 ADMIN）：發送紀錄列表。
- **新增** `POST /api/activities/[id]/announcements`（僅 ADMIN，`maxDuration = 60`）：
  body `{ audience: 'REGISTERED' | 'ALL_STUDENTS', includeTeachers: boolean, message: string }` → 201 `{ recipientCount }`。

手動推播錯誤碼（在 route 驗證，全部映射成中文訊息，不外洩原始 Prisma 錯誤）：

| 狀況 | 狀態碼 | 錯誤 |
|---|---|---|
| 非 ADMIN | 403 | — |
| 訊息 trim 後空白 | 400 | `MESSAGE_REQUIRED` |
| 訊息超過 200 字 | 400 | `MESSAGE_TOO_LONG` |
| audience 不合法 | 400 | `INVALID_AUDIENCE` |
| 活動不存在 | 404 | `NOT_FOUND` |
| 收件人 0 人 | 409 | `NO_RECIPIENTS` |

手動推播流程：算收件人（去重後的 userId）→ 0 人擋下 → **先寫發送紀錄** → 才 `notifyUsers`。
紀錄寫入失敗就整個不送（寧可沒送，不要送了沒紀錄）。`recipientCount`＝去重後實際通知人數。

### Cron

`sendActivityDayBeforeReminders` 掛進 `/api/cron/daily-reminders` 的 `jobs` 清單（名稱 `activityDayBefore`），
**不開新 cron**（Vercel 免費方案上限 2 個）。

## 介面（後台 `/admin/activities`）

- **新增表單**底部：勾選框「發布後通知全體學生」，預設勾。
- **編輯彈窗**底部：勾選框「通知已報名學生與帶隊老師」，預設不勾，旁附「目前報名 N 人」。
- **刪除確認框**：活動未結束且有人報名時，訊息多一行「將通知 N 位已報名學生與帶隊老師」。
- **活動詳情彈窗**「通知紀錄」區塊標題旁放「發送通知」連結鈕（與紀錄放一起，實作計畫階段由 footer 調整至此）→ 開彈窗：
  - 訊息輸入框（共用 `Textarea`，上限 200 字，顯示字數）
  - 對象單選：已報名學生（N 人）／全體學生（M 人；M 取自頁面已載入的 `/api/students` 清單長度）
  - 勾選框「同時通知帶隊老師」
  - 送出鈕文字「發送給 X 人」；X＝所選學生數＋（勾選時）老師數，X 為 0 或訊息空白時停用
  - 成功後 toast「已通知 X 人」、關閉彈窗、重抓發送紀錄
- **詳情彈窗**報名名單下方新增「通知紀錄（N）」區塊：時間／發送人／對象／內容／人數，
  用 `CollapsibleDataTable maxRows=3`（紀錄類表格慣例）。透過 `ActivityDetail` 新增的插槽由後台頁傳入，
  學生／老師端詳情不顯示。
- 表單控件一律用共用 `Input`／`Select`／`Textarea`；勾選框沿用站內原生 `<input type="checkbox">`
  寫法（無共用元件），label 內只放勾選框與文字、不放按鈕（Safari 點擊轉發問題）。
- 「發送通知」彈窗疊在詳情彈窗上，沿用既有 `Modal`（已有 `dialogStack` 處理多層）。
- **鈴鐺**：`NotificationBell` 的 `ICON_KINDS` 末尾新增「活動」類（`match: ['活動']`、旗幟圖示），
  放最後以免搶走其他類別的比對。

## 測試

- **service 層**（真實測試 DB，不 mock 推播；VAPID 未設時推播自動略過，驗 `Notification` 表筆數與內容）：
  - 每個情境各一組正向案例
  - 勾選框沒勾不發（情境 1、3）
  - 已結束活動的自動通知不發；手動推播照發
  - 學生自己報名／取消不發
  - 老師增減／留任的收件人正確，新增者不重複收情境 3
  - 行前提醒只看第一天、多日活動文案、台北凌晨 0～8 點（UTC 前一天）的「明天」邊界
  - 手動推播：兩種 audience × 是否含老師、0 人擋下、發送紀錄內容與 `recipientCount`
- **route 層**：旗標沒帶預設 false；手動推播權限與各錯誤碼；cron 總路由含 `activityDayBefore`。
- 日期 fixture 一律 `Date.UTC(...)`，不用本地時間建構子。
- 瀏覽器實測：新增勾選、編輯勾選、刪除確認文字、發送通知彈窗＋紀錄區塊、鈴鐺活動圖示。

## 開發環境注意

- 在**隔離 worktree** 開發（有 schema 變更；主 checkout 目前有其他 session 的未 commit 改動，
  其中含 `src/app/admin/activities/page.tsx` 一行圖片壓縮參數）。merge 回 main 前要確認那些改動
  已 commit，否則 git 會拒絕合併該檔。
- worktree 用「逐套件 symlink＋`.prisma`/`@prisma` 實體複本」隔離 Prisma client；merge 後在主 checkout
  重跑 `npx prisma generate` 並重啟 dev server。
- merge 前在 worktree 跑一次 `npm run build`（`next build` 會 lint 測試檔）。

## 上線步驟

1. 使用者在 Supabase 正式站跑建表 SQL（純新增，可先於部署執行）：

```sql
CREATE TYPE "ActivityAnnouncementAudience" AS ENUM ('REGISTERED', 'ALL_STUDENTS');

CREATE TABLE "ActivityAnnouncement" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "audience" "ActivityAnnouncementAudience" NOT NULL,
    "includeTeachers" BOOLEAN NOT NULL,
    "message" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityAnnouncement_activityId_createdAt_idx" ON "ActivityAnnouncement"("activityId", "createdAt");

ALTER TABLE "ActivityAnnouncement" ADD CONSTRAINT "ActivityAnnouncement_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActivityAnnouncement" ADD CONSTRAINT "ActivityAnnouncement_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

2. push → 等 Vercel 部署完成。
3. 不需新增環境變數。真機推播由使用者實收一次確認。

## 不在範圍

- 學生使用教學 `/guide`＋PDF 更新（之後另做）
- 收件夾清理機制
- 學生自行報名／取消的通知
