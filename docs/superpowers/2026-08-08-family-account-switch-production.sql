-- 手足帳號快速切換 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：Student 新增 familyGroupId 欄位、新增 FamilySwitchToken 表，無現有資料異動。
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "familyGroupId" TEXT;

CREATE TABLE IF NOT EXISTS "FamilySwitchToken" (
  "id" TEXT PRIMARY KEY,
  "token" TEXT NOT NULL UNIQUE,
  "targetUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3)
);
