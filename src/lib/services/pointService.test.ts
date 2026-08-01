import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import {
  DRAW_COST,
  AWARD_MAX,
  getPointBalances,
  listPointHistory,
  awardPoints,
  recordLottery,
  redeemPoints,
  adjustPoints,
  listStudentPointSummaries,
} from './pointService';

async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: 'pt-chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'pt-ming@example.com', password: 'x' });
  const reason = await prisma.pointReason.create({ data: { label: '課堂表現優良', sortOrder: 0 } });
  return { teacher, student, reason };
}

describe('getPointBalances', () => {
  it('returns zeros for a student with no transactions', async () => {
    const { student } = await setup();
    expect(await getPointBalances(student.id)).toEqual({ regular: 0, redeemOnly: 0 });
  });

  it('sums each bucket independently, including negative rows', async () => {
    const { student } = await setup();
    await prisma.pointTransaction.createMany({
      data: [
        { studentId: student.id, bucket: 'REGULAR', amount: 10, kind: 'TEACHER_AWARD', reason: 'x' },
        { studentId: student.id, bucket: 'REGULAR', amount: -4, kind: 'ADMIN_ADJUST', reason: 'x' },
        { studentId: student.id, bucket: 'REDEEM_ONLY', amount: 7, kind: 'LOTTERY_WIN', reason: 'x' },
      ],
    });
    expect(await getPointBalances(student.id)).toEqual({ regular: 6, redeemOnly: 7 });
  });
});

describe('awardPoints', () => {
  it('writes one REGULAR transaction per student with the reason label snapshot and teacher', async () => {
    const { teacher, student, reason } = await setup();
    const other = await createStudent({ name: '小華', email: 'pt-hua@example.com', password: 'x' });

    await awardPoints({ teacherId: teacher.id, studentIds: [student.id, other.id], amount: 3, reasonId: reason.id });

    const rows = await prisma.pointTransaction.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.studentId).sort()).toEqual([student.id, other.id].sort());
    for (const r of rows) {
      expect(r.bucket).toBe('REGULAR');
      expect(r.amount).toBe(3);
      expect(r.kind).toBe('TEACHER_AWARD');
      expect(r.reason).toBe('課堂表現優良');
      expect(r.teacherId).toBe(teacher.id);
    }
  });

  it('rejects amount outside 1..AWARD_MAX', async () => {
    const { teacher, student, reason } = await setup();
    await expect(awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 0, reasonId: reason.id })).rejects.toThrow('INVALID_AMOUNT');
    await expect(
      awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: AWARD_MAX + 1, reasonId: reason.id })
    ).rejects.toThrow('INVALID_AMOUNT');
  });

  it('rejects an empty student list and an unknown reason', async () => {
    const { teacher, student, reason } = await setup();
    await expect(awardPoints({ teacherId: teacher.id, studentIds: [], amount: 1, reasonId: reason.id })).rejects.toThrow('NO_STUDENTS');
    await expect(awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 1, reasonId: 'nope' })).rejects.toThrow(
      'REASON_NOT_FOUND'
    );
  });
});

describe('recordLottery', () => {
  it('deducts draws*DRAW_COST from REGULAR and credits wonPoints to REDEEM_ONLY', async () => {
    const { teacher, student, reason } = await setup();
    for (let i = 0; i < 4; i++) {
      await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });
    }

    await recordLottery({ studentId: student.id, draws: 2, wonPoints: 15 });

    expect(await getPointBalances(student.id)).toEqual({ regular: 40 - 2 * DRAW_COST, redeemOnly: 15 });
    const cost = await prisma.pointTransaction.findFirstOrThrow({ where: { kind: 'LOTTERY_COST' } });
    expect(cost.amount).toBe(-2 * DRAW_COST);
    expect(cost.reason).toBe('抽獎 2 次');
  });

  it('writes no LOTTERY_WIN row when wonPoints is 0', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });

    await recordLottery({ studentId: student.id, draws: 1, wonPoints: 0 });

    expect(await prisma.pointTransaction.count({ where: { kind: 'LOTTERY_WIN' } })).toBe(0);
    expect(await getPointBalances(student.id)).toEqual({ regular: 0, redeemOnly: 0 });
  });

  it('throws INSUFFICIENT_POINTS when REGULAR balance cannot cover the draws', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });

    await expect(recordLottery({ studentId: student.id, draws: 1, wonPoints: 5 })).rejects.toThrow('INSUFFICIENT_POINTS');
    expect(await prisma.pointTransaction.count({ where: { kind: { in: ['LOTTERY_COST', 'LOTTERY_WIN'] } } })).toBe(0);
  });

  it('REDEEM_ONLY balance does not count toward the draw cost', async () => {
    const { student } = await setup();
    await prisma.pointTransaction.create({
      data: { studentId: student.id, bucket: 'REDEEM_ONLY', amount: 100, kind: 'LOTTERY_WIN', reason: 'x' },
    });

    await expect(recordLottery({ studentId: student.id, draws: 1, wonPoints: 0 })).rejects.toThrow('INSUFFICIENT_POINTS');
  });

  it('rejects non-positive draws and negative wonPoints', async () => {
    const { student } = await setup();
    await expect(recordLottery({ studentId: student.id, draws: 0, wonPoints: 0 })).rejects.toThrow('INVALID_DRAWS');
    await expect(recordLottery({ studentId: student.id, draws: 1, wonPoints: -1 })).rejects.toThrow('INVALID_WON_POINTS');
  });
});

describe('redeemPoints', () => {
  it('spends REDEEM_ONLY first, then REGULAR, as two rows with the description snapshot', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });
    await prisma.pointTransaction.create({
      data: { studentId: student.id, bucket: 'REDEEM_ONLY', amount: 6, kind: 'LOTTERY_WIN', reason: 'x' },
    });

    await redeemPoints({ studentId: student.id, points: 9, description: '棋子鑰匙圈' });

    expect(await getPointBalances(student.id)).toEqual({ regular: 7, redeemOnly: 0 });
    const rows = await prisma.pointTransaction.findMany({ where: { kind: 'REDEMPTION' }, orderBy: { amount: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.bucket, r.amount, r.reason])).toEqual([
      ['REDEEM_ONLY', -6, '棋子鑰匙圈'],
      ['REGULAR', -3, '棋子鑰匙圈'],
    ]);
  });

  it('writes a single row when REDEEM_ONLY alone covers the points', async () => {
    const { student } = await setup();
    await prisma.pointTransaction.create({
      data: { studentId: student.id, bucket: 'REDEEM_ONLY', amount: 20, kind: 'LOTTERY_WIN', reason: 'x' },
    });

    await redeemPoints({ studentId: student.id, points: 20, description: '文具組' });

    expect(await prisma.pointTransaction.count({ where: { kind: 'REDEMPTION' } })).toBe(1);
    expect(await getPointBalances(student.id)).toEqual({ regular: 0, redeemOnly: 0 });
  });

  it('throws INSUFFICIENT_POINTS when the combined balance is short', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 5, reasonId: reason.id });

    await expect(redeemPoints({ studentId: student.id, points: 6, description: '大獎' })).rejects.toThrow('INSUFFICIENT_POINTS');
    expect(await prisma.pointTransaction.count({ where: { kind: 'REDEMPTION' } })).toBe(0);
  });

  it('rejects non-positive points and a blank description', async () => {
    const { student } = await setup();
    await expect(redeemPoints({ studentId: student.id, points: 0, description: 'x' })).rejects.toThrow('INVALID_AMOUNT');
    await expect(redeemPoints({ studentId: student.id, points: 1, description: ' ' })).rejects.toThrow('REASON_REQUIRED');
  });

  it('allows only one of two concurrent redemptions when balance covers just one', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 10, reasonId: reason.id });

    const results = await Promise.allSettled([
      redeemPoints({ studentId: student.id, points: 10, description: '獎品' }),
      redeemPoints({ studentId: student.id, points: 10, description: '獎品' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toBe('INSUFFICIENT_POINTS');
    expect(await getPointBalances(student.id)).toEqual({ regular: 0, redeemOnly: 0 });
  });
});

describe('adjustPoints', () => {
  it('writes a signed ADMIN_ADJUST row on the chosen bucket', async () => {
    const { student } = await setup();
    await adjustPoints({ studentId: student.id, bucket: 'REDEEM_ONLY', amount: 12, reason: '線下活動獎勵' });
    expect(await getPointBalances(student.id)).toEqual({ regular: 0, redeemOnly: 12 });
  });

  it('blocks a negative adjustment that would push the bucket below zero', async () => {
    const { student } = await setup();
    await adjustPoints({ studentId: student.id, bucket: 'REGULAR', amount: 5, reason: '補登' });
    await expect(adjustPoints({ studentId: student.id, bucket: 'REGULAR', amount: -6, reason: '修正' })).rejects.toThrow(
      'INSUFFICIENT_POINTS'
    );
  });

  it('rejects amount 0 and a blank reason', async () => {
    const { student } = await setup();
    await expect(adjustPoints({ studentId: student.id, bucket: 'REGULAR', amount: 0, reason: 'x' })).rejects.toThrow('INVALID_AMOUNT');
    await expect(adjustPoints({ studentId: student.id, bucket: 'REGULAR', amount: 1, reason: '  ' })).rejects.toThrow('REASON_REQUIRED');
  });
});

describe('listPointHistory', () => {
  it('returns newest-first with teacher name for awards', async () => {
    const { teacher, student, reason } = await setup();
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 2, reasonId: reason.id });
    await adjustPoints({ studentId: student.id, bucket: 'REGULAR', amount: 1, reason: '補登' });

    const history = await listPointHistory(student.id);

    expect(history).toHaveLength(2);
    expect(history[0].kind).toBe('ADMIN_ADJUST');
    expect(history[1].kind).toBe('TEACHER_AWARD');
    expect(history[1].teacher?.user.name).toBe('陳老師');
  });
});

describe('listStudentPointSummaries', () => {
  it('returns every student with per-bucket balances and enrolled class names', async () => {
    const { teacher, student, reason } = await setup();
    const other = await createStudent({ name: '小華', email: 'pt-sum-hua@example.com', password: 'x' });
    await awardPoints({ teacherId: teacher.id, studentIds: [student.id], amount: 8, reasonId: reason.id });
    await prisma.pointTransaction.create({
      data: { studentId: student.id, bucket: 'REDEEM_ONLY', amount: 5, kind: 'LOTTERY_WIN', reason: 'x' },
    });

    const summaries = await listStudentPointSummaries();

    const ming = summaries.find((s) => s.id === student.id);
    const hua = summaries.find((s) => s.id === other.id);
    expect(ming).toMatchObject({ regular: 8, redeemOnly: 5 });
    expect(hua).toMatchObject({ regular: 0, redeemOnly: 0 });
  });
});
