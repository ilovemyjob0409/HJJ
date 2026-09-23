import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { getTicketBalance } from './goHallTicketService';
import { previewGoHallBill, createGoHallBill } from './goHallBillService';
import { billTargetName } from './billNotifyService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = new Date(Date.UTC(2026, 8, 23, 4, 0)); // 台北 2026-09-23

async function newStudent() {
  return createStudent({ name: '小弈', email: `ghb-${Date.now()}-${Math.random()}@example.com`, password: 'x' });
}

describe('previewGoHallBill', () => {
  it('堂票：堂數×單價，有優惠時 netFormula 扣到最終金額', () => {
    const p = previewGoHallBill({ item: 'TICKETS', studentId: 's', sessions: 10, unitPrice: 300, discounts: [{ name: '手足', amount: 200 }] });
    expect(p.grossAmount).toBe(3000);
    expect(p.amountDue).toBe(2800);
    expect(p.formula).toBe('弈廳堂票 10 堂 × 300 ＝ 3,000 元');
    expect(p.netFormula).toBe('3,000 元 － 手足 200 元 ＝ 2,800 元');
  });

  it('季票：起訖＋價格；結束早於開始擋下', () => {
    const p = previewGoHallBill({ item: 'SEASON_PASS', studentId: 's', startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500 });
    expect(p.amountDue).toBe(4500);
    expect(p.formula).toContain('弈廳季票');
    expect(p.formula).toContain('4,500 元');
    expect(() => previewGoHallBill({ item: 'SEASON_PASS', studentId: 's', startDate: D(2026, 12, 1), endDate: D(2026, 10, 1), price: 1 })).toThrow('INVALID_RANGE');
    expect(() => previewGoHallBill({ item: 'TICKETS', studentId: 's', sessions: 0, unitPrice: 300 })).toThrow('INVALID_INPUT');
  });
});

describe('createGoHallBill', () => {
  it('堂票：建立已定案帳單＋帳本 +N（reason 收費單）＋清低堂數提醒戳記', async () => {
    const student = await newStudent();
    await prisma.student.update({ where: { id: student.id }, data: { goHallLowQuotaNotifiedAt: new Date() } });
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 10, unitPrice: 300, amountDue: 3000, notifyNow: false }, NOW);

    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill).toMatchObject({ status: 'FINALIZED', goHallItem: 'TICKETS', goHallTickets: 10, unitPrice: 300, amountDue: 3000, batchId: null });
    expect(bill.periodStart.toISOString().slice(0, 10)).toBe('2026-09-23');
    expect(bill.periodEnd.toISOString().slice(0, 10)).toBe('2026-09-23');
    expect(await getTicketBalance(student.id)).toBe(10);
    const tx = await prisma.goHallTicketTransaction.findFirstOrThrow({ where: { studentId: student.id } });
    expect(tx).toMatchObject({ kind: 'PURCHASE', amount: 10, reason: '收費單' });
    const s = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(s.goHallLowQuotaNotifiedAt).toBeNull();
    expect(billTargetName({ class: null, tutoringEnrollment: null, goHallItem: bill.goHallItem, goHallTickets: bill.goHallTickets })).toBe('弈廳堂票 10 堂');
  });

  it('季票：建立季票並關聯，收費區間＝季票起訖；金額與試算不同時標手動調整', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill(
      { item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4000, notifyNow: false },
      NOW
    );
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, include: { seasonPass: true } });
    expect(bill.goHallItem).toBe('SEASON_PASS');
    expect(bill.seasonPass).not.toBeNull();
    expect(bill.unitPrice).toBe(4500); // 季票價格存在 unitPrice，編輯時重建毛額用
    expect(bill.seasonPass!.startDate.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(bill.periodEnd.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect((bill.detail as { formula: string }).formula).toContain('（手動調整）');
    expect(billTargetName({ class: null, tutoringEnrollment: null, goHallItem: 'SEASON_PASS', goHallTickets: null })).toBe('弈廳季票');
  });
});
