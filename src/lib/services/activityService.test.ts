import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { createSignedUrls } from '@/lib/storage';

vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(),
  createSignedUrls: vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`]))),
  deleteActivityImages: vi.fn(async () => {}),
}));

import {
  createActivity,
  listAllActivities,
  listActivitiesForTeacher,
  listOpenActivitiesForStudent,
  registerForActivity,
  cancelRegistration,
  adminRemoveRegistration,
  deleteActivity,
  listRegistrationsForStudent,
  getActivityDetail,
  listCategories,
  createCategory,
  deleteCategory,
} from './activityService';

beforeEach(async () => {
  await prisma.activityImage.deleteMany();
  await prisma.activityRegistration.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
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
  it('creates an activity and lists activities soonest-startDate-first with registration count, category, and teachers', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const otherTeacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    const camp = await createCategory('營隊');
    const lecture = await createCategory('講座');

    await createActivity({
      title: '暑期營隊',
      description: '為期三天的暑期營隊',
      categoryId: camp.id,
      location: '活動中心',
      startDate: new Date(2026, 7, 15),
      endDate: new Date(2026, 7, 17),
      capacity: 20,
      teacherIds: [teacher.id, otherTeacher.id],
    });
    await createActivity({
      title: '棋藝講座',
      description: '一日講座',
      categoryId: lecture.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 30,
      teacherIds: [teacher.id],
    });

    const activities = await listAllActivities();
    expect(activities).toHaveLength(2);
    expect(activities[0].title).toBe('棋藝講座');
    expect(activities[1].title).toBe('暑期營隊');
    expect(activities[1].category.name).toBe('營隊');
    const soonestTeacherNames = activities[1].teachers.map((t) => t.teacher.user.name);
    expect(soonestTeacherNames).toHaveLength(2);
    expect(soonestTeacherNames).toContain('陳老師');
    expect(soonestTeacherNames).toContain('林老師');
    expect(activities[0].teachers.map((t) => t.teacher.user.name)).toEqual(['陳老師']);
    expect(activities[0]._count.registrations).toBe(0);
    expect(activities[0].registrations).toEqual([]);
  });
});

describe('listActivitiesForTeacher', () => {
  it('returns only activities assigned to the given teacher', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const teacherB = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    await createActivity({
      title: 'A 活動',
      description: 'a',
      categoryId: category.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 10,
      teacherIds: [teacherA.id],
    });
    await createActivity({
      title: 'B 活動',
      description: 'b',
      categoryId: category.id,
      startDate: new Date(2026, 7, 2),
      endDate: new Date(2026, 7, 2),
      capacity: 10,
      teacherIds: [teacherB.id],
    });

    const results = await listActivitiesForTeacher(teacherA.id);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('A 活動');
  });

  it('returns an activity assigned to multiple teachers for each assigned teacher, and not for an unassigned one', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const teacherB = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    const teacherC = await createTeacher({ name: '王老師', email: 'wang@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    await createActivity({
      title: '共同帶領活動',
      description: 'x',
      categoryId: category.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 10,
      teacherIds: [teacherA.id, teacherB.id],
    });

    const resultsA = await listActivitiesForTeacher(teacherA.id);
    const resultsB = await listActivitiesForTeacher(teacherB.id);
    const resultsC = await listActivitiesForTeacher(teacherC.id);
    expect(resultsA).toHaveLength(1);
    expect(resultsB).toHaveLength(1);
    expect(resultsC).toHaveLength(0);
  });
});

describe('listOpenActivitiesForStudent', () => {
  it('excludes an activity whose endDate is in the past and includes one ending today or later', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await createActivity({ title: '已結束活動', description: 'x', categoryId: category.id, startDate: yesterday, endDate: yesterday, capacity: 10, teacherIds: [teacher.id] });
    await createActivity({ title: '進行中活動', description: 'x', categoryId: category.id, startDate: tomorrow, endDate: tomorrow, capacity: 10, teacherIds: [teacher.id] });

    const results = await listOpenActivitiesForStudent();
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('進行中活動');
  });
});

describe('registerForActivity', () => {
  it('creates a registration when under capacity', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();

    const registration = await registerForActivity(activity.id, student.id);
    expect(registration.activityId).toBe(activity.id);
    expect(registration.studentId).toBe(student.id);
  });

  it('throws ACTIVITY_FULL once capacity is reached', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 1, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, studentA.id);

    await expect(registerForActivity(activity.id, studentB.id)).rejects.toThrow('ACTIVITY_FULL');
  });

  it('allows only one of two concurrent registrations to succeed when capacity is 1', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const studentA = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const studentB = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 1, teacherIds: [teacher.id] });
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

describe('cancelRegistration', () => {
  it('deletes the registration when the student owns it', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    const registration = await registerForActivity(activity.id, student.id);

    await cancelRegistration(registration.id, student.id);

    const remaining = await prisma.activityRegistration.count();
    expect(remaining).toBe(0);
  });

  it('throws NOT_OWNER when a different student tries to cancel it', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    const registration = await registerForActivity(activity.id, student.id);

    await expect(cancelRegistration(registration.id, otherStudent.id)).rejects.toThrow('NOT_OWNER');
  });
});

describe('adminRemoveRegistration', () => {
  it('deletes the registration regardless of owner', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    const registration = await registerForActivity(activity.id, student.id);

    await adminRemoveRegistration(registration.id);

    const remaining = await prisma.activityRegistration.count();
    expect(remaining).toBe(0);
  });
});

describe('deleteActivity', () => {
  it('removes the activity along with its registrations and teacher assignments, leaving no orphaned row', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, student.id);

    await deleteActivity(activity.id);

    const remainingActivities = await prisma.activity.count();
    const remainingRegistrations = await prisma.activityRegistration.count();
    const remainingTeacherLinks = await prisma.activityTeacher.count();
    expect(remainingActivities).toBe(0);
    expect(remainingRegistrations).toBe(0);
    expect(remainingTeacherLinks).toBe(0);
  });
});

describe('listRegistrationsForStudent', () => {
  it("returns only the given student's registrations, with activity details", async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x' });
    const otherStudent = await createStudent({ name: '小華', email: 'hua@example.com', password: 'x' });
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, student.id);
    await registerForActivity(activity.id, otherStudent.id);

    const results = await listRegistrationsForStudent(student.id);
    expect(results).toHaveLength(1);
    expect(results[0].activity.id).toBe(activity.id);
    expect(results[0].activity.title).toBe('營隊');
  });
});

describe('getActivityDetail', () => {
  it('returns activity info with the full (unmasked) roster, category, and all assigned teachers', async () => {
    const teacherA = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const teacherB = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    const student = await createStudent({ name: '王大明', email: 'wang@example.com', password: 'x' });
    await createActivity({
      title: '營隊',
      description: 'x',
      categoryId: category.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 1),
      capacity: 8,
      teacherIds: [teacherA.id, teacherB.id],
    });
    const activity = await prisma.activity.findFirstOrThrow();
    await registerForActivity(activity.id, student.id);

    const detail = await getActivityDetail(activity.id);
    const teacherNames = detail.teachers.map((t) => t.teacher.user.name);
    expect(teacherNames).toHaveLength(2);
    expect(teacherNames).toContain('陳老師');
    expect(teacherNames).toContain('林老師');
    expect(detail.category.name).toBe('營隊');
    expect(detail.registrations).toHaveLength(1);
    expect(detail.registrations[0].student.user.name).toBe('王大明');
  });
});

describe('listCategories / createCategory / deleteCategory', () => {
  it('creates categories and lists all of them', async () => {
    await createCategory('講座');
    await createCategory('營隊');

    const categories = await listCategories();
    const names = categories.map((c) => c.name);
    expect(names).toHaveLength(2);
    expect(names).toContain('營隊');
    expect(names).toContain('講座');
  });

  it('throws CATEGORY_IN_USE when deleting a category still used by an activity', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const category = await createCategory('營隊');
    await createActivity({ title: '營隊', description: 'x', categoryId: category.id, startDate: new Date(2026, 7, 1), endDate: new Date(2026, 7, 1), capacity: 8, teacherIds: [teacher.id] });

    await expect(deleteCategory(category.id)).rejects.toThrow('CATEGORY_IN_USE');
  });

  it('deletes a category that is not used by any activity', async () => {
    const category = await createCategory('營隊');

    await deleteCategory(category.id);

    const remaining = await prisma.activityCategory.count();
    expect(remaining).toBe(0);
  });

  it('rejects creating a category with a name that already exists', async () => {
    await createCategory('營隊');

    await expect(createCategory('營隊')).rejects.toThrow();
  });
});

describe('coverUrl on list/detail queries', () => {
  it('returns null coverUrl for an activity with no images', async () => {
    const teacher = await createTeacher({ name: '陳老師', email: 'chen@example.com', password: 'x', subjects: '圍棋' });
    const camp = await createCategory('營隊');
    const activity = await createActivity({
      title: '無照片活動',
      description: 'd',
      categoryId: camp.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 2),
      capacity: 10,
      teacherIds: [teacher.id],
    });

    const [all] = await listAllActivities();
    expect(all.coverUrl).toBeNull();

    const detail = await getActivityDetail(activity.id);
    expect(detail.coverUrl).toBeNull();
  });

  it('returns the earliest-uploaded image as a signed coverUrl, and omits the raw images field', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin@example.com', password: 'x', subjects: '圍棋' });
    const camp = await createCategory('營隊');
    const activity = await createActivity({
      title: '有照片活動',
      description: 'd',
      categoryId: camp.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 2),
      capacity: 10,
      teacherIds: [teacher.id],
    });
    await prisma.activityImage.create({ data: { activityId: activity.id, storagePath: `${activity.id}/1.jpg` } });
    await new Promise((r) => setTimeout(r, 5)); // ensure distinct createdAt ordering
    await prisma.activityImage.create({ data: { activityId: activity.id, storagePath: `${activity.id}/2.jpg` } });

    const [all] = await listAllActivities();
    expect(all.coverUrl).toBe(`https://signed/${activity.id}/1.jpg`);
    expect((all as unknown as { images?: unknown }).images).toBeUndefined();

    const forTeacher = await listActivitiesForTeacher(teacher.id);
    expect(forTeacher[0].coverUrl).toBe(`https://signed/${activity.id}/1.jpg`);

    const open = await listOpenActivitiesForStudent();
    expect(open[0].coverUrl).toBe(`https://signed/${activity.id}/1.jpg`);

    const detail = await getActivityDetail(activity.id);
    expect(detail.coverUrl).toBe(`https://signed/${activity.id}/1.jpg`);

    const student = await createStudent({ name: '小明', email: 'ming@example.com', password: 'x', parentPhone: '' });
    await prisma.activityRegistration.create({ data: { activityId: activity.id, studentId: student.id } });
    const registrations = await listRegistrationsForStudent(student.id);
    expect(registrations[0].activity.coverUrl).toBe(`https://signed/${activity.id}/1.jpg`);
  });

  it('falls back to a null coverUrl instead of failing the whole list when signing URLs errors', async () => {
    const teacher = await createTeacher({ name: '林老師', email: 'lin2@example.com', password: 'x', subjects: '圍棋' });
    const camp = await createCategory('營隊');
    const activity = await createActivity({
      title: '簽名失敗活動',
      description: 'd',
      categoryId: camp.id,
      startDate: new Date(2026, 7, 1),
      endDate: new Date(2026, 7, 2),
      capacity: 10,
      teacherIds: [teacher.id],
    });
    await prisma.activityImage.create({ data: { activityId: activity.id, storagePath: `${activity.id}/1.jpg` } });

    vi.mocked(createSignedUrls).mockRejectedValueOnce(new Error('storage outage'));
    const [all] = await listAllActivities();
    expect(all.coverUrl).toBeNull();
  });
});

// Other service test files' beforeEach blocks predate the Activity /
// ActivityRegistration tables and don't clean them up before deleting
// Student, so a registration row left behind by this file's last test
// (e.g. the concurrency test, which intentionally leaves exactly one) would
// break every test file that runs after this one with a foreign key
// violation on student.deleteMany(). Clean up after ourselves so this file
// leaves no residue for other files, regardless of run order.
afterAll(async () => {
  await prisma.activityImage.deleteMany();
  await prisma.activityRegistration.deleteMany();
  await prisma.activityTeacher.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityCategory.deleteMany();
});
