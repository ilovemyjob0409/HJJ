import { prisma } from '@/lib/db';
import { notifyUser } from './notificationService';
import { billTargetName } from './billNotifyService';
import { getPaidState } from '@/lib/billingCalc';

export { getPaidState }; // 沿用既有 import 路徑（'./billPaymentService'）的呼叫端不用改

export async function addPayment(
  billId: string,
  input: { amount: number; paidOn: Date; method: 'CASH' | 'TRANSFER'; note?: string },
  createdById: string
): Promise<void> {
  if (input.amount <= 0) throw new Error('INVALID_AMOUNT');
  const bill = await prisma.bill.findUniqueOrThrow({
    where: { id: billId },
    include: { payments: true, student: { select: { userId: true } }, class: { select: { name: true } }, tutoringEnrollment: { select: { program: { select: { name: true } } } } },
  });
  if (bill.status !== 'FINALIZED') throw new Error('BILL_NOT_FINALIZED');
  const { outstanding } = getPaidState(bill.amountDue, bill.payments);
  if (input.amount > outstanding) throw new Error('OVERPAY');

  await prisma.billPayment.create({ data: { billId, ...input, createdById } });
  const after = outstanding - input.amount;
  await notifyUser(bill.student.userId, {
    title: '繳費入帳通知',
    body: after > 0
      ? `${billTargetName(bill)} 已收到繳費 ${input.amount.toLocaleString('en-US')} 元，尚欠 ${after.toLocaleString('en-US')} 元`
      : `${billTargetName(bill)} 已收到繳費 ${input.amount.toLocaleString('en-US')} 元，已繳清，感謝您`,
    url: '/student/billing',
  });
}

export async function deletePayment(paymentId: string): Promise<void> {
  await prisma.billPayment.delete({ where: { id: paymentId } });
}
