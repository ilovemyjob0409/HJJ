# 全站動效提升（絲滑感）— Design

## Problem

全站目前幾乎沒有動效與載入回饋，體感生硬：

1. 按鈕與可點元素按下時沒有任何視覺反應（只有 hover 亮度）。
2. 所有非同步操作（登入、儲存、新增、刪除）期間沒有 pending 狀態：按鈕不會
   disable、沒有 spinner，且可以連點重複送出（潛在的重複資料 bug）。
3. Toast 與 Modal 直接蹦出/消失，沒有進出場過渡。
4. 每個頁面打開時資料用 `useEffect + fetch` 載入，載入期間是空白表格，
   資料到達後內容「突然蹦出」。
5. 頁面切換之間沒有任何過渡。

目標：讓「登入畫面載入中、儲存、新增、任何點按」都有流暢、統一的動效回饋。

## Scope

**In scope:**
- 全域點按（active）回饋。
- `Button` 元件的 `loading` 狀態（spinner + disable + 防連點）。
- 登入頁與所有 mutation 表單（約 10 個頁面）接上 pending 狀態。
- Toast 進出場動畫。
- Modal 進場動畫（背景淡入 + 面板縮放浮現）。
- `DataTable` 骨架屏（shimmer 佔位列）+ 資料到達後淡入；各頁面補 loading 狀態。
- `AppShell` 主內容區的頁面切換淡入。
- `prefers-reduced-motion` 全域支援。

**Out of scope:**
- 不引入任何動畫函式庫（Framer Motion 等）— 純 CSS/Tailwind。
- Modal 退場動畫（關閉維持即時，保留乾脆感）。
- 頁面間的共享元素轉場（shared element transition）、手勢動畫。
- 現有導覽列 pill 動畫、hover 亮度規則維持不動。

## 動效原則（Motion tokens）

全站統一的手感，定義在 `globals.css`：

| 用途 | 時長 | 緩動 |
|------|------|------|
| 點按回饋（active scale） | 100ms | ease |
| 一般過渡（hover、顏色） | 150–200ms | ease |
| 進場動畫（淡入、浮現、Toast、Modal） | 200–300ms | `cubic-bezier(0.22, 1, 0.36, 1)`（沿用導覽列 pill 的簽名曲線） |

規則：
- 只動 GPU 友善屬性：`transform`、`opacity`、`filter`。不動會觸發排版
  重算的屬性（width/height/margin 等）。
- 所有動畫包在 `@media (prefers-reduced-motion: no-preference)` 內，或用
  全域 `@media (prefers-reduced-motion: reduce)` 一次關閉。
- Safari 為必測瀏覽器（使用者以 Safari 看正式站）。

## 設計細節

### 1. 全域點按回饋（`globals.css`）

在現有 hover 亮度規則旁新增：同一批選擇器（`a`、`button:not(:disabled)`、
`select`、checkbox、`.cursor-pointer`）在 `:active` 時 `transform: scale(0.97)`，
transition 100ms。表格列等大面積元素縮放比例改用 `scale(0.99)`（透過
`.cursor-pointer` 是否同時是 `tr` 區分，或統一 0.98 取中間值——實作時視
體感微調，spec 不鎖死確切數值，鎖死「必須有按下縮小回饋」）。

### 2. `Button` loading 狀態（`src/components/ui/Button.tsx`）

```tsx
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
  loading?: boolean;
}
```

- `loading=true` 時：按鈕 `disabled`、文字前顯示 CSS border spinner
  （`animate-spin` 的圓環，繼承文字顏色），文字保留不變。
- spinner 是純 CSS（`border` + `border-top-color: transparent` + rotate
  keyframes），不用 SVG 函式庫。
- 既有 `disabled:opacity-50` 樣式沿用；loading 時游標為 `wait`。

### 3. 表單 pending 狀態（各頁面）

每個有 mutation 的頁面（登入、admin 的新增/編輯/刪除、student/teacher 的
申請送出）：

```tsx
const [submitting, setSubmitting] = useState(false);

async function handleSubmit(e) {
  e.preventDefault();
  setSubmitting(true);
  try {
    await fetch(...);
    ...
  } finally {
    setSubmitting(false);
  }
}
// <Button type="submit" loading={submitting}>新增</Button>
```

- `finally` 確保失敗時按鈕會恢復。
- 這是機械性修改，逐頁套用，不新增共用 hook（YAGNI：pattern 只有 4 行，
  抽 hook 反而增加間接性）。
- 登入頁 `signIn` 同樣處理。

### 4. Toast 進出場（`src/components/ui/Toast.tsx`）

- 狀態機從 `message | null` 擴充為 `{ message, leaving }`：
  - 顯示：立即 render，進場動畫 = 從 `translateY(8px) + opacity 0` 浮起，
    250ms 簽名曲線。
  - 2.5 秒後進入 `leaving`：加退場 class（下沉 + 淡出 200ms），動畫結束後
    （`onAnimationEnd` 或 200ms timeout）再 unmount。
- 快速連續 `showToast` 時重置計時器與 leaving 狀態（沿用現有 clearTimeout
  邏輯）。

### 5. Modal 進場（`src/components/ui/Modal.tsx`）

- 背景遮罩：`opacity 0 → 1`，150ms。
- 面板：`scale(0.96) + opacity 0 → scale(1) + opacity 1`，200ms 簽名曲線。
- 用 CSS `@keyframes` 掛在 mount 時的 class 上即可（`open` 由條件 render
  控制，mount 即播放）。關閉直接 unmount，不做退場。

### 6. DataTable 骨架屏 + 淡入（`src/components/ui/DataTable.tsx` 等）

- `DataTable` 新增 `loading?: boolean` prop：
  - `loading=true`：render 5 列佔位列，每格一條圓角灰色 shimmer bar
    （漸層背景 + 背景位移 keyframes，1.4s 循環）。shimmer 顏色用現有
    CSS 變數（`--stripe` / `--border-subtle`），深淺色主題自動適配。
  - `loading=false`：正常 render 資料列，`<tbody>` 掛淡入動畫
    （`opacity 0 → 1`，200ms）。
- `CollapsibleDataTable` 透傳 `loading` prop。
- 各列表頁面加 `const [loading, setLoading] = useState(true)`，`load()`
  的 `finally` 裡 `setLoading(false)`，傳給 DataTable。首次載入才顯示
  骨架屏；之後的 `load()` 重新整理（新增/刪除後）不再回到骨架屏
  （避免閃爍）——即 `loading` 只在 mount 後第一次 fetch 期間為 true。

### 7. 頁面切換淡入（`src/components/ui/AppShell.tsx`）

- `<main>` 內容包一層帶 `key={pathname}` 的 div，掛進場動畫：
  `opacity 0 + translateY(4px) → 1 + 0`，200ms 簽名曲線。
- `key={pathname}` 讓每次路由切換重新播放。
- 登入頁不在 AppShell 內，自己的 Card 掛同一個進場動畫 class。

### 8. Reduced motion

`globals.css` 末端：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

spinner 例外：loading spinner 屬於狀態指示不是裝飾，保留可見但可接受
瞬時（0.01ms 循環視覺上仍是圓環）。不另做特例處理。

## Error handling

- pending 狀態一律放 `try/finally`，API 失敗按鈕必須恢復可按。
- 骨架屏只在首次載入顯示；fetch 失敗時 `loading` 一樣要結束（`finally`），
  避免永久骨架屏。

## Testing

- 純視覺/互動變更，不新增單元測試；既有服務層測試不受影響。
- 瀏覽器實測清單：
  1. 深、淺色主題下各動效正常（骨架屏顏色、spinner 顏色）。
  2. DevTools 網路節流（Slow 3G）看骨架屏與按鈕 loading 是否出現、
     是否防連點。
  3. DevTools 模擬 `prefers-reduced-motion: reduce`，確認動畫關閉。
  4. Safari 實測（或本機 Safari 開 dev server）：active scale、spinner、
     shimmer、Toast/Modal 動畫。
  5. 登入流程完整走一遍：載入中 → 成功 toast → 首頁淡入。
