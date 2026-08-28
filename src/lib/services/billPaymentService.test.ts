import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createClassBatch, finalizeBatch, getBatchDetail } from './billingBatchService';
import { addPayment, deletePayment } from './billPaymentService';

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
    expect(notes.some((n) => n.body.includes('尚欠'))).toBe(true); // 第一筆
    expect(notes.some((n) => n.body.includes('已繳清'))).toBe(true); // 第二筆

    await deletePayment(payments[1].id);
    expect(await prisma.billPayment.count({ where: { billId: bill.id } })).toBe(1);
  });

  it('rejects non-positive amounts and draft bills', async () => {
    const { bill } = await finalizedBillFixture();
    await expect(addPayment(bill.id, { amount: 0, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1')).rejects.toThrow('INVALID_AMOUNT');
  });
});
