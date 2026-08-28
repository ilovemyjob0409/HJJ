import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createProgram } from './tutoringProgramService';
import { seedDefaultFeeTiers, listFeeTiers, setEnrollmentFeeTier } from './tutoringFeeTierService';
import { createDiscountItem } from './discountItemService';
import {
  previewStandaloneClassBill, createStandaloneClassBill,
  previewStandaloneTutoringBill, createStandaloneTutoringBill, listStandaloneBills,
} from './standaloneBillService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('standalone class bill', () => {
  it('previews with the same engine and creates a finalized bill with top-up', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: `sb-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '王小強', email: `sb-s-${Date.now()}@example.com`, password: 'x' });
    const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
    await enrollStudent(cls.id, student.id);

    const preview = await previewStandaloneClassBill({ studentId: student.id, classId: cls.id, periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30) });
    expect(preview).toMatchObject({ sessionsTotal: 4, billedSessions: 4, unitPrice: 500, amountDue: 2000, overlapWarning: null });

    const { billId } = await createStandaloneClassBill({ studentId: student.id, classId: cls.id, periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), billedSessions: 4, amountDue: 2000, notifyNow: false });
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill).toMatchObject({ status: 'FINALIZED', batchId: null, amountDue: 2000 });
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(enrollment.totalSessions).toBe(4);

    // 之後的批次會因重疊跳過（preview 會警示）
    const again = await previewStandaloneClassBill({ studentId: student.id, classId: cls.id, periodStart: D(2026, 9, 15), periodEnd: D(2026, 10, 15) });
    expect(again.overlapWarning).toContain('已有');

    expect((await listStandaloneBills()).some((b) => b.id === billId)).toBe(true);
  });

  it('applies a discount item after the base amount is calculated, floored at 0', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: `sb-d-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '王小明', email: `sb-ds-${Date.now()}@example.com`, password: 'x' });
    const cls = await createClass({ name: '週六班B', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
    await enrollStudent(cls.id, student.id);
    const discount = await createDiscountItem({ name: '台積電特約', amount: 500 });

    const preview = await previewStandaloneClassBill({
      studentId: student.id, classId: cls.id, periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), discountItemIds: [discount.id],
    });
    // 4 堂 × 500 = 2000，扣 500 優惠 = 1500
    expect(preview.amountDue).toBe(1500);
    expect(preview.detail.discounts).toEqual([{ name: '台積電特約', amount: 500 }]);
    // formula 只顯示未扣優惠的毛額（4 堂 × 500 ＝ 2000 元），不能把已扣優惠的淨額塞進乘法算式；
    // netFormula 是「毛額－優惠項目＝淨額」單行完整算式（迴歸測試：曾經錯寫成「4 堂 × 500 ＝ 1500 元」）。
    expect(preview.detail.formula).toContain('4 堂 × 500 ＝ 2,000 元');
    expect(preview.detail.formula).not.toContain('1,500');
    expect(preview.detail.netFormula).toBe('2,000 元 － 台積電特約 500 元 ＝ 1,500 元');

    const { billId } = await createStandaloneClassBill({
      studentId: student.id, classId: cls.id, periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30),
      billedSessions: 4, amountDue: 1500, notifyNow: false, discountItemIds: [discount.id],
    });
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.amountDue).toBe(1500);
    const detail = bill.detail as { discounts: { name: string; amount: number }[]; formula: string; netFormula?: string };
    expect(detail.discounts).toEqual([{ name: '台積電特約', amount: 500 }]);
    expect(detail.formula).toContain('4 堂 × 500 ＝ 2,000 元');
    expect(detail.formula).not.toContain('1,500');
    expect(detail.netFormula).toBe('2,000 元 － 台積電特約 500 元 ＝ 1,500 元'); // 1500 等於試算算出的淨額，不算手動調整

    // 優惠金額大於原始金額時，不會變成負數帳單
    const bigDiscount = await createDiscountItem({ name: '全額招待', amount: 9999 });
    const zeroed = await previewStandaloneClassBill({
      studentId: student.id, classId: cls.id, periodStart: D(2026, 11, 1), periodEnd: D(2026, 11, 30), discountItemIds: [bigDiscount.id],
    });
    expect(zeroed.amountDue).toBe(0);
  });

  it('falls back to the default 500 unit price when the class has none set', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: `sb-nf-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '王小柔', email: `sb-nf-s-${Date.now()}@example.com`, password: 'x' });
    const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: null });
    await enrollStudent(cls.id, student.id);

    const preview = await previewStandaloneClassBill({ studentId: student.id, classId: cls.id, periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30) });
    expect(preview).toMatchObject({ billedSessions: 4, unitPrice: 500, amountDue: 2000 });
  });
});

describe('standalone tutoring bill', () => {
  it('prorates by weeks for a mid-month period', async () => {
    await seedDefaultFeeTiers();
    const tiers = await listFeeTiers();
    const student = await createStudent({ name: '林小柔', email: `sb-t-${Date.now()}@example.com`, password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
    await setEnrollmentFeeTier(enrollment.id, tiers[0].id); // 3000

    const preview = await previewStandaloneTutoringBill({ enrollmentId: enrollment.id, periodStart: D(2026, 9, 15), periodEnd: D(2026, 9, 30) });
    expect(preview).toMatchObject({ monthlyFee: 3000, prorationRatio: 0.5, amountDue: 1500 });

    const { billId } = await createStandaloneTutoringBill({ enrollmentId: enrollment.id, periodStart: D(2026, 9, 15), periodEnd: D(2026, 9, 30), amountDue: 1500, notifyNow: false });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: billId } })).prorationRatio).toBe(0.5);
  });

  it('applies a discount item to a tutoring bill too', async () => {
    await seedDefaultFeeTiers();
    const tiers = await listFeeTiers();
    const student = await createStudent({ name: '林小柔B', email: `sb-td-${Date.now()}@example.com`, password: 'x' });
    const program = await createProgram({ name: '數學個別輔導' });
    const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
    await setEnrollmentFeeTier(enrollment.id, tiers[0].id); // 3000
    const discount = await createDiscountItem({ name: '友達特約', amount: 300 });

    const preview = await previewStandaloneTutoringBill({
      enrollmentId: enrollment.id, periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), discountItemIds: [discount.id],
    });
    expect(preview.amountDue).toBe(2700);
    expect(preview.discounts).toEqual([{ name: '友達特約', amount: 300 }]);

    const { billId } = await createStandaloneTutoringBill({
      enrollmentId: enrollment.id, periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), amountDue: 2700, notifyNow: false, discountItemIds: [discount.id],
    });
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(bill.amountDue).toBe(2700);
    const detail = bill.detail as { discounts: { name: string; amount: number }[]; formula: string; netFormula?: string };
    expect(detail.discounts).toEqual([{ name: '友達特約', amount: 300 }]);
    // formula 顯示未扣優惠的月費毛額（3000），netFormula 是「3000－友達特約300＝2700」單行完整算式。
    expect(detail.formula).toContain('3,000 元');
    expect(detail.formula).not.toContain('2,700');
    expect(detail.netFormula).toBe('3,000 元 － 友達特約 300 元 ＝ 2,700 元');
  });
});
