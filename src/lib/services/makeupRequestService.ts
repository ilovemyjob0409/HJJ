import { prisma } from '@/lib/db';
import { getQuarterRange } from '@/lib/quarter';
import { isWithinAvailability, slotsOverlap } from '@/lib/timeSlot';
import { listTeacherAvailability } from './availabilityService';

export interface CreateInsertionInput {
  leaveRequestId: string;
  targetClassId: string;
  targetDate: Date;
}

export function createInsertionMakeupRequest(input: CreateInsertionInput) {
  return prisma.makeupRequest.create({
    data: {
      leaveRequestId: input.leaveRequestId,
      type: 'INSERTION',
      status: 'PENDING_ADMIN',
      targetClassId: input.targetClassId,
      targetDate: input.targetDate,
    },
  });
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
  const { start, end } = getQuarterRange(new Date());
  const quotaUsed = await prisma.makeupRequest.count({
    where: {
      type: 'ONE_ON_ONE',
      status: { in: ['PENDING_ADMIN', 'APPROVED'] },
      leaveRequest: { studentId: input.studentId },
      createdAt: { gte: start, lte: end },
    },
  });
  if (quotaUsed > 0) throw new Error('QUOTA_EXCEEDED');

  // Derived from slotDate rather than trusted from the caller, so a
  // mismatched weekday/date pair can't be used to slip past the check.
  const weekday = input.slotDate.getDay();
  const availabilities = await listTeacherAvailability(input.teacherId);
  const withinAvailability = isWithinAvailability(
    { weekday, startTime: input.slotStartTime, endTime: input.slotEndTime },
    availabilities
  );
  if (!withinAvailability) throw new Error('OUTSIDE_AVAILABILITY');

  const sameDayRequests = await prisma.makeupRequest.findMany({
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

  return prisma.makeupRequest.create({
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
