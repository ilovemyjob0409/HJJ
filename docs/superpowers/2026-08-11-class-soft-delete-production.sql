-- 班級軟刪除 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：Class 新增 active 欄位（預設 true），無現有資料異動。
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
