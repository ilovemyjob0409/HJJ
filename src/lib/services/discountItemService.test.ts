import { describe, it, expect } from 'vitest';
import { listDiscountItems, createDiscountItem, updateDiscountItem, deleteDiscountItem } from './discountItemService';

describe('discountItemService', () => {
  it('creates, lists, updates, and deletes', async () => {
    const item = await createDiscountItem({ name: '台積電特約', amount: 500 });
    expect(await listDiscountItems()).toEqual([item]);

    await updateDiscountItem(item.id, { amount: 600 });
    expect((await listDiscountItems())[0]).toMatchObject({ name: '台積電特約', amount: 600 });

    await deleteDiscountItem(item.id);
    expect(await listDiscountItems()).toEqual([]);
  });
});
