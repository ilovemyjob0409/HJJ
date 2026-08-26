import { waitUntil } from '@vercel/functions';

// 把「回應後才需要完成」的 best-effort 工作移出請求關鍵路徑。
// - Vercel：waitUntil 讓回應先送出、function 存活到工作完成
// - 測試（VITEST）：維持同步 await——測試行為與改動前完全一致，
//   也不會留下跨測試的殘留非同步工作去撞 resetDb
// - 本機 dev：waitUntil 是安全 no-op，process 常駐、工作 fire-and-forget 照跑
export async function deferBestEffort(task: () => Promise<void>): Promise<void> {
  if (process.env.VITEST) {
    try {
      await task();
    } catch (err) {
      console.error('deferred background task failed', err);
    }
    return;
  }
  const running = task().catch((err) => console.error('deferred background task failed', err));
  waitUntil(running);
}
