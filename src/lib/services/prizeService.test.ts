import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { redeemPrize, cancelRedemption, pickupRedemption } from './prizeService';

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

describe('redeemPrize', () => {
  it('deducts REDEEM_ONLY first then REGULAR, snapshots both, decrements stock, issues a 6-digit code', async () => {
    const { student, prize } = await setup({ regular: 40, redeemOnly: 30, points: 50 });
    const result = await redeemPrize({ studentId: student.id, prizeId: prize.id });

    expect(result.code).toMatch(/^\d{6}$/);
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

  it('retries code collisions and fails with CODE_GENERATION_FAILED when exhausted', async () => {
    const { student, prize } = await setup({ regular: 200 });
    const taken = await redeemPrize({ studentId: student.id, prizeId: prize.id }, () => '111111');
    expect(taken.code).toBe('111111');

    const other = await createStudent({ name: '小華', email: 'pz-hua@example.com', password: 'x' });
    await prisma.pointTransaction.create({ data: { studentId: other.id, bucket: 'REGULAR', amount: 100, kind: 'TEACHER_AWARD', reason: 'x' } });

    // 前幾次都撞號、最後一次給新號 → 成功
    const codes = ['111111', '111111', '222222'];
    const ok = await redeemPrize({ studentId: other.id, prizeId: prize.id }, () => codes.shift() ?? '999999');
    expect(ok.code).toBe('222222');

    // 永遠撞號 → CODE_GENERATION_FAILED
    const third = await createStudent({ name: '小美', email: 'pz-mei@example.com', password: 'x' });
    await prisma.pointTransaction.create({ data: { studentId: third.id, bucket: 'REGULAR', amount: 100, kind: 'TEACHER_AWARD', reason: 'x' } });
    await expect(redeemPrize({ studentId: third.id, prizeId: prize.id }, () => '111111')).rejects.toThrow('CODE_GENERATION_FAILED');
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
