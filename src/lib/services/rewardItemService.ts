import { prisma } from '@/lib/db';

function validateCost(pointsCost: number) {
  if (!Number.isInteger(pointsCost) || pointsCost < 1) throw new Error('INVALID_COST');
}

export function listRewardItems() {
  // createdAt is a tiebreaker for the (rare, since createRewardItem's max+1
  // read and write aren't transactional) case of two rows sharing a sortOrder.
  return prisma.rewardItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}

export async function createRewardItem(input: { name: string; pointsCost: number }) {
  validateCost(input.pointsCost);
  const last = await prisma.rewardItem.findFirst({ orderBy: { sortOrder: 'desc' } });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  return prisma.rewardItem.create({ data: { name: input.name, pointsCost: input.pointsCost, sortOrder } });
}

export async function updateRewardItem(id: string, input: { name: string; pointsCost: number }) {
  validateCost(input.pointsCost);
  return prisma.rewardItem.update({ where: { id }, data: { name: input.name, pointsCost: input.pointsCost } });
}

export async function deleteRewardItem(id: string) {
  await prisma.rewardItem.delete({ where: { id } });
}

export async function moveRewardItem(id: string, direction: 'up' | 'down') {
  const item = await prisma.rewardItem.findUniqueOrThrow({ where: { id } });
  const neighbor =
    direction === 'up'
      ? await prisma.rewardItem.findFirst({ where: { sortOrder: { lt: item.sortOrder } }, orderBy: { sortOrder: 'desc' } })
      : await prisma.rewardItem.findFirst({ where: { sortOrder: { gt: item.sortOrder } }, orderBy: { sortOrder: 'asc' } });
  if (!neighbor) return;
  await prisma.$transaction([
    prisma.rewardItem.update({ where: { id: item.id }, data: { sortOrder: neighbor.sortOrder } }),
    prisma.rewardItem.update({ where: { id: neighbor.id }, data: { sortOrder: item.sortOrder } }),
  ]);
}
