import { describe, it, expect, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createTeacher } from './teacherService';
import { createStudent } from './studentService';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import { formatDateWithWeekday } from '@/lib/dateFormat';

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
import {
  getActivitySnapshotSafe,
  sendActivityDayBeforeReminders,
  sendActivityAnnouncement,
  listActivityAnnouncements,
} from './activityNotifyService';

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

  it('「全體學生」以 Student 資料表為準：沒有 Student 資料的孤兒 STUDENT 帳號不收通知', async () => {
    const f = await setup();
    const orphan = await prisma.user.create({
      data: { name: '孤兒', email: 'orphan@example.com', password: 'x', role: 'STUDENT' },
    });
    await createActivity(input(f.category.id, [f.t1.id]), { notifyStudents: true });
    expect(await inbox(orphan.id)).toEqual([]);
    expect(await inbox(f.users.s1)).toHaveLength(1);
    expect(await inbox(f.users.s2)).toHaveLength(1);
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

describe('sendActivityDayBeforeReminders', () => {
  // 台北 2026-10-01 10:00 → 「明天」＝ 10/2
  const NOW = new Date('2026-10-01T02:00:00Z');
  const oct = (day: number) => new Date(Date.UTC(2026, 9, day));

  it('單日活動：已報名學生與帶隊老師收到行前提醒', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: oct(2), endDate: oct(2) }));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    expect(await sendActivityDayBeforeReminders(NOW)).toEqual({ activities: 1, notified: 2 });
    const start = formatDateWithWeekday(oct(2));
    expect(await inbox(f.users.s1)).toEqual([
      { title: '活動行前提醒', body: `明天 ${start} 是「冬令營」，地點：活動中心，記得準時參加`, url: S_URL },
    ]);
    expect(await inbox(f.users.t1)).toEqual([
      { title: '活動行前提醒', body: `明天 ${start} 帶領「冬令營」，目前報名 1 人，地點：活動中心`, url: T_URL },
    ]);
    expect(await inbox(f.users.s2)).toEqual([]);
  });

  it('多日活動：學生文案寫「明天開始，至結束日」；沒地點不帶地點字樣', async () => {
    const f = await setup();
    const a = await createActivity(
      input(f.category.id, [f.t1.id], { startDate: oct(2), endDate: oct(4), location: undefined })
    );
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    await sendActivityDayBeforeReminders(NOW);
    expect(await inbox(f.users.s1)).toEqual([
      {
        title: '活動行前提醒',
        body: `「冬令營」明天 ${formatDateWithWeekday(oct(2))} 開始，至 ${formatDateWithWeekday(oct(4))}`,
        url: S_URL,
      },
    ]);
  });

  it('沒人報名時老師仍收到（目前報名 0 人）', async () => {
    const f = await setup();
    await createActivity(input(f.category.id, [f.t1.id], { startDate: oct(2), endDate: oct(2), location: undefined }));
    await clearInbox();
    expect(await sendActivityDayBeforeReminders(NOW)).toEqual({ activities: 1, notified: 1 });
    expect(await inbox(f.users.t1)).toEqual([
      { title: '活動行前提醒', body: `明天 ${formatDateWithWeekday(oct(2))} 帶領「冬令營」，目前報名 0 人`, url: T_URL },
    ]);
  });

  it('其中一個活動的快照讀取失敗：只跳過它，另一個活動照常提醒', async () => {
    const f = await setup();
    const a1 = await createActivity(
      input(f.category.id, [f.t1.id], { title: '甲活動', startDate: oct(2), endDate: oct(2) })
    );
    const a2 = await createActivity(
      input(f.category.id, [f.t2.id], { title: '乙活動', startDate: oct(2), endDate: oct(2) })
    );
    await registerForActivity(a1.id, f.s1.id);
    await registerForActivity(a2.id, f.s2.id);
    await clearInbox();
    const spyFindUnique = vi.spyOn(prisma.activity, 'findUnique').mockRejectedValueOnce(new Error('boom'));
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await sendActivityDayBeforeReminders(NOW);
      expect(result.activities).toBe(2);
      // 兩個活動裡恰好一個被跳過、一個收到（學生＋老師各一則）
      expect(result.notified).toBe(2);
      expect(await prisma.notification.count()).toBe(2);
      expect(spyError).toHaveBeenCalled();
    } finally {
      spyFindUnique.mockRestore();
      spyError.mockRestore();
    }
  });

  it('只看第一天：今天開始、明天仍在進行的活動不提醒', async () => {
    const f = await setup();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: oct(1), endDate: oct(3) }));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    expect(await sendActivityDayBeforeReminders(NOW)).toEqual({ activities: 0, notified: 0 });
    expect(await prisma.notification.count()).toBe(0);
  });

  it('「明天」以台北日期計算：UTC 還是 9/30、台北已是 10/1 凌晨時，明天＝10/2', async () => {
    const f = await setup();
    await createActivity(input(f.category.id, [f.t1.id], { title: '明天的', startDate: oct(2), endDate: oct(2) }));
    await createActivity(input(f.category.id, [f.t1.id], { title: '今天的', startDate: oct(1), endDate: oct(1) }));
    await clearInbox();
    const result = await sendActivityDayBeforeReminders(new Date('2026-09-30T17:00:00Z'));
    expect(result.activities).toBe(1);
    const bodies = (await inbox(f.users.t1)).map((n) => n.body);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('「明天的」');
  });
});

describe('手動推播 sendActivityAnnouncement', () => {
  function createAdmin() {
    return prisma.user.create({ data: { name: '王行政', email: 'admin@example.com', password: 'x', role: 'ADMIN' } });
  }

  it('對象＝已報名學生：只通知已報名者，並寫一筆發送紀錄', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await clearInbox();
    const result = await sendActivityAnnouncement({
      activityId: a.id,
      senderId: admin.id,
      audience: 'REGISTERED',
      includeTeachers: false,
      message: '明天記得帶水壺',
    });
    expect(result).toEqual({ recipientCount: 1 });
    expect(await inbox(f.users.s1)).toEqual([{ title: '活動通知：冬令營', body: '明天記得帶水壺', url: S_URL }]);
    expect(await inbox(f.users.s2)).toEqual([]);
    expect(await inbox(f.users.t1)).toEqual([]);
    const log = await listActivityAnnouncements(a.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      audience: 'REGISTERED',
      includeTeachers: false,
      message: '明天記得帶水壺',
      recipientCount: 1,
      sender: { name: '王行政' },
    });
  });

  it('對象＝全體學生＋含老師：全體學生與帶隊老師都收到', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await clearInbox();
    const result = await sendActivityAnnouncement({
      activityId: a.id,
      senderId: admin.id,
      audience: 'ALL_STUDENTS',
      includeTeachers: true,
      message: '名額剩 3 位',
    });
    expect(result).toEqual({ recipientCount: 3 });
    expect(await inbox(f.users.s1)).toEqual([{ title: '活動通知：冬令營', body: '名額剩 3 位', url: S_URL }]);
    expect(await inbox(f.users.s2)).toEqual([{ title: '活動通知：冬令營', body: '名額剩 3 位', url: S_URL }]);
    expect(await inbox(f.users.t1)).toEqual([{ title: '活動通知：冬令營', body: '名額剩 3 位', url: T_URL }]);
    expect(await inbox(f.users.t2)).toEqual([]);
  });

  it('已結束的活動也能手動推播', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id], { startDate: PAST, endDate: PAST }));
    await registerForActivity(a.id, f.s1.id);
    const result = await sendActivityAnnouncement({
      activityId: a.id,
      senderId: admin.id,
      audience: 'REGISTERED',
      includeTeachers: false,
      message: '活動照片已上傳到相簿',
    });
    expect(result).toEqual({ recipientCount: 1 });
    expect(await inbox(f.users.s1)).toHaveLength(1);
  });

  it('收件人 0 人時丟 NO_RECIPIENTS，且不寫紀錄、不發通知', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await clearInbox();
    await expect(
      sendActivityAnnouncement({ activityId: a.id, senderId: admin.id, audience: 'REGISTERED', includeTeachers: false, message: 'x' })
    ).rejects.toThrow('NO_RECIPIENTS');
    expect(await listActivityAnnouncements(a.id)).toEqual([]);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('只勾老師（沒人報名）也能送：只通知帶隊老師', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await clearInbox();
    const result = await sendActivityAnnouncement({
      activityId: a.id,
      senderId: admin.id,
      audience: 'REGISTERED',
      includeTeachers: true,
      message: '集合時間提早',
    });
    expect(result).toEqual({ recipientCount: 1 });
    expect(await inbox(f.users.t1)).toHaveLength(1);
  });

  it('活動不存在時丟 NOT_FOUND', async () => {
    const admin = await createAdmin();
    await expect(
      sendActivityAnnouncement({ activityId: 'nope', senderId: admin.id, audience: 'ALL_STUDENTS', includeTeachers: false, message: 'x' })
    ).rejects.toThrow('NOT_FOUND');
  });

  it('發送紀錄新到舊排序', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    const base = { activityId: a.id, senderId: admin.id, audience: 'REGISTERED' as const, includeTeachers: false, recipientCount: 1 };
    await prisma.activityAnnouncement.create({ data: { ...base, message: '舊', createdAt: new Date('2099-01-01T01:00:00Z') } });
    await prisma.activityAnnouncement.create({ data: { ...base, message: '新', createdAt: new Date('2099-01-02T01:00:00Z') } });
    expect((await listActivityAnnouncements(a.id)).map((r) => r.message)).toEqual(['新', '舊']);
  });

  it('刪除活動時一併清掉發送紀錄', async () => {
    const f = await setup();
    const admin = await createAdmin();
    const a = await createActivity(input(f.category.id, [f.t1.id]));
    await registerForActivity(a.id, f.s1.id);
    await sendActivityAnnouncement({ activityId: a.id, senderId: admin.id, audience: 'REGISTERED', includeTeachers: false, message: 'x' });
    await deleteActivity(a.id);
    expect(await prisma.activityAnnouncement.count()).toBe(0);
    expect(await prisma.activity.count()).toBe(0);
  });
});
