-- 弈廳報名資格（堂票／季票／單堂） 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：兩個 enum ＋ 兩張表 ＋ 兩個欄位（無 backfill，歷史點名不回填資格）
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

-- 1) Enum types
DO $$ BEGIN
  CREATE TYPE "GoHallQualification" AS ENUM ('SEASON_PASS', 'TICKET', 'SINGLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "GoHallTicketKind" AS ENUM ('PURCHASE', 'ATTEND', 'ADMIN_ADJUST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) 堂票帳本（餘額＝amount 加總）
CREATE TABLE IF NOT EXISTS "GoHallTicketTransaction" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" "GoHallTicketKind" NOT NULL,
    "reason" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoHallTicketTransaction_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GoHallTicketTransaction" DROP CONSTRAINT IF EXISTS "GoHallTicketTransaction_studentId_fkey";
ALTER TABLE "GoHallTicketTransaction" ADD CONSTRAINT "GoHallTicketTransaction_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GoHallTicketTransaction" DROP CONSTRAINT IF EXISTS "GoHallTicketTransaction_sessionId_fkey";
ALTER TABLE "GoHallTicketTransaction" ADD CONSTRAINT "GoHallTicketTransaction_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "GoHallSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) 季票（一筆一個起訖區間，含頭尾）
CREATE TABLE IF NOT EXISTS "GoHallSeasonPass" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GoHallSeasonPass_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GoHallSeasonPass" DROP CONSTRAINT IF EXISTS "GoHallSeasonPass_studentId_fkey";
ALTER TABLE "GoHallSeasonPass" ADD CONSTRAINT "GoHallSeasonPass_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) 既有表加欄位
ALTER TABLE "GoHallAttendance" ADD COLUMN IF NOT EXISTS "qualification" "GoHallQualification";
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "goHallLowQuotaNotifiedAt" TIMESTAMP(3);
