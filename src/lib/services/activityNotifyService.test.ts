import { describe, it, expect, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { formatActivityDateRange } from '@/lib/activityDateRange';

vi.mock('@/lib/storage', () => ({
  uploadActivityImage: vi.fn(),
  createSignedUrls: vi.fn(async () => new Map()),
  createSignedThumbUrls: vi.fn(async () => new Map()),
  deleteActivityImages: vi.fn(async () => {}),
}));

import { createActivity, createCategory, CreateActivityInput } from './activityService';

// 2099 一定是「未來」、2020 一定「已結束」——測試結果不受執行日期影響
const FUTURE = new Date(Date.UTC(2099, 0, 10));
const PAST = new Date(Date.UTC(2020, 0, 10));
const S_URL = '/student/activities';
const T_URL = '/teacher/activities';

async function teacherUserId(teacherId: string) {
  return (await prisma.teacher.findUniqueOrThrow({ where: { id: teacherId }, select: { userId: true } })).userId;
}
async function studentUserId(studentId: string) {
  return (await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true } })).userId;
}

async function setup() {
  const t1 = await createTeacher({ name: '陳老師', email: 't1@example.com', password: 'x', subjects: '圍棋' });
  const t2 = await createTeacher({ name: '林老師', email: 't2@example.com', password: 'x', subjects: '圍棋' });
  const s1 = await createStudent({ name: '王小明', email: 's1@example.com' });
  const s2 = await createStudent({ name: '李小華', email: 's2@example.com' });
  const category = await createCategory('營隊');
  const users = {
    t1: await teacherUserId(t1.id),
    t2: await teacherUserId(t2.id),
    s1: await studentUserId(s1.id),
    s2: await studentUserId(s2.id),
  };
  return { t1, t2, s1, s2, category, users };
}

function input(categoryId: string, teacherIds: string[], overrides: Partial<CreateActivityInput> = {}): CreateActivityInput {
  return {
    title: '冬令營',
    description: '三天營隊',
    categoryId,
    location: '活動中心',
    startDate: FUTURE,
    endDate: FUTURE,
    capacity: 20,
    teacherIds,
    ...overrides,
  };
}

function inbox(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { title: true, body: true, url: true },
  });
}

describe('新增活動通知', () => {
  it('勾選通知時：全體學生收到「新活動開放報名」、帶隊老師收到指派通知', async () => {
    const f = await setup();
    await createActivity(input(f.category.id, [f.t1.id]), { notifyStudents: true });
    const range = formatActivityDateRange(FUTURE, FUTURE);
    for (const uid of [f.users.s1, f.users.s2]) {
      expect(await inbox(uid)).toEqual([
        { title: '新活動開放報名', body: `營隊｜冬令營，${range}，名額 20 位，點擊查看報名`, url: S_URL },
      ]);
    }
    expect(await inbox(f.users.t1)).toEqual([
      { title: '活動帶隊指派', body: `你被指派帶領「冬令營」，${range}`, url: T_URL },
    ]);
    expect(await inbox(f.users.t2)).toEqual([]);
  });

  it('沒帶選項（預設不通知學生）時學生收不到，但老師照收指派', async () => {
    const f = await setup();
    await createActivity(input(f.category.id, [f.t1.id, f.t2.id]));
    expect(await inbox(f.users.s1)).toEqual([]);
    expect(await inbox(f.users.t1)).toHaveLength(1);
    expect(await inbox(f.users.t2)).toHaveLength(1);
  });

  it('已結束的活動不發任何自動通知', async () => {
    const f = await setup();
    await createActivity(input(f.category.id, [f.t1.id], { startDate: PAST, endDate: PAST }), { notifyStudents: true });
    expect(await prisma.notification.count()).toBe(0);
  });
});
