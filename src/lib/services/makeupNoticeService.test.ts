import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import {
  listMakeupNoticeItems,
  createMakeupNoticeItem,
  updateMakeupNoticeItem,
  deleteMakeupNoticeItem,
  moveMakeupNoticeItem,
} from './makeupNoticeService';

beforeEach(async () => {
  await prisma.makeupNoticeItem.deleteMany();
});

describe('listMakeupNoticeItems', () => {
  it('returns items ordered by sortOrder ascending', async () => {
    await prisma.makeupNoticeItem.create({ data: { content: 'B', sortOrder: 1 } });
    await prisma.makeupNoticeItem.create({ data: { content: 'A', sortOrder: 0 } });

    const items = await listMakeupNoticeItems();

    expect(items.map((i) => i.content)).toEqual(['A', 'B']);
  });
});

describe('createMakeupNoticeItem', () => {
  it('assigns sortOrder 0 to the first item', async () => {
    const item = await createMakeupNoticeItem({ content: '第一條' });
    expect(item.sortOrder).toBe(0);
  });

  it('assigns sortOrder one higher than the current max', async () => {
    await prisma.makeupNoticeItem.create({ data: { content: 'X', sortOrder: 5 } });

    const item = await createMakeupNoticeItem({ content: 'Y' });

    expect(item.sortOrder).toBe(6);
  });
});

describe('updateMakeupNoticeItem', () => {
  it('updates content without touching sortOrder', async () => {
    const created = await prisma.makeupNoticeItem.create({ data: { content: '原文', sortOrder: 3 } });

    const updated = await updateMakeupNoticeItem(created.id, { content: '改文' });

    expect(updated.content).toBe('改文');
    expect(updated.sortOrder).toBe(3);
  });
});

describe('deleteMakeupNoticeItem', () => {
  it('removes the item', async () => {
    const created = await prisma.makeupNoticeItem.create({ data: { content: 'X', sortOrder: 0 } });

    await deleteMakeupNoticeItem(created.id);

    expect(await listMakeupNoticeItems()).toHaveLength(0);
  });
});

describe('moveMakeupNoticeItem', () => {
  async function setupThree() {
    const a = await prisma.makeupNoticeItem.create({ data: { content: 'A', sortOrder: 0 } });
    const b = await prisma.makeupNoticeItem.create({ data: { content: 'B', sortOrder: 1 } });
    const c = await prisma.makeupNoticeItem.create({ data: { content: 'C', sortOrder: 2 } });
    return { a, b, c };
  }

  it('swaps sortOrder with the previous item when moving up', async () => {
    const { b } = await setupThree();

    await moveMakeupNoticeItem(b.id, 'up');

    expect((await listMakeupNoticeItems()).map((i) => i.content)).toEqual(['B', 'A', 'C']);
  });

  it('swaps sortOrder with the next item when moving down', async () => {
    const { b } = await setupThree();

    await moveMakeupNoticeItem(b.id, 'down');

    expect((await listMakeupNoticeItems()).map((i) => i.content)).toEqual(['A', 'C', 'B']);
  });

  it('is a no-op when moving the first item up', async () => {
    const { a } = await setupThree();

    await moveMakeupNoticeItem(a.id, 'up');

    expect((await listMakeupNoticeItems()).map((i) => i.content)).toEqual(['A', 'B', 'C']);
  });

  it('is a no-op when moving the last item down', async () => {
    const { c } = await setupThree();

    await moveMakeupNoticeItem(c.id, 'down');

    expect((await listMakeupNoticeItems()).map((i) => i.content)).toEqual(['A', 'B', 'C']);
  });
});
