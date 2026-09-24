import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { addClosedDay } from './closedDayService';
import { createClassBatch, getBatchDetail } from './billingBatchService';
import { previewStandaloneClassBill, createStandaloneClassBill } from './standaloneBillService';
import { getUpcomingSessionKeys } from './billingUpcomingService';

const D = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
// 台北 2026-09-24（四）中午；班級每週六上課，9/26 是收費區間（10 月）開始前最後一堂
const NOW = new Date(Date.UTC(2026, 8, 24, 4, 0));

async function setup(totalSessions: number) {
  const stamp = `${Date.now()}-${Math.random()}`;
  const teacher = await createTeacher({ name: '陳老師', email: `up-t-${stamp}@example.com`, password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: `up-s-${stamp}@example.com`, password: 'x' });
  const cls = await createClass({ name: '週六基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
  await enrollStudent(cls.id, student.id);
  await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions } });
  const marker = (await prisma.teacher.findUniqueOrThrow({ where: { id: teacher.id }, select: { userId: true } })).userId;
  return { student, cls, marker };
}

const OCT = { periodStart: D(2026, 10, 1), periodEnd: D(2026, 10, 31) };

describe('getUpcomingSessionKeys', () => {
  it('列出今天到收費區間前一天、尚未點名的上課日；停課日、已請假、已點名都不算', async () => {
    const { student, cls, marker } = await setup(5);
    const key = `${student.id}:${cls.id}`;
    const pair = [{ studentId: student.id, classId: cls.id, weekday: 6 }];
    // 11/1 起算：9/26、10/3、10/10、10/17、10/24、10/31 共 6 個週六
    await addClosedDay(D(2026, 10, 10), '測試停課');
    await prisma.leaveRequest.create({ data: { studentId: student.id, classId: cls.id, date: D(2026, 10, 17), reason: 'x' } });
    await prisma.classAttendance.create({ data: { studentId: student.id, classId: cls.id, date: D(2026, 10, 24), status: 'PRESENT', markedById: marker } });
    const map = await getUpcomingSessionKeys(pair, D(2026, 11, 1), NOW);
    expect(map.get(key)).toEqual(['2026-09-26', '2026-10-03', '2026-10-31']);
  });

  it('今天有課但還沒點名也算；收費區間已開始（起日 ≤ 今天）時一律空', async () => {
    const { student, cls } = await setup(5);
    const key = `${student.id}:${cls.id}`;
    const pair = [{ studentId: student.id, classId: cls.id, weekday: 6 }];
    const saturdayNoon = new Date(Date.UTC(2026, 8, 26, 4, 0));
    expect((await getUpcomingSessionKeys(pair, D(2026, 10, 1), saturdayNoon)).get(key)).toEqual(['2026-09-26']);
    expect((await getUpcomingSessionKeys(pair, D(2026, 9, 1), NOW)).get(key) ?? []).toEqual([]);
    expect((await getUpcomingSessionKeys([], D(2026, 10, 1), NOW)).size).toBe(0);
  });
});

describe('開單折抵扣除尚未上的課', () => {
  it('批次：剩 1 堂但 9/26 還要上 → 不折抵', async () => {
    const { cls } = await setup(1);
    const { batchId } = await createClassBatch({ ...OCT, classIds: [cls.id] }, NOW);
    const bill = (await getBatchDetail(batchId)).bills[0];
    // 10 月 5 個週六，無折抵
    expect(bill).toMatchObject({ sessionsTotal: 5, deductedSessions: 0, billedSessions: 5 });
    // 折抵 0 仍保留說明，讓明細看得出為什麼沒折抵；算式不出現「5 − 0」
    const detail = bill.detail as { deduction: unknown; formula: string };
    expect(detail.deduction).toEqual({ previousRemaining: 1, cap: 2, deducted: 0, upcoming: ['2026-09-26'] });
    expect(detail.formula).toBe('5 堂 × 500 ＝ 2,500 元');
  });

  it('批次：沒有剩餘堂數時不寫折抵說明（即使有尚未上的課）', async () => {
    const { cls } = await setup(0);
    const { batchId } = await createClassBatch({ ...OCT, classIds: [cls.id] }, NOW);
    expect(((await getBatchDetail(batchId)).bills[0].detail as { deduction: unknown }).deduction).toBeNull();
  });

  it('批次：剩 5 堂、9/26 要上 → 可折抵 4，受上限 2；明細記下尚未上課日期', async () => {
    const { cls } = await setup(5);
    const { batchId } = await createClassBatch({ ...OCT, classIds: [cls.id] }, NOW);
    const bill = (await getBatchDetail(batchId)).bills[0];
    expect(bill).toMatchObject({ deductedSessions: 2, billedSessions: 3 });
    expect((bill.detail as { deduction: unknown }).deduction).toEqual({ previousRemaining: 5, cap: 2, deducted: 2, upcoming: ['2026-09-26'] });
  });

  it('批次：9/26 已請假 → 那堂不會上，照常折抵 1', async () => {
    const { student, cls } = await setup(1);
    await prisma.leaveRequest.create({ data: { studentId: student.id, classId: cls.id, date: D(2026, 9, 26), reason: 'x' } });
    const { batchId } = await createClassBatch({ ...OCT, classIds: [cls.id] }, NOW);
    const bill = (await getBatchDetail(batchId)).bills[0];
    expect(bill).toMatchObject({ deductedSessions: 1, billedSessions: 4 });
    expect((bill.detail as { deduction: unknown }).deduction).toEqual({ previousRemaining: 1, cap: 2, deducted: 1 });
  });

  it('單獨開單試算：同樣扣除尚未上的課', async () => {
    const { student, cls } = await setup(1);
    const preview = await previewStandaloneClassBill({ studentId: student.id, classId: cls.id, ...OCT }, NOW);
    expect(preview).toMatchObject({ sessionsTotal: 5, deductedSessions: 0, billedSessions: 5, amountDue: 2500 });
    expect(preview.detail.deduction).toEqual({ previousRemaining: 1, cap: 2, deducted: 0, upcoming: ['2026-09-26'] });
  });

  it('單獨開單建立：折抵 0 但有說明時，算式不出現「− 0」', async () => {
    const { student, cls } = await setup(1);
    const { billId } = await createStandaloneClassBill(
      { studentId: student.id, classId: cls.id, ...OCT, billedSessions: 5, amountDue: 2500, notifyNow: false },
      NOW
    );
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    const detail = bill.detail as { deduction: { deducted: number } | null; formula: string };
    expect(detail.deduction?.deducted).toBe(0);
    expect(detail.formula).toBe('5 堂 × 500 ＝ 2,500 元');
  });
});
