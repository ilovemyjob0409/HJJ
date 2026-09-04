-- 2026-09-04 點名選項精簡：只有「出席」才扣弈廳堂票（GO_HALL_ATTENDED 改為
-- PRESENT-only）。歷史的遲到/早退在舊規則下已扣過票，語義上就是有到場——
-- 統一搬成出席，避免之後該場點名被重新儲存時走「轉非到場」路徑被誤退票。
-- 冪等，可重複執行。請在部署新版之前（或同時）執行。
UPDATE "GoHallAttendance"
SET "status" = 'PRESENT'
WHERE "status" IN ('LATE', 'LEFT_EARLY');

-- 驗證：應回傳 0
SELECT COUNT(*) AS remaining_late_leftearly
FROM "GoHallAttendance"
WHERE "status" IN ('LATE', 'LEFT_EARLY');
