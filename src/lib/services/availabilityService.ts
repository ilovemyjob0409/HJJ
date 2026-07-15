import { prisma } from '@/lib/db';

export interface AvailabilityWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

type ClientType = typeof prisma | Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$use' | '$extends'>;

export async function setTeacherAvailability(teacherId: string, windows: AvailabilityWindow[]) {
  await prisma.teacherAvailability.deleteMany({ where: { teacherId } });
  await prisma.teacherAvailability.createMany({
    data: windows.map((w) => ({ teacherId, ...w })),
  });
  return listTeacherAvailability(teacherId);
}

export function listTeacherAvailability(teacherId: string, client: ClientType = prisma) {
  return client.teacherAvailability.findMany({ where: { teacherId }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] });
}
