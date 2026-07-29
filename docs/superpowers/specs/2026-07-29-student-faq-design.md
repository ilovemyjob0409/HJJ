# 學生常見問題專區 設計文件

日期：2026-07-29

## 背景與目標

學生區塊（`/student` 底下的請假、補課、弈廳、出席、活動專區）目前沒有任何「常見問題」說明頁面。行政人員希望能有一個地方統一回答學生常問的問題，並且自己就能新增/修改內容，不需要工程師介入。

## 範圍外

- 分類（現在先做扁平清單，之後題目變多、真的需要分類時再加 `FaqCategory`，不在這次範圍內先蓋一層用不到的資料結構）
- 搜尋功能（清單預期不長，用瀏覽器內建的頁面搜尋即可）
- 老師／行政人員自己的常見問題頁面（這次只做學生看的那份；老師/行政如果之後也要，屆時再評估是否共用同一份資料或另開一份）
- 問題瀏覽次數統計、學生留言/回饋等互動功能

## 資料模型

新增 `FaqItem`：

```prisma
model FaqItem {
  id        String   @id @default(cuid())
  question  String
  answer    String
  sortOrder Int
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- `question`／`answer` 不做長度驗證，比照本專案其他自由文字欄位的慣例（信任行政人員輸入）。
- `sortOrder` 決定學生端清單的顯示順序（由小到大）。新增問題時，`sortOrder` 設為目前最大值 + 1（若清單是空的則為 0）。
- 沒有分類、沒有啟用/停用開關——後台刪除的問題就是真的從清單消失。

## 後台管理（`/admin/faq`）

新增管理頁面，加入 ADMIN 導覽列（比照 `/admin/students`、`/admin/activities` 的既有樣式與元件慣例：`Card`、`DataTable`、`Modal`、`Input`、`Button`、`useToast`）。

**頁面內容：**
- 問題清單，依 `sortOrder` 由小到大列出，每列顯示問題文字（截斷過長顯示）與四個操作：編輯、刪除、↑、↓。
  - 第一項沒有 ↑ 按鈕，最後一項沒有 ↓ 按鈕。
- 「＋ 新增問題」按鈕展開一個內嵌表單：問題用 `Input`，答案用 `<textarea>`（比照 `/admin/activities` 現有的活動描述輸入框樣式：`rounded-lg border border-[#D8C9A8] bg-card px-3 py-2 text-sm text-ink focus:border-brandDark focus:outline-none focus:ring-2 focus:ring-brandDark/25`，`rows={4}`），送出後清空表單、關閉、重新整理清單、跳 toast。
- 編輯用 `Modal`（跟 `/admin/students` 的編輯學生彈窗同樣的模式）：一個 `Input`（問題）+ 一個 `<textarea>`（答案）+ 儲存按鈕。
- 刪除：`confirm()` 對話框後送出 DELETE，成功後從清單移除、跳 toast。沒有「使用中」之類的檢查——`FaqItem` 沒有任何外鍵依賴它，永遠可以直接刪除。

**API：**

- `GET /api/faq`：僅 ADMIN，回傳全部 `FaqItem`（依 `sortOrder` 排序），供後台清單使用。
- `POST /api/faq`：僅 ADMIN，body `{ question, answer }`，建立新項目（`sortOrder` 依上述規則自動計算），回傳建立好的項目。
- `PATCH /api/faq/[id]`：僅 ADMIN，body `{ question, answer }`，更新問題與答案（不改 `sortOrder`）。
- `DELETE /api/faq/[id]`：僅 ADMIN，刪除該項目。
- `POST /api/faq/[id]/reorder`：僅 ADMIN，body `{ direction: 'up' | 'down' }`。找出「目前 `sortOrder` 次序中，緊鄰在前（up）或緊鄰在後（down）的那一項」，在同一個 transaction 內把兩者的 `sortOrder` 互換。若沒有相鄰項目（已經是第一項卻要 up，或已經是最後一項卻要 down）則不做任何事，回傳目前狀態即可（前端本來就不會渲染這種情況下的按鈕，這裡是後端的防呆）。

**Service 層**（`src/lib/services/faqService.ts`）：`listFaqItems`、`createFaqItem`、`updateFaqItem`、`deleteFaqItem`、`moveFaqItem(id, direction)`。這五個函式走本專案既有慣例，用真實測試資料庫寫 Vitest 測試，涵蓋：清單依 `sortOrder` 排序、新增項目的 `sortOrder` 計算、`moveFaqItem` 在中間/最前/最後三種位置的行為、刪除後清單長度正確減少。

## 學生端頁面（`/student/faq`）

新增頁面，加入 STUDENT 導覽列（「常見問題」）。

這是純唯讀內容，設計成一般的 Server Component（比照 `/student/page.tsx` 的寫法：直接在頁面元件裡 `await prisma.faqItem.findMany({ orderBy: { sortOrder: 'asc' } })`），不需要額外的 API 路由，也不需要 `'use client'`。

展開/收合的手風琴效果用原生 `<details>`／`<summary>` 元素，不用 React state：

```tsx
<details className="group rounded-xl border border-borderSubtle bg-card p-4">
  <summary className="cursor-pointer list-none font-semibold text-ink marker:content-none">
    {item.question}
  </summary>
  <p className="mt-3 whitespace-pre-wrap text-sm text-inkMuted">{item.answer}</p>
</details>
```

好處：整個頁面零客戶端 JavaScript，鍵盤操作與螢幕閱讀器支援是瀏覽器原生提供的，不用自己刻。`answer` 用 `whitespace-pre-wrap` 讓後台輸入的換行在學生端正確顯示。

**空清單狀態**：如果目前一筆 `FaqItem` 都沒有，顯示一段提示文字「尚未新增常見問題」，不要顯示空白頁面。

## 導覽列異動

`src/components/ui/AppShell.tsx` 的 `NAV_LINKS`：

- `STUDENT` 陣列最後新增 `{ href: '/student/faq', label: '常見問題' }`。
- `ADMIN` 陣列最後新增 `{ href: '/admin/faq', label: '常見問題' }`。

## 測試

- Service 層（`faqService.ts` 五個函式）：真實測試資料庫、無 mock，比照專案既有慣例。
- API 路由與兩個頁面：零測試檔案，靠 `tsc --noEmit` + `eslint` + 瀏覽器手動驗證（比照本專案所有其他路由與頁面的既有慣例）。
