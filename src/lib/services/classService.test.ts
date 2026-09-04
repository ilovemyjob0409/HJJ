import { describe, it, expect, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createLeaveRequest } from './leaveRequestService';
import { getClassRoster, getClassEnrollmentQuota } from './attendanceService';
import {
  createClass,
  listClasses,
  listClassesForTeacher,
  listClassesBySubjectAndLevel,
  enrollStudent,
  updateClass,
  setStudentEnrollments,
  addEnrollmentSessions,
  listNotRegisteredDates,
  setNotRegisteredDates,
  unenrollStudent,
  transferEnrollment,
  listStudentEnrolledClasses,
  hasActiveClassEnrollment,
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

  it('退班刪除今天以後的點名，保留過去的出席歷史（同 setStudentEnrollments 的抽離邏輯）', async () => {
    const teacher = await createTeacher({ name: '徐老師', email: 'class-unenroll-attendance-hsu@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小抽', email: 'class-unenroll-attendance-chou@example.com', password: 'x' });
    const cls = await createClass({ name: '圍棋抽離班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const keep = await createClass({ name: '圍棋保留班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await setStudentEnrollments(student.id, [
      { classId: cls.id, totalSessions: 12 },
      { classId: keep.id, totalSessions: 12 },
    ]);
    const marker = await prisma.user.findFirstOrThrow();
    const mk = (classId: string, date: Date) =>
      prisma.classAttendance.create({
        data: { classId, studentId: student.id, date, status: 'PRESENT', markedById: marker.id },
      });
    await mk(cls.id, new Date(2020, 0, 6)); // 過去：保留
    await mk(cls.id, new Date(2030, 0, 7)); // 未來：刪除
    await mk(keep.id, new Date(2030, 0, 8)); // 未退的班：不受影響

    await unenrollStudent(cls.id, student.id);

    const remaining = await prisma.classAttendance.findMany({ where: { studentId: student.id }, select: { classId: true, date: true } });
    expect(remaining).toHaveLength(2);
    expect(remaining.some((r) => r.classId === cls.id && r.date.getFullYear() === 2020)).toBe(true);
    expect(remaining.some((r) => r.classId === keep.id)).toBe(true);
    expect(remaining.some((r) => r.classId === cls.id && r.date.getFullYear() === 2030)).toBe(false);
  });
});

describe('unenrollStudent 退班抽離點名 — Taipei day boundary (server clock running in UTC)', () => {
  const originalTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it('keeps a Taipei-yesterday attendance row but still clears a Taipei-today (and later) one', async () => {
    process.env.TZ = 'UTC';
    const teacher = await createTeacher({ name: '徐老師', email: 'class-unenroll-hsu-tz@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小抽', email: 'class-unenroll-chou-tz@example.com', password: 'x' });
    const cls = await createClass({ name: '圍棋抽離班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);
    const marker = await prisma.user.findFirstOrThrow();
    const mk = (date: Date) =>
      prisma.classAttendance.create({
        data: { classId: cls.id, studentId: student.id, date, status: 'PRESENT', markedById: marker.id },
      });
    // 瞬間 = UTC 2026-01-15 20:00 = 台北 2026-01-16 04:00：台北已跨到
    // 1/16，但伺服器（UTC）當地日期仍是 1/15。
    const now = new Date('2026-01-15T20:00:00.000Z');
    await mk(new Date('2026-01-15T00:00:00.000Z')); // 台北昨天：應保留
    await mk(new Date('2026-01-16T00:00:00.000Z')); // 台北今天：應清除
    await mk(new Date('2026-01-20T00:00:00.000Z')); // 台北未來：應清除

    await unenrollStudent(cls.id, student.id, now);

    const remaining = await prisma.classAttendance.findMany({ where: { studentId: student.id }, select: { date: true } });
    expect(remaining.map((r) => r.date.toISOString().slice(0, 10))).toEqual(['2026-01-15']);
  });
});

describe('transferEnrollment', () => {
  async function setupTwoClasses() {
    const teacher = await createTeacher({ name: '陳老師', email: `transfer-chen-${Date.now()}-${Math.random()}@example.com`, password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小轉', email: `transfer-ming-${Date.now()}-${Math.random()}@example.com`, password: 'x' });
    const classA = await createClass({ name: '圍棋原班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const classB = await createClass({ name: '圍棋新班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    return { teacher, student, classA, classB };
  }

  it('moves the enrollment to the target class carrying the remaining quota as a fresh period', async () => {
    const { student, classA, classB } = await setupTwoClasses();
    await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: 12 }]);
    const marker = await prisma.user.findFirstOrThrow();
    const mk = (date: Date, status: string) =>
      prisma.classAttendance.create({
        data: { classId: classA.id, studentId: student.id, date, status: status as never, markedById: marker.id },
      });
    await mk(new Date('2020-01-06'), 'PRESENT'); // 過去扣堂
    await mk(new Date('2020-01-13'), 'LATE'); // 過去扣堂
    await mk(new Date('2020-01-20'), 'ON_LEAVE'); // 不扣堂
    await mk(new Date('2020-01-27'), 'NOT_REGISTERED'); // 不扣堂
    await mk(new Date('2030-01-07'), 'PRESENT'); // 未來：換班時抽離，不算已用

    const result = await transferEnrollment(classA.id, classB.id, student.id);

    expect(result.classId).toBe(classB.id);
    expect(result.totalSessions).toBe(10); // 12 - 已用 2

    expect(await prisma.classEnrollment.findMany({ where: { studentId: student.id, classId: classA.id } })).toHaveLength(0);
    const periods = await prisma.enrollmentPeriod.findMany({ where: { enrollment: { studentId: student.id, classId: classB.id } } });
    expect(periods.map((p) => p.sessions)).toEqual([10]);

    // 舊班過去的點名保留、未來的抽離
    const oldRows = await prisma.classAttendance.findMany({ where: { studentId: student.id, classId: classA.id } });
    expect(oldRows.map((r) => r.date.toISOString().slice(0, 10)).sort()).toEqual([
      '2020-01-06',
      '2020-01-13',
      '2020-01-20',
      '2020-01-27',
    ]);

    // 新班堂數從轉入的剩餘開始倒數，尚未使用任何堂
    const quota = await getClassEnrollmentQuota(classB.id, student.id);
    expect(quota).toEqual({ totalSessions: 10, usedSessions: 0, remaining: 10, feeOverride: null });
  });

  it('carries feeOverride over to the new enrollment', async () => {
    const { student, classA, classB } = await setupTwoClasses();
    await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: 8, feeOverride: 450 }]);

    const result = await transferEnrollment(classA.id, classB.id, student.id);

    expect(result.totalSessions).toBe(8);
    expect(result.feeOverride).toBe(450);
  });

  it('keeps an untracked enrollment untracked and creates no period', async () => {
    const { student, classA, classB } = await setupTwoClasses();
    await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: null }]);

    const result = await transferEnrollment(classA.id, classB.id, student.id);

    expect(result.totalSessions).toBeNull();
    expect(await prisma.enrollmentPeriod.count()).toBe(0);
  });

  it('carries a negative remaining as-is (over-used quota stays visible)', async () => {
    const { student, classA, classB } = await setupTwoClasses();
    await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: 2 }]);
    const marker = await prisma.user.findFirstOrThrow();
    for (const day of ['2020-01-06', '2020-01-13', '2020-01-20']) {
      await prisma.classAttendance.create({
        data: { classId: classA.id, studentId: student.id, date: new Date(day), status: 'PRESENT', markedById: marker.id },
      });
    }

    const result = await transferEnrollment(classA.id, classB.id, student.id);

    expect(result.totalSessions).toBe(-1);
  });

  it('rejects when the student is already enrolled in the target class, changing nothing', async () => {
    const { student, classA, classB } = await setupTwoClasses();
    await setStudentEnrollments(student.id, [
      { classId: classA.id, totalSessions: 12 },
      { classId: classB.id, totalSessions: 5 },
    ]);

    await expect(transferEnrollment(classA.id, classB.id, student.id)).rejects.toThrow('ALREADY_ENROLLED');

    const a = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: classA.id } } });
    expect(a.totalSessions).toBe(12);
    const b = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: classB.id } } });
    expect(b.totalSessions).toBe(5);
  });

  it('rejects when the target class is soft-deleted, changing nothing', async () => {
    const { student, classA, classB } = await setupTwoClasses();
    await setStudentEnrollments(student.id, [{ classId: classA.id, totalSessions: 12 }]);
    await prisma.class.update({ where: { id: classB.id }, data: { active: false } });

    await expect(transferEnrollment(classA.id, classB.id, student.id)).rejects.toThrow('TARGET_CLASS_INACTIVE');

    const a = await prisma.classEnrollment.findUniqueOrThrow({ where: { studentId_classId: { studentId: student.id, classId: classA.id } } });
    expect(a.totalSessions).toBe(12);
  });

  it('rejects when the student is not enrolled in the source class', async () => {
    const { student, classA, classB } = await setupTwoClasses();

    await expect(transferEnrollment(classA.id, classB.id, student.id)).rejects.toThrow();
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

describe('hasActiveClassEnrollment', () => {
  it('is true with an active-class enrollment, false without any enrollment', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-hasactive-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-hasactive-ming@example.com', password: 'x' });
    expect(await hasActiveClassEnrollment(student.id)).toBe(false);

    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    expect(await hasActiveClassEnrollment(student.id)).toBe(true);
  });

  it('ignores enrollments whose class has been soft-deleted', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-hasactive-del-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-hasactive-del-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    // 模擬「留下歷史」的軟刪除路徑：班級標記 inactive、報名列保留
    await prisma.class.update({ where: { id: cls.id }, data: { active: false } });

    expect(await hasActiveClassEnrollment(student.id)).toBe(false);
  });
});

describe('deleteClass', () => {
  it('soft-deletes a class with no history, clearing its enrollments', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-delete-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-delete-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    await deleteClass(cls.id);

    expect(await prisma.class.findUnique({ where: { id: cls.id } })).toMatchObject({ active: false });
    expect(await prisma.classEnrollment.findMany({ where: { classId: cls.id } })).toHaveLength(0);
    expect(await listClasses()).toHaveLength(0);
  });

  it('soft-deletes a class that has a leave request, keeping the leave request intact', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'class-delete-block-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-delete-block-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '感冒' });

    await deleteClass(cls.id);

    expect(await prisma.class.findUnique({ where: { id: cls.id } })).toMatchObject({ active: false });
    expect(await prisma.leaveRequest.findUnique({ where: { id: leave.id } })).toMatchObject({ classId: cls.id });
  });

  it('soft-deletes a class that has attendance history, keeping the attendance row intact', async () => {
    const marker = await prisma.user.create({
      data: { email: 'class-delete-block-marker@example.com', password: 'x', name: '行政', role: 'ADMIN' },
    });
    const teacher = await createTeacher({ name: '陳老師', email: 'class-delete-block-att-chen@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'class-delete-block-att-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);
    const attendance = await prisma.classAttendance.create({
      data: { classId: cls.id, studentId: student.id, date: new Date('2026-08-03'), status: 'PRESENT', markedById: marker.id },
    });

    await deleteClass(cls.id);

    expect(await prisma.class.findUnique({ where: { id: cls.id } })).toMatchObject({ active: false });
    expect(await prisma.classAttendance.findUnique({ where: { id: attendance.id } })).toMatchObject({ classId: cls.id });
  });
});

describe('addEnrollmentSessions with notRegisteredDates', () => {
  // 未來日期用 2099 年（週二班，同 weekday 2），讓guard 在任何執行時間都穩定；
  // 過去日期固定用 2020 年，早於現實中任何測試執行時間，永遠是「過去」。
  const FUTURE_TUE_1 = new Date('2099-01-06');
  const FUTURE_TUE_2 = new Date('2099-01-13');
  const FUTURE_WED = new Date('2099-01-07'); // 錯星期（非過去，單純測 weekday 檢查）
  const PAST_TUE = new Date('2020-08-11');

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
      notRegisteredDates: [FUTURE_TUE_1, FUTURE_TUE_2],
      markedById: marker.id,
    });

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({
      where: { studentId_classId: { studentId: student.id, classId: cls.id } },
    });
    expect(enrollment.totalSessions).toBe(18);

    const roster = await getClassRoster(cls.id, FUTURE_TUE_1);
    expect(roster.find((r) => r.studentId === student.id)?.status).toBe('NOT_REGISTERED');

    const marked = await prisma.classAttendance.findMany({ where: { studentId: student.id, status: 'NOT_REGISTERED' } });
    expect(marked).toHaveLength(2);
  });

  it('rejects a date that does not fall on the class weekday, persisting nothing', async () => {
    const { marker, student, cls } = await setupWithMarker();

    await expect(
      addEnrollmentSessions(cls.id, student.id, 8, {
        notRegisteredDates: [FUTURE_WED],
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

  it('overwrites an existing FUTURE attendance row for the same date, clearing check-in/out times', async () => {
    const { marker, student, cls } = await setupWithMarker();
    await prisma.classAttendance.create({
      data: {
        classId: cls.id,
        studentId: student.id,
        date: FUTURE_TUE_1,
        status: 'PRESENT',
        markedById: marker.id,
        checkInTime: '14:00',
        checkOutTime: '16:00',
      },
    });

    await addEnrollmentSessions(cls.id, student.id, 8, {
      notRegisteredDates: [FUTURE_TUE_1],
      markedById: marker.id,
    });

    const row = await prisma.classAttendance.findUniqueOrThrow({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: FUTURE_TUE_1 } },
    });
    expect(row.status).toBe('NOT_REGISTERED');
    expect(row.checkInTime).toBeNull();
    expect(row.checkOutTime).toBeNull();
  });

  it('rejects a PAST date, leaving a real checked-in attendance row untouched', async () => {
    const { marker, student, cls } = await setupWithMarker();
    const checkInTime = '14:05';
    await prisma.classAttendance.create({
      data: {
        classId: cls.id,
        studentId: student.id,
        date: PAST_TUE,
        status: 'PRESENT',
        markedById: marker.id,
        checkInTime,
      },
    });

    await expect(
      addEnrollmentSessions(cls.id, student.id, 8, {
        notRegisteredDates: [PAST_TUE],
        markedById: marker.id,
      })
    ).rejects.toThrow('INVALID_DATE');

    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({
      where: { studentId_classId: { studentId: student.id, classId: cls.id } },
    });
    expect(enrollment.totalSessions).toBe(10); // 交易整筆回滾，堂數也沒被加

    const row = await prisma.classAttendance.findUniqueOrThrow({
      where: { classId_studentId_date: { classId: cls.id, studentId: student.id, date: PAST_TUE } },
    });
    expect(row.status).toBe('PRESENT');
    expect(row.checkInTime).toBe(checkInTime);
  });
});

describe('listNotRegisteredDates / setNotRegisteredDates', () => {
  // 未來日期用 2099 年，讓「今天（台北）起」的過濾在任何執行時間都穩定。
  // 2099-01-02、01-09、01-16 都是週五（weekday 5）；2020-08-07 也是週五（過去）。
  const FRI_1 = new Date('2099-01-02');
  const FRI_2 = new Date('2099-01-09');
  const FRI_3 = new Date('2099-01-16');
  const PAST_FRI = new Date('2020-08-07');

  async function setupFridayClass() {
    const marker = await prisma.user.create({
      data: { email: 'nr-adjust-marker@example.com', password: 'x', name: '行政', role: 'ADMIN' },
    });
    const teacher = await createTeacher({ name: '陳老師', email: 'nr-adjust-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'nr-adjust-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週五班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 5, startTime: '14:00', endTime: '16:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 10 }]);
    return { marker, student, cls };
  }

  it('syncs future NOT_REGISTERED marks to the given set: adds new dates, removes unchecked ones', async () => {
    const { marker, student, cls } = await setupFridayClass();

    await setNotRegisteredDates(cls.id, student.id, [FRI_1, FRI_2], marker.id);
    expect((await listNotRegisteredDates(cls.id, student.id)).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2099-01-02',
      '2099-01-09',
    ]);

    // 第二次同步：取消 FRI_1、新增 FRI_3
    await setNotRegisteredDates(cls.id, student.id, [FRI_2, FRI_3], marker.id);
    expect((await listNotRegisteredDates(cls.id, student.id)).map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2099-01-09',
      '2099-01-16',
    ]);
  });

  it('never deletes rows whose status is no longer NOT_REGISTERED, and hides past marks from the list', async () => {
    const { marker, student, cls } = await setupFridayClass();
    // 過去的未報名標記：list 不顯示、sync 不刪
    await prisma.classAttendance.create({
      data: { classId: cls.id, studentId: student.id, date: PAST_FRI, status: 'NOT_REGISTERED', markedById: marker.id },
    });
    // 未來但已被點名為 PRESENT 的列：sync 給空集合也不能刪
    await prisma.classAttendance.create({
      data: { classId: cls.id, studentId: student.id, date: FRI_1, status: 'PRESENT', markedById: marker.id },
    });

    expect(await listNotRegisteredDates(cls.id, student.id)).toEqual([]);

    await setNotRegisteredDates(cls.id, student.id, [], marker.id);
    expect(await prisma.classAttendance.count({ where: { studentId: student.id } })).toBe(2);
  });

  it('rejects wrong-weekday and past dates with INVALID_DATE', async () => {
    const { marker, student, cls } = await setupFridayClass();
    await expect(setNotRegisteredDates(cls.id, student.id, [new Date('2099-01-03')], marker.id)).rejects.toThrow('INVALID_DATE'); // Saturday
    await expect(setNotRegisteredDates(cls.id, student.id, [PAST_FRI], marker.id)).rejects.toThrow('INVALID_DATE');
  });

  it('rejects when the student is not enrolled in the class', async () => {
    const { marker, cls } = await setupFridayClass();
    const outsider = await createStudent({ name: '小華', email: 'nr-adjust-hua@example.com', password: 'x' });
    await expect(setNotRegisteredDates(cls.id, outsider.id, [FRI_1], marker.id)).rejects.toThrow();
    await expect(listNotRegisteredDates(cls.id, outsider.id)).rejects.toThrow();
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

describe('setStudentEnrollments 退班抽離點名', () => {
  it('退班刪除今天以後的點名，保留過去的出席歷史', async () => {
    const teacher = await createTeacher({ name: '徐老師', email: 'hsu@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小抽', email: 'chou@example.com', password: 'x' });
    const cls = await createClass({ name: '圍棋抽離班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const keep = await createClass({ name: '圍棋保留班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await setStudentEnrollments(student.id, [
      { classId: cls.id, totalSessions: 12 },
      { classId: keep.id, totalSessions: 12 },
    ]);
    const marker = await prisma.user.findFirstOrThrow();
    const mk = (classId: string, date: Date) =>
      prisma.classAttendance.create({
        data: { classId, studentId: student.id, date, status: 'PRESENT', markedById: marker.id },
      });
    await mk(cls.id, new Date(2020, 0, 6)); // 過去：保留
    await mk(cls.id, new Date(2030, 0, 7)); // 未來：刪除
    await mk(keep.id, new Date(2030, 0, 8)); // 未退的班：不受影響

    await setStudentEnrollments(student.id, [{ classId: keep.id, totalSessions: 12 }]);

    const remaining = await prisma.classAttendance.findMany({ where: { studentId: student.id }, select: { classId: true, date: true } });
    expect(remaining).toHaveLength(2);
    expect(remaining.some((r) => r.classId === cls.id && r.date.getFullYear() === 2020)).toBe(true);
    expect(remaining.some((r) => r.classId === keep.id)).toBe(true);
    expect(remaining.some((r) => r.classId === cls.id && r.date.getFullYear() === 2030)).toBe(false);
  });
});

describe('setStudentEnrollments 退班抽離點名 — Taipei day boundary (server clock running in UTC)', () => {
  const originalTZ = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it('keeps a Taipei-yesterday attendance row but still clears a Taipei-today (and later) one', async () => {
    process.env.TZ = 'UTC';
    const teacher = await createTeacher({ name: '徐老師', email: 'hsu-tz@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小抽', email: 'chou-tz@example.com', password: 'x' });
    const cls = await createClass({ name: '圍棋抽離班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 12 }]);
    const marker = await prisma.user.findFirstOrThrow();
    const mk = (date: Date) =>
      prisma.classAttendance.create({
        data: { classId: cls.id, studentId: student.id, date, status: 'PRESENT', markedById: marker.id },
      });
    // 瞬間 = UTC 2026-01-15 20:00 = 台北 2026-01-16 04:00：台北已跨到
    // 1/16，但伺服器（UTC）當地日期仍是 1/15。
    const now = new Date('2026-01-15T20:00:00.000Z');
    await mk(new Date('2026-01-15T00:00:00.000Z')); // 台北昨天：應保留
    await mk(new Date('2026-01-16T00:00:00.000Z')); // 台北今天：應清除
    await mk(new Date('2026-01-20T00:00:00.000Z')); // 台北未來：應清除

    await setStudentEnrollments(student.id, [], now);

    const remaining = await prisma.classAttendance.findMany({ where: { studentId: student.id }, select: { date: true } });
    expect(remaining.map((r) => r.date.toISOString().slice(0, 10))).toEqual(['2026-01-15']);
  });
});

describe('listStudentEnrolledClasses 批次堂數＝逐班 getClassEnrollmentQuota（對照）', () => {
  it('有無 totalSessions、含不扣堂點名的班級都一致', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: `batch-cls-t-${Date.now()}@example.com`, password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '批次生', email: `batch-cls-s-${Date.now()}@example.com`, password: 'x' });
    const marker = await prisma.user.create({
      data: { email: `batch-cls-marker-${Date.now()}@example.com`, password: 'x', name: 'Marker', role: 'TEACHER' },
    });
    const clsA = await createClass({ name: '批次A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    const clsB = await createClass({ name: '批次B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 4, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(clsA.id, student.id);
    await enrollStudent(clsB.id, student.id);
    await prisma.classEnrollment.update({ where: { studentId_classId: { studentId: student.id, classId: clsA.id } }, data: { totalSessions: 10 } });
    // A 班：扣堂 2（PRESENT、LATE）＋不扣堂 2（ON_LEAVE、NOT_REGISTERED）
    const mk = (classId: string, day: number, status: string) =>
      prisma.classAttendance.create({ data: { classId, studentId: student.id, date: new Date(Date.UTC(2026, 7, day)), status: status as never, markedById: marker.id } });
    await mk(clsA.id, 4, 'PRESENT');
    await mk(clsA.id, 11, 'LATE');
    await mk(clsA.id, 18, 'ON_LEAVE');
    await mk(clsA.id, 25, 'NOT_REGISTERED');
    // B 班：無 totalSessions（remaining null）＋1 筆扣堂
    await mk(clsB.id, 6, 'PRESENT');

    const rows = await listStudentEnrolledClasses(student.id);
    const mine = rows.filter((r) => [clsA.id, clsB.id].includes(r.id));
    expect(mine).toHaveLength(2);
    for (const row of mine) {
      const ref = await getClassEnrollmentQuota(row.id, student.id);
      expect(row.quota).toEqual(ref);
    }
    const a = mine.find((r) => r.id === clsA.id)!;
    expect(a.quota).toEqual({ totalSessions: 10, usedSessions: 2, remaining: 8, feeOverride: null });
    const b = mine.find((r) => r.id === clsB.id)!;
    expect(b.quota).toEqual({ totalSessions: null, usedSessions: 1, remaining: null, feeOverride: null });
  });
});

describe('class fee fields', () => {
  it('stores feePerSession on class and feeOverride on enrollment', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'fee-chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'fee-ming@example.com', password: 'x' });
    const cls = await createClass({ name: '週六班', subject: '圍棋', level: '基礎', teacherId: teacher.id, weekday: 6, startTime: '10:00', endTime: '12:00', feePerSession: 500 });
    expect(cls.feePerSession).toBe(500);

    await updateClass(cls.id, { feePerSession: 550 });
    expect((await prisma.class.findUniqueOrThrow({ where: { id: cls.id } })).feePerSession).toBe(550);

    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: null, feeOverride: 450 }]);
    const enrollment = await prisma.classEnrollment.findFirstOrThrow({ where: { studentId: student.id, classId: cls.id } });
    expect(enrollment.feeOverride).toBe(450);
  });
});
