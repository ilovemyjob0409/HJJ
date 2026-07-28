import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createLeaveRequest } from './leaveRequestService';
import {
  createClass,
  listClasses,
  listClassesBySubjectAndLevel,
  enrollStudent,
  updateClass,
  setStudentEnrollments,
  addEnrollmentSessions,
  unenrollStudent,
  listStudentEnrolledClasses,
  deleteClass,
} from './classService';

beforeEach(async () => {
  await prisma.classAttendance.deleteMany();
  await prisma.oneOnOneAttendance.deleteMany();
  await prisma.goHallAttendance.deleteMany();
  await prisma.activityAttendance.deleteMany();
  await prisma.goHallRegistration.deleteMany();
  await prisma.goHallSession.deleteMany();
  await prisma.substituteRequest.deleteMany();
  await prisma.makeupRequest.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.classEnrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.teacherAvailability.deleteMany();
  await prisma.teacher.deleteMany();
  await prisma.student.deleteMany();
  await prisma.user.deleteMany();
});

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
