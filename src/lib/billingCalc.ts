// 收費模組計算引擎：純函式、不碰 DB。日期一律 UTC 日曆日。

export interface SessionDateEntry {
  dateKey: string; // 'YYYY-MM-DD'
  closed: boolean;
  closedName?: string;
}

export interface BillDetail {
  sessionDates: SessionDateEntry[];
  deduction: { previousRemaining: number; cap: number; deducted: number } | null;
  formula: string;
}

export function utcKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function computeClassSessionDates(
  weekday: number,
  periodStart: Date,
  periodEnd: Date,
  closedDays: { date: Date; name: string }[]
): SessionDateEntry[] {
  const closedByKey = new Map(closedDays.map((c) => [utcKey(c.date), c.name]));
  const entries: SessionDateEntry[] = [];
  // 從區間起日往後找到第一個該 weekday，再一週一週跳。
  const cursor = new Date(periodStart.getTime());
  const offset = (weekday - cursor.getUTCDay() + 7) % 7;
  cursor.setUTCDate(cursor.getUTCDate() + offset);
  while (cursor.getTime() <= periodEnd.getTime()) {
    const key = utcKey(cursor);
    const closedName = closedByKey.get(key);
    entries.push(closedName ? { dateKey: key, closed: true, closedName } : { dateKey: key, closed: false });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return entries;
}

export function countOpenSessions(entries: SessionDateEntry[]): number {
  return entries.filter((e) => !e.closed).length;
}

export function computeDeduction(previousRemaining: number | null, cap: number): number {
  return Math.max(0, Math.min(previousRemaining ?? 0, cap));
}

// 月費折算：週數 = round(天數/7)，比例 = min(1, 週數/4)。整月＝全額。
export function computeTutoringProration(periodStart: Date, periodEnd: Date): number {
  const days = Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1;
  return Math.min(1, Math.round(days / 7) / 4);
}

export function buildClassBillDetail(
  entries: SessionDateEntry[],
  deduction: { previousRemaining: number; cap: number; deducted: number } | null,
  billedSessions: number,
  unitPrice: number
): BillDetail {
  const open = countOpenSessions(entries);
  const amount = (billedSessions * unitPrice).toLocaleString('en-US');
  const formula = deduction && deduction.deducted > 0
    ? `${open} − ${deduction.deducted} ＝ ${billedSessions} 堂 × ${unitPrice} ＝ ${amount} 元`
    : `${billedSessions} 堂 × ${unitPrice} ＝ ${amount} 元`;
  return { sessionDates: entries, deduction: deduction && deduction.deducted > 0 ? deduction : null, formula };
}

// 已繳/尚欠/繳費狀態的唯一算法——billPaymentService、billNotifyService（催繳）、
// 學生端 UI 都從這裡 import，不互相依賴，避免循環 import。
export function getPaidState(amountDue: number, payments: { amount: number }[]) {
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = amountDue - paid;
  return { paid, outstanding, state: paid === 0 ? ('UNPAID' as const) : outstanding > 0 ? ('PARTIAL' as const) : ('PAID' as const) };
}
