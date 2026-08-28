import { prisma } from '@/lib/db';

export function listDiscountItems() {
  return prisma.discountItem.findMany({ orderBy: { createdAt: 'asc' } });
}

export function createDiscountItem(input: { name: string; amount: number }) {
  return prisma.discountItem.create({ data: input });
}

export function updateDiscountItem(id: string, input: { name?: string; amount?: number }) {
  return prisma.discountItem.update({ where: { id }, data: input });
}

export async function deleteDiscountItem(id: string): Promise<void> {
  await prisma.discountItem.delete({ where: { id } });
}
