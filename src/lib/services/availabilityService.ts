import { prisma } from '@/lib/db';

export interface AvailabilityWindow {
  weekday: number;
  startTime: string;
  endTime: string;
}

export async function setTeacherAvailability(teacherId: string, windows: AvailabilityWindow[]) {
  await prisma.teacherAvailability.deleteMany({ where: { teacherId } });
  await prisma.teacherAvailability.createMany({
    data: windows.map((w) => ({ teacherId, ...w })),
  });
  return listTeacherAvailability(teacherId);
}

export function listTeacherAvailability(teacherId: string) {
  return prisma.teacherAvailability.findMany({ where: { teacherId }, orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] });
}
