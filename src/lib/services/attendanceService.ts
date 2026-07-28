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

export interface CheckInResult {
  result: 'NOT_FOUND' | 'NO_SESSION' | 'CHECKED_IN' | 'CHECKED_OUT';
  studentName?: string;
  sessionTitle?: string;
  time?: string;
}

const CHECKIN_WINDOW_MINUTES = 60;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

interface CheckInCandidate {
  diffMinutes: number;
  title: string;
  checkInTime: string | null;
  checkOutTime: string | null;
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

export async function checkInByStudentNumber(
  code: string,
  dateStr: string,
  timeStr: string,
  markedById: string
): Promise<CheckInResult> {
  const student = await prisma.student.findUnique({
    where: { studentNumber: code },
    select: { id: true, user: { select: { name: true } } },
  });
  if (!student) return { result: 'NOT_FOUND' };

  const date = new Date(dateStr);
  const weekday = date.getDay();
  const nowMinutes = toMinutes(timeStr);

  const [enrollments, insertions, oneOnOnes, leaveRequests] = await Promise.all([
    prisma.classEnrollment.findMany({
      where: { studentId: student.id, class: { weekday } },
      select: { class: { select: { id: true, name: true, startTime: true } } },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'INSERTION', status: 'APPROVED', targetDate: date, leaveRequest: { studentId: student.id } },
      select: { id: true, targetClass: { select: { id: true, name: true, startTime: true } } },
    }),
    prisma.makeupRequest.findMany({
      where: { type: 'ONE_ON_ONE', status: 'APPROVED', slotDate: date, leaveRequest: { studentId: student.id } },
      select: { id: true, slotStartTime: true },
    }),
    prisma.leaveRequest.findMany({
      where: { studentId: student.id, date },
      select: { classId: true },
    }),
  ]);

  const excludedClassIds = new Set(leaveRequests.map((l) => l.classId));

  const candidates: CheckInCandidate[] = [];

  for (const e of enrollments) {
    const cls = e.class;
    if (excludedClassIds.has(cls.id)) continue;
    const existing = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date } },
    });
    candidates.push({
      diffMinutes: Math.abs(nowMinutes - toMinutes(cls.startTime)),
      title: cls.name,
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () => applyClassAttendance({ classId: cls.id, studentId: student.id, date, timeStr, markedById }),
    });
  }

  const enrolledClassIds = new Set(enrollments.map((e) => e.class.id));
  for (const ins of insertions) {
    if (!ins.targetClass || enrolledClassIds.has(ins.targetClass.id) || excludedClassIds.has(ins.targetClass.id)) continue;
    const cls = ins.targetClass;
    const existing = await prisma.classAttendance.findUnique({ where: { makeupRequestId: ins.id } });
    candidates.push({
      diffMinutes: Math.abs(nowMinutes - toMinutes(cls.startTime)),
      title: cls.name,
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () =>
        applyClassAttendance({ classId: cls.id, studentId: student.id, date, timeStr, markedById, makeupRequestId: ins.id }),
    });
  }

  for (const o of oneOnOnes) {
    const existing = await prisma.oneOnOneAttendance.findUnique({ where: { makeupRequestId: o.id } });
    candidates.push({
      diffMinutes: Math.abs(nowMinutes - toMinutes(o.slotStartTime!)),
      title: '一對一補課',
      checkInTime: existing?.checkInTime ?? null,
      checkOutTime: existing?.checkOutTime ?? null,
      apply: () => applyOneOnOneAttendance({ makeupRequestId: o.id, timeStr, markedById }),
    });
  }

  // Three priority tiers, checked in order — the first non-empty tier wins:
  //
  // 1. Open (checked in, not yet out): always wins, no time window — a
  //    class's natural check-out can be well over 60 minutes past its start.
  // 2. Not yet checked in, within the window: a genuinely new check-in.
  //    This tier is what lets a student check into a SECOND session later
  //    the same day after finishing their first — without it, tier 3 below
  //    would grab the first (already-completed) session on every later scan
  //    and the student could never check into anything else that day.
  // 3. Already checked in AND out: only reached if nothing is open and
  //    nothing new is in-window — overwrites the check-out time again.
  const openSessions = candidates.filter((c) => c.checkInTime && !c.checkOutTime);
  if (openSessions.length > 0) {
    openSessions.sort((a, b) => a.diffMinutes - b.diffMinutes);
    const match = openSessions[0];
    const action = await match.apply();
    return { result: action, studentName: student.user.name, sessionTitle: match.title, time: timeStr };
  }

  const freshWithinWindow = candidates.filter((c) => !c.checkInTime && c.diffMinutes <= CHECKIN_WINDOW_MINUTES);
  if (freshWithinWindow.length > 0) {
    freshWithinWindow.sort((a, b) => a.diffMinutes - b.diffMinutes);
    const match = freshWithinWindow[0];
    const action = await match.apply();
    return { result: action, studentName: student.user.name, sessionTitle: match.title, time: timeStr };
  }

  const completed = candidates.filter((c) => c.checkInTime && c.checkOutTime);
  if (completed.length > 0) {
    completed.sort((a, b) => a.diffMinutes - b.diffMinutes);
    const match = completed[0];
    const action = await match.apply();
    return { result: action, studentName: student.user.name, sessionTitle: match.title, time: timeStr };
  }

  return { result: 'NO_SESSION' };
}
