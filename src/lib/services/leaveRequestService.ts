import { prisma } from '@/lib/db';
import { revokeMakeup } from './makeupRequestService';
import { notifyAdmins } from './notificationService';
import { formatDateWithWeekday } from '@/lib/dateFormat';

export interface CreateLeaveRequestInput {
  studentId: string;
  classId: string;
  date: Date;
  reason: string;
}

export async function createLeaveRequest(input: CreateLeaveRequestInput) {
  const enrolled = await prisma.classEnrollment.findUnique({
    where: { studentId_classId: { studentId: input.studentId, classId: input.classId } },
    include: { class: { select: { weekday: true, name: true } } },
  });
  if (!enrolled) throw new Error('NOT_ENROLLED');
  if (input.date.getUTCDay() !== enrolled.class.weekday) throw new Error('INVALID_WEEKDAY');

  const leave = await prisma.leaveRequest.create({
    data: { ...input, status: 'APPROVED', origin: 'STUDENT' },
  });
  await notifyAdminsNewLeave(input.studentId, enrolled.class.name, input.date);
  return leave;
}

// 學生自行請假時提醒行政（行政代辦 arrangeLeaveOnly 不經過這裡）。失敗只記 log。
async function notifyAdminsNewLeave(studentId: string, className: string, date: Date) {
  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { user: { select: { name: true } } },
    });
    if (!student) return;
    await notifyAdmins({
      title: '新請假申請',
      body: `${student.user.name} 已請假：${formatDateWithWeekday(date, 'zh-TW')}「${className}」`,
      url: '/admin',
    });
  } catch (err) {
    console.error('new leave request push notification failed', err);
  }
}

// 撤銷請假（學生／老師／行政共用）。掛有補課時先走 revokeMakeup
// （刪補課＋推播通知；補課已點名會擋 MAKEUP_HAS_ATTENDANCE），再刪請假。
// 兩步非同一交易：與現有「通知在交易外」的行為一致，最壞情況是補課已
// 撤而請假仍在，可重按一次撤銷完成。
export async function revokeLeaveRequest(leaveRequestId: string) {
  const leave = await prisma.leaveRequest.findUniqueOrThrow({
    where: { id: leaveRequestId },
    select: { id: true, makeupRequest: { select: { id: true } } },
  });
  if (leave.makeupRequest) {
    await revokeMakeup(leave.makeupRequest.id);
  }
  await prisma.leaveRequest.delete({ where: { id: leaveRequestId } });
}

export function listLeaveRequestsForStudent(studentId: string) {
  return prisma.leaveRequest.findMany({
    where: { studentId },
    include: {
      class: true,
      makeupRequest: {
        include: {
          targetClass: { select: { name: true } },
          teacher: { select: { user: { select: SAFE_USER_SELECT } } },
        },
      },
    },
    orderBy: { date: 'desc' },
  });
}

const SAFE_USER_SELECT = { name: true } as const;

// For the teacher dashboard: which students took leave from a class this
// teacher teaches, and when.
export function listLeaveRequestsForTeacherClasses(teacherId: string) {
  return prisma.leaveRequest.findMany({
    where: { class: { teacherId } },
    select: {
      id: true,
      date: true,
      reason: true,
      student: { select: { user: { select: SAFE_USER_SELECT } } },
      class: { select: { name: true } },
      makeupRequest: {
        select: {
          id: true,
          type: true,
          status: true,
          targetDate: true,
          targetClass: { select: { name: true } },
          slotDate: true,
          slotStartTime: true,
          slotEndTime: true,
          teacher: { select: { user: { select: SAFE_USER_SELECT } } },
        },
      },
    },
    orderBy: { date: 'desc' },
  });
}

// For the admin dashboard: every student's leave records, with the
// resulting insertion makeup (if any) so admins can see both the leave
// and the makeup class/date in one place.
export function listAllLeaveRequests() {
  return prisma.leaveRequest.findMany({
    select: {
      id: true,
      date: true,
      reason: true,
      origin: true,
      student: { select: { user: { select: SAFE_USER_SELECT } } },
      class: { select: { name: true } },
      makeupRequest: {
        select: {
          id: true,
          type: true,
          status: true,
          targetDate: true,
          targetClass: { select: { name: true } },
          slotDate: true,
          slotStartTime: true,
          slotEndTime: true,
          cancelRequestedAt: true,
          teacher: { select: { user: { select: SAFE_USER_SELECT } } },
        },
      },
    },
    orderBy: { date: 'desc' },
  });
}
