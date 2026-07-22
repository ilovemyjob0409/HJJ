import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import {
  createSessions,
  listAllSessions,
  listSessionsForTeacher,
  listOpenSessionsForStudent,
  deleteSession,
  registerForSession,
  cancelRegistration,
  adminRemoveRegistration,
  listRegistrationsForStudent,
  getSessionDetail,
} from './goHallService';

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

describe('createSessions / listAllSessions', () => {
  it('creates one session per date and lists them soonest-first with a registration count', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });

    const result = await createSessions({
      dates: [new Date(2026, 7, 15), new Date(2026, 7, 1)],
      startTime: '14:00',
      endTime: '16:00',
      capacity: 8,
      teacherId: teacher.id,
    });
    expect(result.count).toBe(2);

    const sessions = await listAllSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].date.getDate()).toBe(1);
    expect(sessions[1].date.getDate()).toBe(15);
    expect(sessions[0].teacher.user.name).toBe('陳老師');
    expect(sessions[0]._count.registrations).toBe(0);
  });
});

describe('listSessionsForTeacher', () => {
  it('returns only sessions assigned to the given teacher', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const teacherB = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacherA.id });
    await createSessions({ dates: [new Date(2026, 7, 2)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacherB.id });

    const results = await listSessionsForTeacher(teacherA.id);
    expect(results).toHaveLength(1);
    expect(results[0].teacher.user.name).toBe('陳老師');
  });
});

describe('listOpenSessionsForStudent', () => {
  it('excludes sessions dated before today', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await createSessions({ dates: [yesterday, tomorrow], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });

    const results = await listOpenSessionsForStudent();
    expect(results).toHaveLength(1);
  });
});

describe('deleteSession', () => {
  it('removes the session', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();

    await deleteSession(session.id);

    const remaining = await prisma.goHallSession.count();
    expect(remaining).toBe(0);
  });
});

describe('registerForSession', () => {
  it('creates a registration when under capacity', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();

    const registration = await registerForSession(session.id, student.id);
    expect(registration.sessionId).toBe(session.id);
    expect(registration.studentId).toBe(student.id);
  });

  it('throws SESSION_FULL once capacity is reached', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 1, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, studentA.id);

    await expect(registerForSession(session.id, studentB.id)).rejects.toThrow('SESSION_FULL');
  });

  it('allows only one of two concurrent registrations to succeed when capacity is 1', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 1, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();

    const results = await Promise.allSettled([registerForSession(session.id, studentA.id), registerForSession(session.id, studentB.id)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toBe('SESSION_FULL');

    const count = await prisma.goHallRegistration.count({ where: { sessionId: session.id } });
    expect(count).toBe(1);
  });
});

describe('cancelRegistration', () => {
  it('deletes the registration when the student owns it', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    const registration = await registerForSession(session.id, student.id);

    await cancelRegistration(registration.id, student.id);

    const remaining = await prisma.goHallRegistration.count();
    expect(remaining).toBe(0);
  });

  it('throws NOT_OWNER when a different student tries to cancel it', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    const registration = await registerForSession(session.id, student.id);

    await expect(cancelRegistration(registration.id, otherStudent.id)).rejects.toThrow('NOT_OWNER');
  });
});

describe('adminRemoveRegistration', () => {
  it('deletes the registration regardless of owner', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    const registration = await registerForSession(session.id, student.id);

    await adminRemoveRegistration(registration.id);

    const remaining = await prisma.goHallRegistration.count();
    expect(remaining).toBe(0);
  });
});

describe('listRegistrationsForStudent', () => {
  it('returns only the given student\'s registrations, with session details', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);
    await registerForSession(session.id, otherStudent.id);

    const results = await listRegistrationsForStudent(student.id);
    expect(results).toHaveLength(1);
    expect(results[0].session.id).toBe(session.id);
    expect(results[0].session.teacher.user.name).toBe('陳老師');
  });
});

describe('deleteSession (with an existing registration)', () => {
  it('removes the registration along with the session, leaving no orphaned row', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);

    await deleteSession(session.id);

    const remainingSessions = await prisma.goHallSession.count();
    const remainingRegistrations = await prisma.goHallRegistration.count();
    expect(remainingSessions).toBe(0);
    expect(remainingRegistrations).toBe(0);
  });
});

describe('getSessionDetail', () => {
  it('returns session info with the full (unmasked) roster', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '王大明', email: 'wang@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);

    const detail = await getSessionDetail(session.id);
    expect(detail.teacher.user.name).toBe('陳老師');
    expect(detail.registrations).toHaveLength(1);
    expect(detail.registrations[0].student.user.name).toBe('王大明');
  });
});
