-- 請假操作者欄位（請假撤銷＋請假管理列表用） 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：一個 enum ＋ 一個 nullable 欄位（無 backfill，舊資料操作者顯示「—」）
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

DO $$ BEGIN
  CREATE TYPE "LeaveOrigin" AS ENUM ('STUDENT', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "origin" "LeaveOrigin";
