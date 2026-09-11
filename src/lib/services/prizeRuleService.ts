import { prisma } from '@/lib/db';

// 兌換規則逐條維護：比照 makeupNoticeService 的口徑與排序策略。
export function listPrizeRuleItems() {
  // createdAt 當 tiebreaker：create 的 max+1 讀寫非交易，罕見同 sortOrder 時
  // 讓行政列表與學生頁排序一致。
  return prisma.prizeRuleItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
}

export async function createPrizeRuleItem(input: { content: string }) {
  const last = await prisma.prizeRuleItem.findFirst({ orderBy: { sortOrder: 'desc' } });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  return prisma.prizeRuleItem.create({ data: { content: input.content, sortOrder } });
}

export function updatePrizeRuleItem(id: string, input: { content: string }) {
  return prisma.prizeRuleItem.update({ where: { id }, data: { content: input.content } });
}

export async function deletePrizeRuleItem(id: string) {
  await prisma.prizeRuleItem.delete({ where: { id } });
}

export async function movePrizeRuleItem(id: string, direction: 'up' | 'down') {
  const item = await prisma.prizeRuleItem.findUniqueOrThrow({ where: { id } });
  const neighbor =
    direction === 'up'
      ? await prisma.prizeRuleItem.findFirst({ where: { sortOrder: { lt: item.sortOrder } }, orderBy: { sortOrder: 'desc' } })
      : await prisma.prizeRuleItem.findFirst({ where: { sortOrder: { gt: item.sortOrder } }, orderBy: { sortOrder: 'asc' } });
  if (!neighbor) return;
  await prisma.$transaction([
    prisma.prizeRuleItem.update({ where: { id: item.id }, data: { sortOrder: neighbor.sortOrder } }),
    prisma.prizeRuleItem.update({ where: { id: neighbor.id }, data: { sortOrder: item.sortOrder } }),
  ]);
}
