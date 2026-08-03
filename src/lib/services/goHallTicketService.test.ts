import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createStudent } from './studentService';
import { taipeiDateKey, getTicketBalance, purchaseTickets, adjustTickets, addSeasonPass, deleteSeasonPass, hasValidSeasonPass, determineQualification } from './goHallTicketService';

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

  it('treats a local-midnight session instant as the same Taipei calendar day', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await addSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });
    // 台北 8/1 00:00（= UTC 7/31 16:00）也要算季票第一天內
    expect(await hasValidSeasonPass(prisma, student.id, new Date('2026-07-31T16:00:00.000Z'))).toBe(true);
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
