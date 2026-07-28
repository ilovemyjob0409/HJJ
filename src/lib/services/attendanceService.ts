import { prisma } from '@/lib/db';

export type AttendanceStatusValue = 'PRESENT' | 'LATE' | 'LEFT_EARLY' | 'ON_LEAVE' | 'ABSENT';

const NAME_SELECT = { user: { select: { name: true } } } as const;

export interface SaveAttendanceRecordInput {
  studentId: string;
  status: AttendanceStatusValue;
  checkInTime?: string;
  checkOutTime?: string;
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

export interface ClassAttendanceQuota {
  totalSessions: number | null;
  usedSessions: number;
  remaining: number | null;
}

export async function getClassEnrollmentQuota(classId: string, studentId: string): Promise<ClassAttendanceQuota> {
  const [enrollment, usedSessions] = await Promise.all([
    prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId, classId } } }),
    prisma.classAttendance.count({ where: { classId, studentId, status: { not: 'ON_LEAVE' } } }),
  ]);
  const { totalSessions } = enrollment;
  return {
    totalSessions,
    usedSessions,
    remaining: totalSessions === null ? null : totalSessions - usedSessions,
  };
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

export interface GoHallRosterEntry {
  studentId: string;
  studentName: string;
  status: AttendanceStatusValue | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export async function getGoHallRoster(sessionId: string): Promise<GoHallRosterEntry[]> {
  const [registrations, existing] = await Promise.all([
    prisma.goHallRegistration.findMany({
      where: { sessionId },
      select: { studentId: true, student: { select: NAME_SELECT } },
    }),
    prisma.goHallAttendance.findMany({ where: { sessionId } }),
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

export async function saveGoHallAttendance(
  sessionId: string,
  markedById: string,
  records: SaveAttendanceRecordInput[]
): Promise<void> {
  await prisma.$transaction(
    records.map((r) =>
      prisma.goHallAttendance.upsert({
        where: { sessionId_studentId: { sessionId, studentId: r.studentId } },
        create: {
          sessionId,
          studentId: r.studentId,
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
  const weekday = date.getDay();

  const [classes, oneOnOnes, goHallSessions, activities] = await Promise.all([
    prisma.class.findMany({
      where: { weekday, ...(teacherId ? { teacherId } : {}) },
      select: { id: true, name: true, startTime: true, endTime: true, _count: { select: { enrollments: true } } },
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
      where: { date, ...(teacherId ? { teacherId } : {}) },
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
      return {
        type: 'CLASS' as const,
        id: c.id,
        title: c.name,
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
  const counts: Record<AttendanceStatusValue, number> = { PRESENT: 0, LATE: 0, LEFT_EARLY: 0, ON_LEAVE: 0, ABSENT: 0 };
  for (const r of rows) counts[r.status as AttendanceStatusValue]++;
  return { counts };
}
