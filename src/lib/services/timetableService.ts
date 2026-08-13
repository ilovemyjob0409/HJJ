import { prisma } from '@/lib/db';

export function listClassesForTimetable() {
  return prisma.class.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      subject: true,
      level: true,
      weekday: true,
      startTime: true,
      endTime: true,
      teacher: { select: { user: { select: { name: true } } } },
    },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
}

export interface TutoringSlotForTimetable {
  id: string;
  programName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacher: { user: { name: string } };
  teacher2: { user: { name: string } } | null;
}

export async function listTutoringSlotsForTimetable(): Promise<TutoringSlotForTimetable[]> {
  const programs = await prisma.tutoringProgram.findMany({
    where: { active: true },
    select: {
      name: true,
      windows: {
        where: { active: true },
        select: {
          id: true,
          weekday: true,
          startTime: true,
          endTime: true,
          teacher: { select: { user: { select: { name: true } } } },
          teacher2: { select: { user: { select: { name: true } } } },
        },
      },
    },
  });
  return programs.flatMap((p) => p.windows.map((w) => ({ ...w, programName: p.name })));
}
