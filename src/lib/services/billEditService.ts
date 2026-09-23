import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { BillDiscount, buildNetFormula } from './standaloneBillService';

export interface UpdateFinalizedBillInput {
  billedSessions?: number; // 班級帳單限定；個輔帳單忽略
  amountDue: number;
  discounts: BillDiscount[];
}

// 編輯已定案且未有任何繳款的帳單：優惠項目、最終金額，班級帳單另可改計費堂數。
// 班級帳單堂數變動時，學生總堂數在同一個 transaction 內加減差額＋帳本留一筆
// 差額期別（與行政「增／減堂」同語意）；扣回會讓剩餘變負（BILL_SESSIONS_CONSUMED）
// 或報名已不存在（BILL_ENROLLMENT_GONE）時擋下。明細算式重建規則與單獨開單
// （createStandaloneClassBill／createStandaloneTutoringBill）一致。
export async function updateFinalizedBill(billId: string, input: UpdateFinalizedBillInput): Promise<void> {
  if (!Number.isInteger(input.amountDue) || input.amountDue < 0) throw new Error('INVALID_INPUT');
  if (!Array.isArray(input.discounts)) throw new Error('INVALID_DISCOUNTS');
  const discounts: BillDiscount[] = [];
  for (const d of input.discounts) {
    if (typeof d?.name !== 'string' || d.name.trim() === '' || !Number.isInteger(d.amount) || d.amount <= 0) {
      throw new Error('INVALID_DISCOUNTS');
    }
    discounts.push({ name: d.name.trim(), amount: d.amount });
  }

  const bill = await prisma.bill.findUniqueOrThrow({
    where: { id: billId },
    select: {
      status: true,
      classId: true,
      studentId: true,
      billedSessions: true,
      sessionsTotal: true,
      unitPrice: true,
      monthlyFee: true,
      prorationRatio: true,
      detail: true,
      goHallItem: true,
      payments: { select: { id: true } },
      tutoringEnrollment: { select: { feeTier: { select: { name: true } } } },
    },
  });
  // 弈廳帳單一律走 updateGoHallBill（連動扣回／改堂票季票），不能繞過這裡直接改。
  if (bill.goHallItem !== null) throw new Error('USE_GO_HALL_EDIT');
  if (bill.status !== 'FINALIZED') throw new Error('BILL_NOT_FINALIZED');
  if (bill.payments.length > 0) throw new Error('BILL_HAS_PAYMENTS');

  const discountTotal = discounts.reduce((s, d) => s + d.amount, 0);
  const oldDetail = bill.detail as { sessionDates: unknown[]; deduction: { deducted: number } | null };

  if (bill.classId !== null) {
    if (bill.unitPrice === null) throw new Error('MISSING_PRICE');
    const newBilled = input.billedSessions ?? bill.billedSessions ?? 0;
    if (!Number.isInteger(newBilled) || newBilled < 0) throw new Error('INVALID_INPUT');
    const delta = newBilled - (bill.billedSessions ?? 0);

    const sessionOps: Prisma.PrismaPromise<unknown>[] = [];
    if (delta !== 0) {
      const enrollment = await prisma.classEnrollment.findUnique({
        where: { studentId_classId: { studentId: bill.studentId, classId: bill.classId } },
      });
      if (!enrollment) throw new Error('BILL_ENROLLMENT_GONE');
      if (delta < 0) {
        const used = await prisma.classAttendance.count({
          where: { classId: bill.classId, studentId: bill.studentId, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } },
        });
        if ((enrollment.totalSessions ?? 0) + delta < used) throw new Error('BILL_SESSIONS_CONSUMED');
      }
      sessionOps.push(
        prisma.$executeRaw`UPDATE "ClassEnrollment" SET "totalSessions" = COALESCE("totalSessions", 0) + ${delta} WHERE "id" = ${enrollment.id}`,
        prisma.enrollmentPeriod.create({ data: { enrollmentId: enrollment.id, sessions: delta } })
      );
    }

    const gross = newBilled * bill.unitPrice;
    const adjusted = input.amountDue !== Math.max(0, gross - discountTotal);
    // 算式結構同 createStandaloneClassBill：無優惠時尾端是最終金額，有優惠時
    // formula 只到毛額、netFormula 收最終金額與手動調整標記。
    let formula: string;
    let netFormula: string | undefined;
    if (discounts.length === 0) {
      const amount = input.amountDue.toLocaleString('en-US');
      const base = oldDetail.deduction
        ? `${bill.sessionsTotal} − ${oldDetail.deduction.deducted} ＝ ${newBilled} 堂 × ${bill.unitPrice} ＝ ${amount} 元`
        : `${newBilled} 堂 × ${bill.unitPrice} ＝ ${amount} 元`;
      formula = adjusted ? `${base}（手動調整）` : base;
    } else {
      const grossStr = gross.toLocaleString('en-US');
      formula = oldDetail.deduction
        ? `${bill.sessionsTotal} − ${oldDetail.deduction.deducted} ＝ ${newBilled} 堂 × ${bill.unitPrice} ＝ ${grossStr} 元`
        : `${newBilled} 堂 × ${bill.unitPrice} ＝ ${grossStr} 元`;
      netFormula = buildNetFormula(gross, discounts, input.amountDue, adjusted);
    }
    const detail = {
      sessionDates: oldDetail.sessionDates,
      deduction: oldDetail.deduction,
      discounts,
      ...(netFormula ? { netFormula } : {}),
      formula,
    } as unknown as Prisma.InputJsonValue;

    await prisma.$transaction([
      ...sessionOps,
      prisma.bill.update({ where: { id: billId }, data: { billedSessions: newBilled, amountDue: input.amountDue, detail } }),
    ]);
    return;
  }

  // 個輔帳單：毛額由帳單凍結的月費×折算比例重建（級距名稱盡量取現況，取不到就退回通稱）。
  const gross = Math.round((bill.monthlyFee ?? 0) * (bill.prorationRatio ?? 1));
  const adjusted = input.amountDue !== Math.max(0, gross - discountTotal);
  const tierName = bill.tutoringEnrollment?.feeTier?.name ?? '級距';
  const ratio = bill.prorationRatio ?? 1;
  const ratioText = ratio < 1 ? `（折算 ${Math.round(ratio * 100)}%）` : '';
  let formula: string;
  let netFormula: string | undefined;
  if (discounts.length === 0) {
    formula = `月費（${tierName}）${ratioText} ＝ ${input.amountDue.toLocaleString('en-US')} 元${adjusted ? '（手動調整）' : ''}`;
  } else {
    formula = `月費（${tierName}）${ratioText} ＝ ${gross.toLocaleString('en-US')} 元`;
    netFormula = buildNetFormula(gross, discounts, input.amountDue, adjusted);
  }
  const detail = {
    sessionDates: oldDetail.sessionDates ?? [],
    deduction: oldDetail.deduction ?? null,
    discounts,
    ...(netFormula ? { netFormula } : {}),
    formula,
  } as unknown as Prisma.InputJsonValue;

  await prisma.bill.update({ where: { id: billId }, data: { amountDue: input.amountDue, detail } });
}
