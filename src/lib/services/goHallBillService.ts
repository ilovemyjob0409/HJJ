import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { BillDiscount, buildNetFormula } from './standaloneBillService';
import { notifyBills } from './billNotifyService';
import { taipeiDateKey, utcDateKey, getTicketBalance } from './goHallTicketService';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { runSerializableWithRetry } from '@/lib/transaction';

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

type Tx = Prisma.TransactionClient;

// 這張季票（passId）在 [from, to] 內被拿來簽到、且當天沒有其他季票涵蓋的日期。
// 季票到場（qualification SEASON_PASS）沒有關聯是哪一張季票，只能用日期比對。
async function datesOnlyCoveredBy(tx: Tx, studentId: string, passId: string, from: Date, to: Date): Promise<string[]> {
  const [visits, others] = await Promise.all([
    tx.goHallAttendance.findMany({
      where: { studentId, qualification: 'SEASON_PASS', session: { date: { gte: from, lte: to } } },
      select: { session: { select: { date: true } } },
    }),
    tx.goHallSeasonPass.findMany({ where: { studentId, id: { not: passId } }, select: { startDate: true, endDate: true } }),
  ]);
  return visits
    .map((v) => utcDateKey(v.session.date))
    .filter((d) => !others.some((p) => utcDateKey(p.startDate) <= d && d <= utcDateKey(p.endDate)));
}

async function loadEditableGoHallBill(tx: Tx, billId: string) {
  const bill = await tx.bill.findUniqueOrThrow({
    where: { id: billId },
    select: {
      status: true, studentId: true, goHallItem: true, goHallTickets: true, unitPrice: true, seasonPassId: true,
      seasonPass: { select: { startDate: true, endDate: true } },
      payments: { select: { id: true } },
    },
  });
  if (bill.goHallItem === null) throw new Error('NOT_GO_HALL_BILL');
  if (bill.status !== 'FINALIZED') throw new Error('BILL_NOT_FINALIZED');
  if (bill.payments.length > 0) throw new Error('BILL_HAS_PAYMENTS');
  return bill;
}

export function deleteGoHallBill(billId: string): Promise<void> {
  return runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const bill = await loadEditableGoHallBill(tx, billId);
        if (bill.goHallItem === 'TICKETS') {
          const n = bill.goHallTickets ?? 0;
          if ((await getTicketBalance(bill.studentId, tx)) - n < 0) throw new Error('BILL_TICKETS_CONSUMED');
          await tx.bill.delete({ where: { id: billId } });
          if (n > 0) {
            await tx.goHallTicketTransaction.create({ data: { studentId: bill.studentId, amount: -n, kind: 'ADMIN_ADJUST', reason: '刪除收費單扣回' } });
          }
          return;
        }
        const pass = bill.seasonPass!;
        const used = await datesOnlyCoveredBy(tx, bill.studentId, bill.seasonPassId!, pass.startDate, pass.endDate);
        if (used.length > 0) throw new Error('BILL_SEASON_PASS_USED');
        await tx.bill.delete({ where: { id: billId } }); // 先刪帳單，才能刪 Restrict 的季票
        await tx.goHallSeasonPass.delete({ where: { id: bill.seasonPassId! } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export function updateGoHallBill(
  billId: string,
  input: { amountDue: number; discounts: BillDiscount[]; sessions?: number; unitPrice?: number; startDate?: Date; endDate?: Date; price?: number }
): Promise<void> {
  if (!isNonNegInt(input.amountDue)) return Promise.reject(new Error('INVALID_INPUT'));
  if (!Array.isArray(input.discounts)) return Promise.reject(new Error('INVALID_DISCOUNTS'));
  const discounts: BillDiscount[] = [];
  for (const d of input.discounts) {
    if (typeof d?.name !== 'string' || d.name.trim() === '' || !Number.isInteger(d.amount) || d.amount <= 0) {
      return Promise.reject(new Error('INVALID_DISCOUNTS'));
    }
    discounts.push({ name: d.name.trim(), amount: d.amount });
  }

  return runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const bill = await loadEditableGoHallBill(tx, billId);
        if (bill.goHallItem === 'TICKETS') {
          const sessions = input.sessions ?? bill.goHallTickets ?? 0;
          const unitPrice = input.unitPrice ?? bill.unitPrice ?? 0;
          const spec: GoHallBillInput = { item: 'TICKETS', studentId: bill.studentId, sessions, unitPrice, discounts };
          validate(spec);
          const delta = sessions - (bill.goHallTickets ?? 0);
          if (delta < 0 && (await getTicketBalance(bill.studentId, tx)) + delta < 0) throw new Error('BILL_TICKETS_CONSUMED');
          const { formula, netFormula } = buildGoHallFormulas(spec, input.amountDue, discounts);
          await tx.bill.update({
            where: { id: billId },
            data: {
              goHallTickets: sessions, unitPrice, amountDue: input.amountDue,
              detail: { sessionDates: [], deduction: null, discounts, ...(netFormula ? { netFormula } : {}), formula } as unknown as Prisma.InputJsonValue,
            },
          });
          if (delta !== 0) {
            await tx.goHallTicketTransaction.create({ data: { studentId: bill.studentId, amount: delta, kind: 'ADMIN_ADJUST', reason: '收費單修改堂數' } });
            if (delta > 0) await tx.student.update({ where: { id: bill.studentId }, data: { goHallLowQuotaNotifiedAt: null } });
          }
          return;
        }
        const pass = bill.seasonPass!;
        const startDate = input.startDate ?? pass.startDate;
        const endDate = input.endDate ?? pass.endDate;
        const price = input.price ?? bill.unitPrice ?? 0;
        const spec: GoHallBillInput = { item: 'SEASON_PASS', studentId: bill.studentId, startDate, endDate, price, discounts };
        validate(spec);
        const used = await datesOnlyCoveredBy(tx, bill.studentId, bill.seasonPassId!, pass.startDate, pass.endDate);
        const s = utcDateKey(startDate);
        const e = utcDateKey(endDate);
        if (used.some((d) => d < s || d > e)) throw new Error('BILL_SEASON_PASS_USED');
        const { formula, netFormula } = buildGoHallFormulas(spec, input.amountDue, discounts);
        await tx.goHallSeasonPass.update({ where: { id: bill.seasonPassId! }, data: { startDate, endDate } });
        await tx.bill.update({
          where: { id: billId },
          data: {
            periodStart: startDate, periodEnd: endDate, unitPrice: price, amountDue: input.amountDue,
            detail: { sessionDates: [], deduction: null, discounts, ...(netFormula ? { netFormula } : {}), formula } as unknown as Prisma.InputJsonValue,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}
