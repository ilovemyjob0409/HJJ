import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import {
  redeemPrize,
  cancelRedemption,
  pickupRedemption,
  listPrizesForStudent,
  listPrizesForAdmin,
  createPrize,
  updatePrize,
  listMyRedemptions,
  listPendingRedemptions,
  sendPrizeExpiryReminders,
  expireOverduePrizeRedemptions,
} from './prizeService';

async function setup(opts?: { regular?: number; redeemOnly?: number; points?: number; stock?: number }) {
  const student = await createStudent({ name: '小明', email: 'pz-ming@example.com', password: 'x' });
  const prize = await prisma.prize.create({
    data: { name: '恐龍模型', points: opts?.points ?? 50, stock: opts?.stock ?? 3, sortOrder: 0 },
  });
  const grants = [];
  if (opts?.regular) grants.push({ studentId: student.id, bucket: 'REGULAR' as const, amount: opts.regular, kind: 'TEACHER_AWARD' as const, reason: 'x' });
  if (opts?.redeemOnly) grants.push({ studentId: student.id, bucket: 'REDEEM_ONLY' as const, amount: opts.redeemOnly, kind: 'LOTTERY_WIN' as const, reason: 'x' });
  if (grants.length) await prisma.pointTransaction.createMany({ data: grants });
  return { student, prize };
}

const DAY_MS = 86_400_000;
let redeemCounter = 0;

async function redeemDaysAgo(days: number) {
  redeemCounter++;
  const student = await createStudent({ name: `學生${redeemCounter}`, email: `pz-student${redeemCounter}@example.com`, password: 'x' });
  const prize = await prisma.prize.create({
    data: { name: '恐龍模型', points: 50, stock: 3, sortOrder: 0 },
  });
  await prisma.pointTransaction.create({
    data: { studentId: student.id, bucket: 'REGULAR', amount: 100, kind: 'TEACHER_AWARD', reason: 'x' },
  });
  const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });
  await prisma.prizeRedemption.update({ where: { id: r.id }, data: { createdAt: new Date(Date.now() - days * DAY_MS) } });
  return { student, prize, id: r.id };
}

describe('redeemPrize', () => {
  it('deducts REDEEM_ONLY first then REGULAR, snapshots both, decrements stock', async () => {
    const { student, prize } = await setup({ regular: 40, redeemOnly: 30, points: 50 });
    const result = await redeemPrize({ studentId: student.id, prizeId: prize.id });

    expect(result.prizeName).toBe('恐龍模型');
    expect(result.points).toBe(50);

    const row = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.status).toBe('PENDING');
    expect(row.redeemOnlyUsed).toBe(30);
    expect(row.regularUsed).toBe(20);

    const txs = await prisma.pointTransaction.findMany({ where: { kind: 'REDEMPTION' } });
    expect(txs).toHaveLength(2);
    expect(txs.find((t) => t.bucket === 'REDEEM_ONLY')?.amount).toBe(-30);
    expect(txs.find((t) => t.bucket === 'REGULAR')?.amount).toBe(-20);
    for (const t of txs) expect(t.reason).toBe('兌換獎品：恐龍模型');

    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).stock).toBe(2);
  });

  it('writes a single-bucket transaction when redeem-only covers the whole cost', async () => {
    const { student, prize } = await setup({ redeemOnly: 60, points: 50 });
    await redeemPrize({ studentId: student.id, prizeId: prize.id });
    const txs = await prisma.pointTransaction.findMany({ where: { kind: 'REDEMPTION' } });
    expect(txs).toHaveLength(1);
    expect(txs[0].bucket).toBe('REDEEM_ONLY');
    expect(txs[0].amount).toBe(-50);
  });

  it('rejects INSUFFICIENT_POINTS without touching stock or points', async () => {
    const { student, prize } = await setup({ regular: 10, points: 50 });
    await expect(redeemPrize({ studentId: student.id, prizeId: prize.id })).rejects.toThrow('INSUFFICIENT_POINTS');
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).stock).toBe(3);
    expect(await prisma.pointTransaction.count({ where: { kind: 'REDEMPTION' } })).toBe(0);
  });

  it('rejects OUT_OF_STOCK and PRIZE_UNAVAILABLE (inactive or missing prize)', async () => {
    const { student, prize } = await setup({ regular: 100, stock: 0 });
    await expect(redeemPrize({ studentId: student.id, prizeId: prize.id })).rejects.toThrow('OUT_OF_STOCK');
    await prisma.prize.update({ where: { id: prize.id }, data: { stock: 1, active: false } });
    await expect(redeemPrize({ studentId: student.id, prizeId: prize.id })).rejects.toThrow('PRIZE_UNAVAILABLE');
    await expect(redeemPrize({ studentId: student.id, prizeId: 'nope' })).rejects.toThrow('PRIZE_UNAVAILABLE');
  });

  it('rejects ALREADY_REDEEMED while a PENDING/PICKED_UP redemption exists, allows again after CANCELLED', async () => {
    const { student, prize } = await setup({ regular: 200 });
    const first = await redeemPrize({ studentId: student.id, prizeId: prize.id });
    await expect(redeemPrize({ studentId: student.id, prizeId: prize.id })).rejects.toThrow('ALREADY_REDEEMED');
    await prisma.prizeRedemption.update({ where: { id: first.id }, data: { status: 'CANCELLED' } });
    await expect(redeemPrize({ studentId: student.id, prizeId: prize.id })).resolves.toBeTruthy();
  });

});

describe('cancelRedemption', () => {
  it('refunds each bucket per snapshot, restocks, marks CANCELLED with operator', async () => {
    const { student, prize } = await setup({ regular: 40, redeemOnly: 30, points: 50 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });

    await cancelRedemption({ redemptionId: r.id, byStudentId: student.id, operator: '學生本人' });

    const row = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('CANCELLED');
    expect(row.operator).toBe('學生本人');
    expect(row.cancelledAt).not.toBeNull();

    const refunds = await prisma.pointTransaction.findMany({ where: { kind: 'REDEMPTION_REFUND' } });
    expect(refunds.find((t) => t.bucket === 'REDEEM_ONLY')?.amount).toBe(30);
    expect(refunds.find((t) => t.bucket === 'REGULAR')?.amount).toBe(20);
    for (const t of refunds) expect(t.reason).toBe('取消兌換退點：恐龍模型');

    expect((await prisma.prize.findUniqueOrThrow({ where: { id: prize.id } })).stock).toBe(3);
  });

  it("a student cannot cancel someone else's redemption; admin (no byStudentId) can", async () => {
    const { student, prize } = await setup({ regular: 100 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });
    await expect(cancelRedemption({ redemptionId: r.id, byStudentId: 'other', operator: '學生本人' })).rejects.toThrow('NOT_FOUND');
    await expect(cancelRedemption({ redemptionId: r.id, operator: '王行政' })).resolves.toBeTruthy();
  });

  it('rejects NOT_PENDING for already picked-up rows', async () => {
    const { student, prize } = await setup({ regular: 100 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });
    await pickupRedemption({ redemptionId: r.id, operator: '王行政' });
    await expect(cancelRedemption({ redemptionId: r.id, operator: '王行政' })).rejects.toThrow('NOT_PENDING');
  });
});

describe('pickupRedemption', () => {
  it('marks PICKED_UP with operator and pickedUpAt', async () => {
    const { student, prize } = await setup({ regular: 100 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });
    await pickupRedemption({ redemptionId: r.id, operator: '王行政' });
    const row = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe('PICKED_UP');
    expect(row.operator).toBe('王行政');
    expect(row.pickedUpAt).not.toBeNull();
  });

  it('reports the current status when not pending', async () => {
    const { student, prize } = await setup({ regular: 100 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });
    await pickupRedemption({ redemptionId: r.id, operator: '王行政' });
    await expect(pickupRedemption({ redemptionId: r.id, operator: '王行政' })).rejects.toThrow('ALREADY_PICKED_UP');
    await expect(pickupRedemption({ redemptionId: 'nope', operator: '王行政' })).rejects.toThrow('NOT_FOUND');
  });
});

describe('prize catalog', () => {
  it('createPrize validates inputs; updatePrize edits fields and rejects unknown id', async () => {
    await expect(createPrize({ name: '  ', points: 10, stock: 1, sortOrder: 0 })).rejects.toThrow('INVALID_NAME');
    await expect(createPrize({ name: 'A', points: 0, stock: 1, sortOrder: 0 })).rejects.toThrow('INVALID_POINTS');
    await expect(createPrize({ name: 'A', points: 10, stock: -1, sortOrder: 0 })).rejects.toThrow('INVALID_STOCK');

    const prize = await createPrize({ name: '貼紙組', points: 10, stock: 5, sortOrder: 1 });
    const updated = await updatePrize(prize.id, { points: 15, active: false });
    expect(updated.points).toBe(15);
    expect(updated.active).toBe(false);
    await expect(updatePrize('nope', { points: 1 })).rejects.toThrow('NOT_FOUND');
  });

  it('listPrizesForStudent returns only active prizes ordered by sortOrder, with alreadyRedeemed flag', async () => {
    const { student, prize } = await setup({ regular: 100 });
    await createPrize({ name: '下架品', points: 5, stock: 1, sortOrder: 0 }).then((p) => updatePrize(p.id, { active: false }));
    await redeemPrize({ studentId: student.id, prizeId: prize.id });

    const rows = await listPrizesForStudent(student.id);
    expect(rows.map((r) => r.name)).toEqual(['恐龍模型']);
    expect(rows[0].alreadyRedeemed).toBe(true);

    expect((await listPrizesForAdmin()).map((r) => r.name).sort()).toEqual(['下架品', '恐龍模型']);
  });
});

describe('redemption lists', () => {
  it('listMyRedemptions / listPendingRedemptions return points and deadlineKey', async () => {
    const { student, prize } = await setup({ regular: 100, points: 50 });
    const r = await redeemPrize({ studentId: student.id, prizeId: prize.id });

    const mine = await listMyRedemptions(student.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ prizeName: '恐龍模型', points: 50, status: 'PENDING', deadlineKey: r.deadlineKey });

    const pending = await listPendingRedemptions();
    expect(pending[0]).toMatchObject({ studentName: '小明', prizeName: '恐龍模型', points: 50 });
  });
});

describe('sendPrizeExpiryReminders', () => {
  it('reminds only rows in the 7-day window without a prior reminder, and only once', async () => {
    const due = await redeemDaysAgo(25); // 期限剩 5 天 → 提醒
    expect(await sendPrizeExpiryReminders()).toBe(1);
    const row = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: due.id } });
    expect(row.expiryRemindedAt).not.toBeNull();
    expect(await sendPrizeExpiryReminders()).toBe(0); // 不重複
  });

  it('skips fresh redemptions', async () => {
    await redeemDaysAgo(3);
    expect(await sendPrizeExpiryReminders()).toBe(0);
  });
});

describe('expireOverduePrizeRedemptions', () => {
  it('expires >30-day-old PENDING rows: refund, restock, EXPIRED with system operator', async () => {
    const overdue = await redeemDaysAgo(31);
    expect(await expireOverduePrizeRedemptions()).toBe(1);

    const row = await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: overdue.id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.operator).toBe('系統（逾期）');
    const refunds = await prisma.pointTransaction.findMany({ where: { kind: 'REDEMPTION_REFUND' } });
    expect(refunds.reduce((s, t) => s + t.amount, 0)).toBe(50);
    for (const t of refunds) expect(t.reason).toBe('逾期退點：恐龍模型');
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: overdue.prize.id } })).stock).toBe(3);
  });

  it('leaves 30-day-old (deadline day) and picked-up rows alone', async () => {
    await redeemDaysAgo(29); // 未過期限
    const picked = await redeemDaysAgo(40);
    await prisma.prizeRedemption.update({ where: { id: picked.id }, data: { status: 'PICKED_UP' } });
    expect(await expireOverduePrizeRedemptions()).toBe(0);
  });
});
