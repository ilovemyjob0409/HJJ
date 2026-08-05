import { describe, it, expect } from 'vitest';
import { createTeacher } from './teacherService';
import { createClass } from './classService';
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

    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2026, 6, 20), reason: '出差' });
    expect(req.status).toBe('PENDING_ASSIGNMENT');

    const pending = await listPendingSubstituteRequests();
    expect(pending.map((p) => p.id)).toContain(req.id);
  });
});

describe('assignSubstituteTeacher', () => {
  it('assigns a substitute teacher and marks the request ASSIGNED', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2026, 6, 20), reason: '出差' });

    const updated = await assignSubstituteTeacher(req.id, substitute.id);
    expect(updated.status).toBe('ASSIGNED');
    expect(updated.substituteTeacherId).toBe(substitute.id);

    const pending = await listPendingSubstituteRequests();
    expect(pending.map((p) => p.id)).not.toContain(req.id);
  });
});

describe('listAssignedSubstituteRequestsForTeacher', () => {
  it('returns only upcoming substitute requests assigned to the given teacher, oldest first, with class times', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '數學' });
    const otherSubstitute = await createTeacher({ name: '王老師', email: 'wang@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    const later = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2030, 0, 14), reason: '進修' });
    await assignSubstituteTeacher(later.id, substitute.id);
    const sooner = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2030, 0, 7), reason: '出差' });
    await assignSubstituteTeacher(sooner.id, substitute.id);

    // 過去的指派不出現（首頁只列今天以後）
    const past = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2020, 0, 6), reason: '出差' });
    await assignSubstituteTeacher(past.id, substitute.id);

    // 指派給別人的不出現
    const otherReq = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2030, 0, 21), reason: '請假' });
    await assignSubstituteTeacher(otherReq.id, otherSubstitute.id);

    const results = await listAssignedSubstituteRequestsForTeacher(substitute.id);

    expect(results.map((r) => r.id)).toEqual([sooner.id, later.id]);
    expect(results[0].class.name).toBe('數學A班');
    expect(results[0].class.startTime).toBe('19:00');
    expect(results[0].class.endTime).toBe('21:00');
    expect(results[0].originalTeacher.user.name).toBe('陳老師');
  });
});

describe('teacherCanAccessClass', () => {
  it('allows the class\'s own regular teacher', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen2@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    expect(await teacherCanAccessClass(teacher.id, cls.id, new Date(2030, 0, 7))).toBe(true);
  });

  it('allows an ASSIGNED substitute on the assigned date, but not other dates', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen3@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin3@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    const req = await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2030, 0, 7), reason: '出差' });
    await assignSubstituteTeacher(req.id, substitute.id);

    expect(await teacherCanAccessClass(substitute.id, cls.id, new Date(2030, 0, 7))).toBe(true);
    expect(await teacherCanAccessClass(substitute.id, cls.id, new Date(2030, 0, 14))).toBe(false);
  });

  it('denies an unrelated teacher', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen4@example.com', password: 'x', subjects: '數學' });
    const other = await createTeacher({ name: '王老師', email: 'wang4@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });

    expect(await teacherCanAccessClass(other.id, cls.id, new Date(2030, 0, 7))).toBe(false);
  });

  it('denies a substitute whose request is still PENDING_ASSIGNMENT', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen5@example.com', password: 'x', subjects: '數學' });
    const substitute = await createTeacher({ name: '林老師', email: 'lin5@example.com', password: 'x', subjects: '數學' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
    // 建立請求但不指派——substitute 對此請求沒有 substituteTeacherId 關聯
    await createSubstituteRequest({ classId: cls.id, originalTeacherId: teacher.id, date: new Date(2030, 0, 7), reason: '出差' });

    expect(await teacherCanAccessClass(substitute.id, cls.id, new Date(2030, 0, 7))).toBe(false);
  });
});
