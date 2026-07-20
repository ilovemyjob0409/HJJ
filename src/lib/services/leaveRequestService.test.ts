import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createClass, enrollStudent } from './classService';
import { createLeaveRequest, listLeaveRequestsForStudent } from './leaveRequestService';

beforeEach(async () => {
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
    const leave = await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(2026, 6, 20), reason: '感冒' });
    expect(leave.status).toBe('APPROVED');
    expect(leave.reason).toBe('感冒');
  });
});

describe('listLeaveRequestsForStudent', () => {
  it('returns only the given student\'s leave requests', async () => {
    const { student, cls } = await setupClassAndStudent();
    await createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(2026, 6, 20), reason: '感冒' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await enrollStudent(cls.id, otherStudent.id);
    await createLeaveRequest({ studentId: otherStudent.id, classId: cls.id, date: new Date(2026, 6, 21), reason: '事假' });

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
      createLeaveRequest({ studentId: student.id, classId: cls.id, date: new Date(2026, 6, 20), reason: '事假' })
    ).rejects.toThrow('NOT_ENROLLED');
  });
});
