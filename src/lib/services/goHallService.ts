import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { runSerializableWithRetry } from '@/lib/transaction';

// Go Hall rosters and session lists never render email in the UI, and the
// roster is sent to STUDENT-role requesters (with names masked) — email
// must not be selected here or it would leak unmasked in that response.
const NAME_ONLY_SELECT = { name: true } as const;

const SESSION_LIST_SELECT = {
  id: true,
  date: true,
  startTime: true,
  endTime: true,
  capacity: true,
  teacher: { select: { user: { select: NAME_ONLY_SELECT } } },
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

export async function registerForSession(sessionId: string, studentId: string) {
  return runSerializableWithRetry(() => registerForSessionTx(sessionId, studentId));
}

function registerForSessionTx(sessionId: string, studentId: string) {
  return prisma.$transaction(
    async (tx) => {
      const session = await tx.goHallSession.findUniqueOrThrow({ where: { id: sessionId } });
      const count = await tx.goHallRegistration.count({ where: { sessionId } });
      if (count >= session.capacity) throw new Error('SESSION_FULL');
      return tx.goHallRegistration.create({ data: { sessionId, studentId } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function cancelRegistration(id: string, studentId: string) {
  const registration = await prisma.goHallRegistration.findUniqueOrThrow({ where: { id } });
  if (registration.studentId !== studentId) throw new Error('NOT_OWNER');
  await prisma.goHallRegistration.delete({ where: { id } });
}

export async function adminRemoveRegistration(id: string) {
  await prisma.goHallRegistration.delete({ where: { id } });
}

export function listRegistrationsForStudent(studentId: string) {
  return prisma.goHallRegistration.findMany({
    where: { studentId },
    select: {
      id: true,
      session: { select: SESSION_LIST_SELECT },
    },
    orderBy: { session: { date: 'desc' } },
  });
}

export function getSessionDetail(id: string) {
  return prisma.goHallSession.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      capacity: true,
      teacher: { select: { user: { select: NAME_ONLY_SELECT } } },
      registrations: {
        select: {
          id: true,
          studentId: true,
          student: { select: { user: { select: NAME_ONLY_SELECT } } },
        },
      },
    },
  });
}
