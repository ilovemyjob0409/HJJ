import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { pushLineMessage } from './lineService';
import { runSerializableWithRetry } from '@/lib/transaction';
import { determineQualification, getTicketBalance, LOW_TICKET_THRESHOLD, type GoHallQualificationValue } from './goHallTicketService';
import { LOW_CLASS_QUOTA_THRESHOLD } from '@/lib/lowQuota';

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

export type AttendanceSessionType = 'CLASS' | 'ONE_ON_ONE' | 'GO_HALL' | 'ACTIVITY';

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

  const [classes, oneOnOnes, goHallSessions, activities] = await Promise.all([
    prisma.class.findMany({
      where: {
        weekday,
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

  return [...classRows, ...oneOnOneRows, ...goHallRows, ...activityRows];
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
  const [classRows, oneOnOneRows, goHallRows, activityRows] = await Promise.all([
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

async function getTodayCandidates(
  studentId: string,
  date: Date,
  timeStr: string,
  markedById: string
): Promise<CheckInCandidate[]> {
  const weekday = date.getUTCDay();

  const [enrollments, insertions, oneOnOnes, leaveRequests] = await Promise.all([
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
  student: { id: string; lineUserId: string | null; user: { name: string } },
  classId: string
): Promise<void> {
  if (!student.lineUserId) return;

  const enrollment = await prisma.classEnrollment.findUnique({ where: { studentId_classId: { studentId: student.id, classId } } });
  if (!enrollment || enrollment.lowQuotaNotifiedAt !== null) return;

  const { remaining } = await getClassEnrollmentQuota(classId, student.id);
  if (remaining === null || remaining > LOW_CLASS_QUOTA_THRESHOLD) return;

  await prisma.classEnrollment.update({ where: { id: enrollment.id }, data: { lowQuotaNotifiedAt: new Date() } });
  await pushLineMessage(student.lineUserId, `【MUP】${student.user.name} 目前剩餘堂數：${remaining} 堂，請盡快與行政人員聯繫續費`);
}

// 弈廳堂票低堂數提醒：扣堂後剩餘 ≤ LOW_TICKET_THRESHOLD 且未提醒過才發，
// 登記購買／正向調整時旗標歸零（goHallTicketService）。失敗不影響點名。
async function maybeNotifyLowGoHallTickets(studentId: string): Promise<void> {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, lineUserId: true, goHallLowQuotaNotifiedAt: true, user: { select: { name: true } } },
    });
    if (!student?.lineUserId || student.goHallLowQuotaNotifiedAt !== null) return;
    const remaining = await getTicketBalance(studentId);
    if (remaining > LOW_TICKET_THRESHOLD) return;
    await prisma.student.update({ where: { id: studentId }, data: { goHallLowQuotaNotifiedAt: new Date() } });
    await pushLineMessage(student.lineUserId, `【MUP】${student.user.name} 弈廳堂票剩餘：${remaining} 堂，請盡快與行政人員聯繫續購`);
  } catch (err) {
    console.error('maybeNotifyLowGoHallTickets failed', err);
  }
}

async function notifyAttendanceResult(
  student: { id: string; lineUserId: string | null; user: { name: string } },
  match: CheckInCandidate,
  action: 'CHECKED_IN' | 'CHECKED_OUT',
  timeStr: string
): Promise<void> {
  try {
    if (student.lineUserId) {
      const verb = action === 'CHECKED_IN' ? '簽到' : '簽退';
      await pushLineMessage(student.lineUserId, `【MUP】${student.user.name} 已於 ${timeStr} 完成${verb}（${match.title}）`);
    }
    if (action === 'CHECKED_IN' && match.classId) {
      await maybeNotifyLowQuota(student, match.classId);
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
    select: { id: true, lineUserId: true, user: { select: { name: true } } },
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
    select: { id: true, lineUserId: true, user: { select: { name: true } } },
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
