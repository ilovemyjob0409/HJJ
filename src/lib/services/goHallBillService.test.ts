import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { getTicketBalance } from './goHallTicketService';
import { previewGoHallBill, createGoHallBill, deleteGoHallBill, updateGoHallBill } from './goHallBillService';
import { billTargetName } from './billNotifyService';
import { createTeacher } from './teacherService';
import { deleteSeasonPass } from './goHallTicketService';
import { deleteBill } from './billingBatchService';
import { updateFinalizedBill } from './billEditService';

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

async function seasonPassVisit(studentId: string, date: Date) {
  const teacher = await createTeacher({ name: '弈廳老師', email: `ghb-t-${Date.now()}-${Math.random()}@example.com`, password: 'x', subjects: '圍棋' });
  const session = await prisma.goHallSession.create({ data: { date, startTime: '14:00', endTime: '17:00', capacity: 10, teacherId: teacher.id } });
  const marker = await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } });
  await prisma.goHallAttendance.create({ data: { sessionId: session.id, studentId, status: 'PRESENT', qualification: 'SEASON_PASS', markedById: marker.userId } });
}

describe('deleteGoHallBill', () => {
  it('堂票：扣回 N 堂（ADMIN_ADJUST 刪除收費單扣回）並刪帳單', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 5, unitPrice: 300, amountDue: 1500, notifyNow: false }, NOW);
    await deleteGoHallBill(billId);
    expect(await prisma.bill.findUnique({ where: { id: billId } })).toBeNull();
    expect(await getTicketBalance(student.id)).toBe(0);
    const adj = await prisma.goHallTicketTransaction.findFirstOrThrow({ where: { studentId: student.id, kind: 'ADMIN_ADJUST' } });
    expect(adj).toMatchObject({ amount: -5, reason: '刪除收費單扣回' });
  });

  it('堂票已用掉（餘額不足扣回）擋下', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 2, unitPrice: 300, amountDue: 600, notifyNow: false }, NOW);
    await prisma.goHallTicketTransaction.create({ data: { studentId: student.id, amount: -1, kind: 'ATTEND' } });
    await expect(deleteGoHallBill(billId)).rejects.toThrow('BILL_TICKETS_CONSUMED');
    expect(await prisma.bill.findUnique({ where: { id: billId } })).not.toBeNull();
  });

  it('季票：未使用可連同季票刪除；已有季票到場且無其他季票涵蓋時擋下', async () => {
    const student = await newStudent();
    const a = await createGoHallBill({ item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4500, notifyNow: false }, NOW);
    const passId = (await prisma.bill.findUniqueOrThrow({ where: { id: a.billId } })).seasonPassId!;
    await deleteGoHallBill(a.billId);
    expect(await prisma.goHallSeasonPass.findUnique({ where: { id: passId } })).toBeNull();

    const b = await createGoHallBill({ item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4500, notifyNow: false }, NOW);
    await seasonPassVisit(student.id, D(2026, 10, 10));
    await expect(deleteGoHallBill(b.billId)).rejects.toThrow('BILL_SEASON_PASS_USED');
  });

  it('季票到場日另有季票涵蓋時允許刪除', async () => {
    const student = await newStudent();
    const b = await createGoHallBill({ item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4500, notifyNow: false }, NOW);
    await prisma.goHallSeasonPass.create({ data: { studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 10, 31) } });
    await seasonPassVisit(student.id, D(2026, 10, 10));
    await deleteGoHallBill(b.billId);
    expect(await prisma.bill.findUnique({ where: { id: b.billId } })).toBeNull();
  });

  it('有繳款紀錄擋下', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 1, unitPrice: 300, amountDue: 300, notifyNow: false }, NOW);
    await prisma.billPayment.create({ data: { billId, amount: 100, paidOn: D(2026, 9, 23), method: 'CASH', createdById: 'admin' } });
    await expect(deleteGoHallBill(billId)).rejects.toThrow('BILL_HAS_PAYMENTS');
  });
});

describe('updateGoHallBill', () => {
  it('堂票改堂數：差額寫帳本（收費單修改堂數），扣回時檢查餘額', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 5, unitPrice: 300, amountDue: 1500, notifyNow: false }, NOW);
    await updateGoHallBill(billId, { sessions: 8, unitPrice: 300, amountDue: 2400, discounts: [] });
    expect(await getTicketBalance(student.id)).toBe(8);
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill).toMatchObject({ goHallTickets: 8, amountDue: 2400 });
    expect((bill.detail as { formula: string }).formula).toBe('弈廳堂票 8 堂 × 300 ＝ 2,400 元');

    await prisma.goHallTicketTransaction.create({ data: { studentId: student.id, amount: -7, kind: 'ATTEND' } });
    await expect(updateGoHallBill(billId, { sessions: 2, unitPrice: 300, amountDue: 600, discounts: [] })).rejects.toThrow('BILL_TICKETS_CONSUMED');
  });

  it('季票改日期：同步改季票與收費區間；已用日期落到新區間外擋下', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4500, notifyNow: false }, NOW);
    await seasonPassVisit(student.id, D(2026, 10, 10));
    await updateGoHallBill(billId, { startDate: D(2026, 10, 5), endDate: D(2027, 1, 4), price: 4500, amountDue: 4500, discounts: [] });
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, include: { seasonPass: true } });
    expect(bill.periodStart.toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(bill.seasonPass!.endDate.toISOString().slice(0, 10)).toBe('2027-01-04');
    await expect(
      updateGoHallBill(billId, { startDate: D(2026, 10, 15), endDate: D(2027, 1, 4), price: 4500, amountDue: 4500, discounts: [] })
    ).rejects.toThrow('BILL_SEASON_PASS_USED');
  });
});

describe('deleteSeasonPass 守門', () => {
  it('綁著收費單的季票不能從票券管理直接刪', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'SEASON_PASS', studentId: student.id, startDate: D(2026, 10, 1), endDate: D(2026, 12, 31), price: 4500, amountDue: 4500, notifyNow: false }, NOW);
    const passId = (await prisma.bill.findUniqueOrThrow({ where: { id: billId } })).seasonPassId!;
    await expect(deleteSeasonPass(passId)).rejects.toThrow('SEASON_PASS_HAS_BILL');
  });
});

describe('billingBatchService.deleteBill 防呆：弈廳帳單擋下', () => {
  it('弈廳堂票帳單直接呼叫 deleteBill 會拋錯，帳單仍在', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 3, unitPrice: 300, amountDue: 900, notifyNow: false }, NOW);
    await expect(deleteBill(billId)).rejects.toThrow('USE_GO_HALL_DELETE');
    expect(await prisma.bill.findUnique({ where: { id: billId } })).not.toBeNull();
  });
});

describe('billEditService.updateFinalizedBill 防呆：弈廳帳單擋下', () => {
  it('弈廳堂票帳單直接呼叫 updateFinalizedBill 會拋錯，帳單不受影響', async () => {
    const student = await newStudent();
    const { billId } = await createGoHallBill({ item: 'TICKETS', studentId: student.id, sessions: 3, unitPrice: 300, amountDue: 900, notifyNow: false }, NOW);
    await expect(updateFinalizedBill(billId, { amountDue: 100, discounts: [] })).rejects.toThrow('USE_GO_HALL_EDIT');
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.amountDue).toBe(900);
  });
});
