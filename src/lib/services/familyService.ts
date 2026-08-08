import crypto from 'crypto';
import { prisma } from '@/lib/db';

export interface SiblingOption {
  id: string;
  name: string;
}

export async function listSiblings(userId: string): Promise<SiblingOption[]> {
  const student = await prisma.student.findUnique({ where: { userId }, select: { id: true, familyGroupId: true } });
  if (!student?.familyGroupId) return [];
  const siblings = await prisma.student.findMany({
    where: { familyGroupId: student.familyGroupId, id: { not: student.id } },
    select: { id: true, user: { select: { name: true } } },
    orderBy: { user: { name: 'asc' } },
  });
  return siblings.map((s) => ({ id: s.id, name: s.user.name }));
}

export async function setSiblings(studentId: string, siblingIds: string[]): Promise<void> {
  const uniqueSiblingIds = [...new Set(siblingIds)].filter((id) => id !== studentId);
  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { familyGroupId: true } });

  if (uniqueSiblingIds.length === 0) {
    await prisma.student.update({ where: { id: studentId }, data: { familyGroupId: null } });
    return;
  }

  const siblings = await prisma.student.findMany({
    where: { id: { in: uniqueSiblingIds } },
    select: { id: true, familyGroupId: true },
  });
  if (siblings.length !== uniqueSiblingIds.length) throw new Error('SIBLING_NOT_FOUND');

  const groupId = student.familyGroupId ?? siblings.find((s) => s.familyGroupId)?.familyGroupId ?? crypto.randomUUID();

  await prisma.student.updateMany({
    where: { id: { in: [studentId, ...uniqueSiblingIds] } },
    data: { familyGroupId: groupId },
  });
}
