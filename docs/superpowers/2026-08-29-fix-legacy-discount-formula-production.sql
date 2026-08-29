-- 一次性修正：優惠項目功能上線初期建立的帳單，formula 算式文字寫錯（把已扣優惠
-- 的淨額塞進乘法算式的「＝」），且缺少 netFormula 欄位。這裡只改 detail 裡的
-- formula／netFormula 兩個顯示用文字欄位，不動 amountDue 或任何其他金額欄位。
-- 可重複執行（已經有 netFormula 的帳單會被 WHERE 條件排除，不會重跑）。
DO $$
DECLARE
  r RECORD;
  discount_total int;
  discount_text text;
  gross int;
  net_amount int;
  adjusted boolean;
  ratio_text text;
  formula_text text;
  net_formula_text text;
  tier_name text;
  updated_count int := 0;
BEGIN
  FOR r IN
    SELECT id, "classId", "tutoringEnrollmentId", "sessionsTotal", "deductedSessions",
           "billedSessions", "unitPrice", "monthlyFee", "prorationRatio", "amountDue", detail
    FROM "Bill"
    WHERE detail ? 'discounts'
      AND jsonb_array_length(detail->'discounts') > 0
      AND NOT (detail ? 'netFormula')
  LOOP
    SELECT COALESCE(SUM((d->>'amount')::int), 0) INTO discount_total
    FROM jsonb_array_elements(r.detail->'discounts') d;

    SELECT string_agg('－ ' || (d->>'name') || ' ' || to_char((d->>'amount')::int, 'FM999,999,999') || ' 元', ' ')
      INTO discount_text
    FROM jsonb_array_elements(r.detail->'discounts') d;

    IF r."classId" IS NOT NULL THEN
      gross := r."billedSessions" * r."unitPrice";
      net_amount := GREATEST(0, gross - discount_total);
      adjusted := (r."amountDue" <> net_amount);

      IF jsonb_typeof(r.detail->'deduction') = 'object' THEN
        formula_text := r."sessionsTotal"::text || ' − ' || r."deductedSessions"::text || ' ＝ '
          || r."billedSessions"::text || ' 堂 × ' || r."unitPrice"::text || ' ＝ ' || to_char(gross, 'FM999,999,999') || ' 元';
      ELSE
        formula_text := r."billedSessions"::text || ' 堂 × ' || r."unitPrice"::text || ' ＝ ' || to_char(gross, 'FM999,999,999') || ' 元';
      END IF;

      net_formula_text := to_char(gross, 'FM999,999,999') || ' 元 ' || discount_text || ' ＝ '
        || to_char(r."amountDue", 'FM999,999,999') || ' 元' || (CASE WHEN adjusted THEN '（手動調整）' ELSE '' END);

      UPDATE "Bill"
      SET detail = jsonb_set(jsonb_set(detail, '{formula}', to_jsonb(formula_text)), '{netFormula}', to_jsonb(net_formula_text))
      WHERE id = r.id;
      updated_count := updated_count + 1;

    ELSIF r."tutoringEnrollmentId" IS NOT NULL THEN
      gross := ROUND(r."monthlyFee" * r."prorationRatio")::int;
      net_amount := GREATEST(0, gross - discount_total);
      adjusted := (r."amountDue" <> net_amount);
      ratio_text := CASE WHEN r."prorationRatio" < 1 THEN '（折算 ' || ROUND(r."prorationRatio" * 100)::int || '%）' ELSE '' END;

      SELECT tft.name INTO tier_name
      FROM "TutoringEnrollment" te
      JOIN "TutoringFeeTier" tft ON tft.id = te."feeTierId"
      WHERE te.id = r."tutoringEnrollmentId";

      formula_text := '月費（' || COALESCE(tier_name, '') || '）' || ratio_text || ' ＝ ' || to_char(gross, 'FM999,999,999') || ' 元';
      net_formula_text := to_char(gross, 'FM999,999,999') || ' 元 ' || discount_text || ' ＝ '
        || to_char(r."amountDue", 'FM999,999,999') || ' 元' || (CASE WHEN adjusted THEN '（手動調整）' ELSE '' END);

      UPDATE "Bill"
      SET detail = jsonb_set(jsonb_set(detail, '{formula}', to_jsonb(formula_text)), '{netFormula}', to_jsonb(net_formula_text))
      WHERE id = r.id;
      updated_count := updated_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '已修正 % 筆帳單', updated_count;
END $$;

-- 驗證：執行完後這個查詢應該回傳 0 筆（代表沒有漏改的舊格式帳單）
SELECT id FROM "Bill" WHERE detail ? 'discounts' AND jsonb_array_length(detail->'discounts') > 0 AND NOT (detail ? 'netFormula');
