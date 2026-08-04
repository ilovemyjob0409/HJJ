import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createLeaveRequest } from './leaveRequestService';
import { getClassRoster } from './attendanceService';
import {
  createClass,
  listClasses,
  listClassesForTeacher,
  listClassesBySubjectAndLevel,
  enrollStudent,
  updateClass,
  setStudentEnrollments,
  addEnrollmentSessions,
  unenrollStudent,
  listStudentEnrolledClasses,
  deleteClass,
} from './classService';

describe('createClass / listClasses', () => {
  it('creates and lists a class with its teacher', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-chen@example.com', password: 'x', subjects: '數學' });
    expect(teacher).toBeDefined();

    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    expect(cls.name).toBe('數學A班');

    // Verify teacher exists
    const teacherCheck = await prisma.teacher.findUnique({ where: { id: teacher.id } });
    expect(teacherCheck).toBeDefined();

    // Verify class exists in DB with raw query
    const rawClasses = await prisma.class.findMany();
    expect(rawClasses).toHaveLength(1);

    const classes = await listClasses();
    expect(classes).toHaveLength(1);
    expect(classes[0].teacher.user.name).toBe('陳老師');
  });

  it('includes per-enrollment session quota alongside the existing enrollment fields', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-list-quota-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-list-quota-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await enrollStudent(cls.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 12 } });

    const classes = await listClasses();

    const found = classes.find((c) => c.id === cls.id);
    expect(found?.enrollments).toHaveLength(1);
    expect(found?.enrollments[0].studentId).toBe(student.id);
    expect(found?.enrollments[0].student.user.name).toBe('小明');
    expect(found?.enrollments[0].totalSessions).toBe(12);
    expect(found?.enrollments[0].usedSessions).toBe(0);
    expect(found?.enrollments[0].remaining).toBe(12);
  });
});

describe('listClassesBySubjectAndLevel', () => {
  it('returns only classes matching subject and level, excluding the given class', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-filter-chen@example.com', password: 'x', subjects: '數學' });
    const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await createClass({ name: '英文班', subject: '英文', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });

    const result = await listClassesBySubjectAndLevel('數學', '國一', classA.id);
    expect(result.map((c) => c.id)).toEqual([classB.id]);
  });

  it('excludes classes with the same subject but a different level', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-filter-level-chen@example.com', password: 'x', subjects: '數學' });
    const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await createClass({ name: '數學高一班', subject: '數學', level: '高一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });

    const result = await listClassesBySubjectAndLevel('數學', '國一', classA.id);
    expect(result.map((c) => c.id)).toEqual([classB.id]);
  });
});

describe('enrollStudent', () => {
  it('links a student to a class', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const enrollment = await enrollStudent(cls.id, student.id);
    expect(enrollment.studentId).toBe(student.id);
    expect(enrollment.classId).toBe(cls.id);
  });
});

describe('updateClass', () => {
  it('updates only the provided fields, leaving others unchanged', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-update-chen@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const updated = await updateClass(cls.id, { startTime: '20:00', endTime: '22:00' });

    expect(updated.startTime).toBe('20:00');
    expect(updated.endTime).toBe('22:00');
    expect(updated.name).toBe('數學A班');
    expect(updated.weekday).toBe(1);
  });
});

describe('setStudentEnrollments', () => {
  it('adds new enrollments and removes dropped ones, leaving unchanged ones alone', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-set-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-set-ming@example.com', password: 'x' });
    const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const classB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    const classC = await createClass({ name: '數學C班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });

    await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: null }, { classId: classB.id, totalSessions: null }]);
    const originalEnrollmentA = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: classA.id } });

    await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: null }, { classId: classC.id, totalSessions: null }]);

    const finalEnrollments = await prisma.classEnrollment.findMany({ where: { studentId: student.id } });
    expect(finalEnrollments.map((e) => e.classId).sort()).toEqual([classA.id, classC.id].sort());

    const stillA = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: classA.id } });
    expect(stillA.id).toBe(originalEnrollmentA.id);
  });

  it('sets totalSessions on a newly created enrollment', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-quota-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-quota-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(enrollment.totalSessions).toBe(12);
  });

  it('updates totalSessions in place on an enrollment that stays checked, without touching its id', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-quota-update-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-quota-update-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);
    const original = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 18 }]);

    const updated = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(updated.id).toBe(original.id);
    expect(updated.totalSessions).toBe(18);
  });

  it('clears totalSessions to null when the resent value is null', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-quota-clear-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-quota-clear-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: null }]);

    const updated = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(updated.totalSessions).toBeNull();
  });

  it('leaves lowQuotaNotifiedAt untouched when totalSessions is resubmitted unchanged', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-notify-unchanged-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-notify-unchanged-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);
    const notifiedAt = new Date(2026, 6, 20);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { lowQuotaNotifiedAt: notifiedAt } });

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    const updated = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(updated.lowQuotaNotifiedAt).toEqual(notifiedAt);
  });

  it('resets lowQuotaNotifiedAt to null when totalSessions actually changes', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enroll-notify-changed-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-enroll-notify-changed-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);
    const notifiedAt = new Date(2026, 6, 20);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { lowQuotaNotifiedAt: notifiedAt } });

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 18 }]);

    const updated = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(updated.lowQuotaNotifiedAt).toBeNull();
  });

  it('creates the first enrollment period when a new enrollment has totalSessions', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-period-first-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-period-first-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    const periods = await prisma.enrollmentPeriod.findMany({ where: { enrollment: { studentId: student.id, classId: cls.id } } });
    expect(periods).toHaveLength(1);
    expect(periods[0].sessions).toBe(12);
  });

  it('does not create a period when a new enrollment has no totalSessions', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-period-none-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-period-none-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: null }]);

    expect(await prisma.enrollmentPeriod.count()).toBe(0);
  });

  it('does not create a period when correcting an existing enrollment totalSessions', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-period-correct-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-period-correct-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 18 }]);

    expect(await prisma.enrollmentPeriod.count()).toBe(1);
  });
});

describe('addEnrollmentSessions', () => {
  it('adds to an existing totalSessions value', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-add-sessions-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-add-sessions-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    const updated = await addEnrollmentSessions(cls.id, student.id, 6);

    expect(updated.totalSessions).toBe(18);
  });

  it('treats a null totalSessions as 0 before adding', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-add-sessions-null-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-add-sessions-null-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: null }]);

    const updated = await addEnrollmentSessions(cls.id, student.id, 6);

    expect(updated.totalSessions).toBe(6);
  });

  it('applies both additions when two calls run concurrently, without losing either', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-add-sessions-concurrent-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-add-sessions-concurrent-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 10 }]);

    await Promise.all([
      addEnrollmentSessions(cls.id, student.id, 5),
      addEnrollmentSessions(cls.id, student.id, 3),
    ]);

    const final = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(final.totalSessions).toBe(18);
  });

  it('creates a new enrollment period recording the added sessions', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-add-period-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-add-period-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    await addEnrollmentSessions(cls.id, student.id, 6);

    const periods = await prisma.enrollmentPeriod.findMany({
      where: { enrollment: { studentId: student.id, classId: cls.id } },
      orderBy: { createdAt: 'asc' },
    });
    expect(periods.map((p) => p.sessions)).toEqual([12, 6]);
  });
});

describe('unenrollStudent', () => {
  it('removes a specific enrollment', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-unenroll-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-unenroll-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    await unenrollStudent(cls.id, student.id);

    const remaining = await prisma.classEnrollment.findMany({ where: { studentId: student.id, classId: cls.id } });
    expect(remaining).toHaveLength(0);
  });

  it('cascades enrollment periods when the enrollment is removed', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-unenroll-period-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-unenroll-period-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);

    await unenrollStudent(cls.id, student.id);

    expect(await prisma.enrollmentPeriod.count()).toBe(0);
  });
});

describe('listStudentEnrolledClasses', () => {
  it('returns only classes the student is enrolled in', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-list-enrolled-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-list-enrolled-ming@example.com', password: 'x' });
    const classA = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(classA.id, student.id);

    const result = await listStudentEnrolledClasses(student.id);

    expect(result.map((c) => c.id)).toEqual([classA.id]);
  });

  it('includes the enrolled student\'s own session quota', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-enrolled-quota-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'class-enrolled-quota-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await enrollStudent(cls.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: cls.id } }, data: { totalSessions: 12 } });

    const result = await listStudentEnrolledClasses(student.id);

    expect(result).toHaveLength(1);
    expect(result[0].quota.totalSessions).toBe(12);
    expect(result[0].quota.usedSessions).toBe(0);
    expect(result[0].quota.remaining).toBe(12);
  });
});

describe('deleteClass', () => {
  it('deletes a class with no history, clearing its enrollments', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-delete-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-delete-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    await deleteClass(cls.id);

    expect(await prisma.class.findUnique({ where: { id: cls.id } })).toBeNull();
    expect(await prisma.classEnrollment.findMany({ where: { classId: cls.id } })).toHaveLength(0);
  });

  it('throws CLASS_HAS_RECORDS and does not delete when the class has a leave request', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-delete-block-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-delete-block-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(2026, 6, 20), reason: '感冒' });

    await expect(deleteClass(cls.id)).rejects.toThrow('CLASS_HAS_RECORDS');
    expect(await prisma.class.findUnique({ where: { id: cls.id } })).not.toBeNull();
  });
});

describe('addEnrollmentSessions with notRegisteredDates', () => {
  async function setupWithMarker() {
    const marker = await prisma.user.create({
      data: { email: 'renew-marker@example.com', password: 'x', name: '行政', role: 'ADMIN' },
    });
    const teacher = await createTeacher({ name: '陳老師', email: 'renew-nr-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'renew-nr-ming@example.com', password: 'x' });
    // weekday 2 = 週二
    const cls = await createClass({ name: '週二基礎班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 10 }]);
    return { marker, student, cls };
  }

  it('pre-marks the given class dates as NOT_REGISTERED so future rosters are already set', async () => {
    const { marker, student, cls } = await setupWithMarker();

    await addEnrollmentSessions(cls.id, student.id, 8, {
      notRegisteredDates: [new Date('2026-08-11'), new Date('2026-08-18')], // both Tuesdays
      markedById: marker.id,
    });

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({
      where: { studentId_classId: { studentId: student.id, classId: cls.id } },
    });
    expect(enrollment.totalSessions).toBe(18);

    const roster = await getClassRoster(cls.id, new Date('2026-08-11'));
    expect(roster.find((r) => r.studentId === student.id)?.status).toBe('NOT_REGISTERED');

    const marked = await prisma.classAttendance.findMany({ where: { studentId: student.id, status: 'NOT_REGISTERED' } });
    expect(marked).toHaveLength(2);
  });

  it('rejects a date that does not fall on the class weekday, persisting nothing', async () => {
    const { marker, student, cls } = await setupWithMarker();

    await expect(
      addEnrollmentSessions(cls.id, student.id, 8, {
        notRegisteredDates: [new Date('2026-08-12')], // Wednesday
        markedById: marker.id,
      })
    ).rejects.toThrow('INVALID_DATE');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({
      where: { studentId_classId: { studentId: student.id, classId: cls.id } },
    });
    expect(enrollment.totalSessions).toBe(10);
    expect(await prisma.classAttendance.count()).toBe(0);
    expect(await prisma.enrollmentPeriod.count()).toBe(1);
  });

  it('overwrites an existing attendance row for the same date instead of failing', async () => {
    const { marker, student, cls } = await setupWithMarker();
    await prisma.classAttendance.create({
      data: { classId: cls.id, studentId: student.id, date: new Date('2026-08-11'), status: 'PRESENT', markedById: marker.id },
    });

    await addEnrollmentSessions(cls.id, student.id, 8, {
      notRegisteredDates: [new Date('2026-08-11')],
      markedById: marker.id,
    });

    const row = await prisma.classAttendance.findUniqueOrThrow({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: new Date('2026-08-11') } },
    });
    expect(row.status).toBe('NOT_REGISTERED');
  });
});

describe('listClassesForTeacher', () => {
  it('returns only that teacher classes, sorted by weekday then startTime', async () => {
    const teacher = await createTeacher({ name: '吳老師', email: 'tch-wu@example.com', password: 'x', subjects: '圍棋' });
    const other = await createTeacher({ name: '別師', email: 'tch-other@example.com', password: 'x', subjects: '圍棋' });
    await createClass({ name: '週四班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 4, startTime: '16:30', endTime: '18:30' });
    await createClass({ name: '週二晚班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '18:00', endTime: '20:00' });
    await createClass({ name: '週二午班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    await createClass({ name: '他師班', subject: '圍棋', level: '基礎', teacherId: other.id, weekday: 1, startTime: '10:00', endTime: '12:00' });

    const rows = await listClassesForTeacher(teacher.id);
    expect(rows.map((r) => r.name)).toEqual(['週二午班', '週二晚班', '週四班']);
    expect(rows[0]).toMatchObject({ weekday: 2, startTime: '14:00', endTime: '16:00' });
  });

  it('includes each student with name and quota fields (incl. unlimited totalSessions)', async () => {
    const teacher = await createTeacher({ name: '吳老師', email: 'tch-quota@example.com', password: 'x', subjects: '圍棋' });
    const cls = await createClass({ name: '週二班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    const s1 = await createStudent({ name: '王小明', email: 'tch-s1@example.com', password: 'x' });
    const s2 = await createStudent({ name: '林小華', email: 'tch-s2@example.com', password: 'x' });
    await prisma.classEnrollment.create({ data: { classId: cls.id, studentId: s1.id, totalSessions: 24 } });
    await enrollStudent(cls.id, s2.id);

    const [row] = await listClassesForTeacher(teacher.id);
    expect(row.students).toHaveLength(2);
    expect(row.students.find((s) => s.name === '王小明')).toMatchObject({
      studentId: s1.id, totalSessions: 24, usedSessions: 0, remaining: 24,
    });
    expect(row.students.find((s) => s.name === '林小華')).toMatchObject({
      totalSessions: null, usedSessions: 0, remaining: null,
    });
  });

  it('returns an empty array for a teacher with no classes', async () => {
    const teacher = await createTeacher({ name: '新老師', email: 'tch-new@example.com', password: 'x', subjects: '圍棋' });
    expect(await listClassesForTeacher(teacher.id)).toEqual([]);
  });

  it('counts only non-leave attendance toward usedSessions (ON_LEAVE does not deduct)', async () => {
    const teacher = await createTeacher({ name: '吳老師', email: 'tch-used-chen@example.com', password: 'x', subjects: '圍棋' });
    const marker = await prisma.user.create({
      data: { email: 'tch-used-marker@example.com', password: 'x', name: '行政', role: 'ADMIN' },
    });
    const cls = await createClass({ name: '週二班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '14:00', endTime: '16:00' });
    const student = await createStudent({ name: '王小明', email: 'tch-used-s1@example.com', password: 'x' });
    await prisma.classEnrollment.create({ data: { classId: cls.id, studentId: student.id, totalSessions: 24 } });
    await prisma.classAttendance.create({
      data: { classId: cls.id, studentId: student.id, date: new Date('2026-08-04'), status: 'PRESENT', markedById: marker.id },
    });
    await prisma.classAttendance.create({
      data: { classId: cls.id, studentId: student.id, date: new Date('2026-08-11'), status: 'ON_LEAVE', markedById: marker.id },
    });

    const [row] = await listClassesForTeacher(teacher.id);

    expect(row.students).toHaveLength(1);
    expect(row.students[0]).toMatchObject({ studentId: student.id, totalSessions: 24, usedSessions: 1, remaining: 23 });
  });
});
