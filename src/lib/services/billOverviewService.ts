import { prisma } from '@/lib/db';
import { getPaidState } from '@/lib/billingCalc';
import { billTargetName } from './billNotifyService';

export interface OverviewBillRow {
  id: string;
  source: 'CLASS' | 'TUTORING' | null; // 批次種類；null＝單獨開單
  batchId: string | null;
  studentName: string;
  targetName: string;
  periodStart: Date;
  periodEnd: Date;
  amountDue: number;
  paid: number;
  outstanding: number;
  state: 'UNPAID' | 'PARTIAL' | 'PAID';
  // 操作欄（繳款／通知／提醒／退班結算／刪除）所需的完整欄位，
  // 跟主頁單獨開單帳單表的資料形狀對齊，讓 PaymentModal/SettleModal 可直接共用
  payments: { id: string; amount: number; paidOn: Date; method: 'CASH' | 'TRANSFER'; note: string | null }[];
  notifiedAt: Date | null;
  settledAsWithdrawal: boolean;
  classId: string | null;
  billedSessions: number | null;
  detail: unknown; // BillDetailJson 快照，點列展開明細用
}

export interface BillingOverview {
  summary: { totalDue: number; totalPaid: number; totalOutstanding: number; count: number };
  bills: OverviewBillRow[];
}

// 區間總覽：收費區間與 [periodStart, periodEnd] 重疊的已定案帳單全列入
// （批次內＋單獨開單合併），草稿不算。統計基準是帳單收費區間、不是繳款日
// ——「這段期間的課程收入」，跟批次頁的應收／已收邏輯一致。
// 不帶區間＝不限期間，列出所有已定案帳單（總覽預設）。
export async function getBillingOverview(periodStart?: Date, periodEnd?: Date): Promise<BillingOverview> {
  const bills = await prisma.bill.findMany({
    where: {
      status: 'FINALIZED',
      ...(periodStart && periodEnd ? { periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } } : {}),
    },
    include: {
      payments: {
        select: { id: true, amount: true, paidOn: true, method: true, note: true },
        orderBy: { paidOn: 'asc' },
      },
      batch: { select: { kind: true } },
      class: { select: { name: true } },
      tutoringEnrollment: { select: { program: { select: { name: true } } } },
      student: { select: { user: { select: { name: true } } } },
    },
    orderBy: { periodStart: 'desc' },
  });

  const rows = bills.map((b): OverviewBillRow => {
    const { paid, outstanding, state } = getPaidState(b.amountDue, b.payments);
    return {
      id: b.id,
      source: b.batch?.kind ?? null,
      batchId: b.batchId,
      studentName: b.student.user.name,
      targetName: billTargetName(b),
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
      amountDue: b.amountDue,
      paid,
      outstanding,
      state,
      payments: b.payments,
      notifiedAt: b.notifiedAt,
      settledAsWithdrawal: b.settledAsWithdrawal,
      classId: b.classId,
      billedSessions: b.billedSessions,
      detail: b.detail,
    };
  });

  return {
    summary: {
      totalDue: rows.reduce((s, r) => s + r.amountDue, 0),
      totalPaid: rows.reduce((s, r) => s + r.paid, 0),
      totalOutstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      count: rows.length,
    },
    bills: rows,
  };
}
