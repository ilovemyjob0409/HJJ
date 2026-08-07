-- 個別輔導模組（英文／數學彈性預約）正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：新增 2 個 enum、6 張表，無現有資料異動。
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

DO $$ BEGIN
  CREATE TYPE "TutoringBookingKind" AS ENUM ('REGULAR', 'MAKEUP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TutoringBookingStatus" AS ENUM ('PENDING_ADMIN', 'BOOKED', 'CANCELLED_LATE', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "TutoringProgram" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "defaultMonthlyQuota" INTEGER NOT NULL DEFAULT 8,
  "defaultDurationMinutes" INTEGER NOT NULL DEFAULT 120,
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "TutoringWindow" (
  "id" TEXT PRIMARY KEY,
  "programId" TEXT NOT NULL REFERENCES "TutoringProgram"("id"),
  "weekday" INTEGER NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL,
  "teacherId" TEXT NOT NULL REFERENCES "Teacher"("id"),
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "TutoringWindowClosure" (
  "id" TEXT PRIMARY KEY,
  "windowId" TEXT NOT NULL REFERENCES "TutoringWindow"("id") ON DELETE CASCADE,
  "date" TIMESTAMP(3) NOT NULL,
  UNIQUE ("windowId", "date")
);

CREATE TABLE IF NOT EXISTS "TutoringEnrollment" (
  "id" TEXT PRIMARY KEY,
  "programId" TEXT NOT NULL REFERENCES "TutoringProgram"("id"),
  "studentId" TEXT NOT NULL REFERENCES "Student"("id"),
  "monthlyQuota" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastQuotaReminderMonth" TEXT,
  UNIQUE ("programId", "studentId")
);

CREATE TABLE IF NOT EXISTS "TutoringBooking" (
  "id" TEXT PRIMARY KEY,
  "enrollmentId" TEXT NOT NULL REFERENCES "TutoringEnrollment"("id"),
  "windowId" TEXT NOT NULL REFERENCES "TutoringWindow"("id"),
  "date" TIMESTAMP(3) NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "kind" "TutoringBookingKind" NOT NULL DEFAULT 'REGULAR',
  "status" "TutoringBookingStatus" NOT NULL DEFAULT 'BOOKED',
  "makeupForId" TEXT UNIQUE REFERENCES "TutoringBooking"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "TutoringAttendance" (
  "id" TEXT PRIMARY KEY,
  "bookingId" TEXT NOT NULL UNIQUE REFERENCES "TutoringBooking"("id"),
  "status" "AttendanceStatus" NOT NULL,
  "checkInTime" TEXT,
  "checkOutTime" TEXT,
  "markedById" TEXT NOT NULL REFERENCES "User"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
