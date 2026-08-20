import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent, setStudentEnrollments } from './classService';
import {
  createSubstituteRequest,
  listPendingSubstituteRequests,
  assignSubstituteTeacher,
  listAssignedSubstituteRequestsForTeacher,
  teacherCanAccessClass,
} from './substituteRequestService';

describe('createSubstituteRequest / listPendingSubstituteRequests', () => {
  it('creates a request with status PENDING_ASSIGNMENT and lists it', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '出差' });
    expect(req.status).toBe('PENDING_ASSIGNMENT');

    const pending = await listPendingSubstituteRequests();
    expect(pending.map((p) => p.id)).toContain(req.id);
  });

  it('throws INVALID_WEEKDAY when the date does not fall on the class weekday', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    await expect(
      // 2026-07-21 是週二，班級週一上課
      createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(Date.UTC(2026, 6, 21)), reason: '出差' })
    ).rejects.toThrow('INVALID_WEEKDAY');
  });
});

describe('assignSubstituteTeacher', () => {
  it('assigns a substitute teacher and marks the request ASSIGNED', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '出差' });

    const updated = await assignSubstituteTeacher(req.id, substitute.id);
    expect(updated.status).toBe('ASSIGNED');
    expect(updated.substituteTeacherId).toBe(substitute.id);

    const pending = await listPendingSubstituteRequests();
    expect(pending.map((p) => p.id)).not.toContain(req.id);
  });

  it('assigns and does not throw when the substitute teacher has a push subscription', async () => {
    const original = await createTeacher({ name: '原老師', email: 'sub-orig@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '代課老師', email: 'sub-sub@example.com', password: 'x', subjects: '數學' });
    const subUser = await prisma.teacher.findUniqueOrThrow({ where: { id: substitute.id }, select: { userId: true } });
    await prisma.pushSubscription.create({
      data: { userId: subUser.userId, endpoint: 'https://push.example/sub-t', p256dh: 'k', auth: 'a' },
    });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: original.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    const request = await createSubstituteRequest({
      classId: cls.id,
      originalTeacherId: original.id,
      date: new Date(Date.UTC(2026, 6, 22)),
      reason: '出差',
    });

    const updated = await assignSubstituteTeacher(request.id, substitute.id);

    expect(updated.status).toBe('ASSIGNED');
    expect(updated.substituteTeacherId).toBe(substitute.id);
  });
});

describe('listAssignedSubstituteRequestsForTeacher', () => {
  it('returns only upcoming substitute requests assigned to the given teacher, oldest first, with class times', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '數學' });
    const otherSubstitute = await createTeacher({ name: '王老師', email: 'wang@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const student = await createStudent({ name: '小明', email: 'ming-sub@example.com', password: 'x' });
    await enrollStudent(cls.id, student.id);

    const later = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(Date.UTC(2030, 0, 14)), reason: '進修' });
    await assignSubstituteTeacher(later.id, substitute.id);
    const sooner = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(Date.UTC(2030, 0, 7)), reason: '出差' });
    await assignSubstituteTeacher(sooner.id, substitute.id);

    // 過去的指派不出現（首頁只列今天以後）
    const past = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(Date.UTC(2020, 0, 6)), reason: '出差' });
    await assignSubstituteTeacher(past.id, substitute.id);

    // 指派給別人的不出現
    const otherReq = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(Date.UTC(2030, 0, 21)), reason: '請假' });
    await assignSubstituteTeacher(otherReq.id, otherSubstitute.id);

    const results = await listAssignedSubstituteRequestsForTeacher(substitute.id);

    expect(results.map((r) => r.id)).toEqual([sooner.id, later.id]);
    expect(results[0].class.name).toBe('數學A班');
    expect(results[0].class.startTime).toBe('19:00');
    expect(results[0].class.endTime).toBe('21:00');
    expect(results[0].originalTeacher.user.name).toBe('陳老師');
    expect(results[0].class.students.map((s) => s.name)).toEqual(['小明']);
    expect(results[0].class.students[0].usedSessions).toBe(0);
    expect(results[0].class.students[0].totalSessions).toBeNull();
    expect(results[0].class.students[0].remaining).toBeNull();
  });
});

describe('teacherCanAccessClass', () => {
  it('allows the class\'s own regular teacher', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen2@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    expect(await teacherCanAccessClass(teacher.id, cls.id, new Date(Date.UTC(2030, 0, 7)))).toBe(true);
  });

  it('allows an ASSIGNED substitute on the assigned date, but not other dates', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen3@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin3@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(Date.UTC(2030, 0, 7)), reason: '出差' });
    await assignSubstituteTeacher(req.id, substitute.id);

    expect(await teacherCanAccessClass(substitute.id, cls.id, new Date(Date.UTC(2030, 0, 7)))).toBe(true);
    expect(await teacherCanAccessClass(substitute.id, cls.id, new Date(Date.UTC(2030, 0, 14)))).toBe(false);
  });

  it('denies an unrelated teacher', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen4@example.com', password: 'x', subjects: '數學' });
    const other = await createTeacher({ name: '王老師', email: 'wang4@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    expect(await teacherCanAccessClass(other.id, cls.id, new Date(Date.UTC(2030, 0, 7)))).toBe(false);
  });

  it('denies a substitute whose request is still PENDING_ASSIGNMENT', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen5@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin5@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    // 建立請求但不指派——substitute 對此請求沒有 substituteTeacherId 關聯
    await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(Date.UTC(2030, 0, 7)), reason: '出差' });

    expect(await teacherCanAccessClass(substitute.id, cls.id, new Date(Date.UTC(2030, 0, 7)))).toBe(false);
  });
});

describe('listAssignedSubstituteRequestsForTeacher — 學生堂數進度', () => {
  it('批次計算已上堂數與剩餘堂數（比照 listClassesForTeacher 的算法）', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen6@example.com', password: 'x', subjects: '圍棋' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin6@example.com', password: 'x', subjects: '圍棋' });
    const cls = await createClass({ name: '圍棋A班', subject: '圍棋', level: '初級', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const student = await createStudent({ name: '小華', email: 'hua6@example.com', password: 'x' });
    await setStudentEnrollments(student.id, [{ classId: cls.id, totalSessions: 10 }]);
    const marker = await prisma.user.findFirstOrThrow();
    await prisma.classAttendance.create({
      data: { classId: cls.id, studentId: student.id, date: new Date(Date.UTC(2030, 0, 7)), status: 'PRESENT', markedById: marker.id },
    });

    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(Date.UTC(2030, 0, 14)), reason: '出差' });
    await assignSubstituteTeacher(req.id, substitute.id);

    const results = await listAssignedSubstituteRequestsForTeacher(substitute.id);

    expect(results[0].class.students).toEqual([
      { studentId: student.id, name: '小華', totalSessions: 10, usedSessions: 1, remaining: 9 },
    ]);
  });
});
