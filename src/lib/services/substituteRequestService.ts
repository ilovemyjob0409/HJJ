import { prisma } from '@/lib/db';

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
export function listAssignedSubstituteRequestsForTeacher(teacherId: string) {
  // 老師首頁「被指派」區塊只列今天（含）以後，沿用全站 upcoming 邊界。
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return prisma.substituteRequest.findMany({
    where: { substituteTeacherId: teacherId, date: { gte: today } },
    select: {
      id: true,
      date: true,
      reason: true,
      status: true,
      class: { select: { name: true, startTime: true, endTime: true } },
      originalTeacher: { select: { user: { select: SAFE_USER_SELECT } } },
    },
    orderBy: { date: 'asc' },
  });
}
