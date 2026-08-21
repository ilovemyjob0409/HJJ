import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createSubstituteRequest, assignSubstituteTeacher } from './substituteRequestService';
import { createStudent } from './studentService';
import { createClass, enrollStudent, addEnrollmentSessions } from './classService';
import { createLeaveRequest } from './leaveRequestService';
import { createInsertionMakeupRequest, decideMakeupRequest, createOneOnOneMakeupRequest } from './makeupRequestService';
import { setTeacherAvailability } from './availabilityService';
import { getClassRoster, saveClassAttendance, clearClassAttendance, getClassEnrollmentQuota, getClassAttendanceLedger, getOneOnOneAttendance, saveOneOnOneAttendance, clearOneOnOneAttendance, getGoHallRoster, saveGoHallAttendance, clearGoHallAttendance, getActivityRoster, saveActivityAttendance, clearActivityAttendance, listAttendanceSessionsForDate, checkInByStudentNumber, resolveCheckIn, listClassQuotaSummaries, getTutoringRoster, saveTutoringAttendance, clearTutoringAttendance, getClassAttendanceOverview, getTutoringWindowAttendanceOverview, getTutoringEnrollmentAttendance } from './attendanceService';
import { createSessions, registerForSession } from './goHallService';
import { createActivity, createCategory, registerForActivity } from './activityService';
import { purchaseTickets as buyGoHallTickets, addSeasonPass as addGoHallSeasonPass, getTicketBalance as goHallBalance } from './goHallTicketService';
import { createProgram, createWindow, createEnrollment } from './tutoringProgramService';
import { createBooking, adminCancelBooking } from './tutoringBookingService';
import { subscribeStudentForTest } from '@/lib/testUtils/pushHelpers';

beforeEach(async () => {
  // Create marker user for attendance marking
  await prisma.user.create({
    data: {
      id: 'marker-1',
      email: 'marker@example.com',
      password: 'x',
      name: 'Marker',
      role: 'TEACHER',
    },
  });
});

async function setupClassWithStudent() {
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
  await enrollStudent(cls.id, student.id);
  return { teacher, student, cls };
}

describe('getClassRoster', () => {
  it('lists enrolled students with no status yet', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04');

    const roster = await getClassRoster(cls.id, date);

    expect(roster).toHaveLength(1);
    expect(roster[0].studentId).toBe(student.id);
    expect(roster[0].studentName).toBe('小明');
    expect(roster[0].makeupRequestId).toBeNull();
    expect(roster[0].onLeave).toBe(false);
    expect(roster[0].status).toBeNull();
  });

  it('marks onLeave when an approved leave request exists for that class and date', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04');
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date, reason: '感冒' });

    const roster = await getClassRoster(cls.id, date);

    expect(roster[0].onLeave).toBe(true);
  });

  it('includes an approved insertion-makeup student from another class, tagged with makeupRequestId', async () => {
    const { teacher, student: homeStudent, cls: homeClass } = await setupClassWithStudent();
    const targetClass = await createClass({ name: '週二進階班', subject: '圍棋', level: '進階', teacherId: teacher.id, weekday: 2, startTime: '16:00', endTime: '18:00' });
    const date = new Date('2026-08-04');
    const leave = await createLeaveRequest({ studentId: homeStudent.id, classId: homeClass.id, date, reason: '調課' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: date });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    const roster = await getClassRoster(targetClass.id, date);

    expect(roster).toHaveLength(1);
    expect(roster[0].studentId).toBe(homeStudent.id);
    expect(roster[0].makeupRequestId).toBe(makeup.id);
    expect(roster[0].onLeave).toBe(false);
  });
});

describe('saveClassAttendance', () => {
  it('creates a record for an enrolled student then updates it in place on a second save', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04');

    await saveClassAttendance(cls.id, date, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    let roster = await getClassRoster(cls.id, date);
    expect(roster[0].status).toBe('PRESENT');

    await saveClassAttendance(cls.id, date, 'marker-1', [{ studentId: student.id, status: 'LATE', checkInTime: '14:10' }]);
    roster = await getClassRoster(cls.id, date);
    expect(roster[0].status).toBe('LATE');
    expect(roster[0].checkInTime).toBe('14:10');

    const count = await prisma.classAttendance.count({ where: { classId: cls.id, studentId: student.id } });
    expect(count).toBe(1);
  });

  it('writes an insertion-makeup student into the target class keyed by makeupRequestId', async () => {
    const { teacher, student: homeStudent, cls: homeClass } = await setupClassWithStudent();
    const targetClass = await createClass({ name: '週二進階班', subject: '圍棋', level: '進階', teacherId: teacher.id, weekday: 2, startTime: '16:00', endTime: '18:00' });
    const date = new Date('2026-08-04');
    const leave = await createLeaveRequest({ studentId: homeStudent.id, classId: homeClass.id, date, reason: '調課' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: date });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    await saveClassAttendance(targetClass.id, date, 'marker-1', [{ studentId: homeStudent.id, status: 'PRESENT', makeupRequestId: makeup.id }]);

    const roster = await getClassRoster(targetClass.id, date);
    expect(roster[0].status).toBe('PRESENT');
    const homeRoster = await getClassRoster(homeClass.id, date);
    expect(homeRoster[0].status).toBeNull();
  });

  it('clears an existing checkInTime when saved as explicit null', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04');

    await saveClassAttendance(cls.id, date, 'marker-1', [{ studentId: student.id, status: 'PRESENT', checkInTime: '14:05' }]);
    let roster = await getClassRoster(cls.id, date);
    expect(roster[0].checkInTime).toBe('14:05');

    await saveClassAttendance(cls.id, date, 'marker-1', [{ studentId: student.id, status: 'PRESENT', checkInTime: null }]);
    roster = await getClassRoster(cls.id, date);
    expect(roster[0].checkInTime).toBeNull();
  });
});

describe('clearClassAttendance', () => {
  it('deletes an enrolled student record so the roster shows no status again', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04');
    await saveClassAttendance(cls.id, date, 'marker-1', [{ studentId: student.id, status: 'PRESENT', checkInTime: '14:05' }]);

    await clearClassAttendance(cls.id, date, [{ studentId: student.id }]);

    const roster = await getClassRoster(cls.id, date);
    expect(roster[0].status).toBeNull();
    expect(roster[0].checkInTime).toBeNull();
    const count = await prisma.classAttendance.count({ where: { classId: cls.id, studentId: student.id, date } });
    expect(count).toBe(0);
  });

  it('deletes an insertion-makeup record by makeupRequestId without touching the home roster', async () => {
    const { teacher, student: homeStudent, cls: homeClass } = await setupClassWithStudent();
    const targetClass = await createClass({ name: '週二進階班', subject: '圍棋', level: '進階', teacherId: teacher.id, weekday: 2, startTime: '16:00', endTime: '18:00' });
    const date = new Date('2026-08-04');
    const leave = await createLeaveRequest({ studentId: homeStudent.id, classId: homeClass.id, date, reason: '調課' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: date });
    await decideMakeupRequest(makeup.id, 'APPROVED');
    await saveClassAttendance(targetClass.id, date, 'marker-1', [{ studentId: homeStudent.id, status: 'PRESENT', makeupRequestId: makeup.id }]);

    await clearClassAttendance(targetClass.id, date, [{ studentId: homeStudent.id, makeupRequestId: makeup.id }]);

    const roster = await getClassRoster(targetClass.id, date);
    expect(roster[0].status).toBeNull();
    const count = await prisma.classAttendance.count({ where: { makeupRequestId: makeup.id } });
    expect(count).toBe(0);
  });

  it('is a no-op when there is nothing to clear', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04');

    await expect(clearClassAttendance(cls.id, date, [{ studentId: student.id }])).resolves.not.toThrow();
  });
});

describe('getClassEnrollmentQuota', () => {
  it('returns null totalSessions/remaining when the enrollment has no quota set', async () => {
    const { student, cls } = await setupClassWithStudent();

    const quota = await getClassEnrollmentQuota(cls.id, student.id);

    expect(quota.totalSessions).toBeNull();
    expect(quota.remaining).toBeNull();
    expect(quota.usedSessions).toBe(0);
  });

  it('counts PRESENT/LATE/LEFT_EARLY/ABSENT as used but excludes ON_LEAVE and NOT_REGISTERED', async () => {
    const { student, cls } = await setupClassWithStudent();
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 12 } });

    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-18'), 'marker-1', [{ studentId: student.id, status: 'ON_LEAVE' }]);
    // 報名時就聲明不來、未繳該堂費用 → 未報名，不扣堂
    await saveClassAttendance(cls.id, new Date('2026-08-25'), 'marker-1', [{ studentId: student.id, status: 'NOT_REGISTERED' }]);

    const quota = await getClassEnrollmentQuota(cls.id, student.id);

    expect(quota.totalSessions).toBe(12);
    expect(quota.usedSessions).toBe(2);
    expect(quota.remaining).toBe(10);
  });
});

describe('getClassAttendanceLedger', () => {
  it('lists only the deducting attendance rows newest-first with a running remaining-sessions countdown, excluding non-counting rows', async () => {
    const { student, cls } = await setupClassWithStudent();
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 12 } });

    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-18'), 'marker-1', [{ studentId: student.id, status: 'ON_LEAVE' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-25'), 'marker-1', [{ studentId: student.id, status: 'NOT_REGISTERED' }]);

    const ledger = await getClassAttendanceLedger(cls.id, student.id);

    expect(ledger.totalSessions).toBe(12);
    expect(ledger.usedSessions).toBe(2);
    expect(ledger.remaining).toBe(10);
    // ON_LEAVE and NOT_REGISTERED don't deduct, so they're omitted entirely
    expect(ledger.history).toHaveLength(2);
    expect(ledger.history.map((h) => [h.kind, h.status, h.amount, h.remainingAfter])).toEqual([
      ['DEDUCT', 'ABSENT', -1, 10], // this session settled at 10
      ['DEDUCT', 'PRESENT', -1, 11], // the earlier one settled at 11
    ]);
  });

  it('adds a GRANT row for each renewal period, interleaved with deductions by when they happened', async () => {
    const { student, cls } = await setupClassWithStudent();
    // first period: initial enrollment for 8 sessions. EnrollmentPeriod.createdAt
    // defaults to real wall-clock time, so it's pinned to a fixed date here —
    // otherwise its ordering against the fixed-calendar-date attendance rows
    // below would depend on when the test happens to run.
    const enrollment = await prisma.classEnrollment.update({
      where: { studentId_classId: { studentId: student.id, classId: cls.id } },
      data: { totalSessions: 8, periods: { create: { sessions: 8 } } },
    });
    const period1 = await prisma.enrollmentPeriod.findFirstOrThrow({ where: { enrollmentId: enrollment.id } });
    await prisma.enrollmentPeriod.update({ where: { id: period1.id }, data: { createdAt: new Date('2026-08-01') } });
    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    // renewal: a second period adds 4 more sessions
    await addEnrollmentSessions(cls.id, student.id, 4);
    const period2 = await prisma.enrollmentPeriod.findFirstOrThrow({ where: { enrollmentId: enrollment.id, id: { not: period1.id } } });
    await prisma.enrollmentPeriod.update({ where: { id: period2.id }, data: { createdAt: new Date('2026-08-10') } });
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const ledger = await getClassAttendanceLedger(cls.id, student.id);

    expect(ledger.totalSessions).toBe(12);
    expect(ledger.remaining).toBe(10);
    expect(ledger.history.map((h) => [h.kind, h.amount, h.remainingAfter])).toEqual([
      ['DEDUCT', -1, 10], // 08-11, after the renewal — today's true remaining
      ['GRANT', 4, 11], // the renewal itself, right after it there were 11 left (12 - the 08-04 session)
      ['DEDUCT', -1, 7], // 08-04, before the renewal existed (only the first period's 8 to draw from)
      ['GRANT', 8, 8], // the initial period, nothing used yet
    ]);
  });

  it('returns null remainingAfter for every row when totalSessions is not set', async () => {
    const { student, cls } = await setupClassWithStudent();
    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const ledger = await getClassAttendanceLedger(cls.id, student.id);

    expect(ledger.totalSessions).toBeNull();
    expect(ledger.remaining).toBeNull();
    expect(ledger.history[0].remainingAfter).toBeNull();
  });
});

describe('getOneOnOneAttendance / saveOneOnOneAttendance', () => {
  async function setupOneOnOne() {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    await prisma.teacherAvailability.create({ data: { teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '18:00' } });
    const { student, cls } = await setupClassWithStudent();
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date('2026-08-04'), reason: '請假' });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-08-11'),
      slotStartTime: '15:00',
    });
    return { student, makeup };
  }

  it('returns null status before anything is saved', async () => {
    const { student, makeup } = await setupOneOnOne();

    const entry = await getOneOnOneAttendance(makeup.id);

    expect(entry.studentId).toBe(student.id);
    expect(entry.status).toBeNull();
  });

  it('creates then updates in place on a second save', async () => {
    const { makeup } = await setupOneOnOne();

    await saveOneOnOneAttendance(makeup.id, 'marker-1', { status: 'PRESENT' });
    let entry = await getOneOnOneAttendance(makeup.id);
    expect(entry.status).toBe('PRESENT');

    await saveOneOnOneAttendance(makeup.id, 'marker-1', { status: 'LATE', checkInTime: '15:05' });
    entry = await getOneOnOneAttendance(makeup.id);
    expect(entry.status).toBe('LATE');
    expect(entry.checkInTime).toBe('15:05');

    const count = await prisma.oneOnOneAttendance.count({ where: { makeupRequestId: makeup.id } });
    expect(count).toBe(1);
  });

  it('clearOneOnOneAttendance deletes the record so status reverts to null', async () => {
    const { makeup } = await setupOneOnOne();
    await saveOneOnOneAttendance(makeup.id, 'marker-1', { status: 'PRESENT', checkInTime: '15:05' });

    await clearOneOnOneAttendance(makeup.id);

    const entry = await getOneOnOneAttendance(makeup.id);
    expect(entry.status).toBeNull();
    expect(entry.checkInTime).toBeNull();
    const count = await prisma.oneOnOneAttendance.count({ where: { makeupRequestId: makeup.id } });
    expect(count).toBe(0);
  });
});

describe('getGoHallRoster / saveGoHallAttendance', () => {
  it('lists registered students with no status yet, then reflects a save', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createSessions({ dates: [new Date('2026-08-01')], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);

    let roster = await getGoHallRoster(session.id);
    expect(roster).toHaveLength(1);
    expect(roster[0].studentId).toBe(student.id);
    expect(roster[0].status).toBeNull();

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    roster = await getGoHallRoster(session.id);
    expect(roster[0].status).toBe('PRESENT');

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);
    const count = await prisma.goHallAttendance.count({ where: { sessionId: session.id, studentId: student.id } });
    expect(count).toBe(1);
  });

  it('clearGoHallAttendance deletes the record so status reverts to null', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen2@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小華', email: 'hua2@example.com', password: 'x' });
    await createSessions({ dates: [new Date('2026-08-01')], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    await clearGoHallAttendance(session.id, [student.id]);

    const roster = await getGoHallRoster(session.id);
    expect(roster[0].status).toBeNull();
    const count = await prisma.goHallAttendance.count({ where: { sessionId: session.id, studentId: student.id } });
    expect(count).toBe(0);
  });
});

describe('getActivityRoster / saveActivityAttendance', () => {
  it('tracks attendance per day for a multi-day activity independently', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小美', email: 'mei@example.com', password: 'x' });
    const category = await createCategory('比賽');
    const activity = await createActivity({
      title: '暑期營隊',
      description: '三天營隊',
      categoryId: category.id,
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-03'),
      capacity: 20,
      teacherIds: [teacher.id],
    });
    await registerForActivity(activity.id, student.id);

    let day1 = await getActivityRoster(activity.id, new Date('2026-08-01'));
    expect(day1[0].status).toBeNull();

    await saveActivityAttendance(activity.id, new Date('2026-08-01'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    day1 = await getActivityRoster(activity.id, new Date('2026-08-01'));
    expect(day1[0].status).toBe('PRESENT');

    const day2 = await getActivityRoster(activity.id, new Date('2026-08-02'));
    expect(day2[0].status).toBeNull();
  });

  it('clearActivityAttendance deletes only that day\'s record', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen3@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小美', email: 'mei3@example.com', password: 'x' });
    const category = await createCategory('比賽');
    const activity = await createActivity({
      title: '暑期營隊',
      description: '三天營隊',
      categoryId: category.id,
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-03'),
      capacity: 20,
      teacherIds: [teacher.id],
    });
    await registerForActivity(activity.id, student.id);
    await saveActivityAttendance(activity.id, new Date('2026-08-01'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveActivityAttendance(activity.id, new Date('2026-08-02'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    await clearActivityAttendance(activity.id, new Date('2026-08-01'), [student.id]);

    const day1 = await getActivityRoster(activity.id, new Date('2026-08-01'));
    expect(day1[0].status).toBeNull();
    const day2 = await getActivityRoster(activity.id, new Date('2026-08-02'));
    expect(day2[0].status).toBe('PRESENT');
  });
});

describe('listAttendanceSessionsForDate', () => {
  it('lists a class scheduled on that weekday, with marked/total counts', async () => {
    const { student, cls } = await setupClassWithStudent();
    const date = new Date('2026-08-04'); // a Tuesday, matches weekday: 2 in setupClassWithStudent

    let sessions = await listAttendanceSessionsForDate(date, null);
    const classRow = sessions.find((s) => s.type === 'CLASS' && s.id === cls.id);
    expect(classRow).toBeDefined();
    expect(classRow!.markedCount).toBe(0);
    expect(classRow!.totalCount).toBe(1);

    await saveClassAttendance(cls.id, date, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    sessions = await listAttendanceSessionsForDate(date, null);
    expect(sessions.find((s) => s.type === 'CLASS' && s.id === cls.id)!.markedCount).toBe(1);
  });

  it('excludes classes scheduled on a different weekday', async () => {
    const { cls } = await setupClassWithStudent();
    const sessions = await listAttendanceSessionsForDate(new Date('2026-08-05'), null); // a Wednesday
    expect(sessions.find((s) => s.type === 'CLASS' && s.id === cls.id)).toBeUndefined();
  });

  it('scopes to a given teacherId when provided', async () => {
    const { teacher, cls } = await setupClassWithStudent();
    const otherTeacher = await createTeacher({ name: '林老師', email: 'lin2@example.com', password: 'x', subjects: '圍棋' });
    const date = new Date('2026-08-04');

    const scoped = await listAttendanceSessionsForDate(date, otherTeacher.id);
    expect(scoped.find((s) => s.type === 'CLASS' && s.id === cls.id)).toBeUndefined();

    const own = await listAttendanceSessionsForDate(date, teacher.id);
    expect(own.find((s) => s.type === 'CLASS' && s.id === cls.id)).toBeDefined();
  });

  it('includes go-hall sessions stored with a time-of-day offset (legacy 16:00Z rows)', async () => {
    // Sessions batch-created from a GMT+8 browser were stored at 16:00 UTC
    // instead of UTC midnight. The whole app displays them on their UTC
    // calendar day, so the attendance list must find them on that same day.
    const { teacher } = await setupClassWithStudent();
    await prisma.goHallSession.create({
      data: { date: new Date('2026-08-14T16:00:00Z'), startTime: '18:00', endTime: '20:00', capacity: 8, teacherId: teacher.id },
    });

    const sessions = await listAttendanceSessionsForDate(new Date('2026-08-14'), null);
    expect(sessions.filter((s) => s.type === 'GO_HALL')).toHaveLength(1);
  });

  it('excludes go-hall sessions belonging to an adjacent UTC calendar day', async () => {
    const { teacher } = await setupClassWithStudent();
    await prisma.goHallSession.createMany({
      data: [
        { date: new Date('2026-08-13T16:00:00Z'), startTime: '18:00', endTime: '20:00', capacity: 8, teacherId: teacher.id },
        { date: new Date('2026-08-15T00:00:00Z'), startTime: '18:00', endTime: '20:00', capacity: 8, teacherId: teacher.id },
      ],
    });

    const sessions = await listAttendanceSessionsForDate(new Date('2026-08-14'), null);
    expect(sessions.filter((s) => s.type === 'GO_HALL')).toHaveLength(0);
  });
});

import { listMyAttendance, getAttendanceStats } from './attendanceService';

describe('listMyAttendance', () => {
  it('returns one row per attendance record across all four types, newest first, with a unique id', async () => {
    const { student, cls } = await setupClassWithStudent();
    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'LATE' }]);

    const rows = await listMyAttendance(student.id);

    expect(rows).toHaveLength(2);
    expect(rows[0].date.getTime()).toBeGreaterThan(rows[1].date.getTime());
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(rows[0].type).toBe('CLASS');
    expect(rows[0].title).toBe('週二基礎班');
  });
});

describe('getAttendanceStats', () => {
  it('counts each status within the date range for the given class', async () => {
    const { student, cls } = await setupClassWithStudent();
    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-18'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const stats = await getAttendanceStats({ classId: cls.id, from: new Date('2026-08-01'), to: new Date('2026-08-31') });

    expect(stats.counts.PRESENT).toBe(2);
    expect(stats.counts.ABSENT).toBe(1);
    expect(stats.counts.LATE).toBe(0);
  });

  it('excludes records outside the date range', async () => {
    const { student, cls } = await setupClassWithStudent();
    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-09-01'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const stats = await getAttendanceStats({ classId: cls.id, from: new Date('2026-08-01'), to: new Date('2026-08-31') });

    expect(stats.counts.PRESENT).toBe(1);
  });
});

describe('checkInByStudentNumber / resolveCheckIn', () => {
  async function setupStudentWithNumber(studentNumber: string, email: string) {
    const student = await createStudent({ name: '小明', email, password: 'x' });
    await prisma.student.update({ where: { id: student.id }, data: { studentNumber } });
    return student;
  }

  it('returns NOT_FOUND when no student has that number', async () => {
    const result = await checkInByStudentNumber('unknown-code', '2026-08-04', '19:00', 'marker-1');
    expect(result).toEqual({ result: 'NOT_FOUND' });
  });

  it('resolveCheckIn also returns NOT_FOUND when no student has that number', async () => {
    const result = await resolveCheckIn('unknown-code', '2026-08-04', '19:00', 'marker-1', 'class:whatever');
    expect(result).toEqual({ result: 'NOT_FOUND' });
  });

  it('checks in to the only class today even hours before it starts', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen1@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S001', 'checkin-ming1@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const result = await checkInByStudentNumber('S001', '2026-08-04', '10:00', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '數學A班', time: '10:00' });
    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record?.status).toBe('PRESENT');
    expect(record?.checkInTime).toBe('10:00');
  });

  it('checks out an open session even hours after it ends', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen2@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S002', 'checkin-ming2@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await checkInByStudentNumber('S002', '2026-08-04', '18:55', 'marker-1');

    const result = await checkInByStudentNumber('S002', '2026-08-04', '23:30', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_OUT', studentName: '小明', sessionTitle: '數學A班', time: '23:30' });
    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record?.checkInTime).toBe('18:55');
    expect(record?.checkOutTime).toBe('23:30');
  });

  it('keeps checking out on repeated scans once the only class today is fully checked in and out, overwriting the check-out time', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen3@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S003', 'checkin-ming3@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await checkInByStudentNumber('S003', '2026-08-04', '18:55', 'marker-1');
    await checkInByStudentNumber('S003', '2026-08-04', '21:05', 'marker-1');

    const result = await checkInByStudentNumber('S003', '2026-08-04', '21:10', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_OUT', studentName: '小明', sessionTitle: '數學A班', time: '21:10' });
    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record?.checkInTime).toBe('18:55');
    expect(record?.checkOutTime).toBe('21:10');
  });

  it('returns NO_SESSION when the student has no session today at all', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen14@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S014', 'checkin-ming14@example.com');
    // 週三的班，掃描日 2026-08-04 是週二 → 今天沒課
    const cls = await createClass({ name: '週三班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const result = await checkInByStudentNumber('S014', '2026-08-04', '19:00', 'marker-1');

    expect(result).toEqual({ result: 'NO_SESSION' });
  });

  it('offers completed classes for re-check-out when everything today is done, and resolving overwrites that check-out time', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen15@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S015', 'checkin-ming15@example.com');
    const classA = await createClass({ name: '早班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '09:00', endTime: '11:00' });
    const classB = await createClass({ name: '晚班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '20:00' });
    await enrollStudent(classA.id, student.id);
    await enrollStudent(classB.id, student.id);
    await prisma.classAttendance.create({
      data: { classId: classA.id, studentId: student.id, date: new Date('2026-08-04'), status: 'PRESENT', checkInTime: '09:00', checkOutTime: '11:00', markedById: 'marker-1' },
    });
    await prisma.classAttendance.create({
      data: { classId: classB.id, studentId: student.id, date: new Date('2026-08-04'), status: 'PRESENT', checkInTime: '19:00', checkOutTime: '20:00', markedById: 'marker-1' },
    });

    const scan = await checkInByStudentNumber('S015', '2026-08-04', '20:30', 'marker-1');

    expect(scan).toEqual({
      result: 'CHOOSE_SESSION',
      studentName: '小明',
      candidates: [
        { key: `class:${classA.id}`, title: '早班', timeLabel: '09:00-11:00', teacherName: '陳老師', pendingAction: 'CHECK_OUT' },
        { key: `class:${classB.id}`, title: '晚班', timeLabel: '19:00-20:00', teacherName: '陳老師', pendingAction: 'CHECK_OUT' },
      ],
    });

    const resolved = await resolveCheckIn('S015', '2026-08-04', '20:30', 'marker-1', `class:${classB.id}`);
    expect(resolved).toEqual({ result: 'CHECKED_OUT', studentName: '小明', sessionTitle: '晚班', time: '20:30' });

    const recordB = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: classB.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(recordB?.checkOutTime).toBe('20:30');
    const recordA = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: classA.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(recordA?.checkOutTime).toBe('11:00');
  });

  it('checks in via an approved insertion makeup targeting a class the student is not otherwise enrolled in', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen4@example.com', password: 'x', subjects: '圍棋' });
    const student = await setupStudentWithNumber('S004', 'checkin-ming4@example.com');
    const homeClass = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    const targetClass = await createClass({ name: '週二進階班', subject: '圍棋', level: '進階', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(homeClass.id, student.id);
    const leave = await createLeaveRequest({ studentId: student.id, classId: homeClass.id, date: new Date('2026-08-04'), reason: '調課' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: new Date('2026-08-04') });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    const result = await checkInByStudentNumber('S004', '2026-08-04', '10:00', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '週二進階班', time: '10:00' });
    const record = await prisma.classAttendance.findUnique({ where: { makeupRequestId: makeup.id } });
    expect(record?.studentId).toBe(student.id);
    expect(record?.checkInTime).toBe('10:00');
  });

  it('checks in and out via an approved one-on-one makeup slot today, both well outside the old 60-minute window', async () => {
    const availabilityTeacher = await createTeacher({ name: '林老師', email: 'checkin-lin@example.com', password: 'x', subjects: '圍棋' });
    await prisma.teacherAvailability.create({ data: { teacherId: availabilityTeacher.id, weekday: 2, startTime: '14:00', endTime: '18:00' } });
    const homeTeacher = await createTeacher({ name: '陳老師', email: 'checkin-chen5@example.com', password: 'x', subjects: '圍棋' });
    const student = await setupStudentWithNumber('S005', 'checkin-ming5@example.com');
    const homeClass = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: homeTeacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(homeClass.id, student.id);
    const leave = await createLeaveRequest({ studentId: student.id, classId: homeClass.id, date: new Date('2026-08-04'), reason: '請假' });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: availabilityTeacher.id,
      slotDate: new Date('2026-08-04'),
      slotStartTime: '15:00',
    });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    const checkIn = await checkInByStudentNumber('S005', '2026-08-04', '13:00', 'marker-1');
    expect(checkIn).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '一對一補課', time: '13:00' });

    const checkOut = await checkInByStudentNumber('S005', '2026-08-04', '18:00', 'marker-1');
    expect(checkOut.result).toBe('CHECKED_OUT');
    expect(checkOut.time).toBe('18:00');

    const record = await prisma.oneOnOneAttendance.findUnique({ where: { makeupRequestId: makeup.id } });
    expect(record?.checkInTime).toBe('13:00');
    expect(record?.checkOutTime).toBe('18:00');
  });

  it('returns CHOOSE_SESSION with both candidates sorted by start time when two classes are both not yet checked in', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'checkin-chen6@example.com', password: 'x', subjects: '數學' });
    const teacherB = await createTeacher({ name: '王老師', email: 'checkin-wang6@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S006', 'checkin-ming6@example.com');
    const classA = await createClass({ name: 'A班', subject: '數學', level: '國一', teacherId: teacherA.id, weekday: 2, startTime: '19:30', endTime: '21:00' });
    const classB = await createClass({ name: 'B班', subject: '數學', level: '國一', teacherId: teacherB.id, weekday: 2, startTime: '14:00', endTime: '15:30' });
    await enrollStudent(classA.id, student.id);
    await enrollStudent(classB.id, student.id);

    const result = await checkInByStudentNumber('S006', '2026-08-04', '10:00', 'marker-1');

    expect(result).toEqual({
      result: 'CHOOSE_SESSION',
      studentName: '小明',
      candidates: [
        { key: `class:${classB.id}`, title: 'B班', timeLabel: '14:00-15:30', teacherName: '王老師', pendingAction: 'CHECK_IN' },
        { key: `class:${classA.id}`, title: 'A班', timeLabel: '19:30-21:00', teacherName: '陳老師', pendingAction: 'CHECK_IN' },
      ],
    });
    const countA = await prisma.classAttendance.count({ where: { classId: classA.id, studentId: student.id } });
    const countB = await prisma.classAttendance.count({ where: { classId: classB.id, studentId: student.id } });
    expect(countA).toBe(0);
    expect(countB).toBe(0);
  });

  it('resolveCheckIn checks the chosen candidate in and leaves the other untouched', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen7@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S007', 'checkin-ming7@example.com');
    const classA = await createClass({ name: 'A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '20:00' });
    const classB = await createClass({ name: 'B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:30', endTime: '20:30' });
    await enrollStudent(classA.id, student.id);
    await enrollStudent(classB.id, student.id);

    const result = await resolveCheckIn('S007', '2026-08-04', '19:20', 'marker-1', `class:${classB.id}`);

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: 'B班', time: '19:20' });
    const recordA = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: classA.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(recordA).toBeNull();
  });

  it("resolveCheckIn falls back to NO_SESSION when the chosen key doesn't match any of today's candidates", async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen8@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S008', 'checkin-ming8@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const result = await resolveCheckIn('S008', '2026-08-04', '19:00', 'marker-1', 'class:not-a-real-class-id');

    expect(result).toEqual({ result: 'NO_SESSION' });
  });

  it('walks a student through two classes in one day: choose, check in, choose again to check out, then resolves the remaining class alone', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen9@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S009', 'checkin-ming9@example.com');
    const morningClass = await createClass({ name: '早班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '09:00', endTime: '11:00' });
    const eveningClass = await createClass({ name: '晚班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '20:00' });
    await enrollStudent(morningClass.id, student.id);
    await enrollStudent(eveningClass.id, student.id);

    const firstScan = await checkInByStudentNumber('S009', '2026-08-04', '09:00', 'marker-1');
    expect(firstScan.result).toBe('CHOOSE_SESSION');
    expect(firstScan.candidates?.map((c) => c.key)).toEqual([`class:${morningClass.id}`, `class:${eveningClass.id}`]);

    const morningIn = await resolveCheckIn('S009', '2026-08-04', '09:00', 'marker-1', `class:${morningClass.id}`);
    expect(morningIn).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '早班', time: '09:00' });

    const secondScan = await checkInByStudentNumber('S009', '2026-08-04', '11:05', 'marker-1');
    expect(secondScan.result).toBe('CHOOSE_SESSION');
    expect(secondScan.candidates).toEqual([
      { key: `class:${morningClass.id}`, title: '早班', timeLabel: '09:00-11:00', teacherName: '陳老師', pendingAction: 'CHECK_OUT' },
      { key: `class:${eveningClass.id}`, title: '晚班', timeLabel: '19:00-20:00', teacherName: '陳老師', pendingAction: 'CHECK_IN' },
    ]);

    const morningOut = await resolveCheckIn('S009', '2026-08-04', '11:05', 'marker-1', `class:${morningClass.id}`);
    expect(morningOut.result).toBe('CHECKED_OUT');

    const thirdScan = await checkInByStudentNumber('S009', '2026-08-04', '18:55', 'marker-1');
    expect(thirdScan).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '晚班', time: '18:55' });

    const morningRecord = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: morningClass.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(morningRecord?.checkInTime).toBe('09:00');
    expect(morningRecord?.checkOutTime).toBe('11:05');
  });

  it('excludes a class the student has an approved leave request for today', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen10@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S010', 'checkin-ming10@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date('2026-08-04'), reason: '感冒' });

    const result = await checkInByStudentNumber('S010', '2026-08-04', '18:55', 'marker-1');

    expect(result).toEqual({ result: 'NO_SESSION' });
    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record).toBeNull();
  });

  it('flags low quota after a check-in drops remaining sessions to the threshold, when the student has a push subscription', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-lowquota1@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S011', 'checkin-lowquota-student1@example.com');
    await subscribeStudentForTest(student.id);
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 4 } });

    await checkInByStudentNumber('S011', '2026-08-04', '19:00', 'marker-1');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: cls.id } } });
    expect(enrollment.lowQuotaNotifiedAt).not.toBeNull();
  });

  it('does not re-flag low quota once already flagged this cycle', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-lowquota1b@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S011B', 'checkin-lowquota-student1b@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    // Simulate an earlier cycle that already notified — the guard must leave
    // this timestamp untouched, not bump it to a new "now()" on this check-in.
    const alreadyNotifiedAt = new Date('2026-07-20T00:00:00.000Z');
    await prisma.classEnrollment.update({
      where: { studentId_classId: { studentId: student.id, classId: cls.id } },
      data: { totalSessions: 4, lowQuotaNotifiedAt: alreadyNotifiedAt },
    });

    await checkInByStudentNumber('S011B', '2026-08-04', '19:00', 'marker-1');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: cls.id } } });
    expect(enrollment.lowQuotaNotifiedAt).toEqual(alreadyNotifiedAt);
  });

  it('does not flag low quota while remaining sessions stay above the threshold', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-lowquota2@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S012', 'checkin-lowquota-student2@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 10 } });

    await checkInByStudentNumber('S012', '2026-08-04', '19:00', 'marker-1');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: cls.id } } });
    expect(enrollment.lowQuotaNotifiedAt).toBeNull();
  });

  it('does not flag low quota for a one-on-one makeup check-in', async () => {
    const availabilityTeacher = await createTeacher({ name: '林老師', email: 'checkin-lowquota3-avail@example.com', password: 'x', subjects: '圍棋' });
    await prisma.teacherAvailability.create({ data: { teacherId: availabilityTeacher.id, weekday: 2, startTime: '14:00', endTime: '18:00' } });
    const homeTeacher = await createTeacher({ name: '陳老師', email: 'checkin-lowquota3-home@example.com', password: 'x', subjects: '圍棋' });
    const student = await setupStudentWithNumber('S013', 'checkin-lowquota-student3@example.com');
    const homeClass = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: homeTeacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(homeClass.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: homeClass.id } }, data: { totalSessions: 1 } });
    const leave = await createLeaveRequest({ studentId: student.id, classId: homeClass.id, date: new Date('2026-08-04'), reason: '請假' });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: availabilityTeacher.id,
      slotDate: new Date('2026-08-04'),
      slotStartTime: '15:00',
    });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    await checkInByStudentNumber('S013', '2026-08-04', '15:00', 'marker-1');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: homeClass.id } } });
    expect(enrollment.lowQuotaNotifiedAt).toBeNull();
  });

  it('does not throw when the student has a push subscription but VAPID keys are not configured', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-linebound@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S014', 'checkin-linebound-student@example.com');
    await subscribeStudentForTest(student.id);
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const result = await checkInByStudentNumber('S014', '2026-08-04', '19:00', 'marker-1');

    expect(result).toEqual({ result: 'CHECKED_IN', studentName: '小明', sessionTitle: '數學A班', time: '19:00' });
  });

  it('does not burn the low-quota flag for a student with no push subscription', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-lowquota-unbound@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S015', 'checkin-lowquota-unbound-student@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 4 } });

    await checkInByStudentNumber('S015', '2026-08-04', '19:00', 'marker-1');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: cls.id } } });
    expect(enrollment.lowQuotaNotifiedAt).toBeNull();
  });
});

async function setupGoHallSessionWithStudent() {
  const teacher = await createTeacher({ name: '陳老師', email: 'gohall-t@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'gohall-s@example.com', password: 'x' });
  await createSessions({ dates: [new Date(2026, 7, 15)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
  const session = await prisma.goHallSession.findFirstOrThrow();
  await registerForSession(session.id, student.id);
  return { student, session };
}

describe('go-hall ticket deduction on attendance', () => {
  it('deducts one ticket and stamps TICKET when marked PRESENT', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    expect(await goHallBalance(student.id)).toBe(9);
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.qualification).toBe('TICKET');
    const attendTxn = await prisma.goHallTicketTransaction.findFirstOrThrow({ where: { studentId: student.id, kind: 'ATTEND' } });
    expect(attendTxn.amount).toBe(-1);
    expect(attendTxn.sessionId).toBe(session.id);
  });

  it('does not deduct when marked ABSENT', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);

    expect(await goHallBalance(student.id)).toBe(10);
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.qualification).toBeNull();
  });

  it('refunds when changed from PRESENT to ABSENT', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);

    expect(await goHallBalance(student.id)).toBe(10);
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.qualification).toBeNull();
    expect(await prisma.goHallTicketTransaction.count({ where: { kind: 'ATTEND' } })).toBe(0);
  });

  it('is idempotent: re-saving PRESENT (or switching PRESENT→LATE) deducts only once', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'LATE' }]);

    expect(await goHallBalance(student.id)).toBe(9);
    expect(await prisma.goHallTicketTransaction.count({ where: { kind: 'ATTEND' } })).toBe(1);
  });

  it('refunds when the attendance record is cleared', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await clearGoHallAttendance(session.id, [student.id]);

    expect(await goHallBalance(student.id)).toBe(10);
  });

  it('stamps SEASON_PASS without deduction when a pass covers the session date', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });
    await addGoHallSeasonPass({ studentId: student.id, startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') });

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    expect(await goHallBalance(student.id)).toBe(10);
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.qualification).toBe('SEASON_PASS');
  });

  it('stamps SINGLE when there is no pass and no balance', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    expect(await goHallBalance(student.id)).toBe(0);
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.qualification).toBe('SINGLE');
  });

  it('sets the low-quota flag once when balance drops to the threshold', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await subscribeStudentForTest(student.id);
    await buyGoHallTickets({ studentId: student.id, sessions: 4 }); // 扣 1 後剩 3 → 觸發

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).not.toBeNull();
  });

  it('does not set the flag when balance stays above the threshold or student has no push subscription', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 }); // 剩 9，未達門檻；且未訂閱推播

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    const fresh = await prisma.student.findUniqueOrThrow({ where: { id: student.id } });
    expect(fresh.goHallLowQuotaNotifiedAt).toBeNull();
  });

  it('roster returns the stamped qualification for marked rows and a prediction otherwise', async () => {
    const { student, session } = await setupGoHallSessionWithStudent();
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });

    let roster = await getGoHallRoster(session.id);
    expect(roster[0].qualification).toBe('TICKET');
    expect(roster[0].qualificationPredicted).toBe(true);

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    roster = await getGoHallRoster(session.id);
    expect(roster[0].qualification).toBe('TICKET');
    expect(roster[0].qualificationPredicted).toBe(false);

    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);
    roster = await getGoHallRoster(session.id);
    expect(roster[0].qualification).toBeNull();
    expect(roster[0].qualificationPredicted).toBe(false);
  });
});

describe('listClassQuotaSummaries', () => {
  it('computes used/total/remaining per enrollment, excluding ON_LEAVE and NOT_REGISTERED', async () => {
    const { student, cls } = await setupClassWithStudent();
    await prisma.classEnrollment.update({
      where: { studentId_classId: { studentId: student.id, classId: cls.id } },
      data: { totalSessions: 10 },
    });
    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'ON_LEAVE' }]);

    const all = await listClassQuotaSummaries();
    const row = all.find((r) => r.studentId === student.id && r.classId === cls.id)!;
    expect(row.className).toBe('週二基礎班');
    expect(row.usedSessions).toBe(1);
    expect(row.totalSessions).toBe(10);
    expect(row.remaining).toBe(9);

    const mine = await listClassQuotaSummaries(student.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].usedSessions).toBe(1);
  });

  it('returns null total/remaining when totalSessions is unset', async () => {
    const { student } = await setupClassWithStudent();
    const rows = await listClassQuotaSummaries(student.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].totalSessions).toBeNull();
    expect(rows[0].remaining).toBeNull();
  });
});

describe('listAttendanceSessionsForDate — 代課老師', () => {
  it('代課老師當天被指派的班級會出現在列表，標題加註「（代課）」；原班導師仍照常看得到（不加註）', async () => {
    const { teacher, cls } = await setupClassWithStudent();
    const substitute = await createTeacher({ name: '林代課老師', email: 'sub1@example.com', password: 'x', subjects: '圍棋' });
    const date = new Date('2026-08-04'); // 週二，符合 setupClassWithStudent 的 weekday: 2
    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date, reason: '出差' });
    await assignSubstituteTeacher(req.id, substitute.id);

    const subSessions = await listAttendanceSessionsForDate(date, substitute.id);
    const subRow = subSessions.find((s) => s.type === 'CLASS' && s.id === cls.id);
    expect(subRow).toBeDefined();
    expect(subRow!.title).toContain('（代課）');

    const ownerSessions = await listAttendanceSessionsForDate(date, teacher.id);
    const ownerRow = ownerSessions.find((s) => s.type === 'CLASS' && s.id === cls.id);
    expect(ownerRow).toBeDefined();
    expect(ownerRow!.title).not.toContain('（代課）');
  });

  it('代課指派限定當天日期，其他日期代課老師看不到這個班級', async () => {
    const { teacher, cls } = await setupClassWithStudent();
    const substitute = await createTeacher({ name: '林代課老師2', email: 'sub2@example.com', password: 'x', subjects: '圍棋' });
    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date('2026-08-04'), reason: '出差' });
    await assignSubstituteTeacher(req.id, substitute.id);

    // 班級每週二上課，下週二（8/11）代課老師沒有被指派，不應出現
    const sessions = await listAttendanceSessionsForDate(new Date('2026-08-11'), substitute.id);
    expect(sessions.find((s) => s.type === 'CLASS' && s.id === cls.id)).toBeUndefined();
  });
});

async function setupTutoringBooking() {
  const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '英文' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const program = await createProgram({ name: '英文個別輔導' });
  const window = await createWindow({ programId: program.id, weekday: 5, startTime: '16:00', endTime: '21:00', capacity: 8, teacherId: teacher.id });
  const enrollment = await prisma.tutoringEnrollment.create({ data: { programId: program.id, studentId: student.id } });
  const date = new Date('2026-08-07'); // Friday
  const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date });
  return { teacher, student, program, window, enrollment, date, booking };
}

describe('getTutoringRoster / saveTutoringAttendance / clearTutoringAttendance', () => {
  it('lists a booked student with no status yet, then reflects a saved status', async () => {
    const { window, date, booking } = await setupTutoringBooking();

    let roster = await getTutoringRoster(window.id, date);
    expect(roster).toHaveLength(1);
    expect(roster[0].bookingId).toBe(booking.id);
    expect(roster[0].studentName).toBe('小明');
    expect(roster[0].status).toBeNull();
    expect(roster[0].isMakeup).toBe(false);

    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'PRESENT', checkInTime: '16:05' }]);
    roster = await getTutoringRoster(window.id, date);
    expect(roster[0].status).toBe('PRESENT');
    expect(roster[0].checkInTime).toBe('16:05');
  });

  it('clears a saved attendance record', async () => {
    const { window, date, booking } = await setupTutoringBooking();
    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'ABSENT' }]);
    await clearTutoringAttendance([booking.id]);
    const roster = await getTutoringRoster(window.id, date);
    expect(roster[0].status).toBeNull();
  });
});

describe('listAttendanceSessionsForDate with tutoring windows', () => {
  it('includes an open tutoring window on its weekday with correct counts', async () => {
    const { window, date, teacher } = await setupTutoringBooking();
    const sessions = await listAttendanceSessionsForDate(date, teacher.id);
    const tutoring = sessions.find((s) => s.type === 'TUTORING' && s.id === window.id);
    expect(tutoring).toBeDefined();
    expect(tutoring!.totalCount).toBe(1);
    expect(tutoring!.markedCount).toBe(0);
  });

  it('excludes a tutoring window closed on that date', async () => {
    const { window, date } = await setupTutoringBooking();
    await prisma.tutoringWindowClosure.create({ data: { windowId: window.id, date } });
    const sessions = await listAttendanceSessionsForDate(date, null);
    expect(sessions.find((s) => s.type === 'TUTORING' && s.id === window.id)).toBeUndefined();
  });

  it('shows the window to the second teacher too', async () => {
    const { window, date } = await setupTutoringBooking();
    const teacher2 = await createTeacher({ name: '換班老師', email: `shift-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    await prisma.tutoringWindow.update({ where: { id: window.id }, data: { teacherId2: teacher2.id } });

    const sessions = await listAttendanceSessionsForDate(date, teacher2.id);
    expect(sessions.find((s) => s.type === 'TUTORING' && s.id === window.id)).toBeDefined();

    // 不相干的老師仍然看不到
    const outsider = await createTeacher({ name: '路人老師', email: `out-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const outsiderSessions = await listAttendanceSessionsForDate(date, outsider.id);
    expect(outsiderSessions.find((s) => s.type === 'TUTORING' && s.id === window.id)).toBeUndefined();
  });
});

describe('listMyAttendance with tutoring bookings', () => {
  it('includes a tutoring attendance row', async () => {
    const { student, booking } = await setupTutoringBooking();
    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'PRESENT' }]);
    const rows = await listMyAttendance(student.id);
    expect(rows.find((r) => r.type === 'TUTORING')).toMatchObject({ status: 'PRESENT', title: '英文個別輔導' });
  });
});

describe('checkInByStudentNumber with a class AND a tutoring booking on the same day (multi-candidate)', () => {
  it('returns CHOOSE_SESSION listing both the class and the tutoring booking', async () => {
    const { student, booking } = await setupTutoringBooking(); // Friday 2026-08-07, weekday 5
    await prisma.student.update({ where: { id: student.id }, data: { studentNumber: 'S001' } });
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-combo1@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '週五班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 5, startTime: '18:00', endTime: '19:30' });
    await enrollStudent(cls.id, student.id);

    const result = await checkInByStudentNumber('S001', '2026-08-07', '15:00', 'marker-1');

    expect(result.result).toBe('CHOOSE_SESSION');
    expect(result.candidates?.map((c) => c.key).sort()).toEqual([`class:${cls.id}`, `tutoring:${booking.id}`].sort());
  });
});

describe('checkInByStudentNumber with a class AND a go-hall registration on the same day (multi-candidate)', () => {
  it('returns CHOOSE_SESSION listing both the class and the go-hall session', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-combo2@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'checkin-combo2-s@example.com', password: 'x' });
    await prisma.student.update({ where: { id: student.id }, data: { studentNumber: 'S001' } });
    const date = new Date('2026-08-04'); // Tuesday, weekday 2
    await createSessions({ dates: [date], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });
    const cls = await createClass({ name: '週二班', subject: '圍棋', level: '基礎1', teacherId: teacher.id, weekday: 2, startTime: '18:00', endTime: '19:30' });
    await enrollStudent(cls.id, student.id);

    const result = await checkInByStudentNumber('S001', '2026-08-04', '13:00', 'marker-1');

    expect(result.result).toBe('CHOOSE_SESSION');
    expect(result.candidates?.map((c) => c.key).sort()).toEqual([`class:${cls.id}`, `gohall:${session.id}`].sort());
  });
});

describe('checkInByStudentNumber with a tutoring booking', () => {
  it('checks the student into their tutoring booking for today', async () => {
    const { student, window } = await setupTutoringBooking();
    await prisma.student.update({ where: { id: student.id }, data: { studentNumber: 'S001' } });
    const result = await checkInByStudentNumber('S001', '2026-08-07', '16:02', 'marker-1');
    expect(result.result).toBe('CHECKED_IN');
    expect(result.sessionTitle).toBe('英文個別輔導');
    const roster = await getTutoringRoster(window.id, new Date('2026-08-07'));
    expect(roster[0].checkInTime).toBe('16:02');
  });
});

describe('checkInByStudentNumber with a go-hall registration', () => {
  it('checks the student into their go-hall session for today and stamps qualification/deducts a ticket', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-gohall1@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'checkin-gohall1-s@example.com', password: 'x' });
    await prisma.student.update({ where: { id: student.id }, data: { studentNumber: 'S001' } });
    await createSessions({ dates: [new Date('2026-08-04')], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });

    const result = await checkInByStudentNumber('S001', '2026-08-04', '14:02', 'marker-1');

    expect(result.result).toBe('CHECKED_IN');
    expect(result.sessionTitle).toBe('弈廳');
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.status).toBe('PRESENT');
    expect(record.checkInTime).toBe('14:02');
    expect(record.qualification).toBe('TICKET');
    expect(await goHallBalance(student.id)).toBe(9);
  });

  it('checks out on a second scan without deducting a second ticket', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-gohall2@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'checkin-gohall2-s@example.com', password: 'x' });
    await prisma.student.update({ where: { id: student.id }, data: { studentNumber: 'S002' } });
    await createSessions({ dates: [new Date('2026-08-04')], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);
    await buyGoHallTickets({ studentId: student.id, sessions: 10 });
    await checkInByStudentNumber('S002', '2026-08-04', '14:02', 'marker-1');

    const result = await checkInByStudentNumber('S002', '2026-08-04', '16:05', 'marker-1');

    expect(result.result).toBe('CHECKED_OUT');
    const record = await prisma.goHallAttendance.findUniqueOrThrow({
      where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    });
    expect(record.checkOutTime).toBe('16:05');
    expect(await goHallBalance(student.id)).toBe(9);
  });
});

describe('getClassAttendanceOverview', () => {
  async function setup() {
    const teacher = await createTeacher({ name: '陳老師', email: `overview-chen-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const cls = await createClass({ name: '週三基礎2A', subject: '圍棋', level: '基礎2', teacherId: teacher.id, weekday: 3, startTime: '17:10', endTime: '18:40' });
    const studentA = await createStudent({ name: '小明', email: `overview-ming-${Date.now()}@example.com`, password: 'x' });
    const studentB = await createStudent({ name: '呂昕曄', email: `overview-lu-${Date.now()}@example.com`, password: 'x' });
    await enrollStudent(cls.id, studentA.id);
    await enrollStudent(cls.id, studentB.id);
    return { teacher, cls, studentA, studentB };
  }

  it('lists a plain attendance record with no makeup info', async () => {
    const { cls, studentA } = await setup();
    const date = new Date('2026-07-01');
    await saveClassAttendance(cls.id, date, 'marker-1', [
      { studentId: studentA.id, status: 'PRESENT', checkInTime: '17:10', checkOutTime: '18:40' },
    ]);

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toEqual([{ date, status: 'PRESENT', checkInTime: '17:10', checkOutTime: '18:40', makeup: null }]);
  });

  it('shows a leave with no makeup request yet as ON_LEAVE with makeup: null', async () => {
    const { cls, studentA } = await setup();
    await createLeaveRequest({ studentId: studentA.id, classId: cls.id, date: new Date('2026-07-01'), reason: '事假' });

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toEqual([
      { date: new Date('2026-07-01'), status: 'ON_LEAVE', checkInTime: null, checkOutTime: null, makeup: null },
    ]);
  });

  it('shows an approved insertion makeup with a descriptive label', async () => {
    const { cls, studentA, teacher } = await setup();
    const targetClass = await createClass({
      name: '週一基礎2A', subject: '圍棋', level: '基礎2', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '20:30',
    });
    const leave = await createLeaveRequest({ studentId: studentA.id, classId: cls.id, date: new Date('2026-07-01'), reason: '事假' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: new Date('2026-07-06') });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toHaveLength(1);
    expect(row.records[0].status).toBe('ON_LEAVE');
    expect(row.records[0].makeup).toEqual({ status: 'APPROVED', type: 'INSERTION', label: '補到 2026/7/6（一） 週一基礎2A' });
  });

  it('shows a pending one-on-one makeup with teacher and time', async () => {
    const { cls, studentA, teacher } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    const leave = await createLeaveRequest({ studentId: studentA.id, classId: cls.id, date: new Date('2026-07-01'), reason: '事假' });
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id, studentId: studentA.id, teacherId: teacher.id, slotDate: new Date('2026-07-08'), slotStartTime: '16:00',
    });

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records[0].makeup).toEqual({ status: 'PENDING_ADMIN', type: 'ONE_ON_ONE', label: '陳老師 一對一 2026/7/8（三） 16:00-16:40' });
  });

  it('shows an absence without leave as ABSENT with no makeup', async () => {
    const { cls, studentA } = await setup();
    await saveClassAttendance(cls.id, new Date('2026-07-01'), 'marker-1', [{ studentId: studentA.id, status: 'ABSENT' }]);

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records[0]).toMatchObject({ status: 'ABSENT', makeup: null });
  });

  it('groups records by student and sorts each student\'s records newest first', async () => {
    const { cls, studentA, studentB } = await setup();
    await saveClassAttendance(cls.id, new Date('2026-07-01'), 'marker-1', [{ studentId: studentA.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-07-15'), 'marker-1', [{ studentId: studentA.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-07-08'), 'marker-1', [{ studentId: studentB.id, status: 'PRESENT' }]);

    const overview = await getClassAttendanceOverview(cls.id);
    expect(overview.map((s) => s.studentId).sort()).toEqual([studentA.id, studentB.id].sort());

    const rowA = overview.find((s) => s.studentId === studentA.id)!;
    expect(rowA.records.map((r) => r.date)).toEqual([new Date('2026-07-15'), new Date('2026-07-01')]);

    const rowB = overview.find((s) => s.studentId === studentB.id)!;
    expect(rowB.records).toHaveLength(1);
  });

  it('includes historical records for a student no longer enrolled in the class', async () => {
    const { cls, studentA } = await setup();
    await saveClassAttendance(cls.id, new Date('2026-07-01'), 'marker-1', [{ studentId: studentA.id, status: 'PRESENT' }]);
    await prisma.classEnrollment.delete({ where: { studentId_classId: { studentId: studentA.id, classId: cls.id } } });

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id);
    expect(row?.studentName).toBe('小明');
    expect(row?.records).toHaveLength(1);
  });

  it('returns an empty array for a class with no students', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: `overview-empty-${Date.now()}@example.com`, password: 'x', subjects: '圍棋' });
    const cls = await createClass({ name: '空班', subject: '圍棋', level: '基礎1', teacherId: teacher.id, weekday: 3, startTime: '17:10', endTime: '18:40' });
    expect(await getClassAttendanceOverview(cls.id)).toEqual([]);
  });

  // 未來日期用 2099 年，讓「今天起」的過濾在任何執行時間都穩定（同
  // classService.test.ts 的續報未來日期測試慣例）。
  it('excludes future-dated attendance and leave records from the overview', async () => {
    const { cls, studentA, studentB } = await setup();
    const past = new Date('2026-07-01');
    await saveClassAttendance(cls.id, past, 'marker-1', [{ studentId: studentA.id, status: 'PRESENT' }]);
    const future = new Date('2099-01-07'); // 週三，跟 cls.weekday 對上，才不會被 createLeaveRequest 的星期檢查擋下
    await saveClassAttendance(cls.id, future, 'marker-1', [{ studentId: studentA.id, status: 'NOT_REGISTERED' }]);
    await createLeaveRequest({ studentId: studentB.id, classId: cls.id, date: future, reason: '未來請假' });

    const overview = await getClassAttendanceOverview(cls.id);

    const rowA = overview.find((s) => s.studentId === studentA.id)!;
    expect(rowA.records).toHaveLength(1);
    expect(rowA.records[0]).toMatchObject({ date: past, status: 'PRESENT' });

    const rowB = overview.find((s) => s.studentId === studentB.id)!;
    expect(rowB.records).toEqual([]);
  });

  it('marks an insertion-makeup visitor\'s studentName with （插班） in the target class overview', async () => {
    const { teacher, cls: homeClass, studentA } = await setup();
    const targetClass = await createClass({
      name: '週一基礎2A', subject: '圍棋', level: '基礎2', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '20:30',
    });
    const date = new Date('2026-07-06');
    const leave = await createLeaveRequest({ studentId: studentA.id, classId: homeClass.id, date: new Date('2026-07-01'), reason: '事假' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: date });
    await decideMakeupRequest(makeup.id, 'APPROVED');
    await saveClassAttendance(targetClass.id, date, 'marker-1', [
      { studentId: studentA.id, status: 'PRESENT', makeupRequestId: makeup.id },
    ]);

    const overview = await getClassAttendanceOverview(targetClass.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.studentName).toBe('小明（插班）');
    expect(row.records[0]).toMatchObject({ status: 'PRESENT' });
  });

  it('merges a same-date leave+makeup with an attendance record: attendance status wins, makeup carried over', async () => {
    const { cls, studentA, teacher } = await setup();
    const targetClass = await createClass({
      name: '週一基礎2A', subject: '圍棋', level: '基礎2', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '20:30',
    });
    const date = new Date('2026-07-01');
    const leave = await createLeaveRequest({ studentId: studentA.id, classId: cls.id, date, reason: '事假' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: new Date('2026-07-06') });
    await decideMakeupRequest(makeup.id, 'APPROVED');

    // 學生後來還是在原班出席了同一天。
    await saveClassAttendance(cls.id, date, 'marker-1', [{ studentId: studentA.id, status: 'PRESENT' }]);

    const overview = await getClassAttendanceOverview(cls.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toHaveLength(1);
    expect(row.records[0].status).toBe('PRESENT');
    expect(row.records[0].makeup).toEqual({ status: 'APPROVED', type: 'INSERTION', label: '補到 2026/7/6（一） 週一基礎2A' });
  });
});

describe('getTutoringWindowAttendanceOverview', () => {
  async function setup() {
    const teacher = await createTeacher({ name: '米奇老師', email: `tw-overview-mickey-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({
      programId: program.id, weekday: 5, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id,
    });
    const studentA = await createStudent({ name: '小明', email: `tw-overview-ming-${Date.now()}@example.com`, password: 'x' });
    const enrollmentA = await createEnrollment({ studentId: studentA.id, programId: program.id });
    return { teacher, program, window, studentA, enrollmentA };
  }

  it('reflects a marked attendance status, check-in/out times, and isMakeup for a REGULAR booking', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const booking = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'PRESENT', checkInTime: '17:00', checkOutTime: '19:00' }]);

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toEqual([
      { date: new Date(Date.UTC(2020, 0, 3)), attendanceStatus: 'PRESENT', bookingStatus: 'BOOKED', checkInTime: '17:00', checkOutTime: '19:00', isMakeup: false },
    ]);
  });

  it('reflects an ON_LEAVE attendance status', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const booking = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'ON_LEAVE', checkInTime: null, checkOutTime: null }]);

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records[0].attendanceStatus).toBe('ON_LEAVE');
  });

  it('has attendanceStatus null for a BOOKED booking with no attendance marked yet, whether the date is past or future', async () => {
    const { window, studentA, enrollmentA } = await setup();
    await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2099, 0, 2)) });

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records).toHaveLength(2);
    expect(row.records.every((r) => r.attendanceStatus === null && r.bookingStatus === 'BOOKED')).toBe(true);
  });

  it('reflects a CANCELLED booking', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const booking = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await adminCancelBooking(booking.id);

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records[0]).toMatchObject({ bookingStatus: 'CANCELLED', attendanceStatus: null });
  });

  it('reflects a legacy CANCELLED_LATE booking', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const booking = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await prisma.tutoringBooking.update({ where: { id: booking.id }, data: { status: 'CANCELLED_LATE' } });

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    expect(row.records[0]).toMatchObject({ bookingStatus: 'CANCELLED_LATE' });
  });

  it('marks a pending makeup booking as isMakeup with bookingStatus PENDING_ADMIN', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const original = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await createBooking({
      enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 10)), kind: 'MAKEUP', makeupForId: original.id,
    });

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    const record = row.records.find((r) => r.date.getTime() === new Date(Date.UTC(2020, 0, 10)).getTime())!;
    expect(record).toMatchObject({ isMakeup: true, bookingStatus: 'PENDING_ADMIN' });
  });

  it('reflects a legacy rejected makeup booking', async () => {
    const { window, studentA, enrollmentA } = await setup();
    const original = await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    const makeup = await createBooking({
      enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 10)), kind: 'MAKEUP', makeupForId: original.id,
    });
    await prisma.tutoringBooking.update({ where: { id: makeup.id }, data: { status: 'REJECTED' } });

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    const row = overview.find((s) => s.studentId === studentA.id)!;
    const record = row.records.find((r) => r.date.getTime() === new Date(Date.UTC(2020, 0, 10)).getTime())!;
    expect(record).toMatchObject({ isMakeup: true, bookingStatus: 'REJECTED' });
  });

  it("groups records by student and sorts each student's records newest first, including future dates at the top", async () => {
    const { window, program, studentA, enrollmentA } = await setup();
    // 名字刻意選「丁一」而非其他字，讓 zh-TW 筆畫排序結果跟建立順序（studentA
    // 先建立）相反——這樣這個斷言才會在拿掉排序時真的失敗，而不是巧合通過。
    const studentB = await createStudent({ name: '丁一', email: `tw-overview-ding-${Date.now()}@example.com`, password: 'x' });
    const enrollmentB = await createEnrollment({ studentId: studentB.id, programId: program.id });

    await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 17)) });
    await createBooking({ enrollmentId: enrollmentA.id, windowId: window.id, date: new Date(Date.UTC(2099, 0, 2)) });
    await createBooking({ enrollmentId: enrollmentB.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 10)) });

    const overview = await getTutoringWindowAttendanceOverview(window.id);
    expect(overview).toHaveLength(2);
    expect(overview.map((s) => s.studentName)).toEqual(['丁一', '小明']);
    const rowA = overview.find((s) => s.studentId === studentA.id)!;
    expect(rowA.records.map((r) => r.date)).toEqual([
      new Date(Date.UTC(2099, 0, 2)),
      new Date(Date.UTC(2020, 0, 17)),
      new Date(Date.UTC(2020, 0, 3)),
    ]);
    const rowB = overview.find((s) => s.studentId === studentB.id)!;
    expect(rowB.records).toHaveLength(1);
  });

  it('returns an empty array for a window with no bookings', async () => {
    const { window } = await setup();
    const overview = await getTutoringWindowAttendanceOverview(window.id);
    expect(overview).toEqual([]);
  });
});

describe('getTutoringEnrollmentAttendance', () => {
  async function setup() {
    const teacher = await createTeacher({ name: '米奇老師', email: `enr-att-mickey-${Date.now()}@example.com`, password: 'x', subjects: '英文' });
    const program = await createProgram({ name: '英文個別輔導' });
    const window = await createWindow({ programId: program.id, weekday: 5, startTime: '17:00', endTime: '19:00', capacity: 5, teacherId: teacher.id });
    const student = await createStudent({ name: '小明', email: `enr-att-ming-${Date.now()}@example.com`, password: 'x' });
    const enrollment = await createEnrollment({ studentId: student.id, programId: program.id });
    return { window, enrollment };
  }

  it('returns only bookings with attendance records newest first, excluding unmarked and cancelled bookings', async () => {
    const { window, enrollment } = await setup();
    const marked = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await saveTutoringAttendance('marker-1', [{ bookingId: marked.id, status: 'PRESENT', checkInTime: '17:00', checkOutTime: '19:00' }]);
    const absent = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 17)) });
    await saveTutoringAttendance('marker-1', [{ bookingId: absent.id, status: 'ABSENT' }]);
    const cancelled = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 10)) });
    await adminCancelBooking(cancelled.id);
    await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2099, 0, 2)) });

    const result = await getTutoringEnrollmentAttendance(enrollment.id);
    expect(result.studentName).toBe('小明');
    expect(result.programName).toBe('英文個別輔導');
    expect(result.records.map((r) => r.date)).toEqual([
      new Date(Date.UTC(2020, 0, 17)),
      new Date(Date.UTC(2020, 0, 3)),
    ]);
    expect(result.records[0]).toMatchObject({ attendanceStatus: 'ABSENT', bookingStatus: 'BOOKED', checkInTime: null });
    expect(result.records[1]).toMatchObject({
      attendanceStatus: 'PRESENT',
      bookingStatus: 'BOOKED',
      checkInTime: '17:00',
      checkOutTime: '19:00',
      isMakeup: false,
    });
    expect(typeof result.records[1].id).toBe('string');
  });

  it('keeps a legacy cancelled-late booking that has an attendance record', async () => {
    const { window, enrollment } = await setup();
    const booking = await createBooking({ enrollmentId: enrollment.id, windowId: window.id, date: new Date(Date.UTC(2020, 0, 3)) });
    await saveTutoringAttendance('marker-1', [{ bookingId: booking.id, status: 'PRESENT', checkInTime: '17:00', checkOutTime: '19:00' }]);
    await prisma.tutoringBooking.update({ where: { id: booking.id }, data: { status: 'CANCELLED_LATE' } });

    const result = await getTutoringEnrollmentAttendance(enrollment.id);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ attendanceStatus: 'PRESENT', bookingStatus: 'CANCELLED_LATE' });
  });

  it('throws ENROLLMENT_NOT_FOUND for a missing enrollment', async () => {
    await expect(getTutoringEnrollmentAttendance('nonexistent-id')).rejects.toThrow('ENROLLMENT_NOT_FOUND');
  });
});
