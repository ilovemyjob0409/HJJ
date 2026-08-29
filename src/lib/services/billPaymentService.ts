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
      ? `${billTargetName(bill)} 已收到繳費 ${input.amount.toLocaleString('en-US')} 元，待繳 ${after.toLocaleString('en-US')} 元`
      : `${billTargetName(bill)} 已收到繳費 ${input.amount.toLocaleString('en-US')} 元，已繳清，感謝您`,
    url: '/student/billing',
  });
}

export async function deletePayment(paymentId: string): Promise<void> {
  await prisma.billPayment.delete({ where: { id: paymentId } });
}

// 首頁儀表板的待繳摘要。手足帳單合併計算（同 /api/billing/me 的邏輯：同一
// familyGroup 全算進來，家長看哪個帳號數字都一樣）；只算已定案帳單。
export async function getPendingBillSummaryForStudent(studentId: string): Promise<{ outstanding: number; count: number }> {
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { id: true, familyGroupId: true } });
  const memberIds = student.familyGroupId
    ? (await prisma.student.findMany({ where: { familyGroupId: student.familyGroupId }, select: { id: true } })).map((s) => s.id)
    : [student.id];
  const bills = await prisma.bill.findMany({
    where: { studentId: { in: memberIds }, status: 'FINALIZED' },
    select: { amountDue: true, payments: { select: { amount: true } } },
  });
  let outstanding = 0;
  let count = 0;
  for (const b of bills) {
    const state = getPaidState(b.amountDue, b.payments);
    if (state.state === 'PAID') continue;
    outstanding += state.outstanding;
    count += 1;
  }
  return { outstanding, count };
}
