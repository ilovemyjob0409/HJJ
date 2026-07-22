import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createSessions, listAllSessions, listSessionsForTeacher, listOpenSessionsForStudent, deleteSession } from './goHallService';

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
