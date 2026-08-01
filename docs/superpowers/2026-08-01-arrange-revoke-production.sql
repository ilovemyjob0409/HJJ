-- 行政代排補課＋補課撤銷 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：MakeupRequest 加一個 nullable 欄位
-- （家長申請撤銷的時間戳；行政確認前補課仍有效）
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

ALTER TABLE "MakeupRequest" ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMP(3);

-- 驗證：應回傳一列，data_type = timestamp without time zone
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'MakeupRequest' AND column_name = 'cancelRequestedAt';
