import { prisma } from '@/lib/db';
import { notifyUsers } from './notificationService';
import { formatActivityDateRange } from '@/lib/activityDateRange';
import { isBeforeToday } from '@/lib/pastDate';

export const STUDENT_ACTIVITY_URL = '/student/activities';
export const TEACHER_ACTIVITY_URL = '/teacher/activities';

// 通知用的活動快照：編輯前後各抓一份比對老師增減；刪除前抓一份保留收件人
export interface ActivitySnapshot {
  id: string;
  title: string;
  categoryName: string;
  location: string | null;
  startDate: Date;
  endDate: Date;
  capacity: number;
  teachers: { teacherId: string; userId: string }[];
  studentUserIds: string[];
}

export async function getActivitySnapshot(activityId: string): Promise<ActivitySnapshot | null> {
  const a = await prisma.activity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      title: true,
      location: true,
      startDate: true,
      endDate: true,
      capacity: true,
      category: { select: { name: true } },
      teachers: { select: { teacherId: true, teacher: { select: { userId: true } } } },
      registrations: { select: { student: { select: { userId: true } } } },
    },
  });
  if (!a) return null;
  return {
    id: a.id,
    title: a.title,
    categoryName: a.category.name,
    location: a.location,
    startDate: a.startDate,
    endDate: a.endDate,
    capacity: a.capacity,
    teachers: a.teachers.map((t) => ({ teacherId: t.teacherId, userId: t.teacher.userId })),
    studentUserIds: a.registrations.map((r) => r.student.userId),
  };
}

// 自動通知一律 best-effort：任何一步失敗只記 log，不影響活動的寫入主流程
export async function safeNotify(label: string, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    console.error(`activity notify (${label}) failed`, err);
  }
}

// 寫入「前」的快照也是 best-effort：抓不到就不發通知，但要留 log（不得默默吞掉）
export async function getActivitySnapshotSafe(activityId: string, label: string): Promise<ActivitySnapshot | null> {
  try {
    return await getActivitySnapshot(activityId);
  } catch (err) {
    console.error(`activity notify (${label}) snapshot failed`, err);
    return null;
  }
}

// 已結束的活動不發自動通知（行政補登舊資料時不打擾人）；手動推播不受此限
function isEnded(s: ActivitySnapshot): boolean {
  return isBeforeToday(s.endDate);
}

function dateRange(s: ActivitySnapshot): string {
  return formatActivityDateRange(s.startDate, s.endDate);
}

async function allStudentUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { role: 'STUDENT' }, select: { id: true } });
  return users.map((u) => u.id);
}

async function notifyTeachersAssigned(s: ActivitySnapshot, userIds: string[]): Promise<void> {
  await notifyUsers(userIds, {
    title: '活動帶隊指派',
    body: `你被指派帶領「${s.title}」，${dateRange(s)}`,
    url: TEACHER_ACTIVITY_URL,
  });
}

export async function notifyActivityCreated(s: ActivitySnapshot, options: { notifyStudents: boolean }): Promise<void> {
  if (isEnded(s)) return;
  await notifyTeachersAssigned(
    s,
    s.teachers.map((t) => t.userId)
  );
  if (!options.notifyStudents) return;
  await notifyUsers(await allStudentUserIds(), {
    title: '新活動開放報名',
    body: `${s.categoryName}｜${s.title}，${dateRange(s)}，名額 ${s.capacity} 位，點擊查看報名`,
    url: STUDENT_ACTIVITY_URL,
  });
}

// 編輯後的「活動資訊更新」內容：只寫出日期／地點的變動；名稱改了就附上原名稱
function buildUpdateBody(before: ActivitySnapshot, after: ActivitySnapshot): string {
  const name = before.title !== after.title ? `「${after.title}」（原「${before.title}」）` : `「${after.title}」`;
  const changes: string[] = [];
  if (
    before.startDate.getTime() !== after.startDate.getTime() ||
    before.endDate.getTime() !== after.endDate.getTime()
  ) {
    changes.push(`日期改為 ${dateRange(after)}`);
  }
  if ((before.location ?? '') !== (after.location ?? '')) {
    changes.push(after.location ? `地點改為 ${after.location}` : '地點改為未定');
  }
  return changes.length > 0 ? `${name}${changes.join('；')}` : `${name}活動資訊已更新，點擊查看`;
}

// 老師增減一律自動通知；「活動資訊更新」只在行政勾選時發給已報名學生＋留任老師
// （新加入的老師只收指派通知、被移除的只收取消指派，不重複）
export async function notifyActivityChanges(
  before: ActivitySnapshot,
  after: ActivitySnapshot,
  options: { notifyRegistered: boolean }
): Promise<void> {
  if (isEnded(after)) return;
  const beforeIds = new Set(before.teachers.map((t) => t.teacherId));
  const afterIds = new Set(after.teachers.map((t) => t.teacherId));
  const added = after.teachers.filter((t) => !beforeIds.has(t.teacherId)).map((t) => t.userId);
  const removed = before.teachers.filter((t) => !afterIds.has(t.teacherId)).map((t) => t.userId);
  const retained = after.teachers.filter((t) => beforeIds.has(t.teacherId)).map((t) => t.userId);

  await notifyTeachersAssigned(after, added);
  await notifyUsers(removed, {
    title: '活動帶隊取消指派',
    body: `你已不再帶領「${after.title}」，${dateRange(after)}`,
    url: TEACHER_ACTIVITY_URL,
  });
  if (!options.notifyRegistered) return;
  const body = buildUpdateBody(before, after);
  await notifyUsers(after.studentUserIds, { title: '活動資訊更新', body, url: STUDENT_ACTIVITY_URL });
  await notifyUsers(retained, { title: '活動資訊更新', body, url: TEACHER_ACTIVITY_URL });
}
