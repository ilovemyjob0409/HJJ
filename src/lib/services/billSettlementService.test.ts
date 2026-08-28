import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { saveClassAttendance } from './attendanceService';
import { createClassBatch, finalizeBatch, getBatchDetail } from './billingBatchService';
import { addPayment } from './billPaymentService';
import { remindBill } from './billNotifyService';
import { previewSettlement, settleBill } from './billSettlementService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

beforeEach(async () => {
  // saveClassAttendance requires a User row for markedById (FK constraint);
  // matches the seed pattern used in attendanceService.test.ts.
  await prisma.user.create({
    data: { id: 'marker-1', email: 'marker@example.com', password: 'x', name: 'Marker', role: 'TEACHER' },
  });
});

async function fixture() {
  const teacher = await createTeacher({ name: '陳老師', email: `st-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `st-s-${Date.now()}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
  await finalizeBatch(batchId, { notifyNow: false });
  const bill = (await getBatchDetail(batchId)).bills[0]; // 4 堂 × 500 = 2000
  return { teacher, student, cls, bill };
}

describe('remindBill', () => {
  it('sends a reminder with the outstanding amount; refuses on a paid bill', async () => {
    const { student, bill } = await fixture();
    await addPayment(bill.id, { amount: 500, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1');
    await remindBill(bill.id);
    const userId = (await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).userId;
    const notes = await prisma.notification.findMany({ where: { userId, title: '繳費提醒' } });
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain('1,500');

    await addPayment(bill.id, { amount: 1500, paidOn: D(2026, 9, 4), method: 'CASH' }, 'admin-1');
    await expect(remindBill(bill.id)).rejects.toThrow('ALREADY_PAID');
  });
});

describe('settlement', () => {
  it('suggests attended × unitPrice within the period and applies the adjustment', async () => {
    const { student, cls, bill } = await fixture();
    // 區間內上了 2 堂（一堂請假不算）
    await saveClassAttendance(cls.id, D(2026, 9, 5), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, D(2026, 9, 12), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, D(2026, 9, 19), 'marker-1', [{ studentId: student.id, status: 'ON_LEAVE' }]);
    await addPayment(bill.id, { amount: 2000, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1');

    const preview = await previewSettlement(bill.id);
    expect(preview).toMatchObject({ attendedSessions: 2, unitPrice: 500, suggestedAmount: 1000, paid: 2000, diff: -1000 }); // 應退 1000

    await settleBill(bill.id, { amount: 1000, note: '退班結算：已上 2 堂' });
    const updated = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(updated).toMatchObject({ amountDue: 1000, settledAsWithdrawal: true });
    await expect(settleBill(bill.id, { amount: 1000, note: 'x' })).rejects.toThrow('ALREADY_SETTLED');
  });

  it('suggests owing more when unpaid (追收)', async () => {
    const { student, cls, bill } = await fixture();
    // 完全沒繳，但上了 3 堂
    await saveClassAttendance(cls.id, D(2026, 9, 5), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, D(2026, 9, 12), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, D(2026, 9, 19), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const preview = await previewSettlement(bill.id);
    expect(preview).toMatchObject({ attendedSessions: 3, suggestedAmount: 1500, paid: 0, diff: 1500 }); // 應追收 1500
  });

  it('suggests a smaller remainder when only part was paid (部分繳)', async () => {
    const { student, cls, bill } = await fixture();
    // 上了 1 堂，已繳 500（原帳單 2000 中的一部分）
    await saveClassAttendance(cls.id, D(2026, 9, 5), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await addPayment(bill.id, { amount: 500, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1');

    const preview = await previewSettlement(bill.id);
    expect(preview).toMatchObject({ attendedSessions: 1, suggestedAmount: 500, paid: 500, diff: 0 }); // 剛好打平，不追不退
  });
});
