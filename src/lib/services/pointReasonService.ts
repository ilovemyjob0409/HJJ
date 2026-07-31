import { prisma } from '@/lib/db';

export function listPointReasons() {
  // createdAt is a tiebreaker for the (rare, since createPointReason's max+1
  // read and write aren't transactional) case of two rows sharing a sortOrder.
  return prisma.pointReason.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}

export async function createPointReason(input: { label: string }) {
  const last = await prisma.pointReason.findFirst({ orderBy: { sortOrder: 'desc' } });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  return prisma.pointReason.create({ data: { label: input.label, sortOrder } });
}

export function updatePointReason(id: string, input: { label: string }) {
  return prisma.pointReason.update({ where: { id }, data: { label: input.label } });
}

export async function deletePointReason(id: string) {
  await prisma.pointReason.delete({ where: { id } });
}

export async function movePointReason(id: string, direction: 'up' | 'down') {
  const item = await prisma.pointReason.findUniqueOrThrow({ where: { id } });
  const neighbor =
    direction === 'up'
      ? await prisma.pointReason.findFirst({ where: { sortOrder: { lt: item.sortOrder } }, orderBy: { sortOrder: 'desc' } })
      : await prisma.pointReason.findFirst({ where: { sortOrder: { gt: item.sortOrder } }, orderBy: { sortOrder: 'asc' } });
  if (!neighbor) return;
  await prisma.$transaction([
    prisma.pointReason.update({ where: { id: item.id }, data: { sortOrder: neighbor.sortOrder } }),
    prisma.pointReason.update({ where: { id: neighbor.id }, data: { sortOrder: item.sortOrder } }),
  ]);
}
