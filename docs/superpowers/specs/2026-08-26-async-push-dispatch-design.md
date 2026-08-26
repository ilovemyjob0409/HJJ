# 推播改非同步（回應後才發送）設計

日期：2026-08-26
狀態：已與使用者定案
背景：2026-08-26 正式站壅塞排查（[[project-production-congestion-analysis]]）——推播目前是同步序列發送，每個業務動作（簽到、請假、預約⋯）回應前要逐一 await 對 FCM/APNs 的 HTTPS 請求（每則 0.1–0.5 秒 × 訂閱裝置數），老師連續掃碼點名時最有感，尖峰時吃 Vercel function 併發。

## 目標與範圍

- 通知中心統一入口 `notifyUsers` 的**推播段移出請求關鍵路徑**：收件夾 DB 寫入照舊同步（很快、鈴鐺即時性不變），推播改成「回應送出後在背景完成」。
- 全站 14 個通知點自動受益，呼叫端**零修改**。
- 不改 schema、無正式站 SQL；改完 push 即生效。

## 作法

1. 新增官方小套件 **`@vercel/functions`**（提供 `waitUntil`：把 Promise 註冊給 Vercel 的 request context，回應先送出、function 存活到該 Promise 完成；在非 Vercel 環境安全 no-op）。
2. 新 helper `src/lib/deferBestEffort.ts`：

```ts
import { waitUntil } from '@vercel/functions';

// 把「回應後才需要完成」的 best-effort 工作移出請求關鍵路徑。
// - Vercel：waitUntil 讓回應先走、背景把工作跑完
// - 測試（VITEST）：維持同步 await——測試行為與改動前完全一致，
//   也不會留下跨測試的殘留非同步工作去撞 resetDb
// - 本機 dev：process 常駐，fire-and-forget 照樣跑完
export async function deferBestEffort(task: () => Promise<void>): Promise<void> {
  if (process.env.VITEST) {
    await task();
    return;
  }
  const running = task().catch((err) => console.error('deferred background task failed', err));
  waitUntil(running);
}
```

3. `notificationService.notifyUsers`：`await pushToUsers(...)` 改為 `await deferBestEffort(() => pushToUsers(userIds, payload))`（VITEST 下等同現狀；正式環境立即返回）。收件夾 createMany 維持在推播之前、同步。

## 不變的行為保證

- 推播照發（背景完成）、失敗照樣只記 log；`pushToUsers` 本身不改（序列發送維持——已不佔用使用者等待時間，不需要再並行化，YAGNI）。
- 收件夾寫入時序不變：回應前已入庫，鈴鐺立即看得到。
- 測試環境（VITEST）完全同步＝既有測試語意零變化。
- cron（daily-reminders）呼叫鏈同樣受益：迴圈不再被推播拖慢，推播由 waitUntil 延長生命週期完成（`maxDuration=60` 涵蓋）。

## 相依套件的安裝方式（併發 session 注意）

worktree 內 `npm install @vercel/functions`（node_modules 與主 checkout 共用——新增套件對另一 session 無害；postinstall 的 prisma generate 用相同 schema 無副作用），**先 commit `package.json`＋`package-lock.json` 再做測試 DB 隔離的 sed**，避免把 sed 過的 test:dbpush 混進 commit。

## 測試

- `src/lib/deferBestEffort.test.ts`：VITEST 路徑同步 await（task 的副作用在呼叫返回後立即可見；task reject 時不往外拋——包 catch 後的行為）。
- 既有 `notificationService.test.ts`／全量測試全綠（語意零變化的證明）。
