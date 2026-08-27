import { describe, it, expect } from 'vitest';
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
  adminRegisterForSession,
  cancelRegistration,
  adminRemoveRegistration,
  listRegistrationsForStudent,
  getSessionDetail,
  getSessionDetailWithQualifications,
} from './goHallService';
import { purchaseTickets, getTicketBalance } from './goHallTicketService';
import { saveGoHallAttendance } from './attendanceService';
import { taipeiDateKey } from './tutoringBookingService';

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
  // Cancellation is only allowed while the session has not passed, so these
  // fixtures must use relative dates to keep testing the allowed path.
  it('deletes the registration when the student owns it', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await createSessions({ dates: [tomorrow], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
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
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await createSessions({ dates: [tomorrow], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    const registration = await registerForSession(session.id, student.id);

    await expect(cancelRegistration(registration.id, otherStudent.id)).rejects.toThrow('NOT_OWNER');
  });

  it('throws SESSION_EXPIRED and keeps the registration when the session date has passed', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await createSessions({ dates: [yesterday], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    const registration = await registerForSession(session.id, student.id);

    await expect(cancelRegistration(registration.id, student.id)).rejects.toThrow('SESSION_EXPIRED');

    const remaining = await prisma.goHallRegistration.count();
    expect(remaining).toBe(1);
  });

  it('still allows cancelling a session dated today', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    // 台北今天，以日期欄位的實際存法（UTC 午夜代表曆日）建構，而非伺服器
    // 當地午夜——兩者在正式站（UTC）並不相等。
    const [ty, tm, td] = taipeiDateKey(new Date()).split('-').map(Number);
    const todayMidnight = new Date(Date.UTC(ty, tm - 1, td));
    await createSessions({ dates: [todayMidnight], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    const registration = await registerForSession(session.id, student.id);

    await cancelRegistration(registration.id, student.id);

    const remaining = await prisma.goHallRegistration.count();
    expect(remaining).toBe(0);
  });
});

describe('adminRegisterForSession', () => {
  it('registers a student even when the session is already at capacity', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await createSessions({ dates: [tomorrow], startTime: '14:00', endTime: '16:00', capacity: 1, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, studentA.id);

    const registration = await adminRegisterForSession(session.id, studentB.id);
    expect(registration.studentId).toBe(studentB.id);

    const count = await prisma.goHallRegistration.count({ where: { sessionId: session.id } });
    expect(count).toBe(2);
  });

  it('throws SESSION_EXPIRED for a session dated before today', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await createSessions({ dates: [yesterday], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();

    await expect(adminRegisterForSession(session.id, student.id)).rejects.toThrow('SESSION_EXPIRED');
  });

  it('throws ALREADY_REGISTERED when the student already has a registration', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await createSessions({ dates: [tomorrow], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);

    await expect(adminRegisterForSession(session.id, student.id)).rejects.toThrow('ALREADY_REGISTERED');
  });
});

describe('registerForSession (duplicate)', () => {
  it('throws ALREADY_REGISTERED instead of a raw Prisma error', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 1)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);

    await expect(registerForSession(session.id, student.id)).rejects.toThrow('ALREADY_REGISTERED');
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

describe('getSessionDetailWithQualifications', () => {
  it('attaches a predicted qualification per registration', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 15)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    await registerForSession(session.id, student.id);
    await purchaseTickets({ studentId: student.id, sessions: 5 });

    const detail = await getSessionDetailWithQualifications(session.id);
    expect(detail.registrations).toHaveLength(1);
    expect(detail.registrations[0].qualification).toBe('TICKET');
    expect(detail.registrations[0].qualificationPredicted).toBe(true);
  });
});

describe('adminRemoveRegistration (attendance cleanup)', () => {
  it('refunds the ticket and clears attendance when removing a registration that was already marked present', async () => {
    await prisma.user.create({
      data: { id: 'marker-1', email: 'marker@example.com', password: 'x', name: 'Marker', role: 'TEACHER' },
    });
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createSessions({ dates: [new Date(2026, 7, 15)], startTime: '14:00', endTime: '16:00', capacity: 8, teacherId: teacher.id });
    const session = await prisma.goHallSession.findFirstOrThrow();
    const registration = await registerForSession(session.id, student.id);
    await purchaseTickets({ studentId: student.id, sessions: 5 });
    await saveGoHallAttendance(session.id, 'marker-1', [{ studentId: student.id, status: 'PRESENT' }]);

    await adminRemoveRegistration(registration.id);

    const balance = await getTicketBalance(student.id);
    expect(balance).toBe(5);
    const attendanceCount = await prisma.goHallAttendance.count({ where: { sessionId: session.id, studentId: student.id } });
    expect(attendanceCount).toBe(0);
    const remaining = await prisma.goHallRegistration.count({ where: { id: registration.id } });
    expect(remaining).toBe(0);
  });
});
