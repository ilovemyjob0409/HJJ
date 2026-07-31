-- 集點卡功能 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：兩個 enum type ＋ 三張表（無 backfill，新功能從零開始）
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

-- 1) Enum types
DO $$ BEGIN
  CREATE TYPE "PointBucket" AS ENUM ('REGULAR', 'REDEEM_ONLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PointKind" AS ENUM ('TEACHER_AWARD', 'LOTTERY_COST', 'LOTTERY_WIN', 'REDEMPTION', 'ADMIN_ADJUST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) 點數流水（餘額＝各桶 amount 加總；reason 為文字快照）
CREATE TABLE IF NOT EXISTS "PointTransaction" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "bucket" "PointBucket" NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" "PointKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "teacherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PointTransaction" DROP CONSTRAINT IF EXISTS "PointTransaction_studentId_fkey";
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PointTransaction" DROP CONSTRAINT IF EXISTS "PointTransaction_teacherId_fkey";
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_teacherId_fkey"
  FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) 加分理由（行政維護）
CREATE TABLE IF NOT EXISTS "PointReason" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PointReason_pkey" PRIMARY KEY ("id")
);

-- 驗證：應回傳兩張表且各為 0 筆
SELECT
  (SELECT count(*) FROM "PointTransaction") AS point_transactions,
  (SELECT count(*) FROM "PointReason")      AS point_reasons;
