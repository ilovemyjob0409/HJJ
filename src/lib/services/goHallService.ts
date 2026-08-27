import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { runSerializableWithRetry } from '@/lib/transaction';
import { isBeforeToday } from '@/lib/pastDate';
import { taipeiDateKey } from './tutoringBookingService';
import { determineQualification, type GoHallQualificationValue } from './goHallTicketService';
import { clearGoHallAttendance } from './attendanceService';

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

export function listOpenSessionsForStudent(now: Date = new Date()) {
  // "今天"以台北曆日為準（見 isBeforeToday 註解）——伺服器是 UTC，台北
  // 00:00–07:59 這段若用伺服器當地午夜會少算一天，把已結束的場次當成還開放。
  const [y, m, d] = taipeiDateKey(now).split('-').map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));
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
  return runSerializableWithRetry(() => registerForSessionTx(sessionId, studentId, { bypassCapacity: false }));
}

// 行政代報名：可超額（現場彈性加人），但不能報過去的場次。
export async function adminRegisterForSession(sessionId: string, studentId: string) {
  const session = await prisma.goHallSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (isBeforeToday(session.date)) throw new Error('SESSION_EXPIRED');
  return runSerializableWithRetry(() => registerForSessionTx(sessionId, studentId, { bypassCapacity: true }));
}

async function registerForSessionTx(sessionId: string, studentId: string, options: { bypassCapacity: boolean }) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const session = await tx.goHallSession.findUniqueOrThrow({ where: { id: sessionId } });
        if (!options.bypassCapacity) {
          const count = await tx.goHallRegistration.count({ where: { sessionId } });
          if (count >= session.capacity) throw new Error('SESSION_FULL');
        }
        return await tx.goHallRegistration.create({ data: { sessionId, studentId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new Error('ALREADY_REGISTERED');
    }
    throw err;
  }
}

export async function cancelRegistration(id: string, studentId: string) {
  const registration = await prisma.goHallRegistration.findUniqueOrThrow({ where: { id }, include: { session: true } });
  if (registration.studentId !== studentId) throw new Error('NOT_OWNER');
  if (isBeforeToday(registration.session.date)) throw new Error('SESSION_EXPIRED');
  await clearGoHallAttendance(registration.sessionId, [registration.studentId]);
  await prisma.goHallRegistration.delete({ where: { id } });
}

export async function adminRemoveRegistration(id: string) {
  const registration = await prisma.goHallRegistration.findUniqueOrThrow({ where: { id } });
  await clearGoHallAttendance(registration.sessionId, [registration.studentId]);
  await prisma.goHallRegistration.delete({ where: { id } });
}

// 學生自己的報名紀錄：附帶簽到資訊（status／checkInTime／checkOutTime），
// 讓學生知道哪些場次已到場、什麼時候簽到——堂票就是那次簽到扣掉的。
// GoHallAttendance 跟 GoHallRegistration 之間沒有直接的 Prisma relation
// （兩者各自用 sessionId+studentId 當複合鍵），所以透過 GoHallSession 的
// attendances 關聯、用 studentId 過濾出這位學生自己的那一筆（至多一筆）。
export async function listRegistrationsForStudent(studentId: string) {
  const rows = await prisma.goHallRegistration.findMany({
    where: { studentId },
    select: {
      id: true,
      session: {
        select: {
          ...SESSION_LIST_SELECT,
          attendances: {
            where: { studentId },
            select: { status: true, checkInTime: true, checkOutTime: true },
          },
        },
      },
    },
    orderBy: { session: { date: 'desc' } },
  });
  return rows.map(({ id, session: { attendances, ...session } }) => ({
    id,
    session,
    attendance: attendances[0] ?? null,
  }));
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

export async function getSessionDetailWithQualifications(id: string) {
  const detail = await getSessionDetail(id);
  const attendances = await prisma.goHallAttendance.findMany({
    where: { sessionId: id },
    select: { studentId: true, qualification: true },
  });
  const byStudentId = new Map(attendances.map((a) => [a.studentId, a]));
  const registrations = await Promise.all(
    detail.registrations.map(async (r) => {
      const record = byStudentId.get(r.studentId);
      const qualification: GoHallQualificationValue | null = record
        ? ((record.qualification as GoHallQualificationValue | null) ?? null)
        : await determineQualification(prisma, r.studentId, detail.date);
      return { ...r, qualification, qualificationPredicted: !record };
    })
  );
  return { ...detail, registrations };
}
