import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { isWithinAvailability, slotsOverlap } from '@/lib/timeSlot';
import { listTeacherAvailability } from './availabilityService';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { pushLineMessage } from './lineService';

export const GO_SUBJECT = '圍棋';
export const ONE_ON_ONE_PERIOD_LIMIT = 1;

export interface MakeupQuotaStatus {
  oneOnOneAvailable: boolean;
  oneOnOneRemaining: number;
}

type ClientType = typeof prisma | Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;

// The one-on-one window starts at this enrollment's newest period (each
// 報課 = one EnrollmentPeriod). No period on record — pre-backfill data or
// an enrollment created without sessions — falls back to all-time, the
// conservative reading; after the launch backfill every enrollment has at
// least one period.
async function getOneOnOnePeriodStart(client: ClientType, studentId: string, classId: string) {
  const latest = await client.enrollmentPeriod.findFirst({
    where: { enrollment: { studentId, classId } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return latest?.createdAt ?? null;
}

// Shared by getMakeupQuotaStatus (read-only snapshot for display) and the
// write-path quota check in createOneOnOneMakeupRequestTx (which passes its
// `tx` client so the count is read inside the same serializable transaction
// as the check-then-act). Rejected requests don't count.
async function countOneOnOneUsed(client: ClientType, studentId: string, classId: string, since: Date | null) {
  return client.makeupRequest.count({
    where: {
      type: 'ONE_ON_ONE',
      status: { in: ['PENDING_ADMIN', 'APPROVED'] },
      leaveRequest: { studentId, classId },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
  });
}

export async function getMakeupQuotaStatus(studentId: string, classId: string): Promise<MakeupQuotaStatus> {
  const cls = await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { subject: true } });
  if (cls.subject !== GO_SUBJECT) return { oneOnOneAvailable: false, oneOnOneRemaining: 0 };

  const since = await getOneOnOnePeriodStart(prisma, studentId, classId);
  const used = await countOneOnOneUsed(prisma, studentId, classId, since);
  return { oneOnOneAvailable: true, oneOnOneRemaining: Math.max(0, ONE_ON_ONE_PERIOD_LIMIT - used) };
}

export interface CreateInsertionInput {
  leaveRequestId: string;
  targetClassId: string;
  targetDate: Date;
}

// 插班補課不限次數（所有科目），所以不再有額度檢查與交易需求。
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
  return runSerializableWithRetry(() => createOneOnOneMakeupRequestTx(input));
}


function createOneOnOneMakeupRequestTx(input: CreateOneOnOneInput) {
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUniqueOrThrow({
      where: { id: input.leaveRequestId },
      select: { classId: true, class: { select: { subject: true } } },
    });
    // 一對一補課只開放圍棋班；每期（最新一期起算）限 1 次。
    if (leave.class.subject !== GO_SUBJECT) throw new Error('NOT_AVAILABLE');

    const since = await getOneOnOnePeriodStart(tx, input.studentId, leave.classId);
    const used = await countOneOnOneUsed(tx, input.studentId, leave.classId, since);
    if (used >= ONE_ON_ONE_PERIOD_LIMIT) throw new Error('QUOTA_EXCEEDED');

    // Derived from slotDate rather than trusted from the caller, so a
    // mismatched weekday/date pair can't be used to slip past the check.
    // slotDate is UTC midnight (parsed from a date-only string), so read
    // the weekday in UTC too — local getDay() would depend on the
    // server's timezone.
    const weekday = input.slotDate.getUTCDay();
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

export function formatMakeupSlot(m: {
  type: 'INSERTION' | 'ONE_ON_ONE';
  targetDate: Date | null;
  targetClass: { name: string; startTime: string; endTime: string } | null;
  slotDate: Date | null;
  slotStartTime: string | null;
  slotEndTime: string | null;
}): string {
  if (m.type === 'INSERTION' && m.targetDate && m.targetClass) {
    return `${formatDateWithWeekday(m.targetDate, 'zh-TW')}${m.targetClass.name} ${m.targetClass.startTime}-${m.targetClass.endTime}`;
  }
  if (m.slotDate && m.slotStartTime && m.slotEndTime) {
    return `${formatDateWithWeekday(m.slotDate, 'zh-TW')}一對一補課 ${m.slotStartTime}-${m.slotEndTime}`;
  }
  return '';
}

export async function decideMakeupRequest(id: string, decision: 'APPROVED' | 'REJECTED') {
  const updated = await prisma.makeupRequest.update({
    where: { id },
    data: { status: decision },
    include: {
      leaveRequest: { select: { student: { select: { id: true, lineUserId: true, user: { select: { name: true } } } } } },
      targetClass: { select: { name: true, startTime: true, endTime: true } },
    },
  });

  try {
    const student = updated.leaveRequest.student;
    if (student.lineUserId) {
      const text =
        decision === 'APPROVED'
          ? `【MUP】${student.user.name}的補課申請已核准：${formatMakeupSlot(updated)}`
          : `【MUP】${student.user.name}的補課申請未通過，請洽行政人員`;
      await pushLineMessage(student.lineUserId, text);
    }
  } catch (err) {
    console.error('decideMakeupRequest LINE notification failed', err);
  }

  return updated;
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
