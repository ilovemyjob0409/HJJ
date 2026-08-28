import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { listClosedDays } from './closedDayService';
import { getBillingSetting } from './billingSettingService';
import {
  buildClassBillDetail, computeClassSessionDates, computeDeduction, countOpenSessions,
} from '@/lib/billingCalc';
import { addEnrollmentSessions } from './classService';
import { notifyBills } from './billNotifyService';
import { formatDateWithWeekday } from '@/lib/dateFormat';

export interface SkippedRow { studentName: string; targetName: string; reason: string }

const fmtRange = (s: Date, e: Date) => `${formatDateWithWeekday(s)}～${formatDateWithWeekday(e)}`;

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

  const allClassIds = classes.map((c) => c.id);
  const allStudentIds = Array.from(new Set(classes.flatMap((c) => c.enrollments.map((e) => e.studentId))));

  // 整批一次查完「已有重疊帳單」與「已扣堂數」，避免每個(班級,學生)組合各發兩次
  // 查詢（N+1）；寫法同 listClassesForTeacher 的 groupBy 批次寫法。in 條件為空陣列
  // 時 Prisma 會回傳空結果，不需要另外判斷 classes.length。
  const [overlaps, usedCounts] = await Promise.all([
    prisma.bill.findMany({
      where: {
        studentId: { in: allStudentIds }, classId: { in: allClassIds },
        periodStart: { lte: input.periodEnd }, periodEnd: { gte: input.periodStart },
      },
      select: { studentId: true, classId: true, periodStart: true, periodEnd: true },
    }),
    prisma.classAttendance.groupBy({
      by: ['classId', 'studentId'],
      where: { classId: { in: allClassIds }, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } },
      _count: { _all: true },
    }),
  ]);
  const overlapByKey = new Map<string, { periodStart: Date; periodEnd: Date }>();
  for (const o of overlaps) {
    const key = `${o.studentId}:${o.classId}`;
    if (!overlapByKey.has(key)) overlapByKey.set(key, { periodStart: o.periodStart, periodEnd: o.periodEnd });
  }
  const usedByKey = new Map(usedCounts.map((c) => [`${c.classId}:${c.studentId}`, c._count._all]));

  for (const cls of classes) {
    const entries = computeClassSessionDates(cls.weekday, input.periodStart, input.periodEnd, closedDays);
    const open = countOpenSessions(entries);
    for (const e of cls.enrollments) {
      const existing = overlapByKey.get(`${e.studentId}:${cls.id}`) ?? null;
      if (existing) {
        skipped.push({ studentName: e.student.user.name, targetName: cls.name, reason: `已有 ${fmtRange(existing.periodStart, existing.periodEnd)} 的帳單涵蓋本區間，本批略過` });
        continue;
      }
      // 剩餘＝totalSessions − 已扣堂（請假/未報名不扣，同 getClassEnrollmentQuota 語意）
      const used = usedByKey.get(`${cls.id}:${e.studentId}`) ?? 0;
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

  // 同 createClassBatch：整批一次查完重疊帳單，避免每個報名各發一次查詢（N+1）。
  const enrollmentIds = enrollments.map((e) => e.id);
  const overlaps = enrollmentIds.length === 0 ? [] : await prisma.bill.findMany({
    where: {
      tutoringEnrollmentId: { in: enrollmentIds },
      periodStart: { lte: input.periodEnd }, periodEnd: { gte: input.periodStart },
    },
    select: { tutoringEnrollmentId: true, periodStart: true, periodEnd: true },
  });
  const overlapByEnrollmentId = new Map<string, { periodStart: Date; periodEnd: Date }>();
  for (const o of overlaps) {
    if (!o.tutoringEnrollmentId) continue;
    if (!overlapByEnrollmentId.has(o.tutoringEnrollmentId)) overlapByEnrollmentId.set(o.tutoringEnrollmentId, { periodStart: o.periodStart, periodEnd: o.periodEnd });
  }

  for (const e of enrollments) {
    if (!e.feeTier) {
      skipped.push({ studentName: e.student.user.name, targetName: e.program.name, reason: '尚未指定收費級距，本批略過' });
      continue;
    }
    const existing = overlapByEnrollmentId.get(e.id) ?? null;
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

  const [{ count: transitioned }] = await prisma.$transaction([
    prisma.billingBatch.updateMany({ where: { id: batchId, status: 'DRAFT' }, data: { status: 'FINALIZED', finalizedAt: new Date() } }),
    prisma.bill.updateMany({ where: { batchId }, data: { status: 'FINALIZED' } }),
  ]);
  // updateMany 的 where 帶 status:'DRAFT' 讓狀態轉換本身是原子的：兩個併發的定案
  // 請求只有一個能真的把 count 轉成 1，另一個會拿到 0，代表已經被搶先定案過了。
  if (transitioned === 0) throw new Error('BATCH_FINALIZED');

  // 定案即自動充值（開一期）：帳與堂一致；billedSessions 0 沒東西可充。單筆充值失敗
  // （例如學生在開草稿後、定案前被退班）不應該讓其餘學生的充值跟著失敗、也不該讓
  // 已經定案的批次回報「定案失敗」誤導管理員——收集失敗清單，繼續處理其餘帳單，
  // 全部跑完後再統一拋出，讓管理員知道哪些學生需要手動補堂。
  const topUpFailures: { billId: string; studentId: string }[] = [];
  for (const bill of batch.bills) {
    if (bill.classId && (bill.billedSessions ?? 0) > 0) {
      try {
        await addEnrollmentSessions(bill.classId, bill.studentId, bill.billedSessions as number);
      } catch (err) {
        console.error(`finalizeBatch: session top-up failed for bill ${bill.id} (student ${bill.studentId})`, err);
        topUpFailures.push({ billId: bill.id, studentId: bill.studentId });
      }
    }
  }
  if (options.notifyNow) await notifyBills(batch.bills.map((b) => b.id));
  if (topUpFailures.length > 0) throw new Error('PARTIAL_TOPUP_FAILURE');
}
