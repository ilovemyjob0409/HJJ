import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createLeaveRequest, listLeaveRequestsForStudent, listLeaveRequestsForTeacherClasses, listAllLeaveRequests, revokeLeaveRequest } from './leaveRequestService';
import { createInsertionMakeupRequest } from './makeupRequestService';

async function setupClassAndStudent() {
  const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '數學' });
  const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
  const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 1, startTime: '19:00', endTime: '21:00' });
  await enrollStudent(cls.id, student.id);
  return { student, cls };
}

describe('createLeaveRequest', () => {
  it('creates a leave request with status APPROVED', async () => {
    const { student, cls } = await setupClassAndStudent();
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '感冒' });
    expect(leave.status).toBe('APPROVED');
    expect(leave.reason).toBe('感冒');
  });

  it('throws INVALID_WEEKDAY when the date does not fall on the class weekday', async () => {
    const { student, cls } = await setupClassAndStudent(); // cls.weekday === 1 (Monday)
    await expect(
      createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 21)), reason: '事假' }) // a Tuesday
    ).rejects.toThrow('INVALID_WEEKDAY');
  });
});

describe('listLeaveRequestsForStudent', () => {
  it('returns only the given student\'s leave requests', async () => {
    const { student, cls } = await setupClassAndStudent();
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '感冒' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await enrollStudent(cls.id, otherStudent.id);
    await createLeaveRequest({ studentId: otherStudent.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 27)), reason: '事假' });

    const results = await listLeaveRequestsForStudent(student.id);
    expect(results).toHaveLength(1);
    expect(results[0].reason).toBe('感冒');
  });
});

describe('createLeaveRequest enrollment check', () => {
  it('throws NOT_ENROLLED for a class the student is not enrolled in', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小美', email: 'mei@example.com', password: 'x' });
    const cls = await createClass({ name: '數學D班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 4, startTime: '19:00', endTime: '21:00' });

    await expect(
      createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '事假' })
    ).rejects.toThrow('NOT_ENROLLED');
  });
});

describe('listLeaveRequestsForTeacherClasses', () => {
  it('returns only leave requests for classes taught by the given teacher', async () => {
    const { student, cls } = await setupClassAndStudent();
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '感冒' });

    const otherTeacher = await createTeacher({ name: '林老師', email: 'other-teacher@example.com', password: 'x', subjects: '英文' });
    const otherClass = await createClass({ name: '英文班', subject: '英文', level: '國一', teacherId: otherTeacher.id, weekday: 2, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(otherClass.id, student.id);
    await createLeaveRequest({ studentId: student.id, classId: otherClass.id, date: new Date(Date.UTC(2026, 6, 21)), reason: '事假' });

    const teacherOfCls = await prisma.class.findUniqueOrThrow({ where: { id: cls.id } });
    const results = await listLeaveRequestsForTeacherClasses(teacherOfCls.teacherId);

    expect(results).toHaveLength(1);
    expect(results[0].class.name).toBe('數學A班');
    expect(results[0].student.user.name).toBe('小明');
  });
});

describe('listAllLeaveRequests', () => {
  it('returns leave requests across all students, including insertion makeup details', async () => {
    const { student, cls } = await setupClassAndStudent();
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '感冒' });

    const teacher = await prisma.teacher.findFirstOrThrow();
    const targetClass = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: targetClass.id, targetDate: new Date(Date.UTC(2026, 6, 22)) });

    const results = await listAllLeaveRequests();

    expect(results).toHaveLength(1);
    expect(results[0].student.user.name).toBe('小明');
    expect(results[0].class.name).toBe('數學A班');
    expect(results[0].makeupRequest?.type).toBe('INSERTION');
    expect(results[0].makeupRequest?.targetClass?.name).toBe('數學B班');
  });
});

describe('createLeaveRequest 通知行政', () => {
  it('creating a student leave request does not throw when an admin has a push subscription', async () => {
    const admin = await prisma.user.create({ data: { email: 'leave-admin@example.com', password: 'x', name: '行政', role: 'ADMIN' } });
    await prisma.pushSubscription.create({
      data: { userId: admin.id, endpoint: 'https://push.example/admin-1', p256dh: 'k', auth: 'a' },
    });
    const teacher = await createTeacher({ name: '陳老師', email: 'leave-t@example.com', password: 'x', subjects: '數學' });
    const student = await createStudent({ name: '小明', email: 'leave-s@example.com', password: 'x' });
    const cls = await createClass({ name: '數學A班', subject: '數學', level: '國一', teacherId: teacher.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    await enrollStudent(cls.id, student.id);

    const leave = await createLeaveRequest({
      studentId: student.id,
      classId: cls.id,
      date: new Date(Date.UTC(2026, 6, 22)),
      reason: '事假',
    });

    expect(leave.status).toBe('APPROVED');
  });
});

describe('origin 標記', () => {
  it('學生自行申請的請假標記為 STUDENT', async () => {
    const { student, cls } = await setupClassAndStudent();
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '感冒' });
    expect(leave.origin).toBe('STUDENT');
  });
});

describe('revokeLeaveRequest', () => {
  it('沒有補課的請假直接刪除', async () => {
    const { student, cls } = await setupClassAndStudent();
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '感冒' });

    await revokeLeaveRequest(leave.id);

    expect(await prisma.leaveRequest.count({ where: { id: leave.id } })).toBe(0);
  });

  it('掛有補課的請假：補課與請假一併刪除', async () => {
    const { student, cls } = await setupClassAndStudent();
    const teacher2 = await createTeacher({ name: '林老師', email: 'lin2@example.com', password: 'x', subjects: '數學' });
    const clsB = await createClass({ name: '數學B班', subject: '數學', level: '國一', teacherId: teacher2.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '感冒' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: clsB.id, targetDate: new Date(Date.UTC(2026, 6, 22)) });

    await revokeLeaveRequest(leave.id);

    expect(await prisma.makeupRequest.count({ where: { id: makeup.id } })).toBe(0);
    expect(await prisma.leaveRequest.count({ where: { id: leave.id } })).toBe(0);
  });

  it('補課已有點名紀錄時擋下，請假保留', async () => {
    const { student, cls } = await setupClassAndStudent();
    const teacher2 = await createTeacher({ name: '吳老師', email: 'wu@example.com', password: 'x', subjects: '數學' });
    const clsB = await createClass({ name: '數學C班', subject: '數學', level: '國一', teacherId: teacher2.id, weekday: 3, startTime: '19:00', endTime: '21:00' });
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(Date.UTC(2026, 6, 20)), reason: '感冒' });
    const makeup = await createInsertionMakeupRequest({ leaveRequestId: leave.id, targetClassId: clsB.id, targetDate: new Date(Date.UTC(2026, 6, 22)) });
    const marker = await prisma.user.findFirstOrThrow();
    await prisma.classAttendance.create({
      data: {
        classId: clsB.id,
        studentId: student.id,
        date: new Date(Date.UTC(2026, 6, 22)),
        status: 'PRESENT',
        makeupRequestId: makeup.id,
        markedById: marker.id,
      },
    });

    await expect(revokeLeaveRequest(leave.id)).rejects.toThrow('MAKEUP_HAS_ATTENDANCE');
    expect(await prisma.leaveRequest.count({ where: { id: leave.id } })).toBe(1);
  });
});
