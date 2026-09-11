import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import {
  listPrizeRuleItems,
  createPrizeRuleItem,
  updatePrizeRuleItem,
  deletePrizeRuleItem,
  movePrizeRuleItem,
} from './prizeRuleService';

describe('listPrizeRuleItems', () => {
  it('returns items ordered by sortOrder ascending', async () => {
    await prisma.prizeRuleItem.create({ data: { content: 'B', sortOrder: 1 } });
    await prisma.prizeRuleItem.create({ data: { content: 'A', sortOrder: 0 } });

    const items = await listPrizeRuleItems();

    expect(items.map((i) => i.content)).toEqual(['A', 'B']);
  });
});

describe('createPrizeRuleItem', () => {
  it('assigns sortOrder 0 to the first item', async () => {
    const item = await createPrizeRuleItem({ content: '第一條' });
    expect(item.sortOrder).toBe(0);
  });

  it('assigns sortOrder one higher than the current max', async () => {
    await prisma.prizeRuleItem.create({ data: { content: 'X', sortOrder: 5 } });

    const item = await createPrizeRuleItem({ content: 'Y' });

    expect(item.sortOrder).toBe(6);
  });
});

describe('updatePrizeRuleItem', () => {
  it('updates content without touching sortOrder', async () => {
    const created = await prisma.prizeRuleItem.create({ data: { content: '原文', sortOrder: 3 } });

    const updated = await updatePrizeRuleItem(created.id, { content: '改文' });

    expect(updated.content).toBe('改文');
    expect(updated.sortOrder).toBe(3);
  });
});

describe('deletePrizeRuleItem', () => {
  it('removes the item', async () => {
    const created = await prisma.prizeRuleItem.create({ data: { content: 'X', sortOrder: 0 } });

    await deletePrizeRuleItem(created.id);

    expect(await listPrizeRuleItems()).toHaveLength(0);
  });
});

describe('movePrizeRuleItem', () => {
  async function setupThree() {
    const a = await prisma.prizeRuleItem.create({ data: { content: 'A', sortOrder: 0 } });
    const b = await prisma.prizeRuleItem.create({ data: { content: 'B', sortOrder: 1 } });
    const c = await prisma.prizeRuleItem.create({ data: { content: 'C', sortOrder: 2 } });
    return { a, b, c };
  }

  it('swaps sortOrder with the previous item when moving up', async () => {
    const { b } = await setupThree();

    await movePrizeRuleItem(b.id, 'up');

    expect((await listPrizeRuleItems()).map((i) => i.content)).toEqual(['B', 'A', 'C']);
  });

  it('swaps sortOrder with the next item when moving down', async () => {
    const { b } = await setupThree();

    await movePrizeRuleItem(b.id, 'down');

    expect((await listPrizeRuleItems()).map((i) => i.content)).toEqual(['A', 'C', 'B']);
  });

  it('is a no-op when moving the first item up', async () => {
    const { a } = await setupThree();

    await movePrizeRuleItem(a.id, 'up');

    expect((await listPrizeRuleItems()).map((i) => i.content)).toEqual(['A', 'B', 'C']);
  });

  it('is a no-op when moving the last item down', async () => {
    const { c } = await setupThree();

    await movePrizeRuleItem(c.id, 'down');

    expect((await listPrizeRuleItems()).map((i) => i.content)).toEqual(['A', 'B', 'C']);
  });
});
