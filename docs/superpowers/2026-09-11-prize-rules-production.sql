-- 獎品兌換規則 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：一張表（無 backfill，新功能從零開始）
-- 執行位置：Supabase Dashboard → SQL Editor；先跑本檔再部署新程式。

CREATE TABLE IF NOT EXISTS "PrizeRuleItem" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrizeRuleItem_pkey" PRIMARY KEY ("id")
);

-- 驗證：應回傳 0 筆
SELECT count(*) AS prize_rule_items FROM "PrizeRuleItem";
