import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { listClosedDays } from './closedDayService';
import { getBillingSetting } from './billingSettingService';
import {
  buildClassBillDetail, computeClassSessionDates, computeDeduction, computeTutoringProration, countOpenSessions, DEFAULT_FEE_PER_SESSION,
} from '@/lib/billingCalc';
import { addEnrollmentSessions } from './classService';
import { notifyBills } from './billNotifyService';
import { BILL_DETAIL_INCLUDE } from './billingBatchService';
import { formatDateWithWeekday } from '@/lib/dateFormat';

const fmtRange = (s: Date, e: Date) => `${formatDateWithWeekday(s)}～${formatDateWithWeekday(e)}`;
const overlapMessage = (existing: { periodStart: Date; periodEnd: Date }) =>
  `已有 ${fmtRange(existing.periodStart, existing.periodEnd)} 的帳單涵蓋本區間，請確認是否重複開單`;

async function findOverlappingClassBill(studentId: string, classId: string, periodStart: Date, periodEnd: Date) {
  return prisma.bill.findFirst({
    where: { studentId, classId, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } },
    select: { periodStart: true, periodEnd: true },
  });
}

async function findOverlappingTutoringBill(tutoringEnrollmentId: string, periodStart: Date, periodEnd: Date) {
  return prisma.bill.findFirst({
    where: { tutoringEnrollmentId, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } },
    select: { periodStart: true, periodEnd: true },
  });
}

// 優惠項目只在單獨開單時勾選套用（如「台積電特約」——只有首次報名才有，不是學生
// 長期屬性，不掛在 Student／Enrollment 上）。名稱與金額在這裡凍結進 detail 快照，
// 之後改 DiscountItem 主表的金額不會動到已開的帳單。
async function resolveDiscounts(discountItemIds?: string[]): Promise<{ name: string; amount: number }[]> {
  if (!discountItemIds || discountItemIds.length === 0) return [];
  const items = await prisma.discountItem.findMany({ where: { id: { in: discountItemIds } } });
  return items.map((i) => ({ name: i.name, amount: i.amount }));
}

type Deduction = { previousRemaining: number; cap: number; deducted: number } | null;

// 單一 (studentId, classId) 版的 createClassBatch 迴圈內邏輯：同一批 import、同一段
// 剩餘堂數 count 查詢、同一個單價解析順序（feeOverride ?? feePerSession）。
async function computeClassBillCore(studentId: string, classId: string, periodStart: Date, periodEnd: Date) {
  const [closedDays, setting, cls, enrollment] = await Promise.all([
    listClosedDays(periodStart, periodEnd),
    getBillingSetting(),
    prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { weekday: true, feePerSession: true } }),
    prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } }, select: { totalSessions: true, feeOverride: true } }),
  ]);
  const entries = computeClassSessionDates(cls.weekday, periodStart, periodEnd, closedDays);
  const open = countOpenSessions(entries);
  // 剩餘＝totalSessions − 已扣堂（請假/未報名不扣，同 getClassEnrollmentQuota 語意）
  const used = await prisma.classAttendance.count({ where: { classId, studentId, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } } });
  const remaining = enrollment.totalSessions === null ? null : enrollment.totalSessions - used;
  const deducted = computeDeduction(remaining, setting.deductionCap);
  const billed = Math.max(0, open - deducted);
  const unitPrice = enrollment.feeOverride ?? cls.feePerSession ?? DEFAULT_FEE_PER_SESSION;
  const amountDue = billed * unitPrice;
  const deduction: Deduction = deducted > 0 ? { previousRemaining: remaining ?? 0, cap: setting.deductionCap, deducted } : null;
  return { entries, open, deducted, deduction, billed, unitPrice, amountDue };
}

export async function previewStandaloneClassBill(input: {
  studentId: string; classId: string; periodStart: Date; periodEnd: Date; discountItemIds?: string[];
}) {
  const [core, existing, discounts] = await Promise.all([
    computeClassBillCore(input.studentId, input.classId, input.periodStart, input.periodEnd),
    findOverlappingClassBill(input.studentId, input.classId, input.periodStart, input.periodEnd),
    resolveDiscounts(input.discountItemIds),
  ]);
  const discountTotal = discounts.reduce((s, d) => s + d.amount, 0);
  const netAmountDue = Math.max(0, core.amountDue - discountTotal);
  const netFormula = discounts.length > 0 ? `＝ ${netAmountDue.toLocaleString('en-US')} 元` : undefined;
  const detail = { ...buildClassBillDetail(core.entries, core.deduction, core.billed, core.unitPrice), discounts, ...(netFormula ? { netFormula } : {}) };
  return {
    sessionsTotal: core.open,
    deductedSessions: core.deducted,
    billedSessions: core.billed,
    unitPrice: core.unitPrice,
    amountDue: netAmountDue,
    detail,
    // 重疊只警示不擋：單獨開單本來就是補開用，由行政自行判斷（跟批次的「略過」不同）。
    overlapWarning: existing ? overlapMessage(existing) : null,
  };
}

export async function createStandaloneClassBill(input: {
  studentId: string; classId: string; periodStart: Date; periodEnd: Date;
  billedSessions: number; amountDue: number; note?: string; notifyNow: boolean; discountItemIds?: string[];
}): Promise<{ billId: string }> {
  const [core, discounts] = await Promise.all([
    computeClassBillCore(input.studentId, input.classId, input.periodStart, input.periodEnd),
    resolveDiscounts(input.discountItemIds),
  ]);
  const discountTotal = discounts.reduce((s, d) => s + d.amount, 0);
  const netAmountDue = Math.max(0, core.amountDue - discountTotal);

  // amountDue 由呼叫端傳入（行政可能微調過），與試算（已扣優惠）算出的值不同時
  // 附註「（手動調整）」。formula 只顯示未扣優惠的毛額算式（billedSessions ×
  // unitPrice）——絕對不能把 input.amountDue 塞進乘法算式的「＝」，那樣有優惠項目
  // 時算式會自相矛盾（例如 3 堂 × 500 卻寫著已經扣過優惠的金額）；有優惠項目時
  // 額外算一行 netFormula 顯示扣完的最終金額，手動調整標記跟著挪到那一行。
  const adjusted = input.billedSessions !== core.billed || input.amountDue !== netAmountDue;
  const grossAmount = input.billedSessions * core.unitPrice;
  let formula: string;
  let netFormula: string | undefined;
  if (discounts.length === 0) {
    const amount = input.amountDue.toLocaleString('en-US');
    const baseFormula = core.deduction
      ? `${core.open} − ${core.deduction.deducted} ＝ ${input.billedSessions} 堂 × ${core.unitPrice} ＝ ${amount} 元`
      : `${input.billedSessions} 堂 × ${core.unitPrice} ＝ ${amount} 元`;
    formula = adjusted ? `${baseFormula}（手動調整）` : baseFormula;
  } else {
    const grossStr = grossAmount.toLocaleString('en-US');
    formula = core.deduction
      ? `${core.open} − ${core.deduction.deducted} ＝ ${input.billedSessions} 堂 × ${core.unitPrice} ＝ ${grossStr} 元`
      : `${input.billedSessions} 堂 × ${core.unitPrice} ＝ ${grossStr} 元`;
    const finalStr = input.amountDue.toLocaleString('en-US');
    netFormula = `＝ ${finalStr} 元${adjusted ? '（手動調整）' : ''}`;
  }
  const detail = {
    sessionDates: core.entries,
    deduction: core.deduction,
    discounts,
    ...(netFormula ? { netFormula } : {}),
    formula,
  } as unknown as Prisma.InputJsonValue;

  const bill = await prisma.bill.create({
    data: {
      batchId: null, studentId: input.studentId, classId: input.classId,
      periodStart: input.periodStart, periodEnd: input.periodEnd,
      sessionsTotal: core.open, deductedSessions: core.deducted, billedSessions: input.billedSessions,
      unitPrice: core.unitPrice, amountDue: input.amountDue, detail,
      status: 'FINALIZED', note: input.note,
    },
  });

  if (input.billedSessions > 0) {
    try {
      await addEnrollmentSessions(input.classId, input.studentId, input.billedSessions);
    } catch (err) {
      // 補堂失敗就不該留下一張已定案卻沒有對應堂數的孤兒帳單——刪掉剛建立的帳單，
      // 把原始錯誤往外丟，讓管理員的這次操作乾淨地整個失敗，而不是半成功。
      await prisma.bill.delete({ where: { id: bill.id } });
      throw err;
    }
  }
  if (input.notifyNow) await notifyBills([bill.id]);
  return { billId: bill.id };
}

export async function previewStandaloneTutoringBill(input: {
  enrollmentId: string; periodStart: Date; periodEnd: Date; discountItemIds?: string[];
}) {
  const [enrollment, existing, discounts] = await Promise.all([
    prisma.tutoringEnrollment.findUniqueOrThrow({
      where: { id: input.enrollmentId },
      select: { feeTier: { select: { monthlyFee: true } } },
    }),
    findOverlappingTutoringBill(input.enrollmentId, input.periodStart, input.periodEnd),
    resolveDiscounts(input.discountItemIds),
  ]);
  if (!enrollment.feeTier) throw new Error('NO_FEE_TIER');
  const prorationRatio = computeTutoringProration(input.periodStart, input.periodEnd);
  const grossAmountDue = Math.round(enrollment.feeTier.monthlyFee * prorationRatio);
  const discountTotal = discounts.reduce((s, d) => s + d.amount, 0);
  return {
    monthlyFee: enrollment.feeTier.monthlyFee,
    prorationRatio,
    amountDue: Math.max(0, grossAmountDue - discountTotal),
    discounts,
    overlapWarning: existing ? overlapMessage(existing) : null,
  };
}

export async function createStandaloneTutoringBill(input: {
  enrollmentId: string; periodStart: Date; periodEnd: Date; amountDue: number; note?: string; notifyNow: boolean;
  discountItemIds?: string[];
}): Promise<{ billId: string }> {
  const [enrollment, discounts] = await Promise.all([
    prisma.tutoringEnrollment.findUniqueOrThrow({
      where: { id: input.enrollmentId },
      select: { studentId: true, feeTier: { select: { name: true, monthlyFee: true } } },
    }),
    resolveDiscounts(input.discountItemIds),
  ]);
  if (!enrollment.feeTier) throw new Error('NO_FEE_TIER');
  const prorationRatio = computeTutoringProration(input.periodStart, input.periodEnd);
  const grossAmountDue = Math.round(enrollment.feeTier.monthlyFee * prorationRatio);
  const discountTotal = discounts.reduce((s, d) => s + d.amount, 0);
  const netExpected = Math.max(0, grossAmountDue - discountTotal);
  const adjusted = input.amountDue !== netExpected;
  const ratioText = prorationRatio < 1 ? `（折算 ${Math.round(prorationRatio * 100)}%）` : '';
  let formula: string;
  let netFormula: string | undefined;
  if (discounts.length === 0) {
    const amount = input.amountDue.toLocaleString('en-US');
    formula = `月費（${enrollment.feeTier.name}）${ratioText} ＝ ${amount} 元${adjusted ? '（手動調整）' : ''}`;
  } else {
    const grossStr = grossAmountDue.toLocaleString('en-US');
    formula = `月費（${enrollment.feeTier.name}）${ratioText} ＝ ${grossStr} 元`;
    const finalStr = input.amountDue.toLocaleString('en-US');
    netFormula = `＝ ${finalStr} 元${adjusted ? '（手動調整）' : ''}`;
  }

  const bill = await prisma.bill.create({
    data: {
      batchId: null, studentId: enrollment.studentId, tutoringEnrollmentId: input.enrollmentId,
      periodStart: input.periodStart, periodEnd: input.periodEnd,
      monthlyFee: enrollment.feeTier.monthlyFee, prorationRatio, amountDue: input.amountDue,
      detail: { sessionDates: [], deduction: null, discounts, ...(netFormula ? { netFormula } : {}), formula },
      status: 'FINALIZED', note: input.note,
    },
  });

  if (input.notifyNow) await notifyBills([bill.id]);
  return { billId: bill.id };
}

export async function listStandaloneBills() {
  return prisma.bill.findMany({
    where: { batchId: null },
    include: BILL_DETAIL_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}
