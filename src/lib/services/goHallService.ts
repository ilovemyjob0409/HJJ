import { prisma } from '@/lib/db';

const SAFE_USER_SELECT = { name: true, email: true } as const;

const SESSION_LIST_SELECT = {
  id: true,
  date: true,
  startTime: true,
  endTime: true,
  capacity: true,
  teacher: { select: { user: { select: SAFE_USER_SELECT } } },
  _count: { select: { registrations: true } },
} as const;

export interface CreateSessionsInput {
  dates: Date[];
  startTime: string;
  endTime: string;
  capacity: number;
  teacherId: string;
}

export function createSessions(input: CreateSessionsInput) {
  return prisma.goHallSession.createMany({
    data: input.dates.map((date) => ({
      date,
      startTime: input.startTime,
      endTime: input.endTime,
      capacity: input.capacity,
      teacherId: input.teacherId,
    })),
  });
}

export function listAllSessions() {
  return prisma.goHallSession.findMany({
    select: SESSION_LIST_SELECT,
    orderBy: { date: 'asc' },
  });
}

export function listSessionsForTeacher(teacherId: string) {
  return prisma.goHallSession.findMany({
    where: { teacherId },
    select: SESSION_LIST_SELECT,
    orderBy: { date: 'asc' },
  });
}

export function listOpenSessionsForStudent() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return prisma.goHallSession.findMany({
    where: { date: { gte: today } },
    select: SESSION_LIST_SELECT,
    orderBy: { date: 'asc' },
  });
}

export async function deleteSession(id: string) {
  await prisma.$transaction([
    prisma.goHallRegistration.deleteMany({ where: { sessionId: id } }),
    prisma.goHallSession.delete({ where: { id } }),
  ]);
}
