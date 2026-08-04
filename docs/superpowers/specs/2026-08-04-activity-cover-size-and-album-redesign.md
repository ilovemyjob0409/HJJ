# 活動封面放大＋相簿改版（主圖＋縮圖列） 設計

2026-08-04。需求來源：活動專區封面圖太小看不清楚（選定版本 C：128×80 橫式）；
活動詳情彈窗的相簿 UI 重新設計（選定版本 1：主圖＋縮圖列，全部改掉開新分頁看圖）。

## Part 1：列表封面改 128×80 橫式

四個顯示點的 `h-10 w-10` 改為 `h-20 w-32`（80×128px，橫式較符合照片比例），
`<img>` 與 `bg-stripe` 佔位 `<div>` 同步改，其餘 class（`mx-auto rounded object-cover`）不變：

1. `src/app/student/activities/page.tsx` 活動列表（約 138、140 行）
2. `src/app/student/activities/page.tsx` 我的報名紀錄（約 157、159 行）
3. `src/app/admin/activities/page.tsx`（約 239 行與其佔位）
4. `src/app/teacher/activities/page.tsx`（約 49 行與其佔位）

## Part 2：`ActivityAlbum` 相簿改版

只改 `src/components/ActivityAlbum.tsx` 的渲染層與新增燈箱；資料流（load／upload／delete、
`onImagesChanged` callback、`ImageCropModal` 裁切佇列）與 API 全部不動。

### 版面（取代現有 3 欄方格）
- **主圖**：目前選取的照片（預設第一張＝封面），全寬、`aspect-[16/10]`、`rounded-lg object-cover`。
  右下角疊「`{n} / {總數}`」膠囊（`bg-black/55 text-white text-xs rounded-full px-2 py-0.5`），
  僅照片數 > 1 時顯示。點主圖開燈箱。
- **縮圖列**：主圖下方橫向一列 `h-14 w-14`（56×56）`rounded-lg object-cover` 縮圖，
  `overflow-x-auto` 可橫向捲動，**不做 +N 收合**（與 mockup 的 +1 格不同，捲動比收合簡單直接）。
  目前選取的縮圖加 `outline outline-2 outline-brandDark`；點縮圖切換主圖（不開燈箱）。
- **簽名網址失效**（`url` 為 null）：主圖與縮圖都以 `bg-stripe` 同尺寸佔位。
- **空狀態**：維持灰字「尚無照片」。
- **載入骨架**：主圖一塊 `aspect-[16/10]` ＋ 縮圖列 3 塊 56×56，沿用 `skeleton-shimmer`。

### 燈箱（新增，取代 `window.open` 開新分頁）
- 同檔內部元件（不另開檔案）：`createPortal` 到 `document.body`，
  `fixed inset-0 z-[60] bg-black/80`（高於 Modal 的 z-50），進場沿用 `animate-fade-in`。
- 內容：置中大圖（`max-h-[90vh] max-w-[92vw] object-contain`）、
  左右圓形箭頭（照片數 > 1 才顯示，循環切換，與縮圖選取狀態同步）、
  右上 ✕ 關閉；點黑底或按 Esc 關閉（Esc 用 `useEffect` keydown 監聽）。
- 左右鍵（keyboard arrows）切換：實作順手就加，非必要條件。
- **不做**手機 swipe 手勢（版本 1 未含，YAGNI）。

### 管理端（`canManage`）
- 「＋ 上傳照片」按鈕與上傳流程不變（標題列右側）。
- 刪除鈕從每格方格右上角改到**每個縮圖**右上角，樣式沿用現有
  `bg-black/60 text-white rounded-full h-6 w-6`（縮圖較小，✕ 改 `h-5 w-5 text-[10px]`）。
- 刪除目前選取的照片時：選取移到下一張，沒有下一張則前一張，刪到空則回空狀態。

### 動效與慣例
- 只用既有 `animate-fade-in`／`animate-modal-in`／`skeleton-shimmer`，不新增動畫（[[feedback-motion-conventions]]）。
- 主圖切換不加轉場動畫（直接換 src），保持簡單。

## 測試與驗證
- 專案慣例不寫 UI 元件測試；本次無 service／API 變更，不新增測試。
- 驗證：`npx tsc --noEmit` 乾淨＋既有全套測試維持全綠。
- 部署無 schema 變更，不需 production SQL。

## 明確不做（YAGNI）
- 不做照片排序／設封面功能（封面＝最早上傳，維持現狀）。
- 不做燈箱內縮放（pinch-zoom）。
- 不動 `uploadActivityImage`、簽名網址機制、`ImageCropModal`。
