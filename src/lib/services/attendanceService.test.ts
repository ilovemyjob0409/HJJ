import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createLeaveRequest } from './leaveRequestService';
import { createInsertionMakeupRequest, decideMakeupRequest, createOneOnOneMakeupRequest } from './makeupRequestService';
import { getClassRoster, saveClassAttendance, clearClassAttendance, getClassEnrollmentQuota, getOneOnOneAttendance, saveOneOnOneAttendance, clearOneOnOneAttendance, getGoHallRoster, saveGoHallAttendance, clearGoHallAttendance, getActivityRoster, saveActivityAttendance, clearActivityAttendance, listAttendanceSessionsForDate, checkInByStudentNumber, resolveCheckIn } from './attendanceService';
import { createSessions, registerForSession } from './goHallService';
import { createActivity, createCategory, registerForActivity } from './activityService';

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

  it('returns NO_SESSION once the only class today is fully checked in and out', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'checkin-chen3@example.com', password: 'x', subjects: '數學' });
    const student = await setupStudentWithNumber('S003', 'checkin-ming3@example.com');
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await checkInByStudentNumber('S003', '2026-08-04', '18:55', 'marker-1');
    await checkInByStudentNumber('S003', '2026-08-04', '21:05', 'marker-1');

    const result = await checkInByStudentNumber('S003', '2026-08-04', '21:10', 'marker-1');

    expect(result).toEqual({ result: 'NO_SESSION' });
    const record = await prisma.classAttendance.findUnique({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04') } },
    });
    expect(record?.checkOutTime).toBe('21:05');
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
      slotEndTime: '16:00',
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

  it("resolveCheckIn falls back to NO_SESSION when the chosen key is no longer among today's incomplete candidates", async () => {
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
});
