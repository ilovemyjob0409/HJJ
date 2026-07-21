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
      student: { select: { user: { select: SAFE_USER_SELECT } } },
      class: { select: { name: true } },
      makeupRequest: {
        select: {
          id: true,
          type: true,
          status: true,
          targetDate: true,
          targetClass: { select: { name: true } },
        },
      },
    },
    orderBy: { date: 'desc' },
  });
}
