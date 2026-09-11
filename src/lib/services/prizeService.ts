import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { notifyUser } from './notificationService';
import { prizeDeadlineKey } from '@/lib/prizeDates';
import { formatDateWithWeekday } from '@/lib/dateFormat';

export const CODE_ATTEMPTS = 5;

export function generatePrizeCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// 兌換相關通知（收件夾＋推播）。寫入成功後才發；失敗只記 log，不影響主流程。
async function notifyStudent(studentId: string, body: string) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { user: { select: { id: true } } },
    });
    if (!student) return;
    await notifyUser(student.user.id, { title: '獎品專區', body, url: '/student/prizes' });
  } catch (err) {
    console.error('prize notification failed', err);
  }
}

type RefundableRow = { studentId: string; prizeId: string; prizeName: string; redeemOnlyUsed: number; regularUsed: number };

// 取消／逾期共用：按快照把兩桶各自退回＋庫存加回。
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function refundAndRestock(tx: Prisma.TransactionClient, row: RefundableRow, reasonPrefix: string) {
  const reason = `${reasonPrefix}：${row.prizeName}`;
  if (row.redeemOnlyUsed > 0) {
    await tx.pointTransaction.create({
      data: { studentId: row.studentId, bucket: 'REDEEM_ONLY', amount: row.redeemOnlyUsed, kind: 'REDEMPTION_REFUND', reason },
    });
  }
  if (row.regularUsed > 0) {
    await tx.pointTransaction.create({
      data: { studentId: row.studentId, bucket: 'REGULAR', amount: row.regularUsed, kind: 'REDEMPTION_REFUND', reason },
    });
  }
  await tx.prize.update({ where: { id: row.prizeId }, data: { stock: { increment: 1 } } });
}

async function sumBucket(tx: Prisma.TransactionClient, studentId: string, bucket: 'REGULAR' | 'REDEEM_ONLY') {
  const agg = await tx.pointTransaction.aggregate({ where: { studentId, bucket }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

// 兌換：檢查上架/庫存/限換/餘額 → 扣點（先兌換專用、不足扣一般）→ 扣庫存 → 發代號。
// 全程單一 Serializable 交易，防兩個並發兌換同時通過庫存/餘額檢查。
export async function redeemPrize(
  input: { studentId: string; prizeId: string },
  generateCode: () => string = generatePrizeCode
) {
  const result = await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const prize = await tx.prize.findUnique({ where: { id: input.prizeId } });
        if (!prize || !prize.active) throw new Error('PRIZE_UNAVAILABLE');
        if (prize.stock < 1) throw new Error('OUT_OF_STOCK');

        // 每人每種獎品限 1 次：只算 PENDING/PICKED_UP，取消/逾期不佔名額
        const occupied = await tx.prizeRedemption.count({
          where: { studentId: input.studentId, prizeId: input.prizeId, status: { in: ['PENDING', 'PICKED_UP'] } },
        });
        if (occupied > 0) throw new Error('ALREADY_REDEEMED');

        const [regular, redeemOnly] = await Promise.all([
          sumBucket(tx, input.studentId, 'REGULAR'),
          sumBucket(tx, input.studentId, 'REDEEM_ONLY'),
        ]);
        if (regular + redeemOnly < prize.points) throw new Error('INSUFFICIENT_POINTS');

        const redeemOnlyUsed = Math.min(redeemOnly, prize.points);
        const regularUsed = prize.points - redeemOnlyUsed;
        const reason = `兌換獎品：${prize.name}`;
        if (redeemOnlyUsed > 0) {
          await tx.pointTransaction.create({
            data: { studentId: input.studentId, bucket: 'REDEEM_ONLY', amount: -redeemOnlyUsed, kind: 'REDEMPTION', reason },
          });
        }
        if (regularUsed > 0) {
          await tx.pointTransaction.create({
            data: { studentId: input.studentId, bucket: 'REGULAR', amount: -regularUsed, kind: 'REDEMPTION', reason },
          });
        }

        await tx.prize.update({ where: { id: prize.id }, data: { stock: { decrement: 1 } } });

        let code = '';
        for (let i = 0; i < CODE_ATTEMPTS; i++) {
          const candidate = generateCode();
          if ((await tx.prizeRedemption.count({ where: { code: candidate } })) === 0) {
            code = candidate;
            break;
          }
        }
        if (!code) throw new Error('CODE_GENERATION_FAILED');

        const row = await tx.prizeRedemption.create({
          data: { code, studentId: input.studentId, prizeId: prize.id, prizeName: prize.name, redeemOnlyUsed, regularUsed },
        });
        return { id: row.id, code, prizeName: prize.name, points: prize.points, createdAt: row.createdAt };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  const deadlineKey = prizeDeadlineKey(result.createdAt);
  await notifyStudent(
    input.studentId,
    `兌換成功：${result.prizeName}，兌換代號 ${result.code}，請於 ${formatDateWithWeekday(deadlineKey)} 前至櫃台領取`
  );
  return { ...result, deadlineKey };
}
