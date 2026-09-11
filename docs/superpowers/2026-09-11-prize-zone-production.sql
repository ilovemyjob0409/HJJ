-- 獎品專區 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：一個 enum type＋兩張表＋PointKind 加值（無 backfill）
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔 → Storage 建私有 bucket 'prize-images' → git push 部署新程式。

-- 1) PointKind 加 REDEMPTION_REFUND
ALTER TYPE "PointKind" ADD VALUE IF NOT EXISTS 'REDEMPTION_REFUND';

-- 2) 兌換狀態 enum
DO $$ BEGIN
  CREATE TYPE "PrizeRedemptionStatus" AS ENUM ('PENDING', 'PICKED_UP', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) 獎品目錄
CREATE TABLE IF NOT EXISTS "Prize" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "imagePath" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Prize_pkey" PRIMARY KEY ("id")
);

-- 4) 兌換紀錄
CREATE TABLE IF NOT EXISTS "PrizeRedemption" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "prizeId" TEXT NOT NULL,
    "prizeName" TEXT NOT NULL,
    "redeemOnlyUsed" INTEGER NOT NULL,
    "regularUsed" INTEGER NOT NULL,
    "status" "PrizeRedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedUpAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiryRemindedAt" TIMESTAMP(3),
    "operator" TEXT,
    CONSTRAINT "PrizeRedemption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PrizeRedemption_studentId_idx" ON "PrizeRedemption"("studentId");
CREATE INDEX IF NOT EXISTS "PrizeRedemption_status_idx" ON "PrizeRedemption"("status");

ALTER TABLE "PrizeRedemption" DROP CONSTRAINT IF EXISTS "PrizeRedemption_studentId_fkey";
ALTER TABLE "PrizeRedemption" ADD CONSTRAINT "PrizeRedemption_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PrizeRedemption" DROP CONSTRAINT IF EXISTS "PrizeRedemption_prizeId_fkey";
ALTER TABLE "PrizeRedemption" ADD CONSTRAINT "PrizeRedemption_prizeId_fkey"
  FOREIGN KEY ("prizeId") REFERENCES "Prize"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 驗證：應回傳兩張表且各為 0 筆
SELECT
  (SELECT count(*) FROM "Prize")           AS prizes,
  (SELECT count(*) FROM "PrizeRedemption") AS prize_redemptions;
