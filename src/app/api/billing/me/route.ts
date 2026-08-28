import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getBillingSetting } from '@/lib/services/billingSettingService';
import { getPaidState } from '@/lib/billingCalc';
import { billTargetName } from '@/lib/services/billNotifyService';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
  const [setting, bills] = await Promise.all([
    getBillingSetting(),
    prisma.bill.findMany({
      where: { studentId: student.id, status: 'FINALIZED' },
      include: {
        payments: { orderBy: { paidOn: 'asc' } },
        class: { select: { name: true } },
        tutoringEnrollment: { select: { program: { select: { name: true } }, feeTier: { select: { name: true } } } },
      },
      orderBy: { periodStart: 'desc' },
    }),
  ]);
  return NextResponse.json({
    paymentInfo: setting.paymentInfo,
    bills: bills.map((b) => {
      const { paid, outstanding, state } = getPaidState(b.amountDue, b.payments);
      return {
        id: b.id,
        targetName: billTargetName(b),
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
        amountDue: b.amountDue,
        paid,
        outstanding,
        state,
        detail: b.detail,
        notifiedAt: b.notifiedAt,
        settledAsWithdrawal: b.settledAsWithdrawal,
        monthlyFee: b.monthlyFee,
        prorationRatio: b.prorationRatio,
        feeTierName: b.tutoringEnrollment?.feeTier?.name ?? null,
        payments: b.payments.map((p) => ({ amount: p.amount, paidOn: p.paidOn, method: p.method })),
      };
    }),
  });
}
