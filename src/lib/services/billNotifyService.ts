import { prisma } from '@/lib/db';
import { notifyUser } from './notificationService';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { getPaidState } from '@/lib/billingCalc';
import { goHallItemName } from '@/lib/goHallBillItem';

const BILL_NOTIFY_INCLUDE = {
  student: { select: { userId: true } },
  class: { select: { name: true } },
  tutoringEnrollment: { select: { program: { select: { name: true } } } },
} as const;

export function billTargetName(bill: {
  class: { name: string } | null;
  tutoringEnrollment: { program: { name: string } } | null;
  goHallItem?: 'TICKETS' | 'SEASON_PASS' | null;
  goHallTickets?: number | null;
}): string {
  return (
    bill.class?.name ??
    bill.tutoringEnrollment?.program.name ??
    goHallItemName({ goHallItem: bill.goHallItem ?? null, goHallTickets: bill.goHallTickets ?? null }) ??
    ''
  );
}

export interface NotifyBillsResult {
  succeeded: number;
  failed: number;
}

export async function notifyBills(billIds: string[]): Promise<NotifyBillsResult> {
  const bills = await prisma.bill.findMany({ where: { id: { in: billIds } }, include: BILL_NOTIFY_INCLUDE });
  if (bills.some((b) => b.status !== 'FINALIZED')) throw new Error('BILL_NOT_FINALIZED');
  const now = new Date();
  const succeededIds: string[] = [];
  let failed = 0;
  for (const bill of bills) {
    try {
      await notifyUser(bill.student.userId, {
        title: '繳費通知',
        body: `${billTargetName(bill)} ${formatDateWithWeekday(bill.periodStart)}～${formatDateWithWeekday(bill.periodEnd)} 應繳 ${bill.amountDue.toLocaleString('en-US')} 元，點擊查看明細`,
        url: '/student/billing',
      });
      succeededIds.push(bill.id);
    } catch (err) {
      failed += 1;
      console.error(`notifyBills: failed to notify bill ${bill.id}`, err);
    }
  }
  if (succeededIds.length > 0) {
    await prisma.bill.updateMany({ where: { id: { in: succeededIds } }, data: { notifiedAt: now } });
  }
  return { succeeded: succeededIds.length, failed };
}

export async function remindBill(billId: string): Promise<void> {
  const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, include: { ...BILL_NOTIFY_INCLUDE, payments: true } });
  const { outstanding } = getPaidState(bill.amountDue, bill.payments);
  if (outstanding <= 0) throw new Error('ALREADY_PAID');
  await notifyUser(bill.student.userId, {
    title: '繳費提醒',
    body: `${billTargetName(bill)} 待繳 ${outstanding.toLocaleString('en-US')} 元，再麻煩您撥空繳費，感謝`,
    url: '/student/billing',
  });
}

export interface RemindBillsResult {
  sent: number;
  skipped: number; // 已繳清或非已定案，不需提醒
  failed: number;
}

// 批次提醒繳費：逐筆發送，已繳清／非已定案的略過，單筆失敗不中斷其餘（同 notifyBills）。
export async function remindBills(billIds: string[]): Promise<RemindBillsResult> {
  const bills = await prisma.bill.findMany({ where: { id: { in: billIds } }, include: { ...BILL_NOTIFY_INCLUDE, payments: true } });
  const result: RemindBillsResult = { sent: 0, skipped: billIds.length - bills.length, failed: 0 };
  for (const bill of bills) {
    const { outstanding } = getPaidState(bill.amountDue, bill.payments);
    if (bill.status !== 'FINALIZED' || outstanding <= 0) {
      result.skipped += 1;
      continue;
    }
    try {
      await notifyUser(bill.student.userId, {
        title: '繳費提醒',
        body: `${billTargetName(bill)} 待繳 ${outstanding.toLocaleString('en-US')} 元，再麻煩您撥空繳費，感謝`,
        url: '/student/billing',
      });
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      console.error(`remindBills: failed to remind bill ${bill.id}`, err);
    }
  }
  return result;
}
