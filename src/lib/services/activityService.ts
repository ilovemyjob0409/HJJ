import { prisma } from '@/lib/db';
import { ActivityCategory } from '@prisma/client';

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
