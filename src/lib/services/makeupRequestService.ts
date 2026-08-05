import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { runSerializableWithRetry } from '@/lib/transaction';
import { isWithinAvailability, slotsOverlap } from '@/lib/timeSlot';
import { oneOnOneEndTime, ONE_ON_ONE_DURATION_MINUTES } from '@/lib/oneOnOneSlot';
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
  // 結束時間不由呼叫端決定：固定為開始＋ONE_ON_ONE_DURATION_MINUTES。
}

export async function createOneOnOneMakeupRequest(input: CreateOneOnOneInput) {
  return runSerializableWithRetry(() => createOneOnOneMakeupRequestTx(input));
}


// 一對一補課的共用檢查（給學生申請與行政代排）：圍棋限定、每期
// （最新一期起算）限 1 次、老師可補課時段、時段衝突。必須在
// serializable 交易內呼叫，讓 check-then-act 原子。
async function assertOneOnOneSlotAllowed(
  tx: Prisma.TransactionClient,
  input: { studentId: string; classId: string; teacherId: string; slotDate: Date; slotStartTime: string; slotEndTime: string }
) {
  const cls = await tx.class.findUniqueOrThrow({ where: { id: input.classId }, select: { subject: true } });
  if (cls.subject !== GO_SUBJECT) throw new Error('NOT_AVAILABLE');

  const since = await getOneOnOnePeriodStart(tx, input.studentId, input.classId);
  const used = await countOneOnOneUsed(tx, input.studentId, input.classId, since);
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
}

function createOneOnOneMakeupRequestTx(input: CreateOneOnOneInput) {
  const slotEndTime = oneOnOneEndTime(input.slotStartTime);
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUniqueOrThrow({
      where: { id: input.leaveRequestId },
      select: { classId: true },
    });
    await assertOneOnOneSlotAllowed(tx, {
      studentId: input.studentId,
      classId: leave.classId,
      teacherId: input.teacherId,
      slotDate: input.slotDate,
      slotStartTime: input.slotStartTime,
      slotEndTime,
    });

    return tx.makeupRequest.create({
      data: {
        leaveRequestId: input.leaveRequestId,
        type: 'ONE_ON_ONE',
        status: 'PENDING_ADMIN',
        teacherId: input.teacherId,
        slotDate: input.slotDate,
        slotStartTime: input.slotStartTime,
        slotEndTime,
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

const MAKEUP_NOTIFY_INCLUDE = {
  leaveRequest: { select: { student: { select: { id: true, lineUserId: true, user: { select: { name: true } } } } } },
  targetClass: { select: { name: true, startTime: true, endTime: true } },
} as const;

type MakeupWithNotifyInfo = Prisma.MakeupRequestGetPayload<{ include: typeof MAKEUP_NOTIFY_INCLUDE }>;

// LINE 通知家長；失敗只記 log，不影響主流程（核准／代排／撤銷共用）。
async function notifyMakeup(makeup: MakeupWithNotifyInfo, kind: 'APPROVED' | 'REJECTED' | 'REVOKED') {
  try {
    const student = makeup.leaveRequest.student;
    if (!student.lineUserId) return;
    const text =
      kind === 'APPROVED'
        ? `【MUP】${student.user.name}的補課申請已核准：${formatMakeupSlot(makeup)}`
        : kind === 'REVOKED'
          ? `【MUP】${student.user.name}的補課已取消：${formatMakeupSlot(makeup)}，如需重新安排請洽行政人員`
          : `【MUP】${student.user.name}的補課申請未通過，請洽行政人員`;
    await pushLineMessage(student.lineUserId, text);
  } catch (err) {
    console.error('makeup LINE notification failed', err);
  }
}

export async function decideMakeupRequest(id: string, decision: 'APPROVED' | 'REJECTED') {
  const updated = await prisma.makeupRequest.update({
    where: { id },
    data: { status: decision },
    include: MAKEUP_NOTIFY_INCLUDE,
  });
  await notifyMakeup(updated, decision);
  return updated;
}

// ─── 行政代排：一步建立「請假＋已核准補課」，直接進點名名單 ───

export interface ArrangeBaseInput {
  studentId: string;
  classId: string;
  date: Date;
  reason: string;
}

async function createLeaveForArrangeTx(tx: Prisma.TransactionClient, input: ArrangeBaseInput) {
  const enrolled = await tx.classEnrollment.findUnique({
    where: { studentId_classId: { studentId: input.studentId, classId: input.classId } },
  });
  if (!enrolled) throw new Error('NOT_ENROLLED');
  return tx.leaveRequest.create({
    data: { studentId: input.studentId, classId: input.classId, date: input.date, reason: input.reason, status: 'APPROVED', origin: 'ADMIN' },
  });
}

function findExistingLeaveTx(tx: Prisma.TransactionClient, input: ArrangeBaseInput) {
  return tx.leaveRequest.findFirst({
    where: { studentId: input.studentId, classId: input.classId, date: input.date },
    include: { makeupRequest: { select: { id: true } } },
  });
}

// 同日已有請假就直接沿用——這是行政「對既有請假單獨補排補課」的入口；
// 該請假已掛補課則擋下，避免蓋掉原本的安排。
async function findOrCreateLeaveForArrangeTx(tx: Prisma.TransactionClient, input: ArrangeBaseInput) {
  const existing = await findExistingLeaveTx(tx, input);
  if (existing?.makeupRequest) throw new Error('ALREADY_HAS_MAKEUP');
  if (existing) return existing;
  return createLeaveForArrangeTx(tx, input);
}

// 只代辦請假、暫不安排補課；家長之後仍可對這筆請假自行申請補課。
// 與家長自行請假一致：直接核准、不發 LINE 通知。
export async function arrangeLeaveOnly(input: ArrangeBaseInput) {
  return prisma.$transaction(async (tx) => {
    if (await findExistingLeaveTx(tx, input)) throw new Error('ALREADY_ON_LEAVE');
    return createLeaveForArrangeTx(tx, input);
  });
}

export async function arrangeInsertionMakeup(input: ArrangeBaseInput & { targetClassId: string; targetDate: Date }) {
  const makeup = await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const leave = await findOrCreateLeaveForArrangeTx(tx, input);
        return tx.makeupRequest.create({
          data: {
            leaveRequestId: leave.id,
            type: 'INSERTION',
            status: 'APPROVED',
            targetClassId: input.targetClassId,
            targetDate: input.targetDate,
          },
          include: MAKEUP_NOTIFY_INCLUDE,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  await notifyMakeup(makeup, 'APPROVED');
  return makeup;
}

export async function arrangeOneOnOneMakeup(
  input: ArrangeBaseInput & { teacherId: string; slotDate: Date; slotStartTime: string }
) {
  const slotEndTime = oneOnOneEndTime(input.slotStartTime);
  const makeup = await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await assertOneOnOneSlotAllowed(tx, {
          studentId: input.studentId,
          classId: input.classId,
          teacherId: input.teacherId,
          slotDate: input.slotDate,
          slotStartTime: input.slotStartTime,
          slotEndTime,
        });
        const leave = await findOrCreateLeaveForArrangeTx(tx, input);
        return tx.makeupRequest.create({
          data: {
            leaveRequestId: leave.id,
            type: 'ONE_ON_ONE',
            status: 'APPROVED',
            teacherId: input.teacherId,
            slotDate: input.slotDate,
            slotStartTime: input.slotStartTime,
            slotEndTime,
          },
          include: MAKEUP_NOTIFY_INCLUDE,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
  await notifyMakeup(makeup, 'APPROVED');
  return makeup;
}

// ─── 撤銷：家長申請、行政確認或直接撤銷 ───

// 學生（家長）對自己已核准的補課提出撤銷申請；行政確認前補課仍有效。
export async function requestMakeupCancellation(makeupRequestId: string, studentId: string) {
  const makeup = await prisma.makeupRequest.findUnique({
    where: { id: makeupRequestId },
    select: { id: true, status: true, leaveRequest: { select: { studentId: true } } },
  });
  if (!makeup || makeup.leaveRequest.studentId !== studentId) throw new Error('NOT_FOUND');
  if (makeup.status !== 'APPROVED') throw new Error('NOT_APPROVED');
  return prisma.makeupRequest.update({ where: { id: makeupRequestId }, data: { cancelRequestedAt: new Date() } });
}

export function rejectMakeupCancellation(makeupRequestId: string) {
  return prisma.makeupRequest.update({ where: { id: makeupRequestId }, data: { cancelRequestedAt: null } });
}

// 撤銷＝刪除補課單：點名名單自動消失（名單只撈 APPROVED）、一對一額度
// 釋放、原請假回到「尚未申請」可重新安排。已點過名則擋下。
export async function revokeMakeup(makeupRequestId: string) {
  const makeup = await prisma.makeupRequest.findUniqueOrThrow({
    where: { id: makeupRequestId },
    include: MAKEUP_NOTIFY_INCLUDE,
  });
  await prisma.$transaction(async (tx) => {
    const [classAttendance, oneOnOneAttendance] = await Promise.all([
      tx.classAttendance.count({ where: { makeupRequestId } }),
      tx.oneOnOneAttendance.count({ where: { makeupRequestId } }),
    ]);
    if (classAttendance > 0 || oneOnOneAttendance > 0) throw new Error('MAKEUP_HAS_ATTENDANCE');
    await tx.makeupRequest.delete({ where: { id: makeupRequestId } });
  });
  await notifyMakeup(makeup, 'REVOKED');
}

// 行政補課申請頁的「已核准補課」清單：只列未來場次（今天含以後），
// 有撤銷申請者排最前，其餘依補課日期近到遠。
export async function listApprovedMakeups() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rows = await prisma.makeupRequest.findMany({
    where: {
      status: 'APPROVED',
      OR: [{ targetDate: { gte: todayStart } }, { slotDate: { gte: todayStart } }],
    },
    select: {
      id: true,
      type: true,
      targetDate: true,
      slotDate: true,
      slotStartTime: true,
      slotEndTime: true,
      cancelRequestedAt: true,
      leaveRequest: {
        select: {
          date: true,
          student: { select: { user: { select: { name: true } } } },
          class: { select: { name: true } },
        },
      },
      targetClass: { select: { name: true } },
      teacher: { select: { user: { select: { name: true } } } },
    },
  });
  const when = (r: (typeof rows)[number]) => (r.targetDate ?? r.slotDate ?? new Date(0)).getTime();
  return rows.sort((a, b) => {
    if (!!a.cancelRequestedAt !== !!b.cancelRequestedAt) return a.cancelRequestedAt ? -1 : 1;
    return when(a) - when(b);
  });
}

// For the teacher dashboard: which students inserted into a class this
// teacher teaches, and when.
export interface OneOnOneSlotOption {
  startTime: string;
  endTime: string;
  available: boolean;
}

// 指定老師＋日期的一對一可預約起點：依可補課時段切成 40 分鐘格
// （從時段起點對齊，避免零碎空檔），已被 PENDING／APPROVED 佔用的標記
// 為不可選。給學生表單與行政代排共用；不洩漏預約者身分，只回時間。
export async function listOneOnOneSlotOptions(teacherId: string, slotDate: Date): Promise<OneOnOneSlotOption[]> {
  const weekday = slotDate.getUTCDay();
  const [availabilities, taken] = await Promise.all([
    listTeacherAvailability(teacherId),
    prisma.makeupRequest.findMany({
      where: { type: 'ONE_ON_ONE', teacherId, slotDate, status: { in: ['PENDING_ADMIN', 'APPROVED'] } },
      select: { slotStartTime: true, slotEndTime: true },
    }),
  ]);

  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  const options: OneOnOneSlotOption[] = [];
  for (const win of availabilities.filter((a) => a.weekday === weekday)) {
    const winStart = toMinutes(win.startTime);
    const winEnd = toMinutes(win.endTime);
    for (let start = winStart; start + ONE_ON_ONE_DURATION_MINUTES <= winEnd; start += ONE_ON_ONE_DURATION_MINUTES) {
      const startTime = toTime(start);
      const endTime = toTime(start + ONE_ON_ONE_DURATION_MINUTES);
      const conflict = taken.some((t) => slotsOverlap({ startTime, endTime }, { startTime: t.slotStartTime!, endTime: t.slotEndTime! }));
      options.push({ startTime, endTime, available: !conflict });
    }
  }
  return options.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function listAssignedOneOnOneForTeacher(teacherId: string) {
  // 老師首頁「被指派」區塊：只列今天（含）以後；PENDING_ADMIN 也列出，
  // 因為時段在建立時就已為老師保留（SLOT_CONFLICT 檢查含 PENDING）。
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return prisma.makeupRequest.findMany({
    where: {
      type: 'ONE_ON_ONE',
      teacherId,
      status: { in: ['PENDING_ADMIN', 'APPROVED'] },
      slotDate: { gte: today },
    },
    select: {
      id: true,
      status: true,
      slotDate: true,
      slotStartTime: true,
      slotEndTime: true,
      leaveRequest: {
        select: {
          student: { select: { user: { select: SAFE_USER_SELECT } } },
          class: { select: { name: true } },
        },
      },
    },
    orderBy: [{ slotDate: 'asc' }, { slotStartTime: 'asc' }],
  });
}

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
