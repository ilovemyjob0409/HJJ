import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { listPointReasons, createPointReason, updatePointReason, deletePointReason, movePointReason } from './pointReasonService';

describe('listPointReasons', () => {
  it('returns reasons ordered by sortOrder ascending', async () => {
    await prisma.pointReason.create({ data: { label: 'B', sortOrder: 1 } });
    await prisma.pointReason.create({ data: { label: 'A', sortOrder: 0 } });

    const items = await listPointReasons();

    expect(items.map((i) => i.label)).toEqual(['A', 'B']);
  });
});

describe('createPointReason', () => {
  it('assigns sortOrder 0 to the first reason', async () => {
    const item = await createPointReason({ label: '準時出席' });
    expect(item.sortOrder).toBe(0);
  });

  it('assigns sortOrder one higher than the current max', async () => {
    await prisma.pointReason.create({ data: { label: 'X', sortOrder: 5 } });

    const item = await createPointReason({ label: 'Y' });

    expect(item.sortOrder).toBe(6);
  });
});

describe('updatePointReason', () => {
  it('updates label without touching sortOrder', async () => {
    const created = await prisma.pointReason.create({ data: { label: '原', sortOrder: 3 } });

    const updated = await updatePointReason(created.id, { label: '改' });

    expect(updated.label).toBe('改');
    expect(updated.sortOrder).toBe(3);
  });
});

describe('deletePointReason', () => {
  it('removes the reason', async () => {
    const created = await prisma.pointReason.create({ data: { label: 'X', sortOrder: 0 } });

    await deletePointReason(created.id);

    expect(await listPointReasons()).toHaveLength(0);
  });
});

describe('movePointReason', () => {
  async function setupThree() {
    const a = await prisma.pointReason.create({ data: { label: 'A', sortOrder: 0 } });
    const b = await prisma.pointReason.create({ data: { label: 'B', sortOrder: 1 } });
    const c = await prisma.pointReason.create({ data: { label: 'C', sortOrder: 2 } });
    return { a, b, c };
  }

  it('swaps sortOrder with the previous reason when moving up', async () => {
    const { b } = await setupThree();
    await movePointReason(b.id, 'up');
    expect((await listPointReasons()).map((i) => i.label)).toEqual(['B', 'A', 'C']);
  });

  it('swaps sortOrder with the next reason when moving down', async () => {
    const { b } = await setupThree();
    await movePointReason(b.id, 'down');
    expect((await listPointReasons()).map((i) => i.label)).toEqual(['A', 'C', 'B']);
  });

  it('is a no-op when moving the first reason up', async () => {
    const { a } = await setupThree();
    await movePointReason(a.id, 'up');
    expect((await listPointReasons()).map((i) => i.label)).toEqual(['A', 'B', 'C']);
  });

  it('is a no-op when moving the last reason down', async () => {
    const { c } = await setupThree();
    await movePointReason(c.id, 'down');
    expect((await listPointReasons()).map((i) => i.label)).toEqual(['A', 'B', 'C']);
  });
});
