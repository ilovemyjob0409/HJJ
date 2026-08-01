-- 點名狀態新增「未報名」 正式環境一次性 SQL（冪等，可重複執行）
-- 等同 prisma db push：AttendanceStatus 列舉加一個值
-- （報名時聲明不出席、未繳該堂費用 → 點名標「未報名」，不扣堂）
-- 執行位置：Supabase Dashboard → SQL Editor
-- 順序：先跑本檔，再 git push 部署新程式。

ALTER TYPE "AttendanceStatus" ADD VALUE IF NOT EXISTS 'NOT_REGISTERED';

-- 驗證：應列出六個值，最後一個是 NOT_REGISTERED
SELECT enumlabel FROM pg_enum
WHERE enumtypid = '"AttendanceStatus"'::regtype
ORDER BY enumsortorder;
