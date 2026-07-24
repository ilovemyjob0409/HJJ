import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createActivity, listAllActivities } from './activityService';

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
