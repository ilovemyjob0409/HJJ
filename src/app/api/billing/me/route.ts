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
  try {
    const student = await prisma.student.findUniqueOrThrow({ where: { userId: session.user.id } });
    // 手足帳單合併顯示：同一 familyGroup 的帳單全部撈出來，兩個帳號看到同一份清單
    // （家長不用切帳號逐一看）。沒有手足的帳號 memberIds 就只有自己，行為不變。
    const memberIds = student.familyGroupId
      ? (await prisma.student.findMany({ where: { familyGroupId: student.familyGroupId }, select: { id: true } })).map((s) => s.id)
      : [student.id];
    const [setting, bills] = await Promise.all([
      getBillingSetting(),
      prisma.bill.findMany({
        where: { studentId: { in: memberIds }, status: 'FINALIZED' },
        include: {
          payments: { orderBy: { paidOn: 'asc' } },
          class: { select: { name: true } },
          tutoringEnrollment: { select: { program: { select: { name: true } }, feeTier: { select: { name: true } } } },
          student: { select: { user: { select: { name: true } } } },
        },
        orderBy: { periodStart: 'desc' },
      }),
    ]);
    return NextResponse.json({
      paymentInfo: setting.paymentInfo,
      hasSiblings: memberIds.length > 1,
      bills: bills.map((b) => {
        const { paid, outstanding, state } = getPaidState(b.amountDue, b.payments);
        return {
          id: b.id,
          studentName: b.student.user.name,
          isSelf: b.studentId === student.id,
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
  } catch (e) {
    const code = e instanceof Error ? e.message : 'INTERNAL';
    if (/^[A-Z_]+$/.test(code)) return NextResponse.json({ error: code }, { status: 400 });
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  }
}
