# 推播改非同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通知中心的推播段移出請求關鍵路徑——收件夾寫入照舊同步，推播在回應送出後於背景完成（Vercel `waitUntil`），全站 14 個通知點自動受益、呼叫端零修改。

**Architecture:** 新增 `@vercel/functions` 依賴＋`src/lib/deferBestEffort.ts` helper（VITEST 同步 await／Vercel waitUntil／本機 fire-and-forget），`notificationService.notifyUsers` 的 `await pushToUsers(...)` 換成 `await deferBestEffort(() => pushToUsers(...))`。

**Tech Stack:** Next.js 14 + `@vercel/functions`（官方，waitUntil 在非 Vercel 環境安全 no-op）+ Vitest。

**Spec:** `docs/superpowers/specs/2026-08-26-async-push-dispatch-design.md`

## Global Constraints

- 測試（VITEST）路徑必須完全同步＝既有測試語意零變化；不留跨測試殘留非同步工作。
- `pushToUsers` 本身不改（YAGNI）；收件夾 createMany 維持在推播之前、同步。
- **依賴安裝順序**：worktree 內 `npm install @vercel/functions` → **先 commit `package.json`＋`package-lock.json`** → 之後才做測試 DB 隔離的 sed（避免 sed 過的 `test:dbpush` 混進 commit）。此順序由控制者在 worktree 設置時完成，實作者拿到的 worktree 已裝好依賴、已 sed。
- 只 stage 自己改的檔案；sed 過的 `vitest.setup.ts`／`package.json` 不入 commit。
- `npm test` 約 150 秒，命令 timeout ≥ 300000ms。

---

### Task 1: deferBestEffort helper＋notifyUsers 接線

**Files:**
- Create: `src/lib/deferBestEffort.ts`
- Create: `src/lib/deferBestEffort.test.ts`
- Modify: `src/lib/services/notificationService.ts`（notifyUsers 一行換掉＋import）

**Interfaces:**
- Consumes: `@vercel/functions` 的 `waitUntil`（依賴已由控制者裝好並 commit）。
- Produces: `export async function deferBestEffort(task: () => Promise<void>): Promise<void>`。

- [ ] **Step 1: 寫失敗測試**

Create `src/lib/deferBestEffort.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run src/lib/deferBestEffort.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作**

Create `src/lib/deferBestEffort.ts`：

```ts
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
```

`src/lib/services/notificationService.ts`：import 區加 `import { deferBestEffort } from '@/lib/deferBestEffort';`，`notifyUsers` 內：

```ts
  // 推播移出請求關鍵路徑：回應不等推播完成（Vercel waitUntil 背景跑完；
  // 測試環境維持同步）。收件夾已在上面先寫入，鈴鐺即時性不受影響。
  await deferBestEffort(() => pushToUsers(userIds, payload));
```

（取代原本的 `await pushToUsers(userIds, payload);` 那一行。）

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run src/lib/deferBestEffort.test.ts src/lib/services/notificationService.test.ts`
Expected: 全數 PASS。再跑全量 `npm test`（≥300s timeout）全綠＋`npx tsc --noEmit` 乾淨＋`npx eslint src/lib/deferBestEffort.ts src/lib/deferBestEffort.test.ts src/lib/services/notificationService.ts` 乾淨。**最後在隔離 worktree 跑一次 `npm run build`**（2026-08-26 教訓：next build 會 lint 測試檔，vitest 與逐檔 eslint 都抓不到）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/deferBestEffort.ts src/lib/deferBestEffort.test.ts src/lib/services/notificationService.ts
git commit -m "perf(notifications): defer push sends out of the request path via waitUntil"
```
