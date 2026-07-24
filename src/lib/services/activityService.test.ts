import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import {
  createActivity,
  listAllActivities,
  listActivitiesForTeacher,
  listOpenActivitiesForStudent,
  registerForActivity,
} from './activityService';

beforeEach(async () => {
  await prisma.activityRegistration.deleteMany();
  await prisma.activity.deleteMany();
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

// Other service test files' beforeEach blocks predate the Activity /
// ActivityRegistration tables and don't clean them up before deleting
// Student, so a registration row left behind by this file's last test
// (e.g. the concurrency test, which intentionally leaves exactly one) would
// break every test file that runs after this one with a foreign key
// violation on student.deleteMany(). Clean up after ourselves so this file
// leaves no residue for other files, regardless of run order.
afterAll(async () => {
  await prisma.activityRegistration.deleteMany();
  await prisma.activity.deleteMany();
});

describe('createActivity / listAllActivities', () => {
  it('creates an activity and lists activities soonest-startDate-first with registration count and roster', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });

    await createActivity({
      title: '暑期營隊',
      description: '為期三天的暑期營隊',
      category: 'CAMP',
      location: '活動中心',
      startDate: new Date(2026, 7, 15),
      endDate: new Date(2026, 7, 17),
      capacity: 20,
      teacherId: teacher.id,
    });
    await createActivity({
      title: '棋藝講座',
      description: '一日講座',
      category: 'LECTURE',
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 30,
    });

    const activities = await listAllActivities();
    expect(activities).toHaveLength(2);
    expect(activities[0].title).toBe('棋藝講座');
    expect(activities[1].title).toBe('暑期營隊');
    expect(activities[1].teacher?.user.name).toBe('陳老師');
    expect(activities[0].teacher).toBeNull();
    expect(activities[0]._count.registrations).toBe(0);
    expect(activities[0].registrations).toEqual([]);
  });
});

describe('listActivitiesForTeacher', () => {
  it('returns only activities assigned to the given teacher', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const teacherB = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    await createActivity({
      title: 'A 活動',
      description: 'a',
      category: 'CAMP',
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 10,
      teacherId: teacherA.id,
    });
    await createActivity({
      title: 'B 活動',
      description: 'b',
      category: 'CAMP',
      startDate: new Date(2026, 7, 2),
      endDate: new Date(2026, 7, 2),
      capacity: 10,
      teacherId: teacherB.id,
    });

    const results = await listActivitiesForTeacher(teacherA.id);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('A 活動');
  });
});

describe('listOpenActivitiesForStudent', () => {
  it('excludes an activity whose endDate is in the past and includes one ending today or later', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await createActivity({ title: '已結束活動', description: 'x', category: 'CAMP', startDate: yesterday, endDate: yesterday, capacity: 10 });
    await createActivity({ title: '進行中活動', description: 'x', category: 'CAMP', startDate: tomorrow, endDate: tomorrow, capacity: 10 });

    const results = await listOpenActivitiesForStudent();
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('進行中活動');
  });
});

describe('registerForActivity', () => {
  it('creates a registration when under capacity', async () => {
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8 });
    const activity = await prisma.activity.findFirstOrThrow();

    const registration = await registerForActivity(activity.id, student.id);
    expect(registration.activityId).toBe(activity.id);
    expect(registration.studentId).toBe(student.id);
  });

  it('throws ACTIVITY_FULL once capacity is reached', async () => {
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 1 });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, studentA.id);

    await expect(registerForActivity(activity.id, studentB.id)).rejects.toThrow('ACTIVITY_FULL');
  });

  it('allows only one of two concurrent registrations to succeed when capacity is 1', async () => {
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', category: 'CAMP', startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 1 });
    const activity = await prisma.activity.findFirstOrThrow();

    const results = await Promise.allSettled([registerForActivity(activity.id, studentA.id), registerForActivity(activity.id, studentB.id)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toBe('ACTIVITY_FULL');

    const count = await prisma.activityRegistration.count({ where: { activityId: activity.id } });
    expect(count).toBe(1);
  });
});
