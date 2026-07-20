import { prisma } from '@/lib/db';

export interface CreateLeaveRequestInput {
  studentId: string;
  classId: string;
  date: Date;
  reason: string;
}

export async function createLeaveRequest(input: CreateLeaveRequestInput) {
  const enrolled = await prisma.classEnrollment.findUnique({
    where: { studentId_classId: { studentId: input.studentId, classId: input.classId } },
  });
  if (!enrolled) throw new Error('NOT_ENROLLED');

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
