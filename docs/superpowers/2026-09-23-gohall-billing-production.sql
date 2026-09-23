-- 弈廳收費單 正式環境一次性 SQL（冪等，可重複執行）
-- ⚠️ 草稿：功能實作完成、測試全綠後才執行；實作過程若 schema 有調整會同步更新本檔。
-- 內容：1 個 enum ＋ Bill 三個欄位（含季票外鍵與唯一鍵）＋ BillingSetting 兩個價格欄位。
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

-- 1) 弈廳帳單項目 enum
DO $$ BEGIN
  CREATE TYPE "GoHallBillItem" AS ENUM ('TICKETS', 'SEASON_PASS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Bill：弈廳帳單欄位（goHallItem 非 null＝弈廳帳單）
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "goHallItem" "GoHallBillItem";
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "goHallTickets" INTEGER;
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "seasonPassId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Bill_seasonPassId_key" ON "Bill"("seasonPassId");

DO $$ BEGIN
  ALTER TABLE "Bill" ADD CONSTRAINT "Bill_seasonPassId_fkey"
    FOREIGN KEY ("seasonPassId") REFERENCES "GoHallSeasonPass"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) BillingSetting：弈廳預設價格（0＝未設定，開單時留空讓行政填）
ALTER TABLE "BillingSetting" ADD COLUMN IF NOT EXISTS "goHallTicketPrice" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BillingSetting" ADD COLUMN IF NOT EXISTS "goHallSeasonPassPrice" INTEGER NOT NULL DEFAULT 0;

-- 4) 驗證：應回傳 3 列 Bill 欄位＋2 列 BillingSetting 欄位
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE (table_name = 'Bill' AND column_name IN ('goHallItem', 'goHallTickets', 'seasonPassId'))
   OR (table_name = 'BillingSetting' AND column_name IN ('goHallTicketPrice', 'goHallSeasonPassPrice'))
ORDER BY table_name, column_name;
