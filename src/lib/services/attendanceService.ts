import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import { pushToUser, hasPushSubscription } from './pushService';
import { runSerializableWithRetry } from '@/lib/transaction';
import { determineQualification, getTicketBalance, LOW_TICKET_THRESHOLD, type GoHallQualificationValue } from './goHallTicketService';
import { LOW_CLASS_QUOTA_THRESHOLD } from '@/lib/lowQuota';
import { getMonthlyQuotaStatus, taipeiDateKey } from './tutoringBookingService';

export type AttendanceStatusValue = 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT' | 'NOT_REGISTERED';

const NAME_SELECT = { user: { select: { name: true } } } as const;

export interface SaveAttendanceRecordInput {
  studentId: string;
  status: AttendanceStatusValue;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  makeupRequestId?: string;
}

export interface ClassRosterEntry {
  studentId: string;
  studentName: string;
  makeupRequestId: string | null;
  onLeave: boolean;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function getClassRoster(classId: string, date: Date): Promise<ClassRosterEntry[]> {
  const [enrollments, insertions, leaves, existing] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { classId },
      select: { studentId: true, student: { select: NAME_SELECT } },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'INSERTION', status: 'APPROVED', targetClassId: classId, targetDate: date },
      select: { id: true, leaveRequest: { select: { studentId: true, student: { select: NAME_SELECT } } } },
    }),
    prisma.leaveRequest.findMany({ where: { classId, date }, select: { studentId: true } }),
    prisma.classAttendance.findMany({ where: { classId, date } }),
  ]);

  const onLeaveStudentIds = new Set(leaves.map((l) => l.studentId));
  const existingByStudentId = new Map(existing.filter((a) => a.makeupRequestId === null).map((a) => [a.studentId, a]));
  const existingByMakeupRequestId = new Map(
    existing.filter((a) => a.makeupRequestId !== null).map((a) => [a.makeupRequestId as string, a])
  );

  const enrolledRows: ClassRosterEntry[] = enrollments.map((e) => {
    const record = existingByStudentId.get(e.studentId);
    return {
      studentId: e.studentId,
      studentName: e.student.user.name,
      makeupRequestId: null,
      onLeave: onLeaveStudentIds.has(e.studentId),
      status: (record?.status as AttendanceStatusValue) ?? null,
      checkInTime: record?.checkInTime ?? null,
      checkOutTime: record?.checkOutTime ?? null,
    };
  });

  const enrolledStudentIds = new Set(enrollments.map((e) => e.studentId));
  const insertionRows: ClassRosterEntry[] = insertions
    .filter((ins) => !enrolledStudentIds.has(ins.leaveRequest.studentId))
    .map((ins) => {
      const record = existingByMakeupRequestId.get(ins.id);
      return {
        studentId: ins.leaveRequest.studentId,
        studentName: ins.leaveRequest.student.user.name,
        makeupRequestId: ins.id,
        onLeave: false,
        status: (record?.status as AttendanceStatusValue) ?? null,
        checkInTime: record?.checkInTime ?? null,
        checkOutTime: record?.checkOutTime ?? null,
      };
    });

  return [...enrolledRows, ...insertionRows].sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}

export async function saveClassAttendance(
  classId: string,
  date: Date,
  markedById: string,
  records: SaveAttendanceRecordInput[]
): Promise<void> {
  await prisma.$transaction(
    records.map((r) =>
      prisma.classAttendance.upsert({
        where: r.makeupRequestId
          ? { makeupRequestId: r.makeupRequestId }
          : { classId_studentId_date: { classId, studentId: r.studentId, date } },
        create: {
          classId,
          studentId: r.studentId,
          date,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          makeupRequestId: r.makeupRequestId,
          markedById,
        },
        update: {
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          markedById,
        },
      })
    )
  );
}

export interface ClearClassAttendanceKey {
  studentId: string;
  makeupRequestId?: string;
}

export async function clearClassAttendance(classId: string, date: Date, keys: ClearClassAttendanceKey[]): Promise<void> {
  await prisma.$transaction(
    keys.map((k) =>
      prisma.classAttendance.deleteMany({
        where: k.makeupRequestId ? { makeupRequestId: k.makeupRequestId } : { classId, studentId: k.studentId, date },
      })
    )
  );
}

export interface ClassAttendanceQuota {
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
}

export async function getClassEnrollmentQuota(classId: string, studentId: string): Promise<ClassAttendanceQuota> {
  const [enrollment, usedSessions] = await Promise.all([
    prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } } }),
    // 請假與未報名（報名時聲明不來、未繳該堂費用）都不扣堂。
    prisma.classAttendance.count({ where: { classId, studentId, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } } }),
  ]);
  const { totalSessions } = enrollment;
  return {
    totalSessions,
    usedSessions,
    remaining: totalSessions === null ? null : totalSessions - usedSessions,
  };
}

export interface ClassLedgerRow {
  id: string;
  date: Date;
  kind: 'GRANT' | 'DEDUCT';
  amount: number; // GRANT：+這一期的堂數；DEDUCT：-1
  status: string | null; // DEDUCT 才有值（AttendanceStatus）；GRANT 是 null
  checkInTime: string | null;
  remainingAfter: number | null;
}

// 學生自己看的「扣堂紀錄」：跟班級／個別輔導／弈廳一樣是一份完整的堂數增減
// 帳本——每一期報課／續報（EnrollmentPeriod）算一筆「建立」（GRANT，
// +這一期的堂數），每一堂真的扣掉名額的點名（跟 getClassEnrollmentQuota 同一
// 套扣堂語意：請假、未報名不扣）算一筆 DEDUCT（-1）。不扣堂的請假／未報名
// 點名不算增減事件，不放進帳本。totalSessions 未設定（未設堂數上限）就沒有
// 倒數概念，每一列 remainingAfter 都是 null。
export async function getClassAttendanceLedger(classId: string, studentId: string): Promise<{
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
  history: ClassLedgerRow[];
}> {
  const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } } });
  const [attendances, periods] = await Promise.all([
    // 請假與未報名（報名時聲明不來、未繳該堂費用）都不扣堂，不算增減事件。
    prisma.classAttendance.findMany({
      where: { classId, studentId, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } },
      select: { id: true, date: true, status: true, checkInTime: true },
    }),
    prisma.enrollmentPeriod.findMany({
      where: { enrollmentId: enrollment.id },
      select: { id: true, sessions: true, createdAt: true },
    }),
  ]);
  const { totalSessions } = enrollment;
  const usedSessions = attendances.length;
  const remaining = totalSessions === null ? null : totalSessions - usedSessions;

  const merged = [
    ...attendances.map((a) => ({ id: a.id, date: a.date, kind: 'DEDUCT' as const, amount: -1, status: a.status as string, checkInTime: a.checkInTime })),
    ...periods.map((p) => ({ id: p.id, date: p.createdAt, kind: 'GRANT' as const, amount: p.sessions, status: null, checkInTime: null })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  // 新到舊往回推每筆結算後的剩餘堂數：DEDUCT 往回走一步要 +1（回推到還沒扣掉
  // 這堂之前），GRANT 往回走一步要減掉這一期的堂數（回推到這期還沒核發之
  // 前）——兩者都等於「remainingAfter 減掉這筆事件本身的 amount」。
  // totalSessions 未設定就沒有倒數概念。
  let runningAfter = remaining;
  const history: ClassLedgerRow[] = merged.map((r) => {
    const remainingAfter = runningAfter;
    if (runningAfter !== null) runningAfter -= r.amount;
    return { ...r, remainingAfter };
  });

  return { totalSessions, usedSessions, remaining, history };
}

export interface ClassQuotaSummaryRow {
  studentId: string;
  classId: string;
  className: string;
  usedSessions: number;
  totalSessions: number | null;
  remaining: number | null;
}

// 與 getClassEnrollmentQuota 同一套扣堂語意（請假、未報名不扣），
// 但一次 groupBy 算完（單人或全部學生），供票券管理顯示課堂堂數。
export async function listClassQuotaSummaries(studentId?: string): Promise<ClassQuotaSummaryRow[]> {
  const [enrollments, counts] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: studentId ? { studentId } : {},
      select: { studentId: true, totalSessions: true, class: { select: { id: true, name: true } } },
    }),
    prisma.classAttendance.groupBy({
      by: ['classId', 'studentId'],
      where: { status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] }, ...(studentId ? { studentId } : {}) },
      _count: { _all: true },
    }),
  ]);
  const usedByKey = new Map(counts.map((c) => [`${c.classId}:${c.studentId}`, c._count._all]));
  return enrollments.map((e) => {
    const usedSessions = usedByKey.get(`${e.class.id}:${e.studentId}`) ?? 0;
    return {
      studentId: e.studentId,
      classId: e.class.id,
      className: e.class.name,
      usedSessions,
      totalSessions: e.totalSessions,
      remaining: e.totalSessions === null ? null : e.totalSessions - usedSessions,
    };
  });
}

export interface OneOnOneRosterEntry {
  makeupRequestId: string;
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function getOneOnOneAttendance(makeupRequestId: string): Promise<OneOnOneRosterEntry> {
  const makeupRequest = await prisma.makeupRequest.findUniqueOrThrow({
    where: { id: makeupRequestId },
    select: {
      id: true,
      leaveRequest: { select: { studentId: true, student: { select: NAME_SELECT } } },
      oneOnOneAttendance: true,
    },
  });
  const record = makeupRequest.oneOnOneAttendance;
  return {
    makeupRequestId: makeupRequest.id,
    studentId: makeupRequest.leaveRequest.studentId,
    studentName: makeupRequest.leaveRequest.student.user.name,
    status: (record?.status as AttendanceStatusValue) ?? null,
    checkInTime: record?.checkInTime ?? null,
    checkOutTime: record?.checkOutTime ?? null,
  };
}

export async function saveOneOnOneAttendance(
  makeupRequestId: string,
  markedById: string,
  input: { status: AttendanceStatusValue; checkInTime?: string; checkOutTime?: string }
): Promise<void> {
  await prisma.oneOnOneAttendance.upsert({
    where: { makeupRequestId },
    create: {
      makeupRequestId,
      status: input.status,
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      markedById,
    },
    update: {
      status: input.status,
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      markedById,
    },
  });
}

export async function clearOneOnOneAttendance(makeupRequestId: string): Promise<void> {
  await prisma.oneOnOneAttendance.deleteMany({ where: { makeupRequestId } });
}

// 「到場」才扣堂票：出席／遲到／早退；請假、缺席、未報名不扣。
const GO_HALL_ATTENDED: ReadonlySet<string> = new Set(['PRESENT', 'LATE', 'LEFT_EARLY']);

export interface GoHallRosterEntry {
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  qualification: GoHallQualificationValue | null;
  qualificationPredicted: boolean;
}

export async function getGoHallRoster(sessionId: string): Promise<GoHallRosterEntry[]> {
  const [session, registrations, existing] = await Promise.all([
    prisma.goHallSession.findUniqueOrThrow({ where: { id: sessionId }, select: { date: true } }),
    prisma.goHallRegistration.findMany({
      where: { sessionId },
      select: { studentId: true, student: { select: NAME_SELECT } },
    }),
    prisma.goHallAttendance.findMany({ where: { sessionId } }),
  ]);
  const existingByStudentId = new Map(existing.map((a) => [a.studentId, a]));
  const rows = await Promise.all(
    registrations.map(async (r) => {
      const record = existingByStudentId.get(r.studentId);
      const qualification = record
        ? ((record.qualification as GoHallQualificationValue | null) ?? null)
        : await determineQualification(prisma, r.studentId, session.date);
      return {
        studentId: r.studentId,
        studentName: r.student.user.name,
        status: (record?.status as AttendanceStatusValue) ?? null,
        checkInTime: record?.checkInTime ?? null,
        checkOutTime: record?.checkOutTime ?? null,
        qualification,
        qualificationPredicted: !record,
      };
    })
  );
  return rows.sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}

export async function saveGoHallAttendance(
  sessionId: string,
  markedById: string,
  records: SaveAttendanceRecordInput[]
): Promise<void> {
  const session = await prisma.goHallSession.findUniqueOrThrow({ where: { id: sessionId }, select: { date: true } });
  const deductedStudentIds: string[] = [];

  await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        deductedStudentIds.length = 0; // serializable 重試時歸零，避免重複通知
        for (const r of records) {
          const attended = GO_HALL_ATTENDED.has(r.status);
          const existing = await tx.goHallAttendance.findUnique({
            where: { sessionId_studentId: { sessionId, studentId: r.studentId } },
            select: { qualification: true },
          });
          // 已到場且已戳記 → 沿用（冪等）；轉非到場 → 退堂＋清戳記。
          let qualification: GoHallQualificationValue | null = existing?.qualification ?? null;
          if (attended && qualification === null) {
            qualification = await determineQualification(tx, r.studentId, session.date);
            if (qualification === 'TICKET') {
              await tx.goHallTicketTransaction.create({
                data: { studentId: r.studentId, amount: -1, kind: 'ATTEND', sessionId },
              });
              deductedStudentIds.push(r.studentId);
            }
          } else if (!attended && qualification !== null) {
            await tx.goHallTicketTransaction.deleteMany({
              where: { studentId: r.studentId, sessionId, kind: 'ATTEND' },
            });
            qualification = null;
          }
          await tx.goHallAttendance.upsert({
            where: { sessionId_studentId: { sessionId, studentId: r.studentId } },
            create: {
              sessionId,
              studentId: r.studentId,
              status: r.status,
              checkInTime: r.checkInTime,
              checkOutTime: r.checkOutTime,
              markedById,
              qualification,
            },
            update: {
              status: r.status,
              checkInTime: r.checkInTime,
              checkOutTime: r.checkOutTime,
              markedById,
              qualification,
            },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );

  for (const studentId of deductedStudentIds) {
    await maybeNotifyLowGoHallTickets(studentId);
  }
}

export async function clearGoHallAttendance(sessionId: string, studentIds: string[]): Promise<void> {
  if (studentIds.length === 0) return;
  await runSerializableWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.goHallTicketTransaction.deleteMany({
          where: { sessionId, studentId: { in: studentIds }, kind: 'ATTEND' },
        });
        await tx.goHallAttendance.deleteMany({ where: { sessionId, studentId: { in: studentIds } } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

export interface ActivityRosterEntry {
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function getActivityRoster(activityId: string, date: Date): Promise<ActivityRosterEntry[]> {
  const [registrations, existing] = await Promise.all([
    prisma.activityRegistration.findMany({
      where: { activityId },
      select: { studentId: true, student: { select: NAME_SELECT } },
    }),
    prisma.activityAttendance.findMany({ where: { activityId, date } }),
  ]);
  const existingByStudentId = new Map(existing.map((a) => [a.studentId, a]));
  return registrations
    .map((r) => {
      const record = existingByStudentId.get(r.studentId);
      return {
        studentId: r.studentId,
        studentName: r.student.user.name,
        status: (record?.status as AttendanceStatusValue) ?? null,
        checkInTime: record?.checkInTime ?? null,
        checkOutTime: record?.checkOutTime ?? null,
      };
    })
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}

export async function saveActivityAttendance(
  activityId: string,
  date: Date,
  markedById: string,
  records: SaveAttendanceRecordInput[]
): Promise<void> {
  await prisma.$transaction(
    records.map((r) =>
      prisma.activityAttendance.upsert({
        where: { activityId_studentId_date: { activityId, studentId: r.studentId, date } },
        create: {
          activityId,
          studentId: r.studentId,
          date,
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          markedById,
        },
        update: {
          status: r.status,
          checkInTime: r.checkInTime,
          checkOutTime: r.checkOutTime,
          markedById,
        },
      })
    )
  );
}

export async function clearActivityAttendance(activityId: string, date: Date, studentIds: string[]): Promise<void> {
  await prisma.activityAttendance.deleteMany({ where: { activityId, date, studentId: { in: studentIds } } });
}

export interface TutoringRosterEntry {
  bookingId: string;
  studentId: string;
  studentName: string;
  isMakeup: boolean;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  quotaLabel: string;
}

export async function getTutoringRoster(windowId: string, date: Date): Promise<TutoringRosterEntry[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { windowId, date, status: 'BOOKED' },
    select: {
      id: true,
      kind: true,
      enrollment: { select: { id: true, studentId: true, student: { select: NAME_SELECT } } },
      attendance: true,
    },
  });
  const monthKey = taipeiDateKey(date);
  const rows = await Promise.all(
    bookings.map(async (b) => {
      const { locked, quota } = await getMonthlyQuotaStatus(b.enrollment.id, monthKey);
      return {
        bookingId: b.id,
        studentId: b.enrollment.studentId,
        studentName: b.enrollment.student.user.name,
        isMakeup: b.kind === 'MAKEUP',
        status: (b.attendance?.status as AttendanceStatusValue) ?? null,
        checkInTime: b.attendance?.checkInTime ?? null,
        checkOutTime: b.attendance?.checkOutTime ?? null,
        quotaLabel: `本月已計次 ${locked}／${quota} 堂`,
      };
    })
  );
  return rows.sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}

export interface SaveTutoringAttendanceInput {
  bookingId: string;
  status: AttendanceStatusValue;
  checkInTime?: string | null;
  checkOutTime?: string | null;
}

export async function saveTutoringAttendance(markedById: string, records: SaveTutoringAttendanceInput[]): Promise<void> {
  await prisma.$transaction(
    records.map((r) =>
      prisma.tutoringAttendance.upsert({
        where: { bookingId: r.bookingId },
        create: { bookingId: r.bookingId, status: r.status, checkInTime: r.checkInTime, checkOutTime: r.checkOutTime, markedById },
        update: { status: r.status, checkInTime: r.checkInTime, checkOutTime: r.checkOutTime, markedById },
      })
    )
  );
}

export async function clearTutoringAttendance(bookingIds: string[]): Promise<void> {
  if (bookingIds.length === 0) return;
  await prisma.tutoringAttendance.deleteMany({ where: { bookingId: { in: bookingIds } } });
}

export type AttendanceSessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY' | 'TUTORING';

export interface AttendanceSessionSummary {
  type: AttendanceSessionType;
  id: string;
  title: string;
  timeLabel: string;
  markedCount: number;
  totalCount: number;
}

export async function listAttendanceSessionsForDate(
  date: Date,
  teacherId: string | null
): Promise<AttendanceSessionSummary[]> {
  const weekday = date.getUTCDay();
  // GoHallSession dates should be UTC midnight, but legacy rows created
  // from a GMT+8 browser carry a 16:00Z time-of-day. Match by UTC calendar
  // day so those rows appear on the same day the rest of the app displays.
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // 代課老師當天被指派的班級也要能點名，不只是原班導師。
  const substituteClassIds = teacherId
    ? (
        await prisma.substituteRequest.findMany({
          where: { substituteTeacherId: teacherId, date, status: 'ASSIGNED' },
          select: { classId: true },
        })
      ).map((r) => r.classId)
    : [];

  const [classes, oneOnOnes, goHallSessions, activities, tutoringWindows] = await Promise.all([
    prisma.class.findMany({
      where: {
        weekday,
        active: true,
        ...(teacherId ? { OR: [{ teacherId }, { id: { in: substituteClassIds } }] } : {}),
      },
      select: { id: true, name: true, startTime: true, endTime: true, teacherId: true, _count: { select: { enrollments: true } } },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'ONE_ON_ONE', status: 'APPROVED', slotDate: date, ...(teacherId ? { teacherId } : {}) },
      select: {
        id: true,
        slotStartTime: true,
        slotEndTime: true,
        leaveRequest: { select: { student: { select: NAME_SELECT } } },
      },
    }),
    prisma.goHallSession.findMany({
      where: { date: { gte: dayStart, lt: nextDayStart }, ...(teacherId ? { teacherId } : {}) },
      select: { id: true, startTime: true, endTime: true, _count: { select: { registrations: true } } },
    }),
    prisma.activity.findMany({
      where: { startDate: { lte: date }, endDate: { gte: date }, ...(teacherId ? { teachers: { some: { teacherId } } } : {}) },
      select: { id: true, title: true, _count: { select: { registrations: true } } },
    }),
    prisma.tutoringWindow.findMany({
      // 第二老師（換班）跟主老師一樣要在自己的點名清單看到這個時段
      where: { weekday, active: true, ...(teacherId ? { OR: [{ teacherId }, { teacherId2: teacherId }] } : {}) },
      select: { id: true, startTime: true, endTime: true, program: { select: { name: true } } },
    }),
  ]);

  const classRows: AttendanceSessionSummary[] = await Promise.all(
    classes.map(async (c) => {
      const [markedCount, insertionCount] = await Promise.all([
        prisma.classAttendance.count({ where: { classId: c.id, date } }),
        prisma.makeupRequest.count({
          where: { type: 'INSERTION', status: 'APPROVED', targetClassId: c.id, targetDate: date },
        }),
      ]);
      const isSubstituting = teacherId !== null && c.teacherId !== teacherId && substituteClassIds.includes(c.id);
      return {
        type: 'CLASS' as const,
        id: c.id,
        title: isSubstituting ? `${c.name}（代課）` : c.name,
        timeLabel: `${c.startTime}-${c.endTime}`,
        markedCount,
        totalCount: c._count.enrollments + insertionCount,
      };
    })
  );

  const oneOnOneRows: AttendanceSessionSummary[] = await Promise.all(
    oneOnOnes.map(async (o) => ({
      type: 'ONE_ON_ONE' as const,
      id: o.id,
      title: `${o.leaveRequest.student.user.name}（一對一）`,
      timeLabel: `${o.slotStartTime}-${o.slotEndTime}`,
      markedCount: (await prisma.oneOnOneAttendance.count({ where: { makeupRequestId: o.id } })) > 0 ? 1 : 0,
      totalCount: 1,
    }))
  );

  const goHallRows: AttendanceSessionSummary[] = await Promise.all(
    goHallSessions.map(async (s) => ({
      type: 'GO_HALL' as const,
      id: s.id,
      title: '弈廳',
      timeLabel: `${s.startTime}-${s.endTime}`,
      markedCount: await prisma.goHallAttendance.count({ where: { sessionId: s.id } }),
      totalCount: s._count.registrations,
    }))
  );

  const activityRows: AttendanceSessionSummary[] = await Promise.all(
    activities.map(async (a) => ({
      type: 'ACTIVITY' as const,
      id: a.id,
      title: a.title,
      timeLabel: '',
      markedCount: await prisma.activityAttendance.count({ where: { activityId: a.id, date } }),
      totalCount: a._count.registrations,
    }))
  );

  const openTutoringWindows = [];
  for (const w of tutoringWindows) {
    const closed = await prisma.tutoringWindowClosure.findUnique({ where: { windowId_date: { windowId: w.id, date: dayStart } } });
    if (!closed) openTutoringWindows.push(w);
  }
  const tutoringRows: AttendanceSessionSummary[] = await Promise.all(
    openTutoringWindows.map(async (w) => ({
      type: 'TUTORING' as const,
      id: w.id,
      title: w.program.name,
      timeLabel: `${w.startTime}-${w.endTime}`,
      markedCount: await prisma.tutoringAttendance.count({ where: { booking: { windowId: w.id, date: dayStart } } }),
      totalCount: await prisma.tutoringBooking.count({ where: { windowId: w.id, date: dayStart, status: 'BOOKED' } }),
    }))
  );

  return [...classRows, ...oneOnOneRows, ...goHallRows, ...activityRows, ...tutoringRows];
}

export interface MyAttendanceRow {
  id: string;
  type: AttendanceSessionType;
  date: Date;
  title: string;
  status: AttendanceStatusValue;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function listMyAttendance(studentId: string): Promise<MyAttendanceRow[]> {
  const [classRows, oneOnOneRows, goHallRows, activityRows, tutoringRows] = await Promise.all([
    prisma.classAttendance.findMany({
      where: { studentId },
      select: { id: true, date: true, status: true, checkInTime: true, checkOutTime: true, class: { select: { name: true } } },
    }),
    prisma.oneOnOneAttendance.findMany({
      where: { makeupRequest: { type: 'ONE_ON_ONE', leaveRequest: { studentId } } },
      select: {
        id: true,
        status: true,
        checkInTime: true,
        checkOutTime: true,
        makeupRequest: { select: { slotDate: true, teacher: { select: { user: { select: { name: true } } } } } },
      },
    }),
    prisma.goHallAttendance.findMany({
      where: { studentId },
      select: { id: true, status: true, checkInTime: true, checkOutTime: true, session: { select: { date: true } } },
    }),
    prisma.activityAttendance.findMany({
      where: { studentId },
      select: { id: true, date: true, status: true, checkInTime: true, checkOutTime: true, activity: { select: { title: true } } },
    }),
    prisma.tutoringAttendance.findMany({
      where: { booking: { enrollment: { studentId } } },
      select: {
        id: true,
        status: true,
        checkInTime: true,
        checkOutTime: true,
        booking: { select: { date: true, window: { select: { program: { select: { name: true } } } } } },
      },
    }),
  ]);

  const rows: MyAttendanceRow[] = [
    ...classRows.map((r) => ({
      id: `class-${r.id}`,
      type: 'CLASS' as const,
      date: r.date,
      title: r.class.name,
      status: r.status as AttendanceStatusValue,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
    })),
    ...oneOnOneRows.map((r) => ({
      id: `one-on-one-${r.id}`,
      type: 'ONE_ON_ONE' as const,
      date: r.makeupRequest.slotDate as Date,
      title: `${r.makeupRequest.teacher?.user.name ?? ''}（一對一）`,
      status: r.status as AttendanceStatusValue,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
    })),
    ...goHallRows.map((r) => ({
      id: `go-hall-${r.id}`,
      type: 'GO_HALL' as const,
      date: r.session.date,
      title: '弈廳',
      status: r.status as AttendanceStatusValue,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
    })),
    ...activityRows.map((r) => ({
      id: `activity-${r.id}`,
      type: 'ACTIVITY' as const,
      date: r.date,
      title: r.activity.title,
      status: r.status as AttendanceStatusValue,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
    })),
    ...tutoringRows.map((r) => ({
      id: `tutoring-${r.id}`,
      type: 'TUTORING' as const,
      date: r.booking.date,
      title: r.booking.window.program.name,
      status: r.status as AttendanceStatusValue,
      checkInTime: r.checkInTime,
      checkOutTime: r.checkOutTime,
    })),
  ];

  return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export interface AttendanceStatsResult {
  counts: Record<AttendanceStatusValue, number>;
}

export async function getAttendanceStats(filter: {
  studentId?: string;
  classId?: string;
  from: Date;
  to: Date;
}): Promise<AttendanceStatsResult> {
  const rows = await prisma.classAttendance.findMany({
    where: {
      date: { gte: filter.from, lte: filter.to },
      ...(filter.studentId ? { studentId: filter.studentId } : {}),
      ...(filter.classId ? { classId: filter.classId } : {}),
    },
    select: { status: true },
  });
  const counts: Record<AttendanceStatusValue, number> = { PRESENT: 0, LATE: 0, LEFT_EARLY: 0, ON_LEAVE: 0, ABSENT: 0, NOT_REGISTERED: 0 };
  for (const r of rows) counts[r.status as AttendanceStatusValue]++;
  return { counts };
}

export interface CheckInCandidateOption {
  key: string;
  title: string;
  timeLabel: string;
  teacherName: string | null;
  pendingAction: 'CHECK_IN' | 'CHECK_OUT';
}

export interface CheckInResult {
  result: 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CHOOSE_SESSION';
  studentName?: string;
  sessionTitle?: string;
  time?: string;
  candidates?: CheckInCandidateOption[];
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

interface CheckInCandidate {
  key: string;
  title: string;
  timeLabel: string;
  teacherName: string | null;
  startMinutes: number;
  checkInTime: string | null;
  checkOutTime: string | null;
  classId?: string;
  goHallSessionId?: string;
  apply: () => Promise<'CHECKED_IN' | 'CHECKED_OUT'>;
}

async function applyClassAttendance(input: {
  classId: string;
  studentId: string;
  date: Date;
  timeStr: string;
  markedById: string;
  makeupRequestId?: string;
}): Promise<'CHECKED_IN' | 'CHECKED_OUT'> {
  const where = input.makeupRequestId
    ? { makeupRequestId: input.makeupRequestId }
    : { classId_studentId_date: { classId: input.classId, studentId: input.studentId, date: input.date } };
  const existing = await prisma.classAttendance.findUnique({ where });
  if (!existing || !existing.checkInTime) {
    await prisma.classAttendance.upsert({
      where,
      create: {
        classId: input.classId,
        studentId: input.studentId,
        date: input.date,
        status: 'PRESENT',
        checkInTime: input.timeStr,
        makeupRequestId: input.makeupRequestId,
        markedById: input.markedById,
      },
      update: { status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById },
    });
    return 'CHECKED_IN';
  }
  await prisma.classAttendance.update({ where, data: { checkOutTime: input.timeStr, markedById: input.markedById } });
  return 'CHECKED_OUT';
}

async function applyOneOnOneAttendance(input: {
  makeupRequestId: string;
  timeStr: string;
  markedById: string;
}): Promise<'CHECKED_IN' | 'CHECKED_OUT'> {
  const where = { makeupRequestId: input.makeupRequestId };
  const existing = await prisma.oneOnOneAttendance.findUnique({ where });
  if (!existing || !existing.checkInTime) {
    await prisma.oneOnOneAttendance.upsert({
      where,
      create: { makeupRequestId: input.makeupRequestId, status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById },
      update: { status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById },
    });
    return 'CHECKED_IN';
  }
  await prisma.oneOnOneAttendance.update({ where, data: { checkOutTime: input.timeStr, markedById: input.markedById } });
  return 'CHECKED_OUT';
}

async function applyTutoringAttendance(input: { bookingId: string; timeStr: string; markedById: string }): Promise<'CHECKED_IN' | 'CHECKED_OUT'> {
  const where = { bookingId: input.bookingId };
  const existing = await prisma.tutoringAttendance.findUnique({ where });
  if (!existing || !existing.checkInTime) {
    await prisma.tutoringAttendance.upsert({
      where,
      create: { bookingId: input.bookingId, status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById },
      update: { status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById },
    });
    return 'CHECKED_IN';
  }
  await prisma.tutoringAttendance.update({ where, data: { checkOutTime: input.timeStr, markedById: input.markedById } });
  return 'CHECKED_OUT';
}

async function applyGoHallAttendance(input: {
  sessionId: string;
  studentId: string;
  timeStr: string;
  markedById: string;
}): Promise<'CHECKED_IN' | 'CHECKED_OUT'> {
  const where = { sessionId_studentId: { sessionId: input.sessionId, studentId: input.studentId } };
  const existing = await prisma.goHallAttendance.findUnique({ where });
  if (!existing || !existing.checkInTime) {
    await runSerializableWithRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const current = await tx.goHallAttendance.findUnique({ where, select: { qualification: true } });
          // 已戳記過資格（冪等重試）就沿用，避免重複扣堂票。
          let qualification: GoHallQualificationValue | null = current?.qualification ?? null;
          if (qualification === null) {
            const session = await tx.goHallSession.findUniqueOrThrow({ where: { id: input.sessionId }, select: { date: true } });
            qualification = await determineQualification(tx, input.studentId, session.date);
            if (qualification === 'TICKET') {
              await tx.goHallTicketTransaction.create({
                data: { studentId: input.studentId, amount: -1, kind: 'ATTEND', sessionId: input.sessionId },
              });
            }
          }
          await tx.goHallAttendance.upsert({
            where,
            create: {
              sessionId: input.sessionId,
              studentId: input.studentId,
              status: 'PRESENT',
              checkInTime: input.timeStr,
              markedById: input.markedById,
              qualification,
            },
            update: { status: 'PRESENT', checkInTime: input.timeStr, markedById: input.markedById, qualification },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
    return 'CHECKED_IN';
  }
  await prisma.goHallAttendance.update({ where, data: { checkOutTime: input.timeStr, markedById: input.markedById } });
  return 'CHECKED_OUT';
}

async function getTodayCandidates(
  studentId: string,
  date: Date,
  timeStr: string,
  markedById: string
): Promise<CheckInCandidate[]> {
  const weekday = date.getUTCDay();
  // GoHallSession dates should be UTC midnight, but legacy rows created from
  // a GMT+8 browser carry a 16:00Z time-of-day — match by UTC calendar day
  // (see listAttendanceSessionsForDate) so those rows are still found.
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const nextDayStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const [enrollments, insertions, oneOnOnes, leaveRequests, tutoringBookings, goHallRegistrations] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { studentId, class: { weekday } },
      select: {
        class: {
          select: { id: true, name: true, startTime: true, endTime: true, teacher: { select: { user: { select: { name: true } } } } },
        },
      },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'INSERTION', status: 'APPROVED', targetDate: date, leaveRequest: { studentId } },
      select: {
        id: true,
        targetClass: {
          select: { id: true, name: true, startTime: true, endTime: true, teacher: { select: { user: { select: { name: true } } } } },
        },
      },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'ONE_ON_ONE', status: 'APPROVED', slotDate: date, leaveRequest: { studentId } },
      select: { id: true, slotStartTime: true, slotEndTime: true, teacher: { select: { user: { select: { name: true } } } } },
    }),
    prisma.leaveRequest.findMany({ where: { studentId, date }, select: { classId: true } }),
    prisma.tutoringBooking.findMany({
      where: { date, status: 'BOOKED', enrollment: { studentId } },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        window: {
          select: {
            teacher: { select: { user: { select: { name: true } } } },
            teacher2: { select: { user: { select: { name: true } } } },
            program: { select: { name: true } },
          },
        },
      },
    }),
    prisma.goHallRegistration.findMany({
      where: { studentId, session: { date: { gte: dayStart, lt: nextDayStart } } },
      select: {
        sessionId: true,
        session: { select: { startTime: true, endTime: true, teacher: { select: { user: { select: { name: true } } } } } },
      },
    }),
  ]);

  const excludedClassIds = new Set(leaveRequests.map((l) => l.classId));
  const candidates: CheckInCandidate[] = [];

  for (const e of enrollments) {
    const cls = e.class;
    if (excludedClassIds.has(cls.id)) continue;
    const existing = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId, date } },
    });
    candidates.push({
      key: `class:${cls.id}`,
      title: cls.name,
      timeLabel: `${cls.startTime}-${cls.endTime}`,
      teacherName: cls.teacher.user.name,
      startMinutes: toMinutes(cls.startTime),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      classId: cls.id,
      apply: () => applyClassAttendance({ classId: cls.id, studentId, date, timeStr, markedById }),
    });
  }

  const enrolledClassIds = new Set(enrollments.map((e) => e.class.id));
  for (const ins of insertions) {
    if (!ins.targetClass || enrolledClassIds.has(ins.targetClass.id) || excludedClassIds.has(ins.targetClass.id)) continue;
    const cls = ins.targetClass;
    const existing = await prisma.classAttendance.findUnique({ where: { makeupRequestId: ins.id } });
    candidates.push({
      key: `insertion:${ins.id}`,
      title: cls.name,
      timeLabel: `${cls.startTime}-${cls.endTime}`,
      teacherName: cls.teacher.user.name,
      startMinutes: toMinutes(cls.startTime),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      classId: cls.id,
      apply: () =>
        applyClassAttendance({ classId: cls.id, studentId, date, timeStr, markedById, makeupRequestId: ins.id }),
    });
  }

  for (const o of oneOnOnes) {
    const existing = await prisma.oneOnOneAttendance.findUnique({ where: { makeupRequestId: o.id } });
    candidates.push({
      key: `oneonone:${o.id}`,
      title: '一對一補課',
      timeLabel: `${o.slotStartTime}-${o.slotEndTime}`,
      teacherName: o.teacher?.user.name ?? null,
      startMinutes: toMinutes(o.slotStartTime!),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () => applyOneOnOneAttendance({ makeupRequestId: o.id, timeStr, markedById }),
    });
  }

  for (const tb of tutoringBookings) {
    const existing = await prisma.tutoringAttendance.findUnique({ where: { bookingId: tb.id } });
    candidates.push({
      key: `tutoring:${tb.id}`,
      title: tb.window.program.name,
      timeLabel: `${tb.startTime}-${tb.endTime}`,
      teacherName: [tb.window.teacher.user.name, tb.window.teacher2?.user.name].filter(Boolean).join('／'),
      startMinutes: toMinutes(tb.startTime),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () => applyTutoringAttendance({ bookingId: tb.id, timeStr, markedById }),
    });
  }

  for (const reg of goHallRegistrations) {
    const existing = await prisma.goHallAttendance.findUnique({
      where: { sessionId_studentId: { sessionId: reg.sessionId, studentId } },
    });
    candidates.push({
      key: `gohall:${reg.sessionId}`,
      title: '弈廳',
      timeLabel: `${reg.session.startTime}-${reg.session.endTime}`,
      teacherName: reg.session.teacher.user.name,
      startMinutes: toMinutes(reg.session.startTime),
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      goHallSessionId: reg.sessionId,
      apply: () => applyGoHallAttendance({ sessionId: reg.sessionId, studentId, timeStr, markedById }),
    });
  }

  return candidates;
}

function toCandidateOption(c: CheckInCandidate): CheckInCandidateOption {
  return {
    key: c.key,
    title: c.title,
    timeLabel: c.timeLabel,
    teacherName: c.teacherName,
    pendingAction: c.checkInTime ? 'CHECK_OUT' : 'CHECK_IN',
  };
}

async function maybeNotifyLowQuota(
  student: { id: string; user: { id: string; name: string } },
  classId: string
): Promise<void> {
  if (!(await hasPushSubscription(student.user.id))) return;

  const enrollment = await prisma.classEnrollment.findUnique({ where: { studentId_classId: { studentId: student.id, classId } } });
  if (!enrollment || enrollment.lowQuotaNotifiedAt !== null) return;

  const { remaining } = await getClassEnrollmentQuota(classId, student.id);
  if (remaining === null || remaining > LOW_CLASS_QUOTA_THRESHOLD) return;

  await prisma.classEnrollment.update({ where: { id: enrollment.id }, data: { lowQuotaNotifiedAt: new Date() } });
  await pushToUser(student.user.id, {
    title: '堂數提醒',
    body: `${student.user.name} 目前剩餘堂數：${remaining} 堂，請盡快與行政人員聯繫續費`,
    url: '/student',
  });
}

// 弈廳堂票低堂數提醒：扣堂後剩餘 ≤ LOW_TICKET_THRESHOLD 且未提醒過才發，
// 登記購買／正向調整時旗標歸零（goHallTicketService）。失敗不影響點名。
async function maybeNotifyLowGoHallTickets(studentId: string): Promise<void> {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, goHallLowQuotaNotifiedAt: true, user: { select: { id: true, name: true } } },
    });
    if (!student || student.goHallLowQuotaNotifiedAt !== null) return;
    if (!(await hasPushSubscription(student.user.id))) return;
    const remaining = await getTicketBalance(studentId);
    if (remaining > LOW_TICKET_THRESHOLD) return;
    await prisma.student.update({ where: { id: studentId }, data: { goHallLowQuotaNotifiedAt: new Date() } });
    await pushToUser(student.user.id, {
      title: '弈廳堂票提醒',
      body: `${student.user.name} 弈廳堂票剩餘：${remaining} 堂，請盡快與行政人員聯繫續購`,
      url: '/student',
    });
  } catch (err) {
    console.error('maybeNotifyLowGoHallTickets failed', err);
  }
}

async function notifyAttendanceResult(
  student: { id: string; user: { id: string; name: string } },
  match: CheckInCandidate,
  action: 'CHECKED_IN' | 'CHECKED_OUT',
  timeStr: string
): Promise<void> {
  try {
    const verb = action === 'CHECKED_IN' ? '簽到' : '簽退';
    await pushToUser(student.user.id, {
      title: `${verb}完成`,
      body: `${student.user.name} 已於 ${timeStr} 完成${verb}（${match.title}）`,
      url: '/student',
    });
    if (action === 'CHECKED_IN' && match.classId) {
      await maybeNotifyLowQuota(student, match.classId);
    }
    if (action === 'CHECKED_IN' && match.goHallSessionId) {
      await maybeNotifyLowGoHallTickets(student.id);
    }
  } catch (err) {
    console.error('notifyAttendanceResult failed', err);
  }
}

export async function checkInByStudentNumber(
  code: string,
  dateStr: string,
  timeStr: string,
  markedById: string
): Promise<CheckInResult> {
  const student = await prisma.student.findUnique({
    where: { studentNumber: code },
    select: { id: true, user: { select: { id: true, name: true } } },
  });
  if (!student) return { result: 'NOT_FOUND' };

  const date = new Date(dateStr);
  const candidates = await getTodayCandidates(student.id, date, timeStr, markedById);
  const incomplete = candidates.filter((c) => !(c.checkInTime && c.checkOutTime));
  // 今天的課都已簽到＋簽退時，再掃視為重新簽退（覆蓋簽退時間）；
  // 只有今天完全沒課才回 NO_SESSION
  const eligible = incomplete.length > 0 ? incomplete : candidates;

  if (eligible.length === 0) return { result: 'NO_SESSION' };

  if (eligible.length === 1) {
    const match = eligible[0];
    const action = await match.apply();
    await notifyAttendanceResult(student, match, action, timeStr);
    return { result: action, studentName: student.user.name, sessionTitle: match.title, time: timeStr };
  }

  eligible.sort((a, b) => a.startMinutes - b.startMinutes);
  return {
    result: 'CHOOSE_SESSION',
    studentName: student.user.name,
    candidates: eligible.map(toCandidateOption),
  };
}

export async function resolveCheckIn(
  code: string,
  dateStr: string,
  timeStr: string,
  markedById: string,
  key: string
): Promise<CheckInResult> {
  const student = await prisma.student.findUnique({
    where: { studentNumber: code },
    select: { id: true, user: { select: { id: true, name: true } } },
  });
  if (!student) return { result: 'NOT_FOUND' };

  const date = new Date(dateStr);
  const candidates = await getTodayCandidates(student.id, date, timeStr, markedById);
  // 已完成的課也可以被選來重新簽退（覆蓋簽退時間），所以直接在全部候選裡找
  const match = candidates.find((c) => c.key === key);
  if (!match) return { result: 'NO_SESSION' };

  const action = await match.apply();
  await notifyAttendanceResult(student, match, action, timeStr);
  return { result: action, studentName: student.user.name, sessionTitle: match.title, time: timeStr };
}

export interface ClassAttendanceOverviewMakeup {
  status: 'PENDING_ADMIN' | 'APPROVED' | 'REJECTED';
  type: 'INSERTION' | 'ONE_ON_ONE';
  label: string;
}

export interface ClassAttendanceOverviewRecord {
  date: Date;
  status: AttendanceStatusValue;
  checkInTime: string | null;
  checkOutTime: string | null;
  makeup: ClassAttendanceOverviewMakeup | null;
}

export interface ClassAttendanceOverviewStudent {
  studentId: string;
  studentName: string;
  records: ClassAttendanceOverviewRecord[];
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// 整班出缺勤總表（依學生分組，含補課狀態）：合併 ClassAttendance（點名紀錄）
// 與 LeaveRequest（請假，本身不會自動產生點名紀錄，是分開的表）＋其
// MakeupRequest。只列有紀錄的日期，不枚舉理論上課日。曾經在班但已退班的
// 學生，只要還有歷史點名/請假紀錄，一樣列出（不因為 ClassEnrollment 被刪
// 就把歷史藏起來）。未來日期（例如續報時預先標記的 NOT_REGISTERED）不列
// 入，避免它們排在新到舊排序的最上方、蓋過真正的歷史紀錄。
export async function getClassAttendanceOverview(classId: string): Promise<ClassAttendanceOverviewStudent[]> {
  const todayKey = taipeiDateKey(new Date());
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const todayUtc = new Date(Date.UTC(ty, tm - 1, td));

  const [enrollments, attendances, leaves] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { classId },
      select: { studentId: true, student: { select: NAME_SELECT } },
      orderBy: { student: { user: { name: 'asc' } } },
    }),
    prisma.classAttendance.findMany({
      where: { classId, date: { lte: todayUtc } },
      select: {
        studentId: true,
        student: { select: NAME_SELECT },
        date: true,
        status: true,
        checkInTime: true,
        checkOutTime: true,
        makeupRequestId: true,
      },
    }),
    prisma.leaveRequest.findMany({
      where: { classId, date: { lte: todayUtc } },
      select: {
        studentId: true,
        student: { select: NAME_SELECT },
        date: true,
        makeupRequest: {
          select: {
            status: true,
            type: true,
            targetDate: true,
            targetClass: { select: { name: true } },
            teacher: { select: { user: { select: { name: true } } } },
            slotDate: true,
            slotStartTime: true,
            slotEndTime: true,
          },
        },
      },
    }),
  ]);

  const byStudent = new Map<string, { studentName: string; records: Map<string, ClassAttendanceOverviewRecord> }>();
  function bucketFor(studentId: string, studentName: string) {
    let bucket = byStudent.get(studentId);
    if (!bucket) {
      bucket = { studentName, records: new Map() };
      byStudent.set(studentId, bucket);
    }
    return bucket;
  }

  for (const e of enrollments) bucketFor(e.studentId, e.student.user.name);

  for (const l of leaves) {
    const bucket = bucketFor(l.studentId, l.student.user.name);
    let makeup: ClassAttendanceOverviewMakeup | null = null;
    if (l.makeupRequest) {
      const m = l.makeupRequest;
      const label =
        m.type === 'INSERTION'
          ? `補到 ${formatDateWithWeekday(m.targetDate!)} ${m.targetClass?.name ?? ''}`
          : `${m.teacher?.user.name ?? ''} 一對一 ${formatDateWithWeekday(m.slotDate!)} ${m.slotStartTime}-${m.slotEndTime}`;
      makeup = { status: m.status, type: m.type, label };
    }
    bucket.records.set(toDateKey(l.date), { date: l.date, status: 'ON_LEAVE', checkInTime: null, checkOutTime: null, makeup });
  }

  for (const a of attendances) {
    // 插班補課的點名紀錄會寫進目標班級的 ClassAttendance（帶 makeupRequestId），
    // 這些學生不是本班的人，顯示名字加註（插班）區分（同 AttendanceHub 慣例）。
    const studentName = a.makeupRequestId ? `${a.student.user.name}（插班）` : a.student.user.name;
    const bucket = bucketFor(a.studentId, studentName);
    const key = toDateKey(a.date);
    const existing = bucket.records.get(key);
    bucket.records.set(key, {
      date: a.date,
      status: a.status as AttendanceStatusValue,
      checkInTime: a.checkInTime,
      checkOutTime: a.checkOutTime,
      makeup: existing?.makeup ?? null,
    });
  }

  return Array.from(byStudent.entries()).map(([studentId, v]) => ({
    studentId,
    studentName: v.studentName,
    records: Array.from(v.records.values()).sort((a, b) => b.date.getTime() - a.date.getTime()),
  }));
}

export interface TutoringWindowOverviewRecord {
  date: Date;
  attendanceStatus: AttendanceStatusValue | null;
  bookingStatus: 'PENDING_ADMIN' | 'BOOKED' | 'CANCELLED' | 'CANCELLED_LATE' | 'REJECTED';
  checkInTime: string | null;
  checkOutTime: string | null;
  isMakeup: boolean;
}

export interface TutoringWindowOverviewStudent {
  studentId: string;
  studentName: string;
  records: TutoringWindowOverviewRecord[];
}

// 個別輔導時段出缺勤總表（依學生分組）：TutoringBooking 與 TutoringAttendance
// 是 1:1，不用像 getClassAttendanceOverview 那樣合併兩個獨立來源。不排除未來
// 日期——學生提前預約未來場次是真實、有意義的行為，不是預寫的髒資料。沒有
// 任何 booking 的學生不會出現在總表裡（這裡是從 booking 查起，不是從
// TutoringEnrollment 查起）。
export async function getTutoringWindowAttendanceOverview(windowId: string): Promise<TutoringWindowOverviewStudent[]> {
  const bookings = await prisma.tutoringBooking.findMany({
    where: { windowId },
    select: {
      date: true,
      status: true,
      kind: true,
      attendance: { select: { status: true, checkInTime: true, checkOutTime: true } },
      enrollment: { select: { studentId: true, student: { select: NAME_SELECT } } },
    },
  });

  const byStudent = new Map<string, { studentName: string; records: TutoringWindowOverviewRecord[] }>();
  for (const b of bookings) {
    const studentId = b.enrollment.studentId;
    let bucket = byStudent.get(studentId);
    if (!bucket) {
      bucket = { studentName: b.enrollment.student.user.name, records: [] };
      byStudent.set(studentId, bucket);
    }
    bucket.records.push({
      date: b.date,
      attendanceStatus: (b.attendance?.status as AttendanceStatusValue) ?? null,
      bookingStatus: b.status as TutoringWindowOverviewRecord['bookingStatus'],
      checkInTime: b.attendance?.checkInTime ?? null,
      checkOutTime: b.attendance?.checkOutTime ?? null,
      isMakeup: b.kind === 'MAKEUP',
    });
  }

  return Array.from(byStudent.entries())
    .map(([studentId, v]) => ({
      studentId,
      studentName: v.studentName,
      records: v.records.sort((a, b) => b.date.getTime() - a.date.getTime()),
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'zh-TW'));
}

export interface TutoringEnrollmentAttendanceRecord extends TutoringWindowOverviewRecord {
  id: string;
}

export interface TutoringEnrollmentAttendanceResult {
  studentName: string;
  programName: string;
  records: TutoringEnrollmentAttendanceRecord[];
}

// 單一報名（學生 × 課程）的完整出缺勤：全部 booking（含取消／逾時取消）依日期
// 新→舊。record 形狀比照 getTutoringWindowAttendanceOverview，多帶 booking id
// 當列 key（同日可能有「取消後重約」兩筆，日期不唯一）。
export async function getTutoringEnrollmentAttendance(enrollmentId: string): Promise<TutoringEnrollmentAttendanceResult> {
  const enrollment = await prisma.tutoringEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { student: { select: NAME_SELECT }, program: { select: { name: true } } },
  });
  if (!enrollment) throw new Error('ENROLLMENT_NOT_FOUND');

  const bookings = await prisma.tutoringBooking.findMany({
    where: { enrollmentId },
    select: {
      id: true,
      date: true,
      status: true,
      kind: true,
      attendance: { select: { status: true, checkInTime: true, checkOutTime: true } },
    },
    orderBy: { date: 'desc' },
  });

  return {
    studentName: enrollment.student.user.name,
    programName: enrollment.program.name,
    records: bookings.map((b) => ({
      id: b.id,
      date: b.date,
      attendanceStatus: (b.attendance?.status as AttendanceStatusValue) ?? null,
      bookingStatus: b.status as TutoringWindowOverviewRecord['bookingStatus'],
      checkInTime: b.attendance?.checkInTime ?? null,
      checkOutTime: b.attendance?.checkOutTime ?? null,
      isMakeup: b.kind === 'MAKEUP',
    })),
  };
}
