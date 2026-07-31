import { prisma } from '@/lib/db';

export function listMakeupNoticeItems() {
  // createdAt is a tiebreaker for the (rare, since createMakeupNoticeItem's
  // max+1 read and write aren't transactional) case of two rows sharing a
  // sortOrder — without it, Postgres doesn't guarantee those rows compare
  // the same way between the admin list and the student homepage's query.
  return prisma.makeupNoticeItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}

export async function createMakeupNoticeItem(input: { content: string }) {
  const last = await prisma.makeupNoticeItem.findFirst({ orderBy: { sortOrder: 'desc' } });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  return prisma.makeupNoticeItem.create({ data: { content: input.content, sortOrder } });
}

export function updateMakeupNoticeItem(id: string, input: { content: string }) {
  return prisma.makeupNoticeItem.update({ where: { id }, data: { content: input.content } });
}

export async function deleteMakeupNoticeItem(id: string) {
  await prisma.makeupNoticeItem.delete({ where: { id } });
}

export async function moveMakeupNoticeItem(id: string, direction: 'up' | 'down') {
  const item = await prisma.makeupNoticeItem.findUniqueOrThrow({ where: { id } });
  const neighbor =
    direction === 'up'
      ? await prisma.makeupNoticeItem.findFirst({ where: { sortOrder: { lt: item.sortOrder } }, orderBy: { sortOrder: 'desc' } })
      : await prisma.makeupNoticeItem.findFirst({ where: { sortOrder: { gt: item.sortOrder } }, orderBy: { sortOrder: 'asc' } });
  if (!neighbor) return;
  await prisma.$transaction([
    prisma.makeupNoticeItem.update({ where: { id: item.id }, data: { sortOrder: neighbor.sortOrder } }),
    prisma.makeupNoticeItem.update({ where: { id: neighbor.id }, data: { sortOrder: item.sortOrder } }),
  ]);
}
