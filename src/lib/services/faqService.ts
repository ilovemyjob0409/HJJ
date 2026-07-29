import { prisma } from '@/lib/db';

export function listFaqItems() {
  // createdAt is a tiebreaker for the (rare, since createFaqItem's max+1 read
  // and write aren't transactional) case of two rows sharing a sortOrder —
  // without it, Postgres doesn't guarantee those rows compare the same way
  // between the admin list and the student page's independent query.
  return prisma.faqItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}

export async function createFaqItem(input: { question: string; answer: string }) {
  const last = await prisma.faqItem.findFirst({ orderBy: { sortOrder: 'desc' } });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  return prisma.faqItem.create({ data: { question: input.question, answer: input.answer, sortOrder } });
}

export function updateFaqItem(id: string, input: { question: string; answer: string }) {
  return prisma.faqItem.update({ where: { id }, data: { question: input.question, answer: input.answer } });
}

export async function deleteFaqItem(id: string) {
  await prisma.faqItem.delete({ where: { id } });
}

export async function moveFaqItem(id: string, direction: 'up' | 'down') {
  const item = await prisma.faqItem.findUniqueOrThrow({ where: { id } });
  const neighbor =
    direction === 'up'
      ? await prisma.faqItem.findFirst({ where: { sortOrder: { lt: item.sortOrder } }, orderBy: { sortOrder: 'desc' } })
      : await prisma.faqItem.findFirst({ where: { sortOrder: { gt: item.sortOrder } }, orderBy: { sortOrder: 'asc' } });
  if (!neighbor) return;
  await prisma.$transaction([
    prisma.faqItem.update({ where: { id: item.id }, data: { sortOrder: neighbor.sortOrder } }),
    prisma.faqItem.update({ where: { id: neighbor.id }, data: { sortOrder: item.sortOrder } }),
  ]);
}
