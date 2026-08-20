# Web Push 上線步驟（2026-08-20 計畫的部署清單）

依序執行；1-2 在 push 部署之前做完。

## 1. Vercel 環境變數

`npx web-push generate-vapid-keys` 產生正式金鑰（跟本地開發用的分開），在 Vercel 設定：

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = 公鑰
- `VAPID_PRIVATE_KEY` = 私鑰
- `VAPID_SUBJECT` = `mailto:<管理者 email>`

## 2. 正式站 SQL（Supabase SQL editor）

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

ALTER TABLE "Student" DROP COLUMN "lineUserId", DROP COLUMN "lineBindCode";
```

## 3. push 觸發 Vercel 部署

## 4. 上線後

- 正式站用一支真手機走一次：開啟通知 → 掃碼簽到 → 收到推播。
- LINE Developers 後台的 Messaging API channel 自行停用（程式碼已全移除，留著也不會被呼叫）。
- 使用手冊 PDF 重製（`/guide` 已更新，PDF 另行處理）。
- 提醒家長：手足共用手機時，每個小孩帳號第一次都要各按一次「開啟通知」。
