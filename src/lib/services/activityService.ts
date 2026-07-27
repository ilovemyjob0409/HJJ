import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { runSerializableWithRetry } from '@/lib/transaction';
import { createSignedUrls, deleteActivityImages } from '@/lib/storage';

// Activity rosters are sent to STUDENT-role requesters (with names masked)
// as well as ADMIN/TEACHER (real names) — email must not be selected here
// or it would leak unmasked in the student-facing response.
const NAME_ONLY_SELECT = { name: true } as const;

const ACTIVITY_LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  category: { select: { name: true } },
  location: true,
  startDate: true,
  endDate: true,
  capacity: true,
  teachers: { select: { teacher: { select: { user: { select: NAME_ONLY_SELECT } } } } },
  images: { orderBy: { createdAt: 'asc' as const }, take: 1, select: { storagePath: true } },
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
  category: { select: { name: true } },
  location: true,
  startDate: true,
  endDate: true,
  capacity: true,
  teachers: { select: { teacher: { select: { user: { select: NAME_ONLY_SELECT } } } } },
  images: { orderBy: { createdAt: 'asc' as const }, take: 1, select: { storagePath: true } },
  _count: { select: { registrations: true } },
} as const;

async function attachCoverUrl<T extends { images: { storagePath: string }[] }>(
  rows: T[],
): Promise<(Omit<T, 'images'> & { coverUrl: string | null })[]> {
  const paths = rows.map((r) => r.images[0]?.storagePath).filter((p): p is string => !!p);
  // A Storage outage must not take down the activity list itself — every
  // role's list (and the student's registrations) routes through this
  // helper, so a signing failure here degrades to placeholder covers
  // instead of a 500 across the whole feature.
  const urls = paths.length ? await createSignedUrls(paths).catch(() => new Map<string, string>()) : new Map<string, string>();
  return rows.map(({ images, ...rest }) => ({
    ...rest,
    coverUrl: images[0] ? (urls.get(images[0].storagePath) ?? null) : null,
  }));
}

export interface CreateActivityInput {
  title: string;
  description: string;
  categoryId: string;
  location?: string;
  startDate: Date;
  endDate: Date;
  capacity: number;
  teacherIds: string[];
}

export function createActivity(input: CreateActivityInput) {
  return prisma.activity.create({
    data: {
      title: input.title,
      description: input.description,
      categoryId: input.categoryId,
      location: input.location,
      startDate: input.startDate,
      endDate: input.endDate,
      capacity: input.capacity,
      teachers: { create: input.teacherIds.map((teacherId) => ({ teacherId })) },
    },
  });
}

export async function listAllActivities() {
  const rows = await prisma.activity.findMany({
    select: ACTIVITY_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
  return attachCoverUrl(rows);
}

export async function listActivitiesForTeacher(teacherId: string) {
  const rows = await prisma.activity.findMany({
    where: { teachers: { some: { teacherId } } },
    select: ACTIVITY_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
  return attachCoverUrl(rows);
}

export async function listOpenActivitiesForStudent() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = await prisma.activity.findMany({
    where: { endDate: { gte: today } },
    select: ACTIVITY_STUDENT_LIST_SELECT,
    orderBy: { startDate: 'asc' },
  });
  return attachCoverUrl(rows);
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
  const images = await prisma.activityImage.findMany({ where: { activityId: id }, select: { storagePath: true } });
  await prisma.$transaction([
    prisma.activityImage.deleteMany({ where: { activityId: id } }),
    prisma.activityRegistration.deleteMany({ where: { activityId: id } }),
    prisma.activityTeacher.deleteMany({ where: { activityId: id } }),
    prisma.activity.delete({ where: { id } }),
  ]);
  try {
    await deleteActivityImages(images.map((i) => i.storagePath));
  } catch {}
}

export async function listRegistrationsForStudent(studentId: string) {
  const rows = await prisma.activityRegistration.findMany({
    where: { studentId },
    select: {
      id: true,
      activity: { select: ACTIVITY_STUDENT_LIST_SELECT },
    },
    orderBy: { activity: { startDate: 'desc' } },
  });
  const activitiesWithCover = await attachCoverUrl(rows.map((r) => r.activity));
  return rows.map((r, i) => ({ id: r.id, activity: activitiesWithCover[i] }));
}

export async function getActivityDetail(id: string) {
  const activity = await prisma.activity.findUniqueOrThrow({
    where: { id },
    select: ACTIVITY_LIST_SELECT,
  });
  const [withCover] = await attachCoverUrl([activity]);
  return withCover;
}

export function listCategories() {
  return prisma.activityCategory.findMany({ orderBy: { name: 'asc' } });
}

export function createCategory(name: string) {
  return prisma.activityCategory.create({ data: { name } });
}

export async function deleteCategory(id: string) {
  const count = await prisma.activity.count({ where: { categoryId: id } });
  if (count > 0) throw new Error('CATEGORY_IN_USE');
  await prisma.activityCategory.delete({ where: { id } });
}
