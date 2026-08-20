# Web Push 上線步驟（2026-08-20 計畫的部署清單）

依序執行；1-2 在 push 部署之前做完，**4 一定要等部署完成之後才跑**。

## 1. Vercel 環境變數

`npx web-push generate-vapid-keys` 產生正式金鑰（跟本地開發用的分開），在 Vercel 設定：

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = 公鑰
- `VAPID_PRIVATE_KEY` = 私鑰
- `VAPID_SUBJECT` = `mailto:<管理者 email>`

## 2. 正式站 SQL：建新表（Supabase SQL editor，部署前）

只跑「新增」的部分——純加法，對還在線上的舊程式碼無影響：

```sql
CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_userId_endpoint_key"
  ON "PushSubscription"("userId", "endpoint");
```

**注意：此時還不能 DROP 舊欄位**——線上跑的還是舊程式碼，Prisma 的
`findUnique`（未帶 select）會 SELECT `Student` 的所有欄位，先刪
`lineUserId`/`lineBindCode` 會讓學生端大部分 API 直接炸掉，直到新版部署完成。

## 3. push 觸發 Vercel 部署

等 Vercel 顯示 Ready、正式站確認新版上線（例如首頁看得到「開啟通知」卡片）。

## 4. 正式站 SQL：刪 LINE 欄位（部署完成之後）

新程式碼已不引用這兩個欄位，此時才能安全刪除：

```sql
ALTER TABLE "Student" DROP COLUMN "lineUserId", DROP COLUMN "lineBindCode";
```

## 5. 上線後

- 正式站用一支真手機走一次：開啟通知 → 掃碼簽到 → 收到推播。
- LINE Developers 後台的 Messaging API channel 自行停用（程式碼已全移除，留著也不會被呼叫）。
- 使用手冊 PDF 重製（`/guide` 已更新，PDF 另行處理）。
- 提醒家長：手足共用手機時，每個小孩帳號第一次都要各按一次「開啟通知」。
