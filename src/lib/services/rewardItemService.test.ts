import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { listRewardItems, createRewardItem, updateRewardItem, deleteRewardItem, moveRewardItem } from './rewardItemService';

describe('listRewardItems', () => {
  it('returns items ordered by sortOrder ascending', async () => {
    await prisma.rewardItem.create({ data: { name: 'B', pointsCost: 10, sortOrder: 1 } });
    await prisma.rewardItem.create({ data: { name: 'A', pointsCost: 5, sortOrder: 0 } });

    const items = await listRewardItems();

    expect(items.map((i) => i.name)).toEqual(['A', 'B']);
  });
});

describe('createRewardItem', () => {
  it('assigns sortOrder 0 to the first item and stores the cost', async () => {
    const item = await createRewardItem({ name: '文具組', pointsCost: 20 });
    expect(item.sortOrder).toBe(0);
    expect(item.pointsCost).toBe(20);
  });

  it('assigns sortOrder one higher than the current max', async () => {
    await prisma.rewardItem.create({ data: { name: 'X', pointsCost: 1, sortOrder: 5 } });

    const item = await createRewardItem({ name: 'Y', pointsCost: 2 });

    expect(item.sortOrder).toBe(6);
  });

  it('rejects a non-positive or non-integer pointsCost', async () => {
    await expect(createRewardItem({ name: 'x', pointsCost: 0 })).rejects.toThrow('INVALID_COST');
    await expect(createRewardItem({ name: 'x', pointsCost: 1.5 })).rejects.toThrow('INVALID_COST');
  });
});

describe('updateRewardItem', () => {
  it('updates name and cost without touching sortOrder', async () => {
    const created = await prisma.rewardItem.create({ data: { name: '原', pointsCost: 5, sortOrder: 3 } });

    const updated = await updateRewardItem(created.id, { name: '改', pointsCost: 8 });

    expect(updated.name).toBe('改');
    expect(updated.pointsCost).toBe(8);
    expect(updated.sortOrder).toBe(3);
  });

  it('rejects an invalid pointsCost', async () => {
    const created = await prisma.rewardItem.create({ data: { name: '原', pointsCost: 5, sortOrder: 0 } });
    await expect(updateRewardItem(created.id, { name: '改', pointsCost: -1 })).rejects.toThrow('INVALID_COST');
  });
});

describe('deleteRewardItem', () => {
  it('removes the item', async () => {
    const created = await prisma.rewardItem.create({ data: { name: 'X', pointsCost: 1, sortOrder: 0 } });

    await deleteRewardItem(created.id);

    expect(await listRewardItems()).toHaveLength(0);
  });
});

describe('moveRewardItem', () => {
  async function setupThree() {
    const a = await prisma.rewardItem.create({ data: { name: 'A', pointsCost: 1, sortOrder: 0 } });
    const b = await prisma.rewardItem.create({ data: { name: 'B', pointsCost: 1, sortOrder: 1 } });
    const c = await prisma.rewardItem.create({ data: { name: 'C', pointsCost: 1, sortOrder: 2 } });
    return { a, b, c };
  }

  it('swaps sortOrder with the previous item when moving up', async () => {
    const { b } = await setupThree();
    await moveRewardItem(b.id, 'up');
    expect((await listRewardItems()).map((i) => i.name)).toEqual(['B', 'A', 'C']);
  });

  it('swaps sortOrder with the next item when moving down', async () => {
    const { b } = await setupThree();
    await moveRewardItem(b.id, 'down');
    expect((await listRewardItems()).map((i) => i.name)).toEqual(['A', 'C', 'B']);
  });

  it('is a no-op when moving the first item up', async () => {
    const { a } = await setupThree();
    await moveRewardItem(a.id, 'up');
    expect((await listRewardItems()).map((i) => i.name)).toEqual(['A', 'B', 'C']);
  });

  it('is a no-op when moving the last item down', async () => {
    const { c } = await setupThree();
    await moveRewardItem(c.id, 'down');
    expect((await listRewardItems()).map((i) => i.name)).toEqual(['A', 'B', 'C']);
  });
});
