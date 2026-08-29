import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createClassBatch, finalizeBatch, getBatchDetail } from './billingBatchService';
import { setSiblings } from './familyService';
import { addPayment, deletePayment, getPendingBillSummaryForStudent } from './billPaymentService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

async function finalizedBillFixture() {
  const teacher = await createTeacher({ name: '陳老師', email: `pay-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `pay-s-${Date.now()}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
  await finalizeBatch(batchId, { notifyNow: false });
  const bill = (await getBatchDetail(batchId)).bills[0]; // amountDue 2000
  return { student, bill };
}

describe('addPayment / deletePayment', () => {
  it('records multiple payments, blocks overpay, notifies a receipt, and restores on delete', async () => {
    const { student, bill } = await finalizedBillFixture();
    await addPayment(bill.id, { amount: 500, paidOn: D(2026, 9, 3), method: 'TRANSFER' }, 'admin-1');
    await expect(addPayment(bill.id, { amount: 1600, paidOn: D(2026, 9, 4), method: 'CASH' }, 'admin-1')).rejects.toThrow('OVERPAY');
    await addPayment(bill.id, { amount: 1500, paidOn: D(2026, 9, 5), method: 'CASH' }, 'admin-1');

    const payments = await prisma.billPayment.findMany({ where: { billId: bill.id }, orderBy: { paidOn: 'asc' } });
    expect(payments).toHaveLength(2);

    const userId = (await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).userId;
    const notes = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    expect(notes.some((n) => n.body.includes('待繳'))).toBe(true); // 第一筆
    expect(notes.some((n) => n.body.includes('已繳清'))).toBe(true); // 第二筆

    await deletePayment(payments[1].id);
    expect(await prisma.billPayment.count({ where: { billId: bill.id } })).toBe(1);
  });

  it('rejects non-positive amounts and draft bills', async () => {
    const { bill } = await finalizedBillFixture();
    await expect(addPayment(bill.id, { amount: 0, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1')).rejects.toThrow('INVALID_AMOUNT');
  });
});

describe('getPendingBillSummaryForStudent', () => {
  it('sums outstanding across unpaid and partial bills, skipping paid ones', async () => {
    const { bill } = await finalizedBillFixture(); // amountDue 2000，未繳
    await addPayment(bill.id, { amount: 2000, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1');
    const studentId = (await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).studentId;

    // 繳清後不列入
    expect(await getPendingBillSummaryForStudent(studentId)).toEqual({ outstanding: 0, count: 0 });

    // 再開一批（10 月），部分繳 500 → 待繳 1500、1 筆
    const cls = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId } });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 10, 1), periodEnd: D(2026, 10, 31), classIds: [cls.classId] });
    await finalizeBatch(batchId, { notifyNow: false });
    const octBill = (await getBatchDetail(batchId)).bills[0];
    await addPayment(octBill.id, { amount: 500, paidOn: D(2026, 10, 3), method: 'CASH' }, 'admin-1');

    expect(await getPendingBillSummaryForStudent(studentId)).toEqual({ outstanding: octBill.amountDue - 500, count: 1 });
  });

  it('merges sibling bills and ignores draft batches', async () => {
    const { bill } = await finalizedBillFixture(); // 哥哥的 9 月帳單 2000
    const studentId = (await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).studentId;
    const sibling = await createStudent({ name: '小華', email: `pay-sib-${Date.now()}@example.com`, password: 'x' });
    await setSiblings(studentId, [sibling.id]);

    // 手足報同一班並開 10 月批次但「不定案」→ 草稿不列入
    const cls = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId } });
    await enrollStudent(cls.classId, sibling.id);
    const { batchId } = await createClassBatch({ periodStart: D(2026, 10, 1), periodEnd: D(2026, 10, 31), classIds: [cls.classId] });

    // 草稿批次不算，只有哥哥的已定案帳單
    expect(await getPendingBillSummaryForStudent(sibling.id)).toEqual({ outstanding: bill.amountDue, count: 1 });

    // 定案後：哥哥 9 月＋兩人 10 月，共 3 筆，從任一手足查都一樣
    await finalizeBatch(batchId, { notifyNow: false });
    const octBills = (await getBatchDetail(batchId)).bills;
    const total = bill.amountDue + octBills.reduce((s, b) => s + b.amountDue, 0);
    expect(await getPendingBillSummaryForStudent(sibling.id)).toEqual({ outstanding: total, count: 3 });
    expect(await getPendingBillSummaryForStudent(studentId)).toEqual({ outstanding: total, count: 3 });
  });
});
