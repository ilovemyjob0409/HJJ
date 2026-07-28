import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createLeaveRequest } from './leaveRequestService';
import { createInsertionMakeupRequest, decideMakeupRequest, createOneOnOneMakeupRequest } from './makeupRequestService';
import { getClassRoster, saveClassAttendance, getClassEnrollmentQuota, getOneOnOneAttendance, saveOneOnOneAttendance } from './attendanceService';

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
