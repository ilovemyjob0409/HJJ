import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { addClosedDay } from './closedDayService';
import { updateBillingSetting } from './billingSettingService';
import { createProgram } from './tutoringProgramService';
import { seedDefaultFeeTiers, listFeeTiers, setEnrollmentFeeTier } from './tutoringFeeTierService';
import { createClassBatch, createTutoringBatch, listBatches, getBatchDetail, updateDraftBill, deleteDraftBatch, finalizeBatch } from './billingBatchService';
import { notifyBills } from './billNotifyService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

async function setupClassFixture() {
  const teacher = await createTeacher({ name: '陳老師', email: `bb-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `bb-s-${Date.now()}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  return { teacher, student, cls };
}

describe('createClassBatch', () => {
  it('generates draft bills: session count minus closed days, price from class', async () => {
    const { student, cls } = await setupClassFixture();
    await addClosedDay(D(2026, 9, 26), '測試假日'); // 週六
    const { batchId, skipped } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    expect(skipped).toHaveLength(0);

    const detail = await getBatchDetail(batchId);
    expect(detail.bills).toHaveLength(1);
    const bill = detail.bills[0];
    // 9/5,12,19,26 共 4 個週六，扣假日 1 → 3 堂 × 500
    expect(bill).toMatchObject({ sessionsTotal: 3, deductedSessions: 0, billedSessions: 3, unitPrice: 500, amountDue: 1500, status: 'DRAFT' });
    const d = bill.detail as { sessionDates: { dateKey: string; closed: boolean }[] };
    expect(d.sessionDates).toHaveLength(4);
    expect(d.sessionDates.filter((e) => e.closed)).toHaveLength(1);
    expect(bill.studentId).toBe(student.id);
  });

  it('applies previous-remaining deduction up to the cap', async () => {
    const { student, cls } = await setupClassFixture();
    // 充值 5 堂、沒上過課 → 剩餘 5；cap 預設 2
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 5 } });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    const bill = (await getBatchDetail(batchId)).bills[0];
    // 4 堂 − 折抵 2 ＝ 2 堂 × 500
    expect(bill).toMatchObject({ sessionsTotal: 4, deductedSessions: 2, billedSessions: 2, amountDue: 1000 });
    const d = bill.detail as { deduction: { previousRemaining: number; cap: number; deducted: number } };
    expect(d.deduction).toMatchObject({ previousRemaining: 5, cap: 2, deducted: 2 });
  });

  it('respects a changed cap from settings', async () => {
    const { student, cls } = await setupClassFixture();
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 5 } });
    await updateBillingSetting({ deductionCap: 4 });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    expect((await getBatchDetail(batchId)).bills[0]).toMatchObject({ deductedSessions: 4, billedSessions: 0, amountDue: 0 });
  });

  it('marks missing unit price with amountDue 0 and null unitPrice', async () => {
    const { cls } = await setupClassFixture();
    await prisma.class.update({ where: { id: cls.id }, data: { feePerSession: null } });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    expect((await getBatchDetail(batchId)).bills[0]).toMatchObject({ unitPrice: null, amountDue: 0 });
  });

  it('uses feeOverride over class price', async () => {
    const { student, cls } = await setupClassFixture();
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { feeOverride: 450 } });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    expect((await getBatchDetail(batchId)).bills[0]).toMatchObject({ unitPrice: 450, amountDue: 4 * 450 });
  });

  it('skips a student whose existing bill overlaps (including partial overlap)', async () => {
    const { cls } = await setupClassFixture();
    await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 11, 30), classIds: [cls.id] });
    const { batchId, skipped } = await createClassBatch({ periodStart: D(2026, 11, 1), periodEnd: D(2027, 1, 31), classIds: [cls.id] });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ studentName: '小明', targetName: '週六基礎班' });
    expect(skipped[0].reason).toContain('已有');
    expect((await getBatchDetail(batchId)).bills).toHaveLength(0);
  });

  it('does not skip a fully non-overlapping period, or a different class for the same student', async () => {
    const { student, cls } = await setupClassFixture();
    await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });

    // 完全不重疊的下一期：正常產生
    const nextPeriod = await createClassBatch({ periodStart: D(2026, 10, 1), periodEnd: D(2026, 10, 31), classIds: [cls.id] });
    expect(nextPeriod.skipped).toHaveLength(0);
    expect((await getBatchDetail(nextPeriod.batchId)).bills).toHaveLength(1);

    // 同學生、同區間、但「不同班級」——不該被誤判成重疊而跳過
    const teacher2 = await createTeacher({ name: '林老師', email: `bb-other-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const otherClass = await createClass({ name: '週三班', subject: '圍棋', level: '基礎', teacherId: teacher2.id, weekday: 3, startTime: '18:00', endTime: '20:00', feePerSession: 500 });
    await enrollStudent(otherClass.id, student.id);
    const otherClassBatch = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [otherClass.id] });
    expect(otherClassBatch.skipped).toHaveLength(0);
    expect((await getBatchDetail(otherClassBatch.batchId)).bills).toHaveLength(1);
  });
});

describe('createTutoringBatch', () => {
  it('bills full monthly fee per enrolled tier; skips enrollments without a tier', async () => {
    await seedDefaultFeeTiers();
    const tiers = await listFeeTiers();
    const s1 = await createStudent({ name: '小華', email: `bb-t1-${Date.now()}@example.com`, password: 'x' });
    const s2 = await createStudent({ name: '小美', email: `bb-t2-${Date.now()}@example.com`, password: 'x' });
    const program = await createProgram({ name: '英文個別輔導' });
    const e1 = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: s1.id } });
    await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: s2.id } }); // 無級距
    await setEnrollmentFeeTier(e1.id, tiers[0].id); // 一週兩堂 3000

    const { batchId, skipped } = await createTutoringBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), programIds: [program.id] });
    const detail = await getBatchDetail(batchId);
    expect(detail.bills).toHaveLength(1);
    expect(detail.bills[0]).toMatchObject({ monthlyFee: 3000, prorationRatio: 1, amountDue: 3000 });
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain('級距');
  });
});

describe('draft editing', () => {
  it('recomputes amount when billedSessions changes; batch totals null while draft; deleteDraftBatch removes all', async () => {
    const { cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    const bill = (await getBatchDetail(batchId)).bills[0];

    await updateDraftBill(bill.id, { billedSessions: 2 });
    expect((await getBatchDetail(batchId)).bills[0]).toMatchObject({ billedSessions: 2, amountDue: 1000 });

    const rows = await listBatches();
    expect(rows.find((b) => b.id === batchId)?.status).toBe('DRAFT');

    await deleteDraftBatch(batchId);
    expect(await prisma.bill.count({ where: { batchId } })).toBe(0);
  });
});

describe('finalizeBatch', () => {
  it('finalizes bills, tops up class sessions, and stamps notifiedAt when notifyNow', async () => {
    const { student, cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await finalizeBatch(batchId, { notifyNow: true });

    const detail = await getBatchDetail(batchId);
    expect(detail.status).toBe('FINALIZED');
    expect(detail.bills[0].status).toBe('FINALIZED');
    expect(detail.bills[0].notifiedAt).not.toBeNull();

    // 自動充值：totalSessions 從 null → 4（開一期）
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(enrollment.totalSessions).toBe(4);
    expect(await prisma.enrollmentPeriod.count({ where: { enrollmentId: enrollment.id } })).toBe(1);

    // 收件夾有通知
    const notes = await prisma.notification.findMany({ where: { userId: (await prisma.student.findUniqueOrThrow({ where: { id: student.id } })).userId } });
    expect(notes.some((n) => n.title === '繳費通知')).toBe(true);
  });

  it('does not notify when notifyNow=false; notifyBills later stamps notifiedAt', async () => {
    const { cls } = await setupClassFixture();
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await finalizeBatch(batchId, { notifyNow: false });
    let bill = (await getBatchDetail(batchId)).bills[0];
    expect(bill.notifiedAt).toBeNull();

    await notifyBills([bill.id]);
    bill = (await getBatchDetail(batchId)).bills[0];
    expect(bill.notifiedAt).not.toBeNull();
  });

  it('refuses to finalize with a missing unit price and refuses double finalize', async () => {
    const { cls } = await setupClassFixture();
    await prisma.class.update({ where: { id: cls.id }, data: { feePerSession: null } });
    const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
    await expect(finalizeBatch(batchId, { notifyNow: false })).rejects.toThrow('MISSING_PRICE');

    await prisma.class.update({ where: { id: cls.id }, data: { feePerSession: 500 } });
    await prisma.bill.updateMany({ where: { batchId }, data: { unitPrice: 500, amountDue: 2000 } });
    await finalizeBatch(batchId, { notifyNow: false });
    await expect(finalizeBatch(batchId, { notifyNow: false })).rejects.toThrow('BATCH_FINALIZED');
  });
});
