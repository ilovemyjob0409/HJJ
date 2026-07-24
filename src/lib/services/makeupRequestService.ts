import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { getQuarterRange } from '@/lib/quarter';
import { isWithinAvailability, slotsOverlap } from '@/lib/timeSlot';
import { listTeacherAvailability } from './availabilityService';

export const TOTAL_QUARTER_LIMIT = 2;
export const ONE_ON_ONE_QUARTER_LIMIT = 1;

export interface MakeupQuotaStatus {
  insertionRemaining: number;
  oneOnOneRemaining: number;
}

type ClientType = typeof prisma | Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;

// Shared by getMakeupQuotaStatus (read-only snapshot for display) and the
// write-path quota checks in createOneOnOneMakeupRequestTx /
// createInsertionMakeupRequestTx (which pass their `tx` client so the count
// is read inside the same serializable transaction as the check-then-act).
async function getQuotaCounts(client: ClientType, studentId: string, start: Date, end: Date) {
  const [totalUsed, oneOnOneUsed] = await Promise.all([
    client.makeupRequest.count({
      where: {
        type: { in: ['INSERTION', 'ONE_ON_ONE'] },
        status: { in: ['PENDING_ADMIN', 'APPROVED'] },
        leaveRequest: { studentId },
        createdAt: { gte: start, lte: end },
      },
    }),
    client.makeupRequest.count({
      where: {
        type: 'ONE_ON_ONE',
        status: { in: ['PENDING_ADMIN', 'APPROVED'] },
        leaveRequest: { studentId },
        createdAt: { gte: start, lte: end },
      },
    }),
  ]);
  return { totalUsed, oneOnOneUsed };
}

export async function getMakeupQuotaStatus(studentId: string): Promise<MakeupQuotaStatus> {
  const { start, end } = getQuarterRange(new Date());
  const { totalUsed, oneOnOneUsed } = await getQuotaCounts(prisma, studentId, start, end);

  const totalRemaining = Math.max(0, TOTAL_QUARTER_LIMIT - totalUsed);
  const oneOnOneRemaining = Math.min(Math.max(0, ONE_ON_ONE_QUARTER_LIMIT - oneOnOneUsed), totalRemaining);

  return { insertionRemaining: totalRemaining, oneOnOneRemaining };
}

export interface CreateInsertionInput {
  leaveRequestId: string;
  targetClassId: string;
  targetDate: Date;
}

export function createInsertionMakeupRequest(input: CreateInsertionInput) {
  return runSerializableWithRetry(() => createInsertionMakeupRequestTx(input));
}

function createInsertionMakeupRequestTx(input: CreateInsertionInput) {
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUniqueOrThrow({
      where: { id: input.leaveRequestId },
      select: { studentId: true },
    });
    const { start, end } = getQuarterRange(new Date());
    const { totalUsed } = await getQuotaCounts(tx, leave.studentId, start, end);
    if (totalUsed >= TOTAL_QUARTER_LIMIT) throw new Error('QUOTA_EXCEEDED');

    return tx.makeupRequest.create({
      data: {
        leaveRequestId: input.leaveRequestId,
        type: 'INSERTION',
        status: 'PENDING_ADMIN',
        targetClassId: input.targetClassId,
        targetDate: input.targetDate,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export interface CreateOneOnOneInput {
  leaveRequestId: string;
  studentId: string;
  teacherId: string;
  slotDate: Date;
  slotStartTime: string;
  slotEndTime: string;
}

export async function createOneOnOneMakeupRequest(input: CreateOneOnOneInput) {
  return runSerializableWithRetry(() => createOneOnOneMakeupRequestTx(input));
}


function createOneOnOneMakeupRequestTx(input: CreateOneOnOneInput) {
  return prisma.$transaction(async (tx) => {
    const { start, end } = getQuarterRange(new Date());
    const { totalUsed, oneOnOneUsed } = await getQuotaCounts(tx, input.studentId, start, end);
    if (oneOnOneUsed >= ONE_ON_ONE_QUARTER_LIMIT || totalUsed >= TOTAL_QUARTER_LIMIT) {
      throw new Error('QUOTA_EXCEEDED');
    }

    // Derived from slotDate rather than trusted from the caller, so a
    // mismatched weekday/date pair can't be used to slip past the check.
    const weekday = input.slotDate.getDay();
    const availabilities = await listTeacherAvailability(input.teacherId, tx);
    const withinAvailability = isWithinAvailability(
      { weekday, startTime: input.slotStartTime, endTime: input.slotEndTime },
      availabilities
    );
    if (!withinAvailability) throw new Error('OUTSIDE_AVAILABILITY');

    const sameDayRequests = await tx.makeupRequest.findMany({
      where: {
        type: 'ONE_ON_ONE',
        teacherId: input.teacherId,
        slotDate: input.slotDate,
        status: { in: ['PENDING_ADMIN', 'APPROVED'] },
      },
    });
    const conflict = sameDayRequests.some((r) =>
      slotsOverlap({ startTime: input.slotStartTime, endTime: input.slotEndTime }, { startTime: r.slotStartTime!, endTime: r.slotEndTime! })
    );
    if (conflict) throw new Error('SLOT_CONFLICT');

    return tx.makeupRequest.create({
      data: {
        leaveRequestId: input.leaveRequestId,
        type: 'ONE_ON_ONE',
        status: 'PENDING_ADMIN',
        teacherId: input.teacherId,
        slotDate: input.slotDate,
        slotStartTime: input.slotStartTime,
        slotEndTime: input.slotEndTime,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

const SAFE_USER_SELECT = { name: true, email: true } as const;

export function listPendingMakeupRequests() {
  return prisma.makeupRequest.findMany({
    where: { status: 'PENDING_ADMIN' },
    select: {
      id: true,
      type: true,
      status: true,
      targetDate: true,
      slotDate: true,
      slotStartTime: true,
      slotEndTime: true,
      createdAt: true,
      leaveRequest: {
        select: {
          student: { select: { user: { select: SAFE_USER_SELECT } } },
          class: true,
        },
      },
      targetClass: true,
      teacher: { select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export function decideMakeupRequest(id: string, decision: 'APPROVED' | 'REJECTED') {
  return prisma.makeupRequest.update({ where: { id }, data: { status: decision } });
}

// For the teacher dashboard: which students inserted into a class this
// teacher teaches, and when.
export function listInsertionsForTeacherClasses(teacherId: string) {
  return prisma.makeupRequest.findMany({
    where: { type: 'INSERTION', targetClass: { teacherId } },
    select: {
      id: true,
      status: true,
      targetDate: true,
      targetClass: { select: { name: true } },
      leaveRequest: { select: { student: { select: { user: { select: SAFE_USER_SELECT } } } } },
    },
    orderBy: { targetDate: 'desc' },
  });
}
