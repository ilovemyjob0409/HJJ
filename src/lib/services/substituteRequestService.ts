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

export function assignSubstituteTeacher(id: string, substituteTeacherId: string) {
  return prisma.substituteRequest.update({
    where: { id },
    data: { substituteTeacherId, status: 'ASSIGNED' },
  });
}
