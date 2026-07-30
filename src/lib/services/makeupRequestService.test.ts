import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createLeaveRequest } from './leaveRequestService';
import { setTeacherAvailability } from './availabilityService';
import { formatDateWithWeekday } from '@/lib/dateFormat';
import {
  createInsertionMakeupRequest,
  createOneOnOneMakeupRequest,
  listPendingMakeupRequests,
  decideMakeupRequest,
  listInsertionsForTeacherClasses,
  getMakeupQuotaStatus,
  formatMakeupSlot,
} from './makeupRequestService';

beforeEach(async () => {
  await prisma.goHallRegistration.deleteMany();
  await prisma.goHallSession.deleteMany();
  await prisma.substituteRequest.deleteMany();
  await prisma.makeupRequest.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

async function setup() {
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
  const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
  await enrollStudent(classA.id, student.id);
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
    expect(formatDateWithWeekday(targetDate)).toContain('（三）');
    expect(text).toBe(`${formatDateWithWeekday(targetDate)}數學B班 19:00-21:00`);
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
    expect(formatDateWithWeekday(slotDate)).toContain('（三）');
    expect(text).toBe(`${formatDateWithWeekday(slotDate)}一對一補課 16:00-17:00`);
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

  it('throws QUOTA_EXCEEDED when the student already has 2 requests this quarter', async () => {
    const { student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });

    const thirdLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 30), reason: '事假' });

    await expect(
      createInsertionMakeupRequest({ leaveRequestId: thirdLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 7, 1) })
    ).rejects.toThrow('QUOTA_EXCEEDED');
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
    const classA = await prisma.class.findFirstOrThrow();
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

  it('throws QUOTA_EXCEEDED when student already has a pending/approved one-on-one request this quarter', async () => {
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

    const classA = await prisma.class.findFirstOrThrow();
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

  it('throws QUOTA_EXCEEDED when the total quarterly quota (2) is already used by insertions alone', async () => {
    const { teacher, student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });

    const thirdLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 30), reason: '事假' });

    await expect(
      createOneOnOneMakeupRequest({
        leaveRequestId: thirdLeave.id,
        studentId: student.id,
        teacherId: teacher.id,
        slotDate: new Date('2026-07-15'),
        slotStartTime: '16:00',
        slotEndTime: '17:00',
      })
    ).rejects.toThrow('QUOTA_EXCEEDED');
  });

  it('allows only one of two concurrent requests for the same teacher/slot to succeed', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    const classA = await prisma.class.findFirstOrThrow();
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

  it('allows only one of two concurrent requests to succeed under the per-quarter quota', async () => {
    const { teacher, student, leave } = await setup();
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);

    const classA = await prisma.class.findFirstOrThrow();
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
  it('returns full quota when nothing has been used this quarter', async () => {
    const { student, classA } = await setup();
    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ insertionRemaining: 2, oneOnOneRemaining: 1 });
  });

  it('reduces both remaining counts after a one-on-one request', async () => {
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
    expect(quota).toEqual({ insertionRemaining: 1, oneOnOneRemaining: 0 });
  });

  it('reduces insertion remaining to zero and keeps one-on-one at zero after two insertions', async () => {
    const { student, classA, classB, leave } = await setup();
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeave = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });

    const quota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(quota).toEqual({ insertionRemaining: 0, oneOnOneRemaining: 0 });
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
    expect(quota).toEqual({ insertionRemaining: 2, oneOnOneRemaining: 1 });
  });

  it('tracks quota independently per class', async () => {
    const { teacher, student, classA, classB, leave } = await setup();
    await enrollStudent(classB.id, student.id);

    // Use up classA's total quota (2) with two insertions.
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 22) });
    const secondLeaveA = await createLeaveRequest({ studentId: student.id, classId: classA.id, date: new Date(2026, 6, 27), reason: '事假' });
    await createInsertionMakeupRequest({ leaveRequestId: secondLeaveA.id, targetClassId: classB.id, targetDate: new Date(2026, 6, 29) });

    const classAQuota = await getMakeupQuotaStatus(student.id, classA.id);
    expect(classAQuota).toEqual({ insertionRemaining: 0, oneOnOneRemaining: 0 });

    // classB is a different class for the same student — must be unaffected.
    const classBQuota = await getMakeupQuotaStatus(student.id, classB.id);
    expect(classBQuota).toEqual({ insertionRemaining: 2, oneOnOneRemaining: 1 });

    // A makeup request against classB's own leave must succeed even though classA is exhausted.
    const classBLeave = await createLeaveRequest({ studentId: student.id, classId: classB.id, date: new Date(2026, 6, 28), reason: '事假' });
    await setTeacherAvailability(teacher.id, [{ weekday: 3, startTime: '16:00', endTime: '18:00' }]);
    const makeup = await createOneOnOneMakeupRequest({
      leaveRequestId: classBLeave.id,
      studentId: student.id,
      teacherId: teacher.id,
      slotDate: new Date('2026-07-15'),
      slotStartTime: '16:00',
      slotEndTime: '17:00',
    });
    expect(makeup.status).toBe('PENDING_ADMIN');
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
    expect(results[0].targetClass?.name).toBe('數學B班');
    expect(results[0].leaveRequest.student.user.name).toBe('小明');
  });
});
