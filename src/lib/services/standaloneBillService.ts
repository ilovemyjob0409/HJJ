import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { listClosedDays } from './closedDayService';
import { getBillingSetting } from './billingSettingService';
import {
  buildClassBillDetail, computeClassSessionDates, computeDeduction, computeTutoringProration, countOpenSessions,
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
  const unitPrice = enrollment.feeOverride ?? cls.feePerSession ?? null;
  const amountDue = unitPrice === null ? 0 : billed * unitPrice;
  const deduction: Deduction = deducted > 0 ? { previousRemaining: remaining ?? 0, cap: setting.deductionCap, deducted } : null;
  return { entries, open, deducted, deduction, billed, unitPrice, amountDue };
}

export async function previewStandaloneClassBill(input: {
  studentId: string; classId: string; periodStart: Date; periodEnd: Date;
}) {
  const [core, existing] = await Promise.all([
    computeClassBillCore(input.studentId, input.classId, input.periodStart, input.periodEnd),
    findOverlappingClassBill(input.studentId, input.classId, input.periodStart, input.periodEnd),
  ]);
  const detail = core.unitPrice === null
    ? { sessionDates: core.entries, deduction: null, formula: '（請先設定班級單價）' }
    : buildClassBillDetail(core.entries, core.deduction, core.billed, core.unitPrice);
  return {
    sessionsTotal: core.open,
    deductedSessions: core.deducted,
    billedSessions: core.billed,
    unitPrice: core.unitPrice,
    amountDue: core.amountDue,
    detail,
    // 重疊只警示不擋：單獨開單本來就是補開用，由行政自行判斷（跟批次的「略過」不同）。
    overlapWarning: existing ? overlapMessage(existing) : null,
  };
}

export async function createStandaloneClassBill(input: {
  studentId: string; classId: string; periodStart: Date; periodEnd: Date;
  billedSessions: number; amountDue: number; note?: string; notifyNow: boolean;
}): Promise<{ billId: string }> {
  const core = await computeClassBillCore(input.studentId, input.classId, input.periodStart, input.periodEnd);
  if (core.unitPrice === null) throw new Error('MISSING_PRICE');

  // amountDue 由呼叫端傳入（行政可能微調過）；detail 重算但 formula 以傳入值為準，
  // 與 preview 算出的值不同時附註「（手動調整）」。
  const adjusted = input.billedSessions !== core.billed || input.amountDue !== core.amountDue;
  const amount = input.amountDue.toLocaleString('en-US');
  const baseFormula = core.deduction
    ? `${core.open} − ${core.deduction.deducted} ＝ ${input.billedSessions} 堂 × ${core.unitPrice} ＝ ${amount} 元`
    : `${input.billedSessions} 堂 × ${core.unitPrice} ＝ ${amount} 元`;
  const detail = {
    sessionDates: core.entries,
    deduction: core.deduction,
    formula: adjusted ? `${baseFormula}（手動調整）` : baseFormula,
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
  enrollmentId: string; periodStart: Date; periodEnd: Date;
}) {
  const [enrollment, existing] = await Promise.all([
    prisma.tutoringEnrollment.findUniqueOrThrow({
      where: { id: input.enrollmentId },
      select: { feeTier: { select: { monthlyFee: true } } },
    }),
    findOverlappingTutoringBill(input.enrollmentId, input.periodStart, input.periodEnd),
  ]);
  if (!enrollment.feeTier) throw new Error('NO_FEE_TIER');
  const prorationRatio = computeTutoringProration(input.periodStart, input.periodEnd);
  const amountDue = Math.round(enrollment.feeTier.monthlyFee * prorationRatio);
  return {
    monthlyFee: enrollment.feeTier.monthlyFee,
    prorationRatio,
    amountDue,
    overlapWarning: existing ? overlapMessage(existing) : null,
  };
}

export async function createStandaloneTutoringBill(input: {
  enrollmentId: string; periodStart: Date; periodEnd: Date; amountDue: number; note?: string; notifyNow: boolean;
}): Promise<{ billId: string }> {
  const enrollment = await prisma.tutoringEnrollment.findUniqueOrThrow({
    where: { id: input.enrollmentId },
    select: { studentId: true, feeTier: { select: { name: true, monthlyFee: true } } },
  });
  if (!enrollment.feeTier) throw new Error('NO_FEE_TIER');
  const prorationRatio = computeTutoringProration(input.periodStart, input.periodEnd);
  const computedAmountDue = Math.round(enrollment.feeTier.monthlyFee * prorationRatio);
  const adjusted = input.amountDue !== computedAmountDue;
  const amount = input.amountDue.toLocaleString('en-US');
  const ratioText = prorationRatio < 1 ? `（折算 ${Math.round(prorationRatio * 100)}%）` : '';
  const formula = `月費（${enrollment.feeTier.name}）${ratioText} ＝ ${amount} 元${adjusted ? '（手動調整）' : ''}`;

  const bill = await prisma.bill.create({
    data: {
      batchId: null, studentId: enrollment.studentId, tutoringEnrollmentId: input.enrollmentId,
      periodStart: input.periodStart, periodEnd: input.periodEnd,
      monthlyFee: enrollment.feeTier.monthlyFee, prorationRatio, amountDue: input.amountDue,
      detail: { sessionDates: [], deduction: null, formula },
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
