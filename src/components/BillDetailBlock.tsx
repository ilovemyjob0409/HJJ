import { formatDateWithWeekday } from '@/lib/dateFormat';

// 帳單明細快照的 JSON 形狀，鏡射 src/lib/billingCalc.ts 的 BillDetail——
// 定案後寫進 Bill.detail 欄位凍結，行政草稿頁與學生端都從這裡渲染。
export interface BillDetailJson {
  sessionDates: { dateKey: string; closed: boolean; closedName?: string }[];
  deduction: { previousRemaining: number; cap: number; deducted: number } | null;
  discounts?: { name: string; amount: number }[];
  formula: string;
  // 有優惠項目時才會有值——formula 只顯示未扣優惠的毛額算式，netFormula 是完整的
  // 「毛額 － 優惠項目1 － 優惠項目2 ＝ 最終金額（手動調整）」單行算式，避免 formula
  // 自身的乘法算不出它宣稱的「＝」結果（例如 3 堂 × 500 卻寫著已經扣過優惠的金額）。
  netFormula?: string;
}

// netFormula 是凍結進 detail 的完整字串（「毛額 － 優惠1 － 優惠2 ＝ 最終金額」），
// 但優惠名稱與金額要標紅——用 discounts 陣列裡的 name/amount 組出跟 buildNetFormula
// 完全一樣的片段（－ 名稱 金額 元），在字串裡找出來拆開上色，其餘文字維持預設色。
function renderNetFormula(netFormula: string, discounts: { name: string; amount: number }[]) {
  if (discounts.length === 0) return netFormula;
  const segments: { text: string; highlight: boolean }[] = [];
  let rest = netFormula;
  for (const d of discounts) {
    const marker = `－ ${d.name} ${d.amount.toLocaleString('en-US')} 元`;
    const idx = rest.indexOf(marker);
    if (idx === -1) continue;
    if (idx > 0) segments.push({ text: rest.slice(0, idx), highlight: false });
    segments.push({ text: marker, highlight: true });
    rest = rest.slice(idx + marker.length);
  }
  if (rest) segments.push({ text: rest, highlight: false });
  return segments.map((s, i) => (s.highlight ? <span key={i} className="text-rejected">{s.text}</span> : <span key={i}>{s.text}</span>));
}

export default function BillDetailBlock({ detail }: { detail: BillDetailJson }) {
  return (
    <div className="rounded-lg border border-borderSubtle bg-cream/40 px-4 py-3 text-sm leading-relaxed">
      {detail.sessionDates.length > 0 && (
        <p className="mb-2 text-ink">
          {detail.sessionDates.map((e, i) => (
            <span key={e.dateKey}>
              {i > 0 && '、'}
              {e.closed ? (
                <span className="text-rejected line-through">
                  {formatDateWithWeekday(e.dateKey)}
                  {e.closedName}
                </span>
              ) : (
                formatDateWithWeekday(e.dateKey)
              )}
            </span>
          ))}
        </p>
      )}
      {detail.deduction && (
        <p className="mb-1 border-t border-borderSubtle pt-2 text-brandDark">
          上期剩餘 {detail.deduction.previousRemaining} 堂｜折抵上限 {detail.deduction.cap} 堂 → 本期折抵 {detail.deduction.deducted}{' '}
          堂，其餘 {detail.deduction.previousRemaining - detail.deduction.deducted} 堂保留至本期繼續使用
        </p>
      )}
      <p className="font-bold text-ink">{detail.formula}</p>
      {detail.netFormula ? (
        <p className="mt-1 font-bold text-ink">{renderNetFormula(detail.netFormula, detail.discounts ?? [])}</p>
      ) : (
        // 舊格式相容：netFormula 是後來才加的欄位，優惠項目上線初期建立的帳單只有
        // discounts 陣列、沒有 netFormula——這裡逐項列出，不能讓舊帳單的優惠資訊憑空消失。
        detail.discounts &&
        detail.discounts.length > 0 && (
          <div className="mt-1">
            {detail.discounts.map((d, i) => (
              <p key={i} className="text-rejected">
                － {d.name} {d.amount.toLocaleString('en-US')} 元
              </p>
            ))}
          </div>
        )
      )}
    </div>
  );
}
