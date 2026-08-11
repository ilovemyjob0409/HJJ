import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { createTeacher } from './teacherService';
import {
  taipeiDateKey,
  getTicketBalance,
  purchaseTickets,
  adjustTickets,
  addSeasonPass,
  deleteSeasonPass,
  hasValidSeasonPass,
  determineQualification,
  getMyTickets,
  listStudentTicketSummaries,
  getTicketDetail,
  getGoHallAttendanceLedger,
} from './goHallTicketService';

describe('taipeiDateKey', () => {
  it('converts an instant to its Asia/Taipei calendar date', () => {
    // UTC 2026-08-14 16:00 = 台北 2026-08-15 00:00
    expect(taipeiDateKey(new Date('2026-08-14T16:00:00.000Z'))).toBe('2026-08-15');
    // UTC 午夜＝台北早上八點，同日
    expect(taipeiDateKey(new Date('2026-08-15T00:00:00.000Z'))).toBe('2026-08-15');
  });
});

describe('purchaseTickets / getTicketBalance', () => {
  it('adds a PURCHASE transaction and the balance is the sum', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 10 });
    expect(await getTicketBalance(student.id)).toBe(10);
    const txns = await prisma.goHallTicketTransaction.findMany({ where: { studentId: student.id } });
    expect(txns).toHaveLength(1);
    expect(txns[0].kind).toBe('PURCHASE');
    expect(txns[0].amount).toBe(10);
  });

  it('rejects non-positive or non-integer sessions', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await expect(purchaseTickets({ studentId: student.id, sessions: 0 })).rejects.toThrow('INVALID_AMOUNT');
    await expect(purchaseTickets({ studentId: student.id, sessions: 1.5 })).rejects.toThrow('INVALID_AMOUNT');
  });

  it('resets goHallLowQuotaNotifiedAt on purchase', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await prisma.student.update({ where: { id: student.id }, data: { goHallLowQuotaNotifiedAt: new Date() } });
    await purchaseTickets({ studentId: student.id, sessions: 10 });
    const fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).toBeNull();
  });
});

describe('adjustTickets', () => {
  it('applies positive and negative adjustments with reason', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await adjustTickets({ studentId: student.id, amount: 5, reason: '登記錯誤補回' });
    await adjustTickets({ studentId: student.id, amount: -3, reason: '重複登記' });
    expect(await getTicketBalance(student.id)).toBe(2);
  });

  it('rejects an adjustment that would make the balance negative', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 2 });
    await expect(adjustTickets({ studentId: student.id, amount: -3, reason: '誤扣' })).rejects.toThrow('INSUFFICIENT_TICKETS');
  });

  it('rejects zero / non-integer amount and empty reason', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await expect(adjustTickets({ studentId: student.id, amount: 0, reason: 'x' })).rejects.toThrow('INVALID_AMOUNT');
    await expect(adjustTickets({ studentId: student.id, amount: 1, reason: '  ' })).rejects.toThrow('REASON_REQUIRED');
  });

  it('resets goHallLowQuotaNotifiedAt only on positive adjustment', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 5 });
    await prisma.student.update({ where: { id: student.id }, data: { goHallLowQuotaNotifiedAt: new Date() } });
    await adjustTickets({ studentId: student.id, amount: -1, reason: '誤登' });
    let fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).not.toBeNull();
    await adjustTickets({ studentId: student.id, amount: 2, reason: '補購' });
    fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).toBeNull();
  });
});

describe('addSeasonPass / hasValidSeasonPass', () => {
  it('is valid on the start day, the end day, and days between (inclusive)', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-08-01'))).toBe(true);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-08-31'))).toBe(true);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-08-15'))).toBe(true);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-07-31'))).toBe(false);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-09-01'))).toBe(false);
  });

  it('keys stored dates by UTC calendar day, matching how the app displays them', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });
    // 非正規儲存（UTC 7/31 16:00）在全 app 的 UTC 顯示慣例下呈現為 7/31（見 dateFormat.ts），
    // 判定必須與顯示一致 → 不在 8 月季票內；同一天的 UTC 午夜正規值則在內。
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-07-31T16:00:00.000Z'))).toBe(false);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-08-31T16:00:00.000Z'))).toBe(true);
  });

  it('rejects endDate before startDate', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await expect(
      addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-31'), endDate: new Date('2026-08-01') })
    ).rejects.toThrow('INVALID_RANGE');
  });

  it('deleteSeasonPass removes the pass', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const pass = await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });
    await deleteSeasonPass(pass.id);
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-08-15'))).toBe(false);
  });
});

describe('determineQualification', () => {
  it('prefers a valid season pass even when tickets remain', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 10 });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });
    expect(await determineQualification(prisma, student.id, new Date('2026-08-15'))).toBe('SEASON_PASS');
  });

  it('falls back to TICKET when no pass covers the date but balance > 0', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 1 });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-09-01'), endDate: new Date('2026-11-30') });
    expect(await determineQualification(prisma, student.id, new Date('2026-08-15'))).toBe('TICKET');
  });

  it('falls back to SINGLE when there is no pass and no balance', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    expect(await determineQualification(prisma, student.id, new Date('2026-08-15'))).toBe('SINGLE');
  });
});

describe('getMyTickets / listStudentTicketSummaries', () => {
  it('reports balance and the end date of a currently-valid pass', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 7 });
    const past = new Date();
    past.setDate(past.getDate() - 30);
    const future = new Date();
    future.setDate(future.getDate() + 30);
    await addSeasonPass({ studentId: student.id, startDate: past, endDate: future });

    const mine = await getMyTickets(student.id);
    expect(mine.balance).toBe(7);
    expect(mine.activePassEndDate?.getTime()).toBe(future.getTime());

    const summaries = await listStudentTicketSummaries();
    const row = summaries.find((s) => s.id === student.id)!;
    expect(row.name).toBe('小明');
    expect(row.balance).toBe(7);
    expect(row.activePassEndDate?.getTime()).toBe(future.getTime());
  });

  it('ignores expired and future-only passes for the active end date', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2020-01-01'), endDate: new Date('2020-03-31') });
    const futureStart = new Date();
    futureStart.setDate(futureStart.getDate() + 30);
    const futureEnd = new Date();
    futureEnd.setDate(futureEnd.getDate() + 60);
    await addSeasonPass({ studentId: student.id, startDate: futureStart, endDate: futureEnd });
    const mine = await getMyTickets(student.id);
    expect(mine.activePassEndDate).toBeNull();
  });
});

describe('getTicketDetail', () => {
  it('returns balance, passes, and newest-first history', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 10 });
    await adjustTickets({ studentId: student.id, amount: -2, reason: '登記錯誤' });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });

    const detail = await getTicketDetail(student.id);
    expect(detail.balance).toBe(8);
    expect(detail.seasonPasses).toHaveLength(1);
    expect(detail.history).toHaveLength(2);
    expect(detail.history[0].kind).toBe('ADMIN_ADJUST'); // 最新在前
    expect(detail.history[0].reason).toBe('登記錯誤');
  });

  it('computes the running balance after each transaction and the check-in time for ATTEND rows', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'ticket-detail-chen@example.com', password: 'x', subjects: '圍棋' });
    const marker = await prisma.user.create({
      data: { email: 'ticket-detail-marker@example.com', password: 'x', name: '行政', role: 'ADMIN' },
    });
    const student = await createStudent({ name: '小明', email: 'ticket-detail-ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 10 });
    const goHallSession = await prisma.goHallSession.create({
      data: { date: new Date('2026-08-14'), startTime: '19:00', endTime: '21:00', capacity: 10, teacherId: teacher.id },
    });
    await prisma.goHallRegistration.create({ data: { sessionId: goHallSession.id, studentId: student.id } });
    await prisma.$transaction([
      prisma.goHallTicketTransaction.create({ data: { studentId: student.id, amount: -1, kind: 'ATTEND', sessionId: goHallSession.id } }),
      prisma.goHallAttendance.create({
        data: { sessionId: goHallSession.id, studentId: student.id, status: 'PRESENT', checkInTime: '19:05', markedById: marker.id },
      }),
    ]);

    const detail = await getTicketDetail(student.id);

    expect(detail.balance).toBe(9);
    expect(detail.history).toHaveLength(2);
    expect(detail.history[0]).toMatchObject({ kind: 'ATTEND', amount: -1, balanceAfter: 9, checkInTime: '19:05' });
    expect(detail.history[1]).toMatchObject({ kind: 'PURCHASE', amount: 10, balanceAfter: 10, checkInTime: null });
  });
});

describe('getGoHallAttendanceLedger', () => {
  it('merges ticket-affecting transactions with non-deducting (season-pass/single) attendance into one newest-first timeline', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'ledger-chen@example.com', password: 'x', subjects: '圍棋' });
    const marker = await prisma.user.create({
      data: { email: 'ledger-marker@example.com', password: 'x', name: '行政', role: 'ADMIN' },
    });
    const student = await createStudent({ name: '小明', email: 'ledger-ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 10 });

    // TICKET 資格到場：扣堂，有對應的 GoHallTicketTransaction
    const ticketSession = await prisma.goHallSession.create({
      data: { date: new Date('2026-08-05'), startTime: '19:00', endTime: '21:00', capacity: 10, teacherId: teacher.id },
    });
    await prisma.$transaction([
      prisma.goHallTicketTransaction.create({ data: { studentId: student.id, amount: -1, kind: 'ATTEND', sessionId: ticketSession.id } }),
      prisma.goHallAttendance.create({
        data: {
          sessionId: ticketSession.id, studentId: student.id, status: 'PRESENT', checkInTime: '19:05',
          qualification: 'TICKET', markedById: marker.id,
        },
      }),
    ]);

    // 季票資格到場：不扣堂，沒有 GoHallTicketTransaction，但仍是一次到場紀錄
    const seasonSession = await prisma.goHallSession.create({
      data: { date: new Date('2026-08-12'), startTime: '19:00', endTime: '21:00', capacity: 10, teacherId: teacher.id },
    });
    await prisma.goHallAttendance.create({
      data: {
        sessionId: seasonSession.id, studentId: student.id, status: 'PRESENT', checkInTime: '19:10',
        qualification: 'SEASON_PASS', markedById: marker.id,
      },
    });

    const ledger = await getGoHallAttendanceLedger(student.id);

    expect(ledger.balance).toBe(9);
    expect(ledger.history).toHaveLength(3);
    expect(ledger.history.map((h) => h.kind)).toEqual(['ATTEND_SEASON_PASS', 'ATTEND', 'PURCHASE']);
    // 季票到場不扣堂：金額 0，餘額不變
    expect(ledger.history[0]).toMatchObject({ amount: 0, checkInTime: '19:10', balanceAfter: 9 });
    expect(ledger.history[1]).toMatchObject({ amount: -1, checkInTime: '19:05', balanceAfter: 9 });
    expect(ledger.history[2]).toMatchObject({ amount: 10, balanceAfter: 10 });
  });

  it('includes no-show absences (registered, marked ABSENT, no leave) as non-deducting rows too', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'ledger-absent-chen@example.com', password: 'x', subjects: '圍棋' });
    const marker = await prisma.user.create({
      data: { email: 'ledger-absent-marker@example.com', password: 'x', name: '行政', role: 'ADMIN' },
    });
    const student = await createStudent({ name: '小明', email: 'ledger-absent-ming@example.com', password: 'x' });
    await purchaseTickets({ studentId: student.id, sessions: 10 });

    const absentSession = await prisma.goHallSession.create({
      data: { date: new Date('2026-08-19'), startTime: '19:00', endTime: '21:00', capacity: 10, teacherId: teacher.id },
    });
    await prisma.goHallRegistration.create({ data: { sessionId: absentSession.id, studentId: student.id } });
    // 報名了、沒請假（Go Hall 沒有請假機制，缺席就是缺席）、點名時被標記缺席：
    // qualification 維持 null（只有到場才會戳記），沒有 GoHallTicketTransaction。
    await prisma.goHallAttendance.create({
      data: { sessionId: absentSession.id, studentId: student.id, status: 'ABSENT', markedById: marker.id },
    });

    const ledger = await getGoHallAttendanceLedger(student.id);

    expect(ledger.balance).toBe(10); // 缺席不扣堂，餘額不變
    expect(ledger.history).toHaveLength(2); // PURCHASE + ABSENT
    expect(ledger.history[0]).toMatchObject({ kind: 'ABSENT', amount: 0, checkInTime: null, balanceAfter: 10 });
  });
});
