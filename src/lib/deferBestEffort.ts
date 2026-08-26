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
  // 用 async IIFE 包住呼叫：task 若「同步」throw 也會變成 rejection 被吃掉，
  // 與 VITEST 分支的 try/catch 行為一致（這個 helper 是通用件，不能兩個環境
  // 對同一種錯誤一個吞、一個往外拋）。
  const running = (async () => task())().catch((err) => console.error('deferred background task failed', err));
  waitUntil(running);
}
