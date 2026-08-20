import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';

export type GoHallQualificationValue = 'SEASON_PASS' | 'TICKET' | 'SINGLE';

export const LOW_TICKET_THRESHOLD = 3; // 剩餘 ≤3 堂時推播提醒（比照課程低堂數）

type ClientType = typeof prisma | Prisma.TransactionClient;

// 儲存的場次／季票日期是「純日曆日」，全 app 一律以 UTC 讀取顯示
// （見 dateFormat.ts）——比較時同樣取 UTC 日曆日，才會與畫面顯示一致。
// 「今天」是使用者的當下，用台北時區取日曆日（getMyTickets 等）。
export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

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
  if (utcDateKey(input.endDate) < utcDateKey(input.startDate)) throw new Error('INVALID_RANGE');
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
  const key = utcDateKey(onDate);
  const passes = await client.goHallSeasonPass.findMany({ where: { studentId }, select: { startDate: true, endDate: true } });
  return passes.some((p) => utcDateKey(p.startDate) <= key && key <= utcDateKey(p.endDate));
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

function activePassEndDate(passes: { startDate: Date; endDate: Date }[], todayKey: string): Date | null {
  const active = passes
    .filter((p) => utcDateKey(p.startDate) <= todayKey && todayKey <= utcDateKey(p.endDate))
    .sort((a, b) => b.endDate.getTime() - a.endDate.getTime());
  return active[0]?.endDate ?? null;
}

export async function getMyTickets(studentId: string): Promise<{ balance: number; activePassEndDate: Date | null }> {
  const todayKey = taipeiDateKey(new Date());
  const [balance, passes] = await Promise.all([
    getTicketBalance(studentId),
    prisma.goHallSeasonPass.findMany({ where: { studentId }, select: { startDate: true, endDate: true } }),
  ]);
  return { balance, activePassEndDate: activePassEndDate(passes, todayKey) };
}

// 管理端「票券管理」主表：全部學生＋餘額（一次 groupBy）＋今日有效季票結束日。
export async function listStudentTicketSummaries() {
  const todayKey = taipeiDateKey(new Date());
  const [students, sums, passes] = await Promise.all([
    prisma.student.findMany({
      select: { id: true, studentNumber: true, user: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.goHallTicketTransaction.groupBy({ by: ['studentId'], _sum: { amount: true } }),
    prisma.goHallSeasonPass.findMany({ select: { studentId: true, startDate: true, endDate: true } }),
  ]);
  const balanceByStudentId = new Map(sums.map((s) => [s.studentId, s._sum.amount ?? 0]));
  const passesByStudentId = new Map<string, { startDate: Date; endDate: Date }[]>();
  for (const p of passes) {
    const list = passesByStudentId.get(p.studentId) ?? [];
    list.push(p);
    passesByStudentId.set(p.studentId, list);
  }
  return students.map((s) => ({
    id: s.id,
    name: s.user.name,
    studentNumber: s.studentNumber,
    balance: balanceByStudentId.get(s.id) ?? 0,
    activePassEndDate: activePassEndDate(passesByStudentId.get(s.id) ?? [], todayKey),
  }));
}

export async function getTicketDetail(studentId: string) {
  const [balance, seasonPasses, history] = await Promise.all([
    getTicketBalance(studentId),
    prisma.goHallSeasonPass.findMany({
      where: { studentId },
      select: { id: true, startDate: true, endDate: true },
      orderBy: { startDate: 'desc' },
    }),
    prisma.goHallTicketTransaction.findMany({
      where: { studentId },
      select: {
        id: true,
        amount: true,
        kind: true,
        reason: true,
        createdAt: true,
        session: { select: { date: true, attendances: { where: { studentId }, select: { checkInTime: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // 依交易時間新到舊算出每筆交易「結算後剩餘堂數」：從目前餘額往回推，
  // 逐筆扣掉自己的異動量，就是再往前一筆（更早）交易結算後的餘額。
  let runningAfter = balance;
  const historyWithBalance = history.map((h) => {
    const balanceAfter = runningAfter;
    runningAfter -= h.amount;
    return {
      id: h.id,
      amount: h.amount,
      kind: h.kind as string,
      reason: h.reason,
      createdAt: h.createdAt,
      sessionDate: h.session?.date ?? null,
      checkInTime: h.session?.attendances[0]?.checkInTime ?? null,
      balanceAfter,
    };
  });

  return { balance, seasonPasses, history: historyWithBalance };
}

// 學生自己看的「堂票紀錄」：跟 getTicketDetail 不同，這裡要顯示「所有」跟到場
// 有關的紀錄（季票／單堂到場不扣堂票、缺席也不扣堂票，但學生仍要看得到這些
// 事件何時發生），不是只有真的動到堂票餘額的交易。堂票交易（購買／扣堂／
// 調整）以外，再把（1）季票／單堂到場、（2）報名了但未請假、點名時被標記
// 缺席（status ABSENT，qualification 會是 null，因為只有到場才會戳記資格）
// 的 GoHallAttendance，一起當成金額 0 的紀錄併進同一份時間軸；只有 TICKET
// 資格到場才會有對應的 GoHallTicketTransaction，這裡不用重複列一次。
export async function getGoHallAttendanceLedger(studentId: string) {
  const [balance, ticketRows, nonDeductingAttendances] = await Promise.all([
    getTicketBalance(studentId),
    prisma.goHallTicketTransaction.findMany({
      where: { studentId },
      select: {
        id: true,
        amount: true,
        kind: true,
        reason: true,
        createdAt: true,
        session: { select: { date: true, attendances: { where: { studentId }, select: { checkInTime: true } } } },
      },
    }),
    prisma.goHallAttendance.findMany({
      where: { studentId, OR: [{ qualification: { in: ['SEASON_PASS', 'SINGLE'] } }, { status: 'ABSENT' }] },
      select: { id: true, qualification: true, status: true, checkInTime: true, createdAt: true, session: { select: { date: true } } },
    }),
  ]);

  const merged = [
    ...ticketRows.map((h) => ({
      id: h.id,
      amount: h.amount,
      kind: h.kind as string,
      reason: h.reason,
      createdAt: h.createdAt,
      sessionDate: h.session?.date ?? null,
      checkInTime: h.session?.attendances[0]?.checkInTime ?? null,
    })),
    ...nonDeductingAttendances.map((a) => ({
      id: a.id,
      amount: 0,
      kind:
        a.status === 'ABSENT' ? 'ABSENT' : a.qualification === 'SEASON_PASS' ? 'ATTEND_SEASON_PASS' : 'ATTEND_SINGLE',
      reason: null as string | null,
      createdAt: a.createdAt,
      sessionDate: a.session.date,
      checkInTime: a.checkInTime,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // 同樣是從目前餘額往回推；金額 0 的到場紀錄自然不影響餘額。
  let runningAfter = balance;
  const historyWithBalance = merged.map((row) => {
    const balanceAfter = runningAfter;
    runningAfter -= row.amount;
    return { ...row, balanceAfter };
  });

  return { balance, history: historyWithBalance };
}
