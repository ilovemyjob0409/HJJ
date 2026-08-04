# 活動封面放大＋相簿改版＋詳情彈窗改版 設計

2026-08-04。需求來源：活動專區封面圖太小看不清楚（選定版本 C：128×80 橫式）；
活動詳情彈窗的相簿 UI 重新設計（選定版本 1：主圖＋縮圖列，全部改掉開新分頁看圖）；
活動點開後的彈窗整體重新設計（選定版本甲：照片頂置，三端統一版面）。

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

### 版面（取代現有 3 欄方格；作為 Part 3 版本甲的頂部區塊）
- **主圖**：目前選取的照片（預設第一張＝封面），全寬、`aspect-[16/10]` `object-cover`；
  在彈窗內為滿版貼頂（無圓角、無左右內距，見 Part 3）。
  右下角疊「`{n} / {總數}`」膠囊（`bg-black/55 text-white text-xs rounded-full px-2 py-0.5`），
  僅照片數 > 1 時顯示。點主圖開燈箱。
- **縮圖列**：主圖下方橫向一列 `h-14 w-14`（56×56）`rounded-lg object-cover` 縮圖，
  `overflow-x-auto` 可橫向捲動，**不做 +N 收合**（與 mockup 的 +1 格不同，捲動比收合簡單直接）。
  目前選取的縮圖加 `outline outline-2 outline-brandDark`；點縮圖切換主圖（不開燈箱）。
- **不再渲染「相簿」eyebrow 標題**——主圖就是彈窗門面，標題多餘。
- **管理端上傳入口**：原標題列的「＋ 上傳照片」按鈕改為縮圖列末端一個 56×56 虛線
  「＋」方塊（`border border-dashed border-borderStrong text-inkMuted rounded-lg`）；
  無照片時（見空狀態）改為一條虛線「＋ 上傳照片」橫條按鈕。上傳流程（多選、裁切佇列）不變。
- **簽名網址失效**（`url` 為 null）：主圖與縮圖都以 `bg-stripe` 同尺寸佔位。
- **空狀態**（無照片）：頂部不顯示主圖與縮圖列（不放灰色大佔位）。改於**報名名單之後、
  footer 之前**補一個「相簿」小節（此情境保留 eyebrow 標題以交代脈絡）：
  一般使用者顯示灰字「尚無照片」，管理端顯示虛線「＋ 上傳照片」橫條。
  （有照片時相簿在頂部、無 eyebrow；無照片時相簿小節在尾端、有 eyebrow——兩者擇一出現。）
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
- 上傳流程（多選、裁切佇列）不變；上傳入口見 Part 2（縮圖列末端虛線方塊／無照片時虛線橫條），不再位於標題列。
- 刪除鈕從每格方格右上角改到**每個縮圖**右上角，樣式沿用現有
  `bg-black/60 text-white rounded-full h-6 w-6`（縮圖較小，✕ 改 `h-5 w-5 text-[10px]`）。
- 刪除目前選取的照片時：選取移到下一張，沒有下一張則前一張，刪到空則回空狀態。

### 動效與慣例
- 只用既有 `animate-fade-in`／`animate-modal-in`／`skeleton-shimmer`，不新增動畫（[[feedback-motion-conventions]]）。
- 主圖切換不加轉場動畫（直接換 src），保持簡單。

## Part 3：活動詳情彈窗改版（版本甲，三端統一）

### 新共用元件與 Modal 擴充
- `src/components/ui/Modal.tsx` 新增可選 prop `flush?: boolean`：為 true 時不渲染
  內建標題列與 `p-5` 內距（內容自理），backdrop 點擊關閉、`animate-modal-in`、
  `max-h-[90vh]` 捲動等行為不變。既有呼叫點完全不受影響。
- 新共用元件 `src/components/ActivityDetail.tsx`（client）：三端共用的彈窗內容版面。
  Props：活動資料（標題、分類名、日期區間字串、地點、老師名、capacity、已報名數、
  registrations 名單）、`canManageAlbum`、`onImagesChanged`、
  `rosterItemAction?: (registration) => ReactNode`（行政端的移除 ✕）、
  `footer?: ReactNode`（各端動作區）。資料查詢與動作 handler 留在各頁。

### 版面結構（由上而下）
1. **相簿區**（Part 2 的主圖＋縮圖列）：有照片時滿版貼頂；✕ 關閉鈕疊在主圖右上
   （`bg-black/45 text-white h-7 w-7 rounded-full`）。無照片時整區不顯示。
2. **標題列**：活動標題（`text-lg font-bold text-ink`）＋分類籤
   （`bg-stripe border border-borderSubtle text-ink text-xs rounded-full px-2.5 py-0.5`）。
   無照片時此列右側補 ✕（沿用 Modal 現有 ✕ 樣式），因為 hero 上的 ✕ 不存在。
3. **資訊列**（每列一項，`text-sm text-ink`，icon `text-inkMuted`）：
   日期區間／地點（無則「地點未定」）／帶隊老師／名額。
   icon 不新增依賴：在 `ActivityDetail.tsx` 內建四個 16px inline SVG
   （日曆、地點釘、單人、多人，`stroke="currentColor"`，比照既有 `LowQuotaIcon` 做法）。
   名額列：「已報名 X／名額 Y」＋右側迷你進度條
   （`h-1.5 rounded-full bg-stripe`，填色 `bg-brand`，寬度 = X/Y，超過 100% 封頂）。
4. **描述**：`whitespace-pre-wrap text-sm text-ink`；空描述則整段不顯示。
5. **報名名單**：eyebrow「報名名單（N）」＋籤片（pill）換行排列
   （`bg-stripe border border-borderSubtle text-xs rounded-full px-2.5 py-1`）。
   `rosterItemAction` 存在時渲染於籤片內名字右側（行政端 ✕，沿用既有移除確認流程）。
   空名單：灰字「尚無學生報名」。
6. **Footer**：`border-t border-borderSubtle pt-4`，內容由各端傳入：
   - 學生端：現有報名／取消報名／「活動已結束」邏輯原樣搬入（按鈕樣式不變）。
   - 行政端：左側「刪除此活動」紅字連結（現有 `handleDeleteActivity`）；無右側 CTA。
   - 老師端：依現狀（無動作則不渲染 footer）。

### 三端接線
- `src/app/student/activities/page.tsx`、`src/app/admin/activities/page.tsx`、
  `src/app/teacher/activities/page.tsx` 的詳情 Modal 改為
  `<Modal flush …><ActivityDetail …/></Modal>`；各端現有的資料載入、
  報名／取消／移除／刪除 handler 與 `canManage`、`onImagesChanged` 傳法維持不變。
- 行政端彈窗標題原為「活動名單」——改版後統一顯示活動標題（與學生端一致）。

## 測試與驗證
- 專案慣例不寫 UI 元件測試；本次無 service／API 變更，不新增測試。
- 驗證：`npx tsc --noEmit` 乾淨＋既有全套測試維持全綠。
- 部署無 schema 變更，不需 production SQL。

## 明確不做（YAGNI）
- 不做照片排序／設封面功能（封面＝最早上傳，維持現狀）。
- 不做燈箱內縮放（pinch-zoom）。
- 不動 `uploadActivityImage`、簽名網址機制、`ImageCropModal`。
