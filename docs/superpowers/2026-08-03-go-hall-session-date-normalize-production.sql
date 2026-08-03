-- 弈廳場次日期正規化 正式環境 SQL（檢查唯讀；UPDATE 已註解，確認後擇一啟用，兩案皆冪等）
-- 背景：GMT+8 瀏覽器批次開場次曾把日期存成「挑選日的前一天 16:00 UTC」而非 UTC 午夜；
--       全 app 以 UTC 日曆日顯示，這批場次會顯示成前一天，且（程式修正前）點名清單找不到它們。
-- 程式修正已在 main：previewSessionDates 改產 UTC 午夜（新資料不再偏移）；
--                   listAttendanceSessionsForDate 改 UTC 當日範圍查詢（相容既有偏移資料）。
-- 執行位置：Supabase Dashboard → SQL Editor
-- 步驟：先跑【檢查 1】。若 time_part 全為 00:00:00 → 無偏移資料，本檔到此為止。
--       否則跑【檢查 2】看明細，再依「決策指引」擇一啟用方案 A 或 B。

-- ── 檢查 1（唯讀）：時刻分布 ─────────────────────────────
SELECT date::time AS time_part, COUNT(*) AS rows
FROM "GoHallSession"
GROUP BY 1
ORDER BY 1;

-- ── 檢查 2（唯讀）：偏移場次明細 ──────────────────────────
-- shown_dow：目前顯示日的星期（0=日 1=一 … 6=六）
-- intended_day_if_gmt8：若當初是 GMT+8 瀏覽器造成的偏移，管理員原本挑的日期
SELECT s.id,
       s.date,
       s.date::date                          AS shown_day,
       EXTRACT(DOW FROM s.date)::int         AS shown_dow,
       (s.date + interval '8 hours')::date   AS intended_day_if_gmt8,
       s."startTime",
       s."endTime",
       COUNT(r.id)                           AS registrations
FROM "GoHallSession" s
LEFT JOIN "GoHallRegistration" r ON r."sessionId" = s.id
WHERE s.date::time <> '00:00:00'
GROUP BY s.id
ORDER BY s.date;

-- ── 決策指引 ─────────────────────────────────────────
-- 方案 A（保守，預設建議）：截斷到當日 UTC 午夜。App 一直以來顯示的日期不變，
--   使用者看不出任何變化，只是把儲存格式正規化。適合「顯示日已成既定事實」
--   （例如已過去的場次、或大家都照顯示日運作）。
-- 方案 B：+8 小時後截斷 ＝ 恢復管理員當初挑選的日期，顯示日會往後移一天。
--   適合「shown_dow 與弈廳實際上課星期不符、且場次在未來／報名數少」的情況。
-- 兩案跑完後重跑【檢查 1】，time_part 應全為 00:00:00（冪等：再跑一次不會有任何列被更動）。

-- ── 方案 A：維持顯示日（擇一，取消註解後執行）──────────────
-- UPDATE "GoHallSession"
-- SET date = date_trunc('day', date)
-- WHERE date::time <> '00:00:00';

-- ── 方案 B：恢復挑選日（擇一，取消註解後執行）──────────────
-- UPDATE "GoHallSession"
-- SET date = date_trunc('day', date + interval '8 hours')
-- WHERE date::time <> '00:00:00';
