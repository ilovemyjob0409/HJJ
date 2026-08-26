import { describe, it, expect } from 'vitest';
import { deferBestEffort } from './deferBestEffort';

describe('deferBestEffort', () => {
  it('VITEST 環境下同步 await：返回時 task 副作用已完成', async () => {
    let done = false;
    await deferBestEffort(async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    expect(done).toBe(true);
  });

  it('task reject 不往外拋（best-effort）', async () => {
    await expect(
      deferBestEffort(async () => {
        throw new Error('boom');
      })
    ).resolves.toBeUndefined();
  });
});
