import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { listClosedDays } from './closedDayService';
import { getBillingSetting } from './billingSettingService';
import {
  buildClassBillDetail, computeClassSessionDates, computeDeduction, countOpenSessions,
} from '@/lib/billingCalc';
import { addEnrollmentSessions } from './classService';
import { notifyBills } from './billNotifyService';

export interface SkippedRow { studentName: string; targetName: string; reason: string }

const fmtRange = (s: Date, e: Date) => `${s.toISOString().slice(0, 10)}～${e.toISOString().slice(0, 10)}`;

async function overlappingClassBill(studentId: string, classId: string, periodStart: Date, periodEnd: Date) {
  return prisma.bill.findFirst({
    where: { studentId, classId, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } },
    select: { periodStart: true, periodEnd: true },
  });
}

export async function createClassBatch(input: { periodStart: Date; periodEnd: Date; classIds: string[] }) {
  const [closedDays, setting, classes] = await Promise.all([
    listClosedDays(input.periodStart, input.periodEnd),
    getBillingSetting(),
    prisma.class.findMany({
      where: { id: { in: input.classIds }, active: true },
      select: {
        id: true, name: true, weekday: true, feePerSession: true,
        enrollments: { select: { studentId: true, totalSessions: true, feeOverride: true, student: { select: { user: { select: { name: true } } } } } },
      },
    }),
  ]);
  const skipped: SkippedRow[] = [];
  const batch = await prisma.billingBatch.create({ data: { kind: 'CLASS', periodStart: input.periodStart, periodEnd: input.periodEnd } });

  for (const cls of classes) {
    const entries = computeClassSessionDates(cls.weekday, input.periodStart, input.periodEnd, closedDays);
    const open = countOpenSessions(entries);
    for (const e of cls.enrollments) {
      const existing = await overlappingClassBill(e.studentId, cls.id, input.periodStart, input.periodEnd);
      if (existing) {
        skipped.push({ studentName: e.student.user.name, targetName: cls.name, reason: `已有 ${fmtRange(existing.periodStart, existing.periodEnd)} 的帳單涵蓋本區間，本批略過` });
        continue;
      }
      // 剩餘＝totalSessions − 已扣堂（請假/未報名不扣，同 getClassEnrollmentQuota 語意）
      const used = await prisma.classAttendance.count({ where: { classId: cls.id, studentId: e.studentId, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } } });
      const remaining = e.totalSessions === null ? null : e.totalSessions - used;
      const deducted = computeDeduction(remaining, setting.deductionCap);
      const billed = Math.max(0, open - deducted);
      const unitPrice = e.feeOverride ?? cls.feePerSession ?? null;
      const detail = (unitPrice === null
        ? { sessionDates: entries, deduction: null, formula: '（請先設定班級單價）' }
        : buildClassBillDetail(entries, deducted > 0 ? { previousRemaining: remaining ?? 0, cap: setting.deductionCap, deducted } : null, billed, unitPrice)) as unknown as Prisma.InputJsonValue;
      await prisma.bill.create({
        data: {
          batchId: batch.id, studentId: e.studentId, classId: cls.id,
          periodStart: input.periodStart, periodEnd: input.periodEnd,
          sessionsTotal: open, deductedSessions: deducted, billedSessions: billed,
          unitPrice, amountDue: unitPrice === null ? 0 : billed * unitPrice, detail,
        },
      });
    }
  }
  return { batchId: batch.id, skipped };
}

export async function createTutoringBatch(input: { periodStart: Date; periodEnd: Date; programIds: string[] }) {
  const enrollments = await prisma.tutoringEnrollment.findMany({
    where: { programId: { in: input.programIds }, active: true },
    select: { id: true, feeTier: true, program: { select: { name: true } }, studentId: true, student: { select: { user: { select: { name: true } } } } },
  });
  const skipped: SkippedRow[] = [];
  const batch = await prisma.billingBatch.create({ data: { kind: 'TUTORING', periodStart: input.periodStart, periodEnd: input.periodEnd } });
  for (const e of enrollments) {
    if (!e.feeTier) {
      skipped.push({ studentName: e.student.user.name, targetName: e.program.name, reason: '尚未指定收費級距，本批略過' });
      continue;
    }
    const existing = await prisma.bill.findFirst({
      where: { tutoringEnrollmentId: e.id, periodStart: { lte: input.periodEnd }, periodEnd: { gte: input.periodStart } },
      select: { periodStart: true, periodEnd: true },
    });
    if (existing) {
      skipped.push({ studentName: e.student.user.name, targetName: e.program.name, reason: `已有 ${fmtRange(existing.periodStart, existing.periodEnd)} 的帳單涵蓋本區間，本批略過` });
      continue;
    }
    await prisma.bill.create({
      data: {
        batchId: batch.id, studentId: e.studentId, tutoringEnrollmentId: e.id,
        periodStart: input.periodStart, periodEnd: input.periodEnd,
        monthlyFee: e.feeTier.monthlyFee, prorationRatio: 1, amountDue: e.feeTier.monthlyFee,
        detail: { sessionDates: [], deduction: null, formula: `月費（${e.feeTier.name}）＝ ${e.feeTier.monthlyFee.toLocaleString('en-US')} 元` },
      },
    });
  }
  return { batchId: batch.id, skipped };
}

export async function listBatches() {
  const batches = await prisma.billingBatch.findMany({
    orderBy: { createdAt: 'desc' },
    include: { bills: { select: { amountDue: true, status: true, payments: { select: { amount: true } } } } },
  });
  return batches.map((b) => {
    const finalized = b.status === 'FINALIZED';
    const totalDue = b.bills.reduce((s, bill) => s + bill.amountDue, 0);
    const totalPaid = b.bills.reduce((s, bill) => s + bill.payments.reduce((p, x) => p + x.amount, 0), 0);
    return {
      id: b.id, kind: b.kind, periodStart: b.periodStart, periodEnd: b.periodEnd, status: b.status,
      totalDue: finalized ? totalDue : null, totalPaid: finalized ? totalPaid : null,
      totalOutstanding: finalized ? totalDue - totalPaid : null,
    };
  });
}

export const BILL_DETAIL_INCLUDE = {
  student: { select: { id: true, userId: true, user: { select: { name: true } } } },
  class: { select: { name: true } },
  tutoringEnrollment: { select: { program: { select: { name: true } }, feeTier: { select: { name: true } } } },
  payments: { orderBy: { paidOn: 'asc' as const } },
} as const;

export async function getBatchDetail(batchId: string) {
  return prisma.billingBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { bills: { include: BILL_DETAIL_INCLUDE, orderBy: { createdAt: 'asc' } } },
  }).then((batch) => ({ ...batch, bills: batch.bills }));
}

export async function updateDraftBill(billId: string, input: { billedSessions?: number; amountDue?: number; note?: string }) {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
  if (bill.status === 'FINALIZED') throw new Error('BILL_FINALIZED');
  const data: { billedSessions?: number; amountDue?: number; note?: string; detail?: object } = { ...input };
  if (input.billedSessions !== undefined && bill.unitPrice !== null && input.amountDue === undefined) {
    data.amountDue = input.billedSessions * bill.unitPrice;
    const detail = bill.detail as { sessionDates: unknown[]; deduction: { previousRemaining: number; cap: number; deducted: number } | null };
    const amount = data.amountDue.toLocaleString('en-US');
    const formula = detail.deduction
      ? `${bill.sessionsTotal} − ${detail.deduction.deducted} ＝ ${input.billedSessions} 堂 × ${bill.unitPrice} ＝ ${amount} 元（手動調整）`
      : `${input.billedSessions} 堂 × ${bill.unitPrice} ＝ ${amount} 元`;
    data.detail = { ...detail, formula };
  }
  await prisma.bill.update({ where: { id: billId }, data });
}

export async function deleteDraftBill(billId: string): Promise<void> {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, select: { status: true } });
  if (bill.status === 'FINALIZED') throw new Error('BILL_FINALIZED');
  await prisma.bill.delete({ where: { id: billId } });
}

export async function deleteDraftBatch(batchId: string): Promise<void> {
  const batch = await prisma.billingBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true } });
  if (batch.status === 'FINALIZED') throw new Error('BATCH_FINALIZED');
  await prisma.billingBatch.delete({ where: { id: batchId } }); // bills onDelete: Cascade
}

export async function finalizeBatch(batchId: string, options: { notifyNow: boolean }): Promise<void> {
  const batch = await prisma.billingBatch.findUniqueOrThrow({ where: { id: batchId }, include: { bills: true } });
  if (batch.status === 'FINALIZED') throw new Error('BATCH_FINALIZED');
  if (batch.kind === 'CLASS' && batch.bills.some((b) => b.unitPrice === null)) throw new Error('MISSING_PRICE');

  await prisma.$transaction([
    prisma.billingBatch.update({ where: { id: batchId }, data: { status: 'FINALIZED', finalizedAt: new Date() } }),
    prisma.bill.updateMany({ where: { batchId }, data: { status: 'FINALIZED' } }),
  ]);
  // 定案即自動充值（開一期）：帳與堂一致；billedSessions 0 沒東西可充。
  for (const bill of batch.bills) {
    if (bill.classId && (bill.billedSessions ?? 0) > 0) {
      await addEnrollmentSessions(bill.classId, bill.studentId, bill.billedSessions as number);
    }
  }
  if (options.notifyNow) await notifyBills(batch.bills.map((b) => b.id));
}
