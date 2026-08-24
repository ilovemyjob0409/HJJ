# 通知中心（小鈴鐺收件夾）設計

日期：2026-08-24
狀態：已與使用者定案
關聯：[2026-08-24-makeup-request-notifications-design.md](2026-08-24-makeup-request-notifications-design.md)（補課申請通知四情境，依賴本篇的統一發送入口）

## 背景與目標

- 全站通知目前只有 Web Push：沒開推播權限（或推播失敗）的使用者什麼都收不到，事後也無從回看。
- 目標：頁首（登出鈕旁）新增**小鈴鐺收件夾**，三端（學生／老師／行政）都有，把該使用者收到的**所有通知**存起來可回看；發通知的統一入口＝「寫進收件夾＋發推播」。

## 已定案的決策

1. **三端都要**：學生／老師／行政的 AppShell 頁首都有鈴鐺。
2. **逐則點擊才算已讀**：每則通知有自己的已讀狀態，點了才消；未讀數＝未讀則數。
3. **要有「一鍵已讀」按鈕**（使用者明確要求）：面板頂部提供「全部標為已讀」。
4. 架構採 **Notification 資料表＋統一發送入口**：全站現有推播呼叫點改走統一入口，推播行為不變、多寫一筆收件夾（沒訂閱推播的人也收得到站內通知）。

## 資料模型（schema 變更）

```prisma
model Notification {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  title     String
  body      String
  url       String?
  readAt    DateTime? // null = 未讀
  createdAt DateTime  @default(now())

  @@index([userId, createdAt])
  @@index([userId, readAt])
}
```

- `User` 加對應 relation 欄位 `notifications Notification[]`。
- **正式站部署**：加表＋索引是相容變更；比照 web-push 慣例，先對正式 DB 跑 `CREATE TABLE`／`CREATE INDEX` SQL，再 push 觸發 Vercel 部署。
- 保留策略：暫不自動清除（列表只取最近 50 則，資料量可控；未來需要再加清理 cron）。

## 服務層（新檔 `src/lib/services/notificationService.ts`）

統一發送入口——**先寫 DB、再發推播**，推播失敗只記 log（沿用現有慣例），DB 寫入失敗也只記 log 不影響主流程（通知永遠是 best-effort，不能弄掛業務動作）：

```ts
notifyUser(userId, { title, body, url }): Promise<void>   // 寫 1 筆 + pushToUser
notifyUsers(userIds, payload): Promise<void>              // 每人 1 筆 + pushToUsers
notifyAdmins(payload): Promise<void>                      // 查全部 ADMIN user → 每人 1 筆 + pushToAdmins
```

查詢／已讀：

```ts
listNotifications(userId, limit = 50): Promise<NotificationRow[]>  // createdAt desc
countUnread(userId): Promise<number>
markRead(notificationId, userId): Promise<void>    // 僅本人；已讀過的再標不報錯（冪等）
markAllRead(userId): Promise<void>                 // updateMany readAt=null → now
```

- `pushService` 降級為純傳輸層：業務程式碼不再直接 import `pushToUser/pushToUsers/pushToAdmins`，只有 `notificationService`（與推播訂閱測試端點）使用。

## 現有呼叫點遷移

全站所有 `pushToUser`／`pushToUsers`／`pushToAdmins` 業務呼叫點改為對應的 `notifyUser`／`notifyUsers`／`notifyAdmins`，payload（title/body/url）逐字不變。涵蓋（以實際 grep 為準）：

- `makeupRequestService.ts`（補課送審→行政、核准/駁回/撤銷→家長、一對一→老師）
- `tutoringBookingService.ts`（預約/取消→老師、超額送審→行政、審核結果→學生、缺席提醒、額度提醒）
- 其他 service 內的推播點（請假、代課、弈廳等，依 grep 結果全數遷移，不得遺漏）

## API

- `GET /api/notifications` → `{ unread: number, rows: [{ id, title, body, url, readAt, createdAt }] }`（最近 50 則，登入者本人）
- `PATCH /api/notifications/[id]` → 標單則已讀（僅本人，非本人 403、不存在 404）
- `POST /api/notifications/read-all` → 全部標為已讀
- 三端任何已登入角色皆可用；只能操作自己的資料。

## 鈴鐺 UI（`AppShell.tsx` 右側按鈕群，手足切換選單之後、主題切換之前）

- 鈴鐺 icon 按鈕＋未讀徽章（紅底小圓點數字，>9 顯示「9+」；0 則不顯示徽章）。
- 點開下拉面板（重用手足切換選單的 pattern：`relative`＋絕對定位卡片＋`animate-fade-in`，寬 `w-80 max-w-[90vw]`，內容超高時 `max-h-96 overflow-y-auto`）：
  - 頂部列：「通知」標題＋右側**「全部標為已讀」**文字按鈕（永遠顯示，未讀 0 時 disabled）。
  - 每則：title（粗體）、body（`text-inkMuted` 小字）、時間（`M/D（週N） HH:mm`，日期部分沿用 `formatDateWithWeekday` 慣例）；未讀則左側帶 pending 色小圓點、底色 `bg-stripe` 區隔。
  - 點一則 → 呼叫單則已讀 API → 有 `url` 就導頁（`window.location.href`，跨區塊導頁要吃到最新資料）、沒有就地標已讀。
  - 空狀態：「目前沒有通知」。
- 關閉行為：再點鈴鐺、點面板外、按 Esc 皆關閉（外點偵測用 document mousedown listener，比手足切換選單多補這個，避免面板常駐擋畫面）。
- 未讀數更新時機：AppShell 掛載時、開面板時、`visibilitychange`（回到分頁時）重抓——不做輪詢。
- 動效／配色全部沿用既有 token 與 `animate-*` class，不另創動畫。

## 測試

- 服務層：notifyUser 寫 DB＋（不拋錯的）推播；notifyAdmins 對每個 ADMIN 各寫一筆；listNotifications 排序與 limit；countUnread；markRead 僅本人（他人 NOT_OWNER）；markAllRead 冪等。
- API：GET 需登入、只回自己的；PATCH 非本人 403、不存在 404；read-all 生效。
- 遷移驗證：既有 service 測試全綠（呼叫點改名不改行為）；grep 確認業務程式碼不再直接 import pushService 發送函式。
