import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { listFaqItems, createFaqItem, updateFaqItem, deleteFaqItem, moveFaqItem } from './faqService';

describe('listFaqItems', () => {
  it('returns items ordered by sortOrder ascending', async () => {
    await prisma.faqItem.create({ data: { question: 'B', answer: 'b', sortOrder: 1 } });
    await prisma.faqItem.create({ data: { question: 'A', answer: 'a', sortOrder: 0 } });

    const items = await listFaqItems();

    expect(items.map((i) => i.question)).toEqual(['A', 'B']);
  });
});

describe('createFaqItem', () => {
  it('assigns sortOrder 0 to the first item', async () => {
    const item = await createFaqItem({ question: 'Q1', answer: 'A1' });
    expect(item.sortOrder).toBe(0);
  });

  it('assigns sortOrder one higher than the current max', async () => {
    await prisma.faqItem.create({ data: { question: 'Q1', answer: 'A1', sortOrder: 5 } });

    const item = await createFaqItem({ question: 'Q2', answer: 'A2' });

    expect(item.sortOrder).toBe(6);
  });
});

describe('updateFaqItem', () => {
  it('updates question and answer without touching sortOrder', async () => {
    const created = await prisma.faqItem.create({ data: { question: 'Q1', answer: 'A1', sortOrder: 3 } });

    const updated = await updateFaqItem(created.id, { question: 'Q1 改', answer: 'A1 改' });

    expect(updated.question).toBe('Q1 改');
    expect(updated.answer).toBe('A1 改');
    expect(updated.sortOrder).toBe(3);
  });
});

describe('deleteFaqItem', () => {
  it('removes the item', async () => {
    const created = await prisma.faqItem.create({ data: { question: 'Q1', answer: 'A1', sortOrder: 0 } });

    await deleteFaqItem(created.id);

    const items = await listFaqItems();
    expect(items).toHaveLength(0);
  });
});

describe('moveFaqItem', () => {
  async function setupThree() {
    const a = await prisma.faqItem.create({ data: { question: 'A', answer: 'a', sortOrder: 0 } });
    const b = await prisma.faqItem.create({ data: { question: 'B', answer: 'b', sortOrder: 1 } });
    const c = await prisma.faqItem.create({ data: { question: 'C', answer: 'c', sortOrder: 2 } });
    return { a, b, c };
  }

  it('swaps sortOrder with the previous item when moving up', async () => {
    const { b } = await setupThree();

    await moveFaqItem(b.id, 'up');

    const items = await listFaqItems();
    expect(items.map((i) => i.question)).toEqual(['B', 'A', 'C']);
  });

  it('swaps sortOrder with the next item when moving down', async () => {
    const { b } = await setupThree();

    await moveFaqItem(b.id, 'down');

    const items = await listFaqItems();
    expect(items.map((i) => i.question)).toEqual(['A', 'C', 'B']);
  });

  it('is a no-op when moving the first item up', async () => {
    const { a } = await setupThree();

    await moveFaqItem(a.id, 'up');

    const items = await listFaqItems();
    expect(items.map((i) => i.question)).toEqual(['A', 'B', 'C']);
  });

  it('is a no-op when moving the last item down', async () => {
    const { c } = await setupThree();

    await moveFaqItem(c.id, 'down');

    const items = await listFaqItems();
    expect(items.map((i) => i.question)).toEqual(['A', 'B', 'C']);
  });
});
