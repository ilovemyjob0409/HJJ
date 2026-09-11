import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { notifyUser } from './notificationService';
import { prizeDeadlineKey } from '@/lib/prizeDates';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { createPrizeSignedUrls, deletePrizeImages } from '@/lib/storage';

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

// 取消（學生本人或行政撤銷）：退點＋補庫存＋改狀態，單一 Serializable 交易。
export async function cancelRedemption(input: { redemptionId: string; byStudentId?: string; operator: string }) {
  const row = await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const r = await tx.prizeRedemption.findUnique({ where: { id: input.redemptionId } });
        if (!r || (input.byStudentId && r.studentId !== input.byStudentId)) throw new Error('NOT_FOUND');
        if (r.status !== 'PENDING') throw new Error('NOT_PENDING');
        await refundAndRestock(tx, r, '取消兌換退點');
        return tx.prizeRedemption.update({
          where: { id: r.id },
          data: { status: 'CANCELLED', cancelledAt: new Date(), operator: input.operator },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  await notifyStudent(row.studentId, `已取消兌換：${row.prizeName}，退回 ${row.redeemOnlyUsed + row.regularUsed} 點`);
  return row;
}

// 核銷：updateMany 帶 status 條件當樂觀鎖——兩個行政同時按只會成功一次。
export async function pickupRedemption(input: { redemptionId: string; operator: string }) {
  const updated = await prisma.prizeRedemption.updateMany({
    where: { id: input.redemptionId, status: 'PENDING' },
    data: { status: 'PICKED_UP', pickedUpAt: new Date(), operator: input.operator },
  });
  if (updated.count === 0) {
    const cur = await prisma.prizeRedemption.findUnique({ where: { id: input.redemptionId } });
    if (!cur) throw new Error('NOT_FOUND');
    if (cur.status === 'PICKED_UP') throw new Error('ALREADY_PICKED_UP');
    if (cur.status === 'CANCELLED') throw new Error('ALREADY_CANCELLED');
    throw new Error('ALREADY_EXPIRED');
  }
}

// 簽名網址快取：失敗不擋目錄顯示（沒圖照樣能換）
async function signedUrlMap(imagePaths: (string | null)[]) {
  const paths = imagePaths.filter((p): p is string => !!p);
  try {
    return await createPrizeSignedUrls(paths);
  } catch (err) {
    console.error('prize signed urls failed', err);
    return new Map<string, string>();
  }
}

export async function listPrizesForStudent(studentId: string) {
  const [prizes, mine] = await Promise.all([
    prisma.prize.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.prizeRedemption.findMany({
      where: { studentId, status: { in: ['PENDING', 'PICKED_UP'] } },
      select: { prizeId: true },
    }),
  ]);
  const redeemed = new Set(mine.map((m) => m.prizeId));
  const urls = await signedUrlMap(prizes.map((p) => p.imagePath));
  return prizes.map((p) => ({
    id: p.id,
    name: p.name,
    points: p.points,
    stock: p.stock,
    imageUrl: p.imagePath ? (urls.get(p.imagePath) ?? null) : null,
    alreadyRedeemed: redeemed.has(p.id),
  }));
}

export async function listPrizesForAdmin() {
  const prizes = await prisma.prize.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  const urls = await signedUrlMap(prizes.map((p) => p.imagePath));
  return prizes.map((p) => ({
    id: p.id,
    name: p.name,
    points: p.points,
    stock: p.stock,
    active: p.active,
    sortOrder: p.sortOrder,
    imageUrl: p.imagePath ? (urls.get(p.imagePath) ?? null) : null,
  }));
}

function validatePrizeInput(input: { name?: string; points?: number; stock?: number; sortOrder?: number }) {
  if (input.name !== undefined && !input.name.trim()) throw new Error('INVALID_NAME');
  if (input.points !== undefined && (!Number.isInteger(input.points) || input.points < 1)) throw new Error('INVALID_POINTS');
  if (input.stock !== undefined && (!Number.isInteger(input.stock) || input.stock < 0)) throw new Error('INVALID_STOCK');
  if (input.sortOrder !== undefined && !Number.isInteger(input.sortOrder)) throw new Error('INVALID_SORT_ORDER');
}

export async function createPrize(input: { name: string; points: number; stock: number; sortOrder: number }) {
  validatePrizeInput(input);
  return prisma.prize.create({
    data: { name: input.name.trim(), points: input.points, stock: input.stock, sortOrder: input.sortOrder },
  });
}

export async function updatePrize(
  id: string,
  input: { name?: string; points?: number; stock?: number; sortOrder?: number; active?: boolean }
) {
  validatePrizeInput(input);
  const existing = await prisma.prize.findUnique({ where: { id } });
  if (!existing) throw new Error('NOT_FOUND');
  return prisma.prize.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.points !== undefined ? { points: input.points } : {}),
      ...(input.stock !== undefined ? { stock: input.stock } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

// 換圖：DB 先 commit、舊檔刪除 best-effort（孤兒物件可接受，DB 指向被刪物件不可）
export async function setPrizeImage(prizeId: string, storagePath: string) {
  const prize = await prisma.prize.findUnique({ where: { id: prizeId } });
  if (!prize) throw new Error('NOT_FOUND');
  await prisma.prize.update({ where: { id: prizeId }, data: { imagePath: storagePath } });
  if (prize.imagePath) {
    try {
      await deletePrizeImages([prize.imagePath]);
    } catch {}
  }
}

export async function listMyRedemptions(studentId: string) {
  const rows = await prisma.prizeRedemption.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' } });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    prizeName: r.prizeName,
    points: r.redeemOnlyUsed + r.regularUsed,
    status: r.status,
    createdAt: r.createdAt,
    deadlineKey: prizeDeadlineKey(r.createdAt),
  }));
}

export async function listPendingRedemptions() {
  const rows = await prisma.prizeRedemption.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: { student: { select: { studentNumber: true, user: { select: { name: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    studentName: r.student.user.name,
    studentNumber: r.student.studentNumber,
    prizeName: r.prizeName,
    points: r.redeemOnlyUsed + r.regularUsed,
    createdAt: r.createdAt,
    deadlineKey: prizeDeadlineKey(r.createdAt),
  }));
}

export async function findRedemptionByCode(code: string) {
  const r = await prisma.prizeRedemption.findUnique({
    where: { code },
    include: { student: { select: { user: { select: { name: true } } } } },
  });
  if (!r) return null;
  return {
    id: r.id,
    code: r.code,
    studentName: r.student.user.name,
    prizeName: r.prizeName,
    points: r.redeemOnlyUsed + r.regularUsed,
    status: r.status,
    createdAt: r.createdAt,
    deadlineKey: prizeDeadlineKey(r.createdAt),
  };
}
