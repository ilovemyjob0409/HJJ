import { prisma } from '@/lib/db';
import { ActivityCategory, Prisma } from '@prisma/client';
import { runSerializableWithRetry } from '@/lib/transaction';

// Activity rosters are sent to STUDENT-role requesters (with names masked)
// as well as ADMIN/TEACHER (real names) — email must not be selected here
// or it would leak unmasked in the student-facing response.
const NAME_ONLY_SELECT = { name: true } as const;

const ACTIVITY_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  location: true,
  startDate: true,
  endDate: true,
  capacity: true,
  teacher: { select: { user: { select: NAME_ONLY_SELECT } } },
  registrations: {
    select: {
      id: true,
      studentId: true,
      student: { select: { user: { select: NAME_ONLY_SELECT } } },
    },
  },
  _count: { select: { registrations: true } },
} as const;

const ACTIVITY_STUDENT_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  location: true,
  startDate: true,
  endDate: true,
  capacity: true,
  teacher: { select: { user: { select: NAME_ONLY_SELECT } } },
  _count: { select: { registrations: true } },
} as const;

export interface CreateActivityInput {
  title: string;
  description: string;
  category: ActivityCategory;
  location?: string;
  startDate: Date;
  endDate: Date;
  capacity: number;
  teacherId?: string;
}

export function createActivity(input: CreateActivityInput) {
  return prisma.activity.create({
    data: {
      title: input.title,
      description: input.description,
      category: input.category,
      location: input.location,
      startDate: input.startDate,
      endDate: input.endDate,
      capacity: input.capacity,
      teacherId: input.teacherId,
    },
  });
}

export function listAllActivities() {
  return prisma.activity.findMany({
    select: ACTIVITY_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
}

export function listActivitiesForTeacher(teacherId: string) {
  return prisma.activity.findMany({
    where: { teacherId },
    select: ACTIVITY_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
}

export function listOpenActivitiesForStudent() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return prisma.activity.findMany({
    where: { endDate: { gte: today } },
    select: ACTIVITY_STUDENT_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
}

export async function registerForActivity(activityId: string, studentId: string) {
  return runSerializableWithRetry(() => registerForActivityTx(activityId, studentId));
}

function registerForActivityTx(activityId: string, studentId: string) {
  return prisma.$transaction(
    async (tx) => {
      const activity = await tx.activity.findUniqueOrThrow({ where: { id: activityId } });
      const count = await tx.activityRegistration.count({ where: { activityId } });
      if (count >= activity.capacity) throw new Error('ACTIVITY_FULL');
      return tx.activityRegistration.create({ data: { activityId, studentId } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function cancelRegistration(id: string, studentId: string) {
  const registration = await prisma.activityRegistration.findUniqueOrThrow({ where: { id } });
  if (registration.studentId !== studentId) throw new Error('NOT_OWNER');
  await prisma.activityRegistration.delete({ where: { id } });
}

export async function adminRemoveRegistration(id: string) {
  await prisma.activityRegistration.delete({ where: { id } });
}

export async function deleteActivity(id: string) {
  await prisma.$transaction([
    prisma.activityRegistration.deleteMany({ where: { activityId: id } }),
    prisma.activity.delete({ where: { id } }),
  ]);
}

export function listRegistrationsForStudent(studentId: string) {
  return prisma.activityRegistration.findMany({
    where: { studentId },
    select: {
      id: true,
      activity: { select: ACTIVITY_STUDENT_LIST_SELECT },
    },
    orderBy: { activity: { startDate: 'desc' } },
  });
}

export function getActivityDetail(id: string) {
  return prisma.activity.findUniqueOrThrow({
    where: { id },
    select: ACTIVITY_LIST_SELECT,
  });
}
