-- 收費模組 schema（批次/帳單/繳款/停課日/級距/設定） 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：5 個 enum ＋ 6 張表 ＋ 既有表（Class／ClassEnrollment／
-- TutoringEnrollment）各加一個收費相關欄位；BillingSetting 塞入單列預設值。
-- 國定假日種子資料由 Task 2 產生後，會附加在本檔案末尾（見檔尾佔位註解）。
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

-- 1) Enum types
DO $$ BEGIN
  CREATE TYPE "ClosedDaySource" AS ENUM ('NATIONAL', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BillingKind" AS ENUM ('CLASS', 'TUTORING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BillingBatchStatus" AS ENUM ('DRAFT', 'FINALIZED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BillStatus" AS ENUM ('DRAFT', 'FINALIZED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) 停課日曆（唯一來源；預載國定假日=source NATIONAL，見檔尾）
CREATE TABLE IF NOT EXISTS "ClosedDay" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "source" "ClosedDaySource" NOT NULL DEFAULT 'CUSTOM',
    CONSTRAINT "ClosedDay_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ClosedDay_date_key" UNIQUE ("date")
);

-- 3) 個別輔導月費級距
CREATE TABLE IF NOT EXISTS "TutoringFeeTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessionsPerWeek" INTEGER NOT NULL,
    "monthlyFee" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TutoringFeeTier_pkey" PRIMARY KEY ("id")
);

-- 4) 收費模組單列設定（id 固定 'main'）
CREATE TABLE IF NOT EXISTS "BillingSetting" (
    "id" TEXT NOT NULL,
    "deductionCap" INTEGER NOT NULL DEFAULT 2,
    "paymentInfo" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "BillingSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "BillingSetting" ("id", "deductionCap", "paymentInfo")
VALUES ('main', 2, '')
ON CONFLICT ("id") DO NOTHING;

-- 5) 收費批次
CREATE TABLE IF NOT EXISTS "BillingBatch" (
    "id" TEXT NOT NULL,
    "kind" "BillingKind" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "BillingBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingBatch_pkey" PRIMARY KEY ("id")
);

-- 6) 帳單
CREATE TABLE IF NOT EXISTS "Bill" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "studentId" TEXT NOT NULL,
    "classId" TEXT,
    "tutoringEnrollmentId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sessionsTotal" INTEGER,
    "deductedSessions" INTEGER NOT NULL DEFAULT 0,
    "billedSessions" INTEGER,
    "unitPrice" INTEGER,
    "monthlyFee" INTEGER,
    "prorationRatio" DOUBLE PRECISION,
    "amountDue" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'DRAFT',
    "settledAsWithdrawal" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_batchId_fkey";
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "BillingBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_studentId_fkey";
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_classId_fkey";
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_tutoringEnrollmentId_fkey";
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_tutoringEnrollmentId_fkey"
  FOREIGN KEY ("tutoringEnrollmentId") REFERENCES "TutoringEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Bill_studentId_periodStart_idx" ON "Bill"("studentId", "periodStart");
CREATE INDEX IF NOT EXISTS "Bill_classId_periodStart_idx" ON "Bill"("classId", "periodStart");
CREATE INDEX IF NOT EXISTS "Bill_tutoringEnrollmentId_periodStart_idx" ON "Bill"("tutoringEnrollmentId", "periodStart");

-- 7) 繳款紀錄
CREATE TABLE IF NOT EXISTS "BillPayment" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BillPayment" DROP CONSTRAINT IF EXISTS "BillPayment_billId_fkey";
ALTER TABLE "BillPayment" ADD CONSTRAINT "BillPayment_billId_fkey"
  FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8) 既有表加欄位
ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "feePerSession" INTEGER;
ALTER TABLE "ClassEnrollment" ADD COLUMN IF NOT EXISTS "feeOverride" INTEGER;
ALTER TABLE "TutoringEnrollment" ADD COLUMN IF NOT EXISTS "feeTierId" TEXT;

ALTER TABLE "TutoringEnrollment" DROP CONSTRAINT IF EXISTS "TutoringEnrollment_feeTierId_fkey";
ALTER TABLE "TutoringEnrollment" ADD CONSTRAINT "TutoringEnrollment_feeTierId_fkey"
  FOREIGN KEY ("feeTierId") REFERENCES "TutoringFeeTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 9) 國定假日種子資料（Task 2 產生後附加於此，source 一律 'NATIONAL'）
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2026-09-25', '中秋節', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2026-09-28', '教師節', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2026-10-09', '國慶連假', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2026-10-10', '國慶日', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2026-10-25', '光復節', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2026-10-26', '光復節補假', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2026-12-25', '行憲紀念日', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-01-01', '元旦', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-02-05', '農曆除夕', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-02-06', '春節初一', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-02-07', '春節初二', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-02-08', '春節初三', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-02-09', '春節補假', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-02-28', '和平紀念日', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-03-01', '和平紀念日補假', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-04-04', '兒童節', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-04-05', '清明節', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-04-06', '清明連假補假', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-05-01', '勞動節', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-06-09', '端午節', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-09-15', '中秋節', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-10-10', '國慶日', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-10-11', '國慶日補假', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-10-25', '光復節', 'NATIONAL') ON CONFLICT (date) DO NOTHING;
INSERT INTO "ClosedDay" (id, date, name, source) VALUES (gen_random_uuid(), '2027-12-25', '行憲紀念日', 'NATIONAL') ON CONFLICT (date) DO NOTHING;

-- 驗證：應回傳六張新表的列數（BillingSetting 應為 1，其餘應為 0）
SELECT
  (SELECT count(*) FROM "ClosedDay")        AS closed_days,
  (SELECT count(*) FROM "TutoringFeeTier")  AS tutoring_fee_tiers,
  (SELECT count(*) FROM "BillingSetting")   AS billing_settings,
  (SELECT count(*) FROM "BillingBatch")     AS billing_batches,
  (SELECT count(*) FROM "Bill")             AS bills,
  (SELECT count(*) FROM "BillPayment")      AS bill_payments;
