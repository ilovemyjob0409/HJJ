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

import {
  createActivity,
  createCategory,
  CreateActivityInput,
  registerForActivity,
  cancelRegistration,
  updateActivity,
  deleteActivity,
  adminRegisterStudent,
  adminRemoveRegistration,
} from './activityService';
import { getActivitySnapshotSafe } from './activityNotifyService';

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

async function clearInbox() {
  await prisma.notification.deleteMany();
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

describe('編輯活動通知', () => {
  it('老師名單增減：新增者收指派、被移除者收取消指派；沒勾通知時學生收不到', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await updateActivity(a.id, input(f.category.id, [f.t2.id]));
    const range = formatActivityDateRange(FUTURE, FUTURE);
    expect(await inbox(f.users.t2)).toEqual([{ title: '活動帶隊指派', body: `你被指派帶領「冬令營」，${range}`, url: T_URL }]);
    expect(await inbox(f.users.t1)).toEqual([{ title: '活動帶隊取消指派', body: `你已不再帶領「冬令營」，${range}`, url: T_URL }]);
    expect(await inbox(f.users.s1)).toEqual([]);
  });

  it('勾選通知＋日期與地點都改：已報名學生與留任老師收到變更內容，新加入老師只收指派', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    const newStart = new Date(Date.UTC(2099, 0, 20));
    const newEnd = new Date(Date.UTC(2099, 0, 22));
    await updateActivity(
      a.id,
      input(f.category.id, [f.t1.id, f.t2.id], { startDate: newStart, endDate: newEnd, location: '大禮堂' }),
      { notifyRegistered: true }
    );
    const newRange = formatActivityDateRange(newStart, newEnd);
    const body = `「冬令營」日期改為 ${newRange}；地點改為 大禮堂`;
    expect(await inbox(f.users.s1)).toEqual([{ title: '活動資訊更新', body, url: S_URL }]);
    expect(await inbox(f.users.t1)).toEqual([{ title: '活動資訊更新', body, url: T_URL }]);
    expect(await inbox(f.users.t2)).toEqual([{ title: '活動帶隊指派', body: `你被指派帶領「冬令營」，${newRange}`, url: T_URL }]);
    expect(await inbox(f.users.s2)).toEqual([]);
  });

  it('勾選通知＋只改名稱：寫出原名稱與「活動資訊已更新」', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await updateActivity(a.id, input(f.category.id, [f.t1.id], { title: '冬季營隊' }), { notifyRegistered: true });
    expect(await inbox(f.users.s1)).toEqual([
      { title: '活動資訊更新', body: '「冬季營隊」（原「冬令營」）活動資訊已更新，點擊查看', url: S_URL },
    ]);
  });

  it('勾選通知＋清空地點：寫「地點改為未定」', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await updateActivity(a.id, input(f.category.id, [f.t1.id], { location: undefined }), { notifyRegistered: true });
    expect(await inbox(f.users.s1)).toEqual([{ title: '活動資訊更新', body: '「冬令營」地點改為未定', url: S_URL }]);
  });

  it('已結束的活動：老師增減與勾選通知都不發', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: PAST, endDate: PAST }));
    await registerForActivity(a.id, f.s1.id);
    await updateActivity(a.id, input(f.category.id, [f.t2.id], { startDate: PAST, endDate: PAST }), { notifyRegistered: true });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('getActivitySnapshotSafe 快照失敗時記 log 並回傳 null', async () => {
    const spyFindUnique = vi.spyOn(prisma.activity, 'findUnique').mockRejectedValueOnce(new Error('boom'));
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await getActivitySnapshotSafe('x', 'updated');
    expect(result).toBeNull();
    expect(spyError).toHaveBeenCalledWith(
      expect.stringContaining('activity notify (updated) snapshot failed'),
      expect.any(Error)
    );
    spyFindUnique.mockRestore();
    spyError.mockRestore();
  });
});

describe('刪除活動與行政代報名／移除通知', () => {
  it('刪除未結束活動：已報名學生與帶隊老師收到「活動取消」', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await deleteActivity(a.id);
    const body = `「冬令營」已取消，原訂 ${formatActivityDateRange(FUTURE, FUTURE)}`;
    expect(await inbox(f.users.s1)).toEqual([{ title: '活動取消', body, url: S_URL }]);
    expect(await inbox(f.users.t1)).toEqual([{ title: '活動取消', body, url: T_URL }]);
    expect(await inbox(f.users.s2)).toEqual([]);
  });

  it('刪除已結束活動不發通知', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: PAST, endDate: PAST }));
    await registerForActivity(a.id, f.s1.id);
    await deleteActivity(a.id);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('行政代報名：學生收到「活動報名成功」含地點', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await clearInbox();
    await adminRegisterStudent(a.id, f.s1.id);
    expect(await inbox(f.users.s1)).toEqual([
      {
        title: '活動報名成功',
        body: `行政已幫你報名「冬令營」，${formatActivityDateRange(FUTURE, FUTURE)}，地點：活動中心`,
        url: S_URL,
      },
    ]);
  });

  it('行政代報名：活動沒有地點時不帶地點字樣', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { location: undefined }));
    await clearInbox();
    await adminRegisterStudent(a.id, f.s1.id);
    expect(await inbox(f.users.s1)).toEqual([
      { title: '活動報名成功', body: `行政已幫你報名「冬令營」，${formatActivityDateRange(FUTURE, FUTURE)}`, url: S_URL },
    ]);
  });

  it('行政移除報名：學生收到「活動報名已取消」', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    const reg = await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await adminRemoveRegistration(reg.id);
    expect(await inbox(f.users.s1)).toEqual([
      {
        title: '活動報名已取消',
        body: `行政已取消你「冬令營」的報名，原訂 ${formatActivityDateRange(FUTURE, FUTURE)}`,
        url: S_URL,
      },
    ]);
  });

  it('學生自己報名／取消不發任何通知', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await clearInbox();
    const reg = await registerForActivity(a.id, f.s1.id);
    await cancelRegistration(reg.id, f.s1.id);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('已結束活動的代報名／移除不發通知', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: PAST, endDate: PAST }));
    const reg = await adminRegisterStudent(a.id, f.s1.id);
    await adminRemoveRegistration(reg.id);
    expect(await prisma.notification.count()).toBe(0);
  });
});
