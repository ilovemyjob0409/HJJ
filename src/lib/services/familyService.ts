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
  const uniqueSiblingIds = Array.from(new Set(siblingIds)).filter((id) => id !== studentId);
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

const SWITCH_TOKEN_TTL_MS = 30_000;

export async function createSwitchToken(currentUserId: string, targetStudentId: string): Promise<string> {
  const current = await prisma.student.findUnique({ where: { userId: currentUserId }, select: { familyGroupId: true } });
  if (!current?.familyGroupId) throw new Error('NOT_IN_FAMILY_GROUP');

  const target = await prisma.student.findUnique({ where: { id: targetStudentId }, select: { familyGroupId: true, userId: true } });
  if (!target || target.familyGroupId !== current.familyGroupId) throw new Error('NOT_A_SIBLING');

  const token = crypto.randomBytes(32).toString('hex');
  await prisma.familySwitchToken.create({
    data: { token, targetUserId: target.userId, expiresAt: new Date(Date.now() + SWITCH_TOKEN_TTL_MS) },
  });
  return token;
}

export async function redeemSwitchToken(token: string) {
  const record = await prisma.familySwitchToken.findUnique({ where: { token } });
  if (!record || record.usedAt || record.expiresAt < new Date()) return null;
  const result = await prisma.familySwitchToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (result.count === 0) return null;
  return prisma.user.findUniqueOrThrow({
    where: { id: record.targetUserId },
    select: { id: true, name: true, email: true, role: true },
  });
}
