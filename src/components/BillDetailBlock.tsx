import { formatDateWithWeekday } from '@/lib/dateFormat';

// 帳單明細快照的 JSON 形狀，鏡射 src/lib/billingCalc.ts 的 BillDetail——
// 定案後寫進 Bill.detail 欄位凍結，行政草稿頁與學生端都從這裡渲染。
export interface BillDetailJson {
  sessionDates: { dateKey: string; closed: boolean; closedName?: string }[];
  deduction: { previousRemaining: number; cap: number; deducted: number } | null;
  discounts?: { name: string; amount: number }[];
  formula: string;
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
      {detail.discounts && detail.discounts.length > 0 && (
        <div className="mb-1 border-t border-borderSubtle pt-2">
          {detail.discounts.map((d, i) => (
            <p key={i} className="text-rejected">
              － {d.name} {d.amount.toLocaleString('en-US')} 元
            </p>
          ))}
        </div>
      )}
      <p className="font-bold text-ink">{detail.formula}</p>
    </div>
  );
}
