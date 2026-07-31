-- 補課規則改版 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push（新增兩張表）＋ prisma/backfill-periods-and-notices.ts
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

-- 1) 期紀錄表：每次報課一筆
CREATE TABLE IF NOT EXISTS "EnrollmentPeriod" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnrollmentPeriod_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EnrollmentPeriod" DROP CONSTRAINT IF EXISTS "EnrollmentPeriod_enrollmentId_fkey";
ALTER TABLE "EnrollmentPeriod" ADD CONSTRAINT "EnrollmentPeriod_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "ClassEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) 補課須知表
CREATE TABLE IF NOT EXISTS "MakeupNoticeItem" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MakeupNoticeItem_pkey" PRIMARY KEY ("id")
);

-- 3) Backfill：為每筆尚無期紀錄的報名補建第一期（堂數＝現有總堂數，NULL 視為 0）
INSERT INTO "EnrollmentPeriod" ("id", "enrollmentId", "sessions")
SELECT gen_random_uuid()::text, ce."id", COALESCE(ce."totalSessions", 0)
FROM "ClassEnrollment" ce
WHERE NOT EXISTS (SELECT 1 FROM "EnrollmentPeriod" ep WHERE ep."enrollmentId" = ce."id");

-- 4) Backfill：補課須知為空時寫入預設 4 條（之後行政可在後台自行維護）
INSERT INTO "MakeupNoticeItem" ("id", "content", "sortOrder", "updatedAt")
SELECT gen_random_uuid()::text, v.content, v.sort, CURRENT_TIMESTAMP
FROM (VALUES
  ('圍棋班：插班補課不限次數；每期課程可申請一次一對一補課。', 0),
  ('英文、數學等其他科目：僅提供插班補課，不限次數。', 1),
  ('若家長無法配合插班補課、且該期一對一補課已使用，該期請假未補課之費用將於下一期學費中扣除。', 2),
  ('補課申請若被行政人員拒絕，不會計入一對一額度，仍可再次申請。', 3)
) AS v(content, sort)
WHERE NOT EXISTS (SELECT 1 FROM "MakeupNoticeItem");

-- 驗證：兩個數字都應 > 0（第二個應為 4）
SELECT
  (SELECT count(*) FROM "EnrollmentPeriod")  AS enrollment_periods,
  (SELECT count(*) FROM "MakeupNoticeItem")  AS makeup_notices;
