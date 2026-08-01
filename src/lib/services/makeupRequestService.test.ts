import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent, setStudentEnrollments, addEnrollmentSessions } from './classService';
import { createLeaveRequest } from './leaveRequestService';
import { setTeacherAvailability } from './availabilityService';
import { getClassRoster } from './attendanceService';
import {
  createInsertionMakeupRequest,
  createOneOnOneMakeupRequest,
  listPendingMakeupRequests,
  decideMakeupRequest,
  listInsertionsForTeacherClasses,
  getMakeupQuotaStatus,
  formatMakeupSlot,
  arrangeInsertionMakeup,
  arrangeOneOnOneMakeup,
  arrangeLeaveOnly,
  requestMakeupCancellation,
  rejectMakeupCancellation,
  revokeMakeup,
} from './makeupRequestService';

// 報名帶堂數 → setStudentEnrollments 會建立第一期，之後的一對一額度
// 都從這期起算（一期 1 次）。
async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const classA = await createClass({ name: '圍棋A班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
  const classB = await createClass({ name: '圍棋B班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
  await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: 12 }]);
  const leave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 20), reason: '感冒' });
  return { teacher, student, classA, classB, leave };
}

describe('formatMakeupSlot', () => {
  it('formats an INSERTION slot with no space between the weekday and class name', () => {
    const targetDate = new Date('2026-07-22'); // a Wednesday
    const text = formatMakeupSlot({
      type: 'INSERTION',
      targetDate,
      targetClass: { name: '數學B班', startTime: '19:00', endTime: '21:00' },
      slotDate: null,
      slotStartTime: null,
      slotEndTime: null,
    });
    // Pinned to the zh-TW literal (not just re-derived via formatDateWithWeekday)
    // so a regression to an unspecified/default locale is actually caught.
    expect(text).toBe('2026/7/22（三）數學B班 19:00-21:00');
  });

  it('formats a ONE_ON_ONE slot with no space between the weekday and 一對一補課', () => {
    const slotDate = new Date('2026-07-22'); // a Wednesday
    const text = formatMakeupSlot({
      type: 'ONE_ON_ONE',
      targetDate: null,
      targetClass: null,
      slotDate,
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });
    expect(text).toBe('2026/7/22（三）一對一補課 16:00-17:00');
  });

  it('returns an empty string when neither branch has the fields it needs', () => {
    const text = formatMakeupSlot({
      type: 'INSERTION',
      targetDate: new Date('2026-07-22'),
      targetClass: null,
      slotDate: null,
      slotStartTime: null,
      slotEndTime: null,
    });
    expect(text).toBe('');
  });
});

describe('createInsertionMakeupRequest', () => {
  it('creates a PENDING_ADMIN insertion request', async () => {
    const { classB, leave } = await setup();
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    expect(makeup.type).toBe('INSERTION');
    expect(makeup.status).toBe('PENDING_ADMIN');
  });

  it('allows a third insertion in the same period (insertions are unlimited)', async () => {
    const { student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });
    const thirdLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 30), reason: '事假' });

    const third = await createInsertionMakeupRequest({ leaveRequestId: thirdLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 7, 1) });

    expect(third.status).toBe('PENDING_ADMIN');
  });
});

describe('createOneOnOneMakeupRequest', () => {
  it('creates a PENDING_ADMIN one-on-one request when slot is within availability and free', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'), // a Wednesday
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });
    expect(makeup.type).toBe('ONE_ON_ONE');
    expect(makeup.status).toBe('PENDING_ADMIN');
  });

  it('throws NOT_AVAILABLE for a non-Go class', async () => {
    const { teacher, student } = await setup();
    const mathClass = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(mathClass.id, student.id);
    const mathLeave = await createLeaveRequest({ studentId: student.id, classId: mathClass.id, date: new Date(2026, 6, 21), reason: '事假' });
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    await expect(
      createOneOnOneMakeupRequest({
        leaveRequestId: mathLeave.id,
        studentId: student.id,
        teacherId: teacher.id,
        slotDate: new Date('2026-07-15'),
        slotStartTime: '16:00',
        slotEndTime: '17:00',
      })
    ).rejects.toThrow('NOT_AVAILABLE');
  });

  it('throws OUTSIDE_AVAILABILITY when slot is not within any window', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    await expect(
      createOneOnOneMakeupRequest({
        leaveRequestId: leave.id,
        studentId: student.id,
        teacherId: teacher.id,
        slotDate: new Date('2026-07-15'),
        slotStartTime: '19:00',
        slotEndTime: '20:00',
      })
    ).rejects.toThrow('OUTSIDE_AVAILABILITY');
  });

  it('throws SLOT_CONFLICT when another pending/approved request already holds the slot', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    const classA = await prisma.class.findFirstOrThrow({ where: { name: '圍棋A班' } });
    await enrollStudent(classA.id, otherStudent.id);
    const otherLeave = await createLeaveRequest({ studentId: otherStudent.id, classId: classA.id, date: new Date(2026, 6, 20), reason: '事假' });

    await expect(
      createOneOnOneMakeupRequest({
        leaveRequestId: otherLeave.id,
        studentId: otherStudent.id,
        teacherId: teacher.id,
        slotDate: new Date('2026-07-15'),
        slotStartTime: '16:30',
        slotEndTime: '17:30',
      })
    ).rejects.toThrow('SLOT_CONFLICT');
  });

  it('throws QUOTA_EXCEEDED when the student already used the one-on-one makeup this period', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    const classA = await prisma.class.findFirstOrThrow({ where: { name: '圍棋A班' } });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });

    await expect(
      createOneOnOneMakeupRequest({
        leaveRequestId: secondLeave.id,
        studentId: student.id,
        teacherId: teacher.id,
        slotDate: new Date('2026-07-29'),
        slotStartTime: '17:00',
        slotEndTime: '18:00',
      })
    ).rejects.toThrow('QUOTA_EXCEEDED');
  });

  it('still allows a one-on-one after two insertions (insertions do not consume the quota)', async () => {
    const { teacher, student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    const thirdLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 30), reason: '事假' });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: thirdLeave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    expect(makeup.status).toBe('PENDING_ADMIN');
  });

  it('allows a new one-on-one after a new enrollment period is added', async () => {
    const { teacher, student, classA, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    await addEnrollmentSessions(classA.id, student.id, 10); // 新的一期

    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: secondLeave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-29'),
      slotStartTime: '17:00',
      slotEndTime: '18:00',
    });

    expect(makeup.status).toBe('PENDING_ADMIN');
  });

  it('allows only one of two concurrent requests for the same teacher/slot to succeed', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    const classA = await prisma.class.findFirstOrThrow({ where: { name: '圍棋A班' } });
    await enrollStudent(classA.id, otherStudent.id);
    const otherLeave = await createLeaveRequest({ studentId: otherStudent.id, classId: classA.id, date: new Date(2026, 6, 20), reason: '事假' });

    const slotInput = {
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    };

    const results = await Promise.allSettled([
      createOneOnOneMakeupRequest({ leaveRequestId: leave.id, studentId: student.id, ...slotInput }),
      createOneOnOneMakeupRequest({ leaveRequestId: otherLeave.id, studentId: otherStudent.id, ...slotInput }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toBe('SLOT_CONFLICT');

    const created = await prisma.makeupRequest.count({
      where: { type: 'ONE_ON_ONE', teacherId: teacher.id, slotDate: slotInput.slotDate },
    });
    expect(created).toBe(1);
  });

  it('allows only one of two concurrent requests to succeed under the per-period quota', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    const classA = await prisma.class.findFirstOrThrow({ where: { name: '圍棋A班' } });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });

    const results = await Promise.allSettled([
      createOneOnOneMakeupRequest({
        leaveRequestId: leave.id,
        studentId: student.id,
        teacherId: teacher.id,
        slotDate: new Date('2026-07-15'),
        slotStartTime: '16:00',
        slotEndTime: '17:00',
      }),
      createOneOnOneMakeupRequest({
        leaveRequestId: secondLeave.id,
        studentId: student.id,
        teacherId: teacher.id,
        slotDate: new Date('2026-07-29'),
        slotStartTime: '17:00',
        slotEndTime: '18:00',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toBe('QUOTA_EXCEEDED');

    const created = await prisma.makeupRequest.count({
      where: { type: 'ONE_ON_ONE', leaveRequest: { studentId: student.id } },
    });
    expect(created).toBe(1);
  });
});

describe('getMakeupQuotaStatus', () => {
  it('returns full quota for a Go class with a fresh period', async () => {
    const { student, classA } = await setup();
    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 1 });
  });

  it('marks one-on-one unavailable for a non-Go class', async () => {
    const { teacher, student } = await setup();
    const mathClass = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(mathClass.id, student.id);

    const quota = await getMakeupQuotaStatus(student.id, mathClass.id);

    expect(quota).toEqual({ oneOnOneAvailable: false, oneOnOneRemaining: 0 });
  });

  it('reduces remaining to zero after a one-on-one request this period', async () => {
    const { teacher, student, classA, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 0 });
  });

  it('keeps remaining untouched by insertions', async () => {
    const { student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });

    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 1 });
  });

  it('releases quota back after a one-on-one request is rejected', async () => {
    const { teacher, student, classA, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    await decideMakeupRequest(makeup.id, 'REJECTED');

    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 1 });
  });

  it('resets remaining when a new period is added', async () => {
    const { teacher, student, classA, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    await addEnrollmentSessions(classA.id, student.id, 10);

    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 1 });
  });

  it('counts all history when the enrollment has no period on record', async () => {
    const { teacher, student, classB } = await setup();
    await enrollStudent(classB.id, student.id); // 無堂數 → 無期紀錄
    const leaveB = await createLeaveRequest({ studentId: student.id, classId: classB.id, date: new Date(2026, 6, 28), reason: '事假' });
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leaveB.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    const quota = await getMakeupQuotaStatus(student.id, classB.id);
    expect(quota).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 0 });
  });

  it('tracks quota independently per class', async () => {
    const { teacher, student, classA, classB, leave } = await setup();
    await setStudentEnrollments(student.id, [
      { classId: classA.id, totalSessions: 12 },
      { classId: classB.id, totalSessions: 12 },
    ]);
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    expect(await getMakeupQuotaStatus(student.id, classA.id)).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 0 });
    expect(await getMakeupQuotaStatus(student.id, classB.id)).toEqual({ oneOnOneAvailable: true, oneOnOneRemaining: 1 });
  });
});

describe('listPendingMakeupRequests / decideMakeupRequest', () => {
  it('lists pending requests and allows admin to approve one', async () => {
    const { classB, leave } = await setup();
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });

    const pending = await listPendingMakeupRequests();
    expect(pending.map((m) => m.id)).toContain(makeup.id);

    const decided = await decideMakeupRequest(makeup.id, 'APPROVED');
    expect(decided.status).toBe('APPROVED');

    const pendingAfter = await listPendingMakeupRequests();
    expect(pendingAfter.map((m) => m.id)).not.toContain(makeup.id);
  });

  it('does not throw when the student has no LINE binding', async () => {
    const { classB, leave } = await setup();
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });

    const decided = await decideMakeupRequest(makeup.id, 'APPROVED');

    expect(decided.status).toBe('APPROVED');
  });

  it('does not throw when the student has a LINE binding but no access token is configured', async () => {
    const { student, classB, leave } = await setup();
    await prisma.student.update({ where: { id: student.id }, data: { lineUserId: 'Uparent123' } });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });

    const decided = await decideMakeupRequest(makeup.id, 'REJECTED');

    expect(decided.status).toBe('REJECTED');
  });
});

describe('listInsertionsForTeacherClasses', () => {
  it('returns only insertion requests targeting classes taught by the given teacher', async () => {
    const { teacher, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });

    const otherTeacher = await createTeacher({ name: '林老師', email: 'other-teacher@example.com', password: 'x', subjects: '英文' });
    const otherClass = await createClass({ name: '英文班', subject: '英文', level: '國一', teacherId: otherTeacher.id, weekday: 4, startTime: '19:00', endTime: '21:00' });
    const otherStudent = await createStudent({ name: '小華', email: 'other-student@example.com', password: 'x' });
    await enrollStudent(otherClass.id, otherStudent.id);
    const otherLeave = await createLeaveRequest({ studentId: otherStudent.id, classId: otherClass.id, date: new Date(2026, 6, 20), reason: '事假' });
    const unrelatedTargetClass = await createClass({ name: '英文B班', subject: '英文', level: '國一', teacherId: otherTeacher.id, weekday: 5, startTime: '19:00', endTime: '21:00' });
    await createInsertionMakeupRequest({ leaveRequestId: otherLeave.id, targetClassId: unrelatedTargetClass.id, targetDate: new Date(2026, 6, 23) });

    const results = await listInsertionsForTeacherClasses(teacher.id);

    expect(results).toHaveLength(1);
    expect(results[0].targetClass?.name).toBe('圍棋B班');
    expect(results[0].leaveRequest.student.user.name).toBe('小明');
  });
});

describe('arrangeInsertionMakeup', () => {
  it('creates an approved leave+makeup and the student appears on the target class roster', async () => {
    const { student, classA, classB } = await setup();

    const makeup = await arrangeInsertionMakeup({
      studentId: student.id,
      classId: classA.id,
      date: new Date(2026, 7, 3),
      reason: '行政代辦',
      targetClassId: classB.id,
      targetDate: new Date(2026, 7, 5),
    });

    expect(makeup.status).toBe('APPROVED');
    const leave = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: makeup.leaveRequestId } });
    expect(leave.studentId).toBe(student.id);
    expect(leave.classId).toBe(classA.id);

    const roster = await getClassRoster(classB.id, new Date(2026, 7, 5));
    const insertion = roster.find((r) => r.makeupRequestId === makeup.id);
    expect(insertion?.studentName).toBe('小明');
  });

  it('throws NOT_ENROLLED for a class the student is not enrolled in, leaving no rows behind', async () => {
    const { student, classB } = await setup();

    await expect(
      arrangeInsertionMakeup({
        studentId: student.id,
        classId: classB.id, // 未就讀 classB
        date: new Date(2026, 7, 3),
        reason: '行政代辦',
        targetClassId: classB.id,
        targetDate: new Date(2026, 7, 5),
      })
    ).rejects.toThrow('NOT_ENROLLED');

    expect(await prisma.leaveRequest.count({ where: { date: new Date(2026, 7, 3) } })).toBe(0);
    expect(await prisma.makeupRequest.count()).toBe(0);
  });
});

describe('arrangeLeaveOnly', () => {
  it('creates an approved leave with no makeup request attached', async () => {
    const { student, classA } = await setup();

    const leave = await arrangeLeaveOnly({
      studentId: student.id,
      classId: classA.id,
      date: new Date(2026, 7, 3),
      reason: '行政代辦',
    });

    expect(leave.status).toBe('APPROVED');
    expect(leave.studentId).toBe(student.id);
    expect(leave.classId).toBe(classA.id);
    expect(await prisma.makeupRequest.count({ where: { leaveRequestId: leave.id } })).toBe(0);
  });

  it('throws NOT_ENROLLED for a class the student is not enrolled in, leaving no rows behind', async () => {
    const { student, classB } = await setup();

    await expect(
      arrangeLeaveOnly({
        studentId: student.id,
        classId: classB.id, // 未就讀 classB
        date: new Date(2026, 7, 3),
        reason: '行政代辦',
      })
    ).rejects.toThrow('NOT_ENROLLED');

    expect(await prisma.leaveRequest.count({ where: { date: new Date(2026, 7, 3) } })).toBe(0);
  });
});

describe('arrangeOneOnOneMakeup', () => {
  it('creates an approved one-on-one directly', async () => {
    const { teacher, student, classA } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    const makeup = await arrangeOneOnOneMakeup({
      studentId: student.id,
      classId: classA.id,
      date: new Date(2026, 7, 3),
      reason: '行政代辦',
      teacherId: teacher.id,
      slotDate: new Date('2026-08-05'), // a Wednesday
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    expect(makeup.type).toBe('ONE_ON_ONE');
    expect(makeup.status).toBe('APPROVED');
  });

  it('throws NOT_AVAILABLE for a non-Go class', async () => {
    const { teacher, student } = await setup();
    const mathClass = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(mathClass.id, student.id);
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    await expect(
      arrangeOneOnOneMakeup({
        studentId: student.id,
        classId: mathClass.id,
        date: new Date(2026, 7, 4),
        reason: '行政代辦',
        teacherId: teacher.id,
        slotDate: new Date('2026-08-05'),
        slotStartTime: '16:00',
        slotEndTime: '17:00',
      })
    ).rejects.toThrow('NOT_AVAILABLE');
  });

  it('enforces the per-period one-on-one quota', async () => {
    const { teacher, student, classA, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    await createOneOnOneMakeupRequest({
      leaveRequestId: leave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-08-05'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });

    await expect(
      arrangeOneOnOneMakeup({
        studentId: student.id,
        classId: classA.id,
        date: new Date(2026, 7, 10),
        reason: '行政代辦',
        teacherId: teacher.id,
        slotDate: new Date('2026-08-12'),
        slotStartTime: '17:00',
        slotEndTime: '18:00',
      })
    ).rejects.toThrow('QUOTA_EXCEEDED');
  });

  it('rejects a slot outside teacher availability', async () => {
    const { teacher, student, classA } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    await expect(
      arrangeOneOnOneMakeup({
        studentId: student.id,
        classId: classA.id,
        date: new Date(2026, 7, 3),
        reason: '行政代辦',
        teacherId: teacher.id,
        slotDate: new Date('2026-08-05'),
        slotStartTime: '19:00',
        slotEndTime: '20:00',
      })
    ).rejects.toThrow('OUTSIDE_AVAILABILITY');
  });
});

describe('makeup cancellation', () => {
  async function arrangedInsertion() {
    const base = await setup();
    const makeup = await arrangeInsertionMakeup({
      studentId: base.student.id,
      classId: base.classA.id,
      date: new Date(2026, 7, 3),
      reason: '行政代辦',
      targetClassId: base.classB.id,
      targetDate: new Date(2026, 7, 5),
    });
    return { ...base, makeup };
  }

  it('requestMakeupCancellation marks an approved makeup and keeps it on the roster', async () => {
    const { student, classB, makeup } = await arrangedInsertion();

    await requestMakeupCancellation(makeup.id, student.id);

    const updated = await prisma.makeupRequest.findUniqueOrThrow({ where: { id: makeup.id } });
    expect(updated.cancelRequestedAt).not.toBeNull();
    expect(updated.status).toBe('APPROVED');
    const roster = await getClassRoster(classB.id, new Date(2026, 7, 5));
    expect(roster.some((r) => r.makeupRequestId === makeup.id)).toBe(true);
  });

  it('rejects a cancellation request from another student or on a non-approved makeup', async () => {
    const { classB, makeup, student, classA } = await arrangedInsertion();
    const other = await createStudent({ name: '小華', email: 'cancel-hua@example.com', password: 'x' });
    await expect(requestMakeupCancellation(makeup.id, other.id)).rejects.toThrow('NOT_FOUND');

    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 7, 10), reason: '事假' });
    const pending = await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 7, 12) });
    await expect(requestMakeupCancellation(pending.id, student.id)).rejects.toThrow('NOT_APPROVED');
  });

  it('rejectMakeupCancellation clears the flag', async () => {
    const { student, makeup } = await arrangedInsertion();
    await requestMakeupCancellation(makeup.id, student.id);

    await rejectMakeupCancellation(makeup.id);

    const updated = await prisma.makeupRequest.findUniqueOrThrow({ where: { id: makeup.id } });
    expect(updated.cancelRequestedAt).toBeNull();
  });

  it('revokeMakeup deletes the makeup, frees the roster, and allows re-application on the same leave', async () => {
    const { student, classB, makeup } = await arrangedInsertion();

    await revokeMakeup(makeup.id);

    expect(await prisma.makeupRequest.count({ where: { id: makeup.id } })).toBe(0);
    const roster = await getClassRoster(classB.id, new Date(2026, 7, 5));
    expect(roster.some((r) => r.makeupRequestId === makeup.id)).toBe(false);
    const leave = await prisma.leaveRequest.findFirstOrThrow({ where: { studentId: student.id, date: new Date(2026, 7, 3) } });
    const again = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 7, 19) });
    expect(again.status).toBe('PENDING_ADMIN');
  });

  it('revoking an approved one-on-one releases the per-period quota', async () => {
    const { teacher, student, classA } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    const makeup = await arrangeOneOnOneMakeup({
      studentId: student.id,
      classId: classA.id,
      date: new Date(2026, 7, 3),
      reason: '行政代辦',
      teacherId: teacher.id,
      slotDate: new Date('2026-08-05'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });
    expect((await getMakeupQuotaStatus(student.id, classA.id)).oneOnOneRemaining).toBe(0);

    await revokeMakeup(makeup.id);

    expect((await getMakeupQuotaStatus(student.id, classA.id)).oneOnOneRemaining).toBe(1);
  });

  it('revokeMakeup blocks when attendance is already marked', async () => {
    const { student, classB, makeup } = await arrangedInsertion();
    const marker = await prisma.user.findFirstOrThrow();
    await prisma.classAttendance.create({
      data: {
        classId: classB.id,
        studentId: student.id,
        date: new Date(2026, 7, 5),
        status: 'PRESENT',
        makeupRequestId: makeup.id,
        markedById: marker.id,
      },
    });

    await expect(revokeMakeup(makeup.id)).rejects.toThrow('MAKEUP_HAS_ATTENDANCE');
    expect(await prisma.makeupRequest.count({ where: { id: makeup.id } })).toBe(1);
  });
});
