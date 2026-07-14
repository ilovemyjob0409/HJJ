import { prisma } from '@/lib/db';

export interface CreateLeaveRequestInput {
  studentId: string;
  classId: string;
  date: Date;
  reason: string;
}

export function createLeaveRequest(input: CreateLeaveRequestInput) {
  return prisma.leaveRequest.create({
    data: { ...input, status: 'APPROVED' },
  });
}

export function listLeaveRequestsForStudent(studentId: string) {
  return prisma.leaveRequest.findMany({
    where: { studentId },
    include: { class: true, makeupRequest: true },
    orderBy: { date: 'desc' },
  });
}
