import { prisma } from '@/lib/db';

// 點名等處的班級歸屬檢查：原班導師，或當天已指派的代課老師，皆可存取。
export async function teacherCanAccessClass(teacherId: string, classId: string, date: Date): Promise<boolean> {
  const cls = await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { teacherId: true } });
  if (cls.teacherId === teacherId) return true;
  const sub = await prisma.substituteRequest.findFirst({
    where: { substituteTeacherId: teacherId, classId, date, status: 'ASSIGNED' },
    select: { id: true },
  });
  return sub !== null;
}

export interface CreateSubstituteRequestInput {
  classId: string;
  originalTeacherId: string;
  date: Date;
  reason: string;
}

export function createSubstituteRequest(input: CreateSubstituteRequestInput) {
  return prisma.substituteRequest.create({ data: { ...input, status: 'PENDING_ASSIGNMENT' } });
}

const SAFE_USER_SELECT = { name: true, email: true } as const;

export function listPendingSubstituteRequests() {
  return prisma.substituteRequest.findMany({
    where: { status: 'PENDING_ASSIGNMENT' },
    select: {
      id: true,
      date: true,
      reason: true,
      status: true,
      createdAt: true,
      class: true,
      originalTeacher: { select: { id: true, subjects: true, phone: true, user: { select: SAFE_USER_SELECT } } },
    },
    orderBy: { date: 'asc' },
  });
}

export function listAllSubstituteRequests() {
  return prisma.substituteRequest.findMany({
    select: {
      id: true,
      date: true,
      reason: true,
      status: true,
      class: { select: { name: true } },
      originalTeacher: { select: { user: { select: SAFE_USER_SELECT } } },
      substituteTeacher: { select: { user: { select: SAFE_USER_SELECT } } },
    },
    orderBy: { date: 'desc' },
  });
}

export function assignSubstituteTeacher(id: string, substituteTeacherId: string) {
  return prisma.substituteRequest.update({
    where: { id },
    data: { substituteTeacherId, status: 'ASSIGNED' },
  });
}

// For the teacher dashboard: substitute duties assigned to this teacher.
// 學生名單附堂數進度，算法與 listClassesForTeacher 一致（單一批次
// groupBy 掃所有相關班級，避免逐生查詢；正式站 pg pool max:1）。
export async function listAssignedSubstituteRequestsForTeacher(teacherId: string) {
  // 老師首頁「被指派」區塊只列今天（含）以後，沿用全站 upcoming 邊界。
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const requests = await prisma.substituteRequest.findMany({
    where: { substituteTeacherId: teacherId, date: { gte: today } },
    select: {
      id: true,
      date: true,
      reason: true,
      status: true,
      class: {
        select: {
          id: true,
          name: true,
          startTime: true,
          endTime: true,
          enrollments: {
            select: { totalSessions: true, student: { select: { id: true, user: { select: SAFE_USER_SELECT } } } },
          },
        },
      },
      originalTeacher: { select: { user: { select: SAFE_USER_SELECT } } },
    },
    orderBy: { date: 'asc' },
  });

  const classIds = Array.from(new Set(requests.map((r) => r.class.id)));
  const counts =
    classIds.length === 0
      ? []
      : await prisma.classAttendance.groupBy({
          by: ['classId', 'studentId'],
          // 請假與未報名（報名時聲明不來、未繳該堂費用）都不扣堂。
          where: { classId: { in: classIds }, status: { notIn: ['ON_LEAVE', 'NOT_REGISTERED'] } },
          _count: { _all: true },
        });
  const usedByKey = new Map(counts.map((c) => [`${c.classId}:${c.studentId}`, c._count._all]));

  return requests.map((r) => ({
    ...r,
    class: {
      ...r.class,
      students: r.class.enrollments.map((e) => {
        const usedSessions = usedByKey.get(`${r.class.id}:${e.student.id}`) ?? 0;
        return {
          studentId: e.student.id,
          name: e.student.user.name,
          totalSessions: e.totalSessions,
          usedSessions,
          remaining: e.totalSessions === null ? null : e.totalSessions - usedSessions,
        };
      }),
    },
  }));
}
