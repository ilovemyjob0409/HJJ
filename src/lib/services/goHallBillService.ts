import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { BillDiscount, buildNetFormula } from './standaloneBillService';
import { notifyBills } from './billNotifyService';
import { taipeiDateKey, utcDateKey } from './goHallTicketService';
import { formatDateWithWeekday } from '@/lib/dateFormat';

// 弈廳收費單（堂票／季票）：只走單獨開單，開單即入帳——堂票寫帳本 PURCHASE +N
// （reason 文字快照「收費單」，不建 FK），季票直接建立 GoHallSeasonPass 並以
// Bill.seasonPassId 關聯。刪除／編輯見 deleteGoHallBill／updateGoHallBill。

export type GoHallBillInput =
  | { item: 'TICKETS'; studentId: string; sessions: number; unitPrice: number; discounts?: BillDiscount[] }
  | { item: 'SEASON_PASS'; studentId: string; startDate: Date; endDate: Date; price: number; discounts?: BillDiscount[] };

const isNonNegInt = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

export { goHallItemName } from '@/lib/goHallBillItem';

function validate(input: GoHallBillInput) {
  if (input.item === 'TICKETS') {
    if (!Number.isInteger(input.sessions) || input.sessions < 1 || !isNonNegInt(input.unitPrice)) throw new Error('INVALID_INPUT');
  } else {
    if (!isNonNegInt(input.price)) throw new Error('INVALID_INPUT');
    if (utcDateKey(input.endDate) < utcDateKey(input.startDate)) throw new Error('INVALID_RANGE');
  }
}

function grossOf(input: GoHallBillInput): number {
  return input.item === 'TICKETS' ? input.sessions * input.unitPrice : input.price;
}

// formula 只寫毛額；無優惠時尾端就是最終金額(含手動調整標記)，有優惠時最終金額
// 與手動調整標記移到 netFormula（同 createStandaloneClassBill 的算式規則）。
export function buildGoHallFormulas(input: GoHallBillInput, amountDue: number, discounts: BillDiscount[]) {
  const gross = grossOf(input);
  const expected = Math.max(0, gross - discounts.reduce((s, d) => s + d.amount, 0));
  const adjusted = amountDue !== expected;
  const head =
    input.item === 'TICKETS'
      ? `弈廳堂票 ${input.sessions} 堂 × ${input.unitPrice}`
      : `弈廳季票 ${formatDateWithWeekday(input.startDate)}～${formatDateWithWeekday(input.endDate)}`;
  if (discounts.length === 0) {
    return { formula: `${head} ＝ ${amountDue.toLocaleString('en-US')} 元${adjusted ? '（手動調整）' : ''}`, netFormula: undefined };
  }
  return {
    formula: `${head} ＝ ${gross.toLocaleString('en-US')} 元`,
    netFormula: buildNetFormula(gross, discounts, amountDue, adjusted),
  };
}

export function previewGoHallBill(input: GoHallBillInput) {
  validate(input);
  const discounts = input.discounts ?? [];
  const grossAmount = grossOf(input);
  const amountDue = Math.max(0, grossAmount - discounts.reduce((s, d) => s + d.amount, 0));
  const { formula, netFormula } = buildGoHallFormulas(input, amountDue, discounts);
  return { grossAmount, amountDue, formula, ...(netFormula ? { netFormula } : {}) };
}

export async function createGoHallBill(
  input: GoHallBillInput & { amountDue: number; note?: string; notifyNow: boolean },
  now: Date = new Date()
): Promise<{ billId: string }> {
  validate(input);
  if (!isNonNegInt(input.amountDue)) throw new Error('INVALID_INPUT');
  const discounts = input.discounts ?? [];
  const { formula, netFormula } = buildGoHallFormulas(input, input.amountDue, discounts);
  const detail = { sessionDates: [], deduction: null, discounts, ...(netFormula ? { netFormula } : {}), formula } as unknown as Prisma.InputJsonValue;
  const today = new Date(`${taipeiDateKey(now)}T00:00:00Z`);

  const billId = await prisma.$transaction(async (tx) => {
    if (input.item === 'TICKETS') {
      const bill = await tx.bill.create({
        data: {
          studentId: input.studentId, periodStart: today, periodEnd: today,
          goHallItem: 'TICKETS', goHallTickets: input.sessions, unitPrice: input.unitPrice,
          amountDue: input.amountDue, detail, status: 'FINALIZED', note: input.note,
        },
      });
      await tx.goHallTicketTransaction.create({ data: { studentId: input.studentId, amount: input.sessions, kind: 'PURCHASE', reason: '收費單' } });
      await tx.student.update({ where: { id: input.studentId }, data: { goHallLowQuotaNotifiedAt: null } });
      return bill.id;
    }
    const pass = await tx.goHallSeasonPass.create({ data: { studentId: input.studentId, startDate: input.startDate, endDate: input.endDate } });
    const bill = await tx.bill.create({
      data: {
        studentId: input.studentId, periodStart: input.startDate, periodEnd: input.endDate,
        goHallItem: 'SEASON_PASS', seasonPassId: pass.id, unitPrice: input.price, // 季票價格存 unitPrice，編輯時重建毛額
        amountDue: input.amountDue, detail, status: 'FINALIZED', note: input.note,
      },
    });
    return bill.id;
  });

  if (input.notifyNow) await notifyBills([billId]);
  return { billId };
}
