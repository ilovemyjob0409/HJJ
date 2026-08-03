import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';

export type GoHallQualificationValue = 'SEASON_PASS' | 'TICKET' | 'SINGLE';

export const LOW_TICKET_THRESHOLD = 3; // 剩餘 ≤3 堂時 LINE 提醒（比照課程低堂數）

type ClientType = typeof prisma | Prisma.TransactionClient;

// 既有場次日期存在 UTC／本地午夜混用（瀏覽器 toISOString vs 'YYYY-MM-DD' 解析），
// 兩種存法都落在台北日曆日當天 → 一律轉台北日曆日字串再比較。
const TAIPEI_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function taipeiDateKey(date: Date): string {
  return TAIPEI_DATE_FMT.format(date); // 'YYYY-MM-DD'
}

export async function getTicketBalance(studentId: string, client: ClientType = prisma): Promise<number> {
  const agg = await client.goHallTicketTransaction.aggregate({ where: { studentId }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

export function purchaseTickets(input: { studentId: string; sessions: number }): Promise<void> {
  if (!Number.isInteger(input.sessions) || input.sessions < 1) return Promise.reject(new Error('INVALID_AMOUNT'));
  return prisma.$transaction(async (tx) => {
    await tx.goHallTicketTransaction.create({
      data: { studentId: input.studentId, amount: input.sessions, kind: 'PURCHASE' },
    });
    await tx.student.update({ where: { id: input.studentId }, data: { goHallLowQuotaNotifiedAt: null } });
  }).then(() => undefined);
}

export function adjustTickets(input: { studentId: string; amount: number; reason: string }): Promise<void> {
  if (!Number.isInteger(input.amount) || input.amount === 0) return Promise.reject(new Error('INVALID_AMOUNT'));
  if (!input.reason.trim()) return Promise.reject(new Error('REASON_REQUIRED'));
  return runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        if (input.amount < 0) {
          const balance = await getTicketBalance(input.studentId, tx);
          if (balance + input.amount < 0) throw new Error('INSUFFICIENT_TICKETS');
        }
        await tx.goHallTicketTransaction.create({
          data: { studentId: input.studentId, amount: input.amount, kind: 'ADMIN_ADJUST', reason: input.reason.trim() },
        });
        if (input.amount > 0) {
          await tx.student.update({ where: { id: input.studentId }, data: { goHallLowQuotaNotifiedAt: null } });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export async function addSeasonPass(input: { studentId: string; startDate: Date; endDate: Date }): Promise<{ id: string }> {
  if (taipeiDateKey(input.endDate) < taipeiDateKey(input.startDate)) throw new Error('INVALID_RANGE');
  const pass = await prisma.goHallSeasonPass.create({
    data: { studentId: input.studentId, startDate: input.startDate, endDate: input.endDate },
    select: { id: true },
  });
  return pass;
}

export async function deleteSeasonPass(id: string): Promise<void> {
  await prisma.goHallSeasonPass.delete({ where: { id } });
}

export async function hasValidSeasonPass(client: ClientType, studentId: string, onDate: Date): Promise<boolean> {
  const key = taipeiDateKey(onDate);
  const passes = await client.goHallSeasonPass.findMany({ where: { studentId }, select: { startDate: true, endDate: true } });
  return passes.some((p) => taipeiDateKey(p.startDate) <= key && key <= taipeiDateKey(p.endDate));
}

// 資格判定（純查詢、不扣堂）：季票一律優先 → 堂票餘額 > 0 → 單堂。
export async function determineQualification(
  client: ClientType,
  studentId: string,
  sessionDate: Date
): Promise<GoHallQualificationValue> {
  if (await hasValidSeasonPass(client, studentId, sessionDate)) return 'SEASON_PASS';
  if ((await getTicketBalance(studentId, client)) > 0) return 'TICKET';
  return 'SINGLE';
}
