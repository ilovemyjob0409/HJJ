import { prisma } from '@/lib/db';
import { getPaidState } from '@/lib/billingCalc';

export async function previewSettlement(billId: string) {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, include: { payments: true } });
  if (!bill.classId || bill.unitPrice === null) throw new Error('NOT_A_CLASS_BILL');
  const attendedSessions = await prisma.classAttendance.count({
    where: {
      classId: bill.classId, studentId: bill.studentId,
      date: { gte: bill.periodStart, lte: bill.periodEnd },
      status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] },
    },
  });
  const suggestedAmount = attendedSessions * bill.unitPrice;
  const { paid } = getPaidState(bill.amountDue, bill.payments);
  return { attendedSessions, unitPrice: bill.unitPrice, suggestedAmount, paid, diff: suggestedAmount - paid };
}

export async function settleBill(billId: string, input: { amount: number; note: string }): Promise<void> {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
  if (bill.settledAsWithdrawal) throw new Error('ALREADY_SETTLED');
  await prisma.bill.update({
    where: { id: billId },
    data: {
      amountDue: input.amount,
      settledAsWithdrawal: true,
      note: bill.note ? `${bill.note}｜${input.note}` : input.note,
    },
  });
}
