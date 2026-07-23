import { prisma } from '@/lib/db';

const SUBJECT_COLOR_SELECT = { subject: true, color: true } as const;

export function listSubjectColors() {
  return prisma.subjectColor.findMany({
    select: SUBJECT_COLOR_SELECT,
    orderBy: { subject: 'asc' },
  });
}

export function setSubjectColor(subject: string, color: string) {
  return prisma.subjectColor.upsert({
    where: { subject },
    create: { subject, color },
    update: { color },
    select: SUBJECT_COLOR_SELECT,
  });
}
