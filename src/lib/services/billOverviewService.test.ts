import { describe, it, expect } from 'vitest';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createClassBatch, finalizeBatch, getBatchDetail } from './billingBatchService';
import { getBillingOverview } from './billOverviewService';
import { createStandaloneClassBill } from './standaloneBillService';
import { addPayment } from './billPaymentService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

// 9 月批次帳單（週六 4 堂 × 500 = 2000）＋ 10 月上半單獨開單（2 堂 × 500 = 1000）
// ＋ 11 月草稿批次（不定案，不應出現在總覽）。
async function overviewFixture() {
  const teacher = await createTeacher({ name: '陳老師', email: `ov-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `ov-s-${Date.now()}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);

  const { batchId } = await createClassBatch({ periodStart: D(2026, 9, 1), periodEnd: D(2026, 9, 30), classIds: [cls.id] });
  await finalizeBatch(batchId, { notifyNow: false });
  const batchBill = (await getBatchDetail(batchId)).bills[0];

  const { billId: standaloneId } = await createStandaloneClassBill({
    studentId: student.id, classId: cls.id, periodStart: D(2026, 10, 1), periodEnd: D(2026, 10, 15),
    billedSessions: 2, amountDue: 1000, notifyNow: false,
  });

  await createClassBatch({ periodStart: D(2026, 11, 1), periodEnd: D(2026, 11, 30), classIds: [cls.id] }); // 草稿

  return { batchBill, standaloneId };
}

describe('getBillingOverview', () => {
  it('merges batch and standalone bills in range with paid totals, excluding drafts', async () => {
    const { batchBill, standaloneId } = await overviewFixture();
    await addPayment(batchBill.id, { amount: 500, paidOn: D(2026, 9, 10), method: 'CASH' }, 'admin-1');

    // 涵蓋到 11 月草稿的區間：草稿仍不列入
    const { summary, bills } = await getBillingOverview(D(2026, 9, 1), D(2026, 11, 30));
    expect(summary).toEqual({ totalDue: 3000, totalPaid: 500, totalOutstanding: 2500, count: 2 });

    // 依收費區間新→舊排序：單獨開單（10 月）在前
    expect(bills.map((b) => b.id)).toEqual([standaloneId, batchBill.id]);
    expect(bills[0]).toMatchObject({ source: null, studentName: '小明', targetName: '週六班', amountDue: 1000, paid: 0, outstanding: 1000, state: 'UNPAID' });
    expect(bills[1]).toMatchObject({ source: 'CLASS', amountDue: 2000, paid: 500, outstanding: 1500, state: 'PARTIAL' });
  });

  it('includes bills whose period merely overlaps the range and excludes the rest', async () => {
    const { batchBill } = await overviewFixture();

    // 區間切在 9 月中：只有 9 月批次帳單重疊
    const mid = await getBillingOverview(D(2026, 9, 15), D(2026, 9, 20));
    expect(mid.bills.map((b) => b.id)).toEqual([batchBill.id]);

    // 10 月下半：兩張都不重疊
    const none = await getBillingOverview(D(2026, 10, 16), D(2026, 10, 31));
    expect(none.summary.count).toBe(0);
    expect(none.bills).toEqual([]);
  });

  it('returns all finalized bills when no range is given (default view)', async () => {
    const { batchBill, standaloneId } = await overviewFixture();

    const all = await getBillingOverview();
    expect(all.summary).toEqual({ totalDue: 3000, totalPaid: 0, totalOutstanding: 3000, count: 2 });
    expect(all.bills.map((b) => b.id)).toEqual([standaloneId, batchBill.id]); // 草稿批次帳單仍不列入
  });
});
