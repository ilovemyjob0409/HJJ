import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createProgram } from './tutoringProgramService';
import { seedDefaultFeeTiers, listFeeTiers, setEnrollmentFeeTier } from './tutoringFeeTierService';
import { createClassBatch, getBatchDetail, finalizeBatch } from './billingBatchService';
import { createStandaloneClassBill, createStandaloneTutoringBill } from './standaloneBillService';
import { addPayment } from './billPaymentService';
import { updateFinalizedBill } from './billEditService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

async function setupClassFixture() {
  const teacher = await createTeacher({ name: '陳老師', email: `be-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `be-s-${Date.now()}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  return { teacher, student, cls };
}

// 建一張已定案、已充 4 堂的單獨開單班級帳單（2026-09 有 4 個週六）
async function setupStandaloneClassBill() {
  const fixture = await setupClassFixture();
  const { billId } = await createStandaloneClassBill({
    studentId: fixture.student.id,
    classId: fixture.cls.id,
    periodStart: D(2026, 9, 1),
    periodEnd: D(2026, 9, 30),
    billedSessions: 4,
    amountDue: 2000,
    notifyNow: false,
  });
  const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: fixture.student.id, classId: fixture.cls.id } });
  return { ...fixture, billId, enrollmentId: enrollment.id };
}

describe('updateFinalizedBill（班級帳單）', () => {
  it('加堂＋加優惠：帳單、明細、總堂數與期別帳本一起更新', async () => {
    const { billId, enrollmentId } = await setupStandaloneClassBill();

    await updateFinalizedBill(billId, {
      billedSessions: 6,
      amountDue: 2500,
      discounts: [{ name: '早鳥優惠', amount: 500 }],
    });

    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.billedSessions).toBe(6);
    expect(bill.amountDue).toBe(2500);
    const detail = bill.detail as { discounts: { name: string; amount: number }[]; formula: string; netFormula?: string };
    expect(detail.discounts).toEqual([{ name: '早鳥優惠', amount: 500 }]);
    expect(detail.formula).toContain('6 堂 × 500');
    expect(detail.netFormula).toContain('早鳥優惠');
    expect(detail.netFormula).toContain('2,500 元');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(enrollment.totalSessions).toBe(6);
    const periods = await prisma.enrollmentPeriod.findMany({ where: { enrollmentId }, orderBy: { createdAt: 'asc' } });
    expect(periods.map((p) => p.sessions)).toEqual([4, 2]);
  });

  it('減堂且金額吻合：帳本留負數期別、算式不標手動調整、netFormula 不存在', async () => {
    const { billId, enrollmentId } = await setupStandaloneClassBill();

    await updateFinalizedBill(billId, { billedSessions: 2, amountDue: 1000, discounts: [] });

    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.billedSessions).toBe(2);
    expect(bill.amountDue).toBe(1000);
    const detail = bill.detail as { formula: string; netFormula?: string };
    expect(detail.formula).toContain('2 堂 × 500');
    expect(detail.formula).not.toContain('手動調整');
    expect(detail.netFormula).toBeUndefined();

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(enrollment.totalSessions).toBe(2);
    const periods = await prisma.enrollmentPeriod.findMany({ where: { enrollmentId }, orderBy: { createdAt: 'asc' } });
    expect(periods.map((p) => p.sessions)).toEqual([4, -2]);
  });

  it('減堂會讓剩餘變負時擋下（BILL_SESSIONS_CONSUMED），什麼都不改', async () => {
    const { billId, enrollmentId, student, cls } = await setupStandaloneClassBill();
    const marker = await prisma.user.findFirstOrThrow();
    for (const day of [5, 12, 19]) {
      await prisma.classAttendance.create({
        data: { classId: cls.id, studentId: student.id, date: D(2026, 9, day), status: 'PRESENT', markedById: marker.id },
      });
    }

    // total 4 → 改 2（delta −2）＝ 2 < used 3
    await expect(updateFinalizedBill(billId, { billedSessions: 2, amountDue: 1000, discounts: [] })).rejects.toThrow('BILL_SESSIONS_CONSUMED');

    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.billedSessions).toBe(4);
    expect(bill.amountDue).toBe(2000);
    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(enrollment.totalSessions).toBe(4);
  });

  it('已有繳款紀錄擋下（BILL_HAS_PAYMENTS）', async () => {
    const { billId } = await setupStandaloneClassBill();
    await addPayment(billId, { amount: 500, paidOn: D(2026, 9, 3), method: 'CASH' }, 'admin-1');

    await expect(updateFinalizedBill(billId, { amountDue: 1500, discounts: [] })).rejects.toThrow('BILL_HAS_PAYMENTS');
  });

  it('草稿帳單擋下（BILL_NOT_FINALIZED）', async () => {
    const { cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    const bill = (await getBatchDetail(batchId)).bills[0];

    await expect(updateFinalizedBill(bill.id, { amountDue: 100, discounts: [] })).rejects.toThrow('BILL_NOT_FINALIZED');
  });

  it('報名已不存在時：改堂數擋下（BILL_ENROLLMENT_GONE），只改金額/優惠仍可行', async () => {
    const { billId, enrollmentId } = await setupStandaloneClassBill();
    await prisma.enrollmentPeriod.deleteMany({ where: { enrollmentId } });
    await prisma.classEnrollment.delete({ where: { id: enrollmentId } });

    await expect(updateFinalizedBill(billId, { billedSessions: 5, amountDue: 2500, discounts: [] })).rejects.toThrow('BILL_ENROLLMENT_GONE');

    // 堂數不動（delta 0）就不需要動帳本，只改金額與優惠可以成功
    await updateFinalizedBill(billId, { billedSessions: 4, amountDue: 1800, discounts: [{ name: '特殊折讓', amount: 200 }] });
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.amountDue).toBe(1800);
    expect((bill.detail as { discounts: unknown[] }).discounts).toHaveLength(1);
  });

  it('批次開的已定案班級帳單也適用同一套（含堂數連動）', async () => {
    const { student, cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await finalizeBatch(batchId, { notifyNow: false });
    const bill = (await getBatchDetail(batchId)).bills[0];

    await updateFinalizedBill(bill.id, { billedSessions: 5, amountDue: 2500, discounts: [] });

    const updated = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(updated.billedSessions).toBe(5);
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(enrollment.totalSessions).toBe(5);
  });

  it('輸入驗證：壞優惠列 INVALID_DISCOUNTS、負數金額 INVALID_INPUT', async () => {
    const { billId } = await setupStandaloneClassBill();

    await expect(updateFinalizedBill(billId, { amountDue: 2000, discounts: [{ name: '', amount: 100 }] })).rejects.toThrow('INVALID_DISCOUNTS');
    await expect(updateFinalizedBill(billId, { amountDue: 2000, discounts: [{ name: 'x', amount: 0 }] })).rejects.toThrow('INVALID_DISCOUNTS');
    await expect(updateFinalizedBill(billId, { amountDue: -1, discounts: [] })).rejects.toThrow('INVALID_INPUT');
  });
});

describe('updateFinalizedBill（個輔帳單）', () => {
  it('改優惠與金額：明細重建、不影響任何堂數帳', async () => {
    await seedDefaultFeeTiers();
    const tiers = await listFeeTiers();
    const student = await createStudent({ name: '小華', email: `be-t-${Date.now()}@example.com`, password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
    await setEnrollmentFeeTier(enrollment.id, tiers[0].id);
    const { billId } = await createStandaloneTutoringBill({
      enrollmentId: enrollment.id,
      periodStart: D(2026, 9, 1),
      periodEnd: D(2026, 9, 30),
      amountDue: tiers[0].monthlyFee,
      notifyNow: false,
    });

    await updateFinalizedBill(billId, { amountDue: tiers[0].monthlyFee - 300, discounts: [{ name: '手足優惠', amount: 300 }] });

    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.amountDue).toBe(tiers[0].monthlyFee - 300);
    const detail = bill.detail as { discounts: { name: string }[]; formula: string; netFormula?: string };
    expect(detail.discounts).toEqual([{ name: '手足優惠', amount: 300 }]);
    expect(detail.formula).toContain('月費');
    expect(detail.netFormula).toContain('手足優惠');
    expect(await prisma.enrollmentPeriod.count()).toBe(0);
  });
});
