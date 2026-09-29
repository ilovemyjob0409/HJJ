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
