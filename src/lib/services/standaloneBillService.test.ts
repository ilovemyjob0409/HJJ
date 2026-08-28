import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createProgram } from './tutoringProgramService';
import { seedDefaultFeeTiers, listFeeTiers, setEnrollmentFeeTier } from './tutoringFeeTierService';
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
});
