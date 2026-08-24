import { Prisma, PointBucket } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { notifyUser } from './notificationService';

export const DRAW_COST = 20; // 線下抽獎固定每次消耗
export const AWARD_MAX = 10; // 老師單次給點上限（防誤按）

export interface PointBalances {
  regular: number;
  redeemOnly: number;
}

type ClientType = typeof prisma | Prisma.TransactionClient;

// 點數異動即時推播給學生（家長）。寫入成功後才發；失敗只記 log，不影響主流程。
async function notifyPointChange(studentId: string, body: string) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { user: { select: { id: true } } },
    });
    if (!student) return;
    await notifyUser(student.user.id, { title: '點數異動', body, url: '/student/points' });
  } catch (err) {
    console.error('point change push notification failed', err);
  }
}

async function sumBucket(client: ClientType, studentId: string, bucket: PointBucket) {
  const agg = await client.pointTransaction.aggregate({ where: { studentId, bucket }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

export async function getPointBalances(studentId: string): Promise<PointBalances> {
  const [regular, redeemOnly] = await Promise.all([
    sumBucket(prisma, studentId, 'REGULAR'),
    sumBucket(prisma, studentId, 'REDEEM_ONLY'),
  ]);
  return { regular, redeemOnly };
}

export function listPointHistory(studentId: string) {
  return prisma.pointTransaction.findMany({
    where: { studentId },
    select: {
      id: true,
      bucket: true,
      amount: true,
      kind: true,
      reason: true,
      createdAt: true,
      teacher: { select: { user: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// 加分：老師（帶 teacherId）或行政（teacherId: null）都可執行。
export async function awardPoints(input: { teacherId: string | null; studentIds: string[]; amount: number; reasonId: string }) {
  if (!Number.isInteger(input.amount) || input.amount < 1 || input.amount > AWARD_MAX) throw new Error('INVALID_AMOUNT');
  if (input.studentIds.length === 0) throw new Error('NO_STUDENTS');
  const reason = await prisma.pointReason.findUnique({ where: { id: input.reasonId } });
  if (!reason) throw new Error('REASON_NOT_FOUND');
  await prisma.pointTransaction.createMany({
    data: input.studentIds.map((studentId) => ({
      studentId,
      bucket: 'REGULAR' as const,
      amount: input.amount,
      kind: 'TEACHER_AWARD' as const,
      reason: reason.label,
      teacherId: input.teacherId,
    })),
  });
  for (const studentId of input.studentIds) {
    await notifyPointChange(studentId, `獲得 ${input.amount} 點：${reason.label}`);
  }
}

// 線下抽獎登記：固定 DRAW_COST/次，從一般點數扣；抽中點數進兌換專用桶。
// 兌換專用點數不能再拿去抽——檢查與扣點都只看 REGULAR。
export async function recordLottery(input: { studentId: string; draws: number; wonPoints: number }) {
  if (!Number.isInteger(input.draws) || input.draws < 1) return Promise.reject(new Error('INVALID_DRAWS'));
  if (!Number.isInteger(input.wonPoints) || input.wonPoints < 0) return Promise.reject(new Error('INVALID_WON_POINTS'));
  await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const cost = input.draws * DRAW_COST;
        const regular = await sumBucket(tx, input.studentId, 'REGULAR');
        if (regular < cost) throw new Error('INSUFFICIENT_POINTS');
        await tx.pointTransaction.create({
          data: { studentId: input.studentId, bucket: 'REGULAR', amount: -cost, kind: 'LOTTERY_COST', reason: `抽獎 ${input.draws} 次` },
        });
        if (input.wonPoints > 0) {
          await tx.pointTransaction.create({
            data: { studentId: input.studentId, bucket: 'REDEEM_ONLY', amount: input.wonPoints, kind: 'LOTTERY_WIN', reason: '抽獎獲得' },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  const cost = input.draws * DRAW_COST;
  await notifyPointChange(
    input.studentId,
    `抽獎 ${input.draws} 次使用 ${cost} 點${input.wonPoints > 0 ? `，獲得 ${input.wonPoints} 點（兌換專用）` : ''}`
  );
}

// 兌換（無獎品目錄）：行政輸入扣多少點＋換了什麼。兩桶合計須足夠，
// 優先扣兌換專用、不足再扣一般（各桶一筆負向紀錄）。
export async function redeemPoints(input: { studentId: string; points: number; description: string }) {
  if (!Number.isInteger(input.points) || input.points < 1) return Promise.reject(new Error('INVALID_AMOUNT'));
  if (!input.description.trim()) return Promise.reject(new Error('REASON_REQUIRED'));
  const description = input.description.trim();
  await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const [regular, redeemOnly] = await Promise.all([
          sumBucket(tx, input.studentId, 'REGULAR'),
          sumBucket(tx, input.studentId, 'REDEEM_ONLY'),
        ]);
        if (regular + redeemOnly < input.points) throw new Error('INSUFFICIENT_POINTS');
        const fromRedeemOnly = Math.min(redeemOnly, input.points);
        const fromRegular = input.points - fromRedeemOnly;
        if (fromRedeemOnly > 0) {
          await tx.pointTransaction.create({
            data: { studentId: input.studentId, bucket: 'REDEEM_ONLY', amount: -fromRedeemOnly, kind: 'REDEMPTION', reason: description },
          });
        }
        if (fromRegular > 0) {
          await tx.pointTransaction.create({
            data: { studentId: input.studentId, bucket: 'REGULAR', amount: -fromRegular, kind: 'REDEMPTION', reason: description },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  await notifyPointChange(input.studentId, `使用 ${input.points} 點兌換：${description}`);
}

// 行政「集點」主表：每位學生的兩桶餘額＋就讀班級（含個別輔導方案，供班級／名字篩選）。
// 餘額用一次 groupBy 聚合，避免逐學生查詢。
export async function listStudentPointSummaries() {
  const [students, sums] = await Promise.all([
    prisma.student.findMany({
      select: {
        id: true,
        studentNumber: true,
        user: { select: { name: true } },
        enrollments: { select: { class: { select: { id: true, name: true } } } },
        tutoringEnrollments: {
          where: { active: true },
          select: { program: { select: { id: true, name: true } } },
        },
      },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.pointTransaction.groupBy({ by: ['studentId', 'bucket'], _sum: { amount: true } }),
  ]);

  const balances = new Map<string, { regular: number; redeemOnly: number }>();
  for (const row of sums) {
    const entry = balances.get(row.studentId) ?? { regular: 0, redeemOnly: 0 };
    if (row.bucket === 'REGULAR') entry.regular = row._sum.amount ?? 0;
    else entry.redeemOnly = row._sum.amount ?? 0;
    balances.set(row.studentId, entry);
  }

  return students.map((s) => ({
    id: s.id,
    name: s.user.name,
    studentNumber: s.studentNumber,
    classes: [...s.enrollments.map((e) => e.class), ...s.tutoringEnrollments.map((e) => e.program)],
    regular: balances.get(s.id)?.regular ?? 0,
    redeemOnly: balances.get(s.id)?.redeemOnly ?? 0,
  }));
}

export async function adjustPoints(input: { studentId: string; bucket: PointBucket; amount: number; reason: string }) {
  if (!Number.isInteger(input.amount) || input.amount === 0) return Promise.reject(new Error('INVALID_AMOUNT'));
  if (!input.reason.trim()) return Promise.reject(new Error('REASON_REQUIRED'));
  const reason = input.reason.trim();
  await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        if (input.amount < 0) {
          const balance = await sumBucket(tx, input.studentId, input.bucket);
          if (balance + input.amount < 0) throw new Error('INSUFFICIENT_POINTS');
        }
        await tx.pointTransaction.create({
          data: { studentId: input.studentId, bucket: input.bucket, amount: input.amount, kind: 'ADMIN_ADJUST', reason },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  await notifyPointChange(
    input.studentId,
    input.amount > 0 ? `增加 ${input.amount} 點：${reason}` : `扣除 ${-input.amount} 點：${reason}`
  );
}
