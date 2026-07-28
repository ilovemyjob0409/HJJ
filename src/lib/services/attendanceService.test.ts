import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createLeaveRequest } from './leaveRequestService';
import { createInsertionMakeupRequest, decideMakeupRequest, createOneOnOneMakeupRequest } from './makeupRequestService';
import { getClassRoster, saveClassAttendance, getClassEnrollmentQuota, getOneOnOneAttendance, saveOneOnOneAttendance, getGoHallRoster, saveGoHallAttendance, getActivityRoster, saveActivityAttendance, listAttendanceSessionsForDate } from './attendanceService';
import { createSessions, registerForSession } from './goHallService';
import { createActivity, createCategory, registerForActivity } from './activityService';

beforeEach(async () => {
  await prisma.classAttendance.deleteMany();
  await prisma.oneOnOneAttendance.deleteMany();
  await prisma.goHallAttendance.deleteMany();
  await prisma.activityAttendance.deleteMany();
  await prisma.goHallRegistration.deleteMany();
  await prisma.goHallSession.deleteMany();
  await prisma.activityRegistration.deleteMany();
  await prisma.activityImage.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
  await prisma.substituteRequest.deleteMany();
  await prisma.makeupRequest.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();

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
});

describe('getClassEnrollmentQuota', () => {
  it('returns null totalSessions/remaining when the enrollment has no quota set', async () => {
    const { student, cls } = await setupClassWithStudent();

    const quota = await getClassEnrollmentQuota(cls.id, student.id);

    expect(quota.totalSessions).toBeNull();
    expect(quota.remaining).toBeNull();
    expect(quota.usedSessions).toBe(0);
  });

  it('counts PRESENT/LATE/LEFT_EARLY/ABSENT as used but excludes ON_LEAVE', async () => {
    const { student, cls } = await setupClassWithStudent();
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 12 } });

    await saveClassAttendance(cls.id, new Date('2026-08-04'), 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-11'), 'marker-1', [{ studentId: student.id, status: 'ABSENT' }]);
    await saveClassAttendance(cls.id, new Date('2026-08-18'), 'marker-1', [{ studentId: student.id, status: 'ON_LEAVE' }]);

    const quota = await getClassEnrollmentQuota(cls.id, student.id);

    expect(quota.totalSessions).toBe(12);
    expect(quota.usedSessions).toBe(2);
    expect(quota.remaining).toBe(10);
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
      slotEndTime: '16:00',
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
