# 活動封面縮圖 ＋ 上傳裁切 — Design

## Problem

活動相簿上線後兩個回饋：
1. 上傳成功的照片在活動列表裡完全看不到，要點進「編輯」/「查看」才知道有沒有照片。
2. 直接把手機原圖上傳，構圖常常不好看（相簿縮圖是裁切成正方形顯示的 `object-cover`，原圖比例不一定適合）。

## Scope

**In scope:**
- 三個角色（管理員、老師、學生）的活動列表都加一欄「封面」縮圖（該活動最早上傳的一張照片，40×40，無照片顯示灰色佔位方塊）。學生「我的報名紀錄」表格同樣加。
- 上傳照片（新增活動表單的暫存照片、既有相簿的「＋ 上傳照片」）一律先跳出裁切畫面，固定 1:1 正方形，可拖曳＋滾輪縮放，逐張處理（多選時依序跳出）。取消裁切＝跳過該張。
- 裁切後的方形圖再送進現有的壓縮流程（最長邊 2000px、JPEG 0.85），不改動既有的檔案大小/格式保證。
- 新依賴：`react-easy-crop`（~13KB gzip，處理拖曳/縮放/裁切區域計算）。

**Out of scope（YAGNI）：**
- 自由裁切比例、旋轉、濾鏡。
- 已上傳照片的事後裁切/更換封面（要換封面＝目前流程已支援：把想當封面的照片以外的都刪掉再重傳順序，或未來再做「指定封面」功能，這次不做）。
- 封面以外的列表縮圖（例如列表每列顯示多張），只顯示一張。

## 後端設計

### 封面縮圖
`src/lib/services/activityService.ts` 的兩個 select 常數（`ACTIVITY_LIST_SELECT`、`ACTIVITY_STUDENT_LIST_SELECT`）都加：

```ts
images: { orderBy: { createdAt: 'asc' }, take: 1, select: { storagePath: true } },
```

新增一個共用的簽名輔助函式，在回傳前把 `images: [{storagePath}]` 轉成 `coverUrl: string | null`：

```ts
async function attachCoverUrl<T extends { images: { storagePath: string }[] }>(
  rows: T[],
): Promise<(Omit<T, 'images'> & { coverUrl: string | null })[]> {
  const paths = rows.map((r) => r.images[0]?.storagePath).filter((p): p is string => !!p);
  const urls = paths.length ? await createSignedUrls(paths) : new Map<string, string>();
  return rows.map(({ images, ...rest }) => ({
    ...rest,
    coverUrl: images[0] ? (urls.get(images[0].storagePath) ?? null) : null,
  }));
}
```

套用到 `listAllActivities`、`listActivitiesForTeacher`、`listOpenActivitiesForStudent`、`getActivityDetail`（單筆也走同一函式，包成陣列再取回第一筆）。`listRegistrationsForStudent` 回傳的是 `{id, activity}[]`，需要先攤平出 `activity` 陣列跑 `attachCoverUrl`，再組裝回 `{id, activity}[]`。

`createSignedUrls` 已存在於 `src/lib/storage.ts`（Task 2 的既有函式），`activityService.ts` 已經 import 該模組的 `deleteActivityImages`，這次加一個 import。

## 前端設計

### 列表封面欄
三個角色的 `Column<T>[]` 定義都在最前面加一欄：

```tsx
{
  header: '封面',
  render: (a) =>
    a.coverUrl ? (
      // eslint-disable-next-line @next/next/no-img-element -- signed URL, short-lived
      <img src={a.coverUrl} alt="封面" className="mx-auto h-10 w-10 rounded object-cover" />
    ) : (
      <div className="bg-stripe mx-auto h-10 w-10 rounded" />
    ),
},
```

對應的 row 型別（`ActivityRow`、`ActivityStudentRow`、`RegistrationRow`）加 `coverUrl: string | null`。

### 裁切元件 `src/components/ImageCropModal.tsx`

```tsx
interface ImageCropModalProps {
  files: File[];
  onDone: (croppedBlobs: Blob[]) => void;
}
```

- 內部維護 `index`（目前處理到第幾張）與 `results: Blob[]`。
- 用既有的 `Modal` 元件包裹，內容是 `react-easy-crop` 的 `<Cropper image={...} aspect={1} .../>`，下方「確認裁切」／「跳過這張」兩顆按鈕。
- 確認：用 `src/lib/cropImage.ts` 的 `getCroppedImageBlob(file, croppedAreaPixels)` 把裁切區域畫進 canvas 輸出 Blob，push 進 `results`，`index+1`。
- 跳過：直接 `index+1`，不 push。
- `index === files.length` 時呼叫 `onDone(results)`，呼叫方負責把 modal 從畫面上移除（`files` 傳空陣列/null 時不 render）。
- 每張處理完要重置 `crop`/`zoom` 內部 state（换下一張圖從置中、zoom=1 開始）。

`src/lib/cropImage.ts`：

```ts
export interface PixelCrop { x: number; y: number; width: number; height: number; }

export async function getCroppedImageBlob(file: File, area: PixelCrop): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = area.width;
    canvas.height = area.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('裁切失敗'))), 'image/jpeg', 0.95),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

### 既有壓縮函式放寬型別
`src/lib/imageCompression.ts` 的 `compressImage(file: File)` 參數型別放寬為 `Blob`（`createImageBitmap` 本來就吃 Blob；`File extends Blob`，呼叫端不用改）。`src/lib/uploadActivityImage.ts` 的 `uploadActivityImageFile(activityId, file: File)` 同樣把參數型別放寬為 `Blob`，因為裁切後傳進來的都是 `Blob` 不是 `File`。

### 兩個上傳入口接裁切

**`src/app/admin/activities/page.tsx`（新增活動表單的暫存照片）：**
- 原本 `handleStagePhotos(files)` 直接壓縮暫存，改成：選檔案先存進 `cropQueue` state，render `<ImageCropModal files={cropQueue} onDone={handleCroppedPhotos} />`（`cropQueue` 非空才 render）。
- `handleCroppedPhotos(blobs: Blob[])`：對每個 blob 呼叫既有的 `compressImage` 再 `setStagedPhotos` push，跟原本邏輯一樣，只是輸入源從 `file` 換成裁切後的 `blob`。

**`src/components/ActivityAlbum.tsx`（既有相簿的上傳）：**
- 原本 `handleFiles(files)` 直接逐張上傳，改成：選檔案先存進 `cropQueue` state，render `ImageCropModal`。
- `onDone` 拿到 `blobs` 後，逐一呼叫 `uploadActivityImageFile(activityId, blob)`（原本呼叫時傳的是 `file`，現在傳裁切後的 `blob`），其餘 loading/toast/reload 邏輯不變。

## Error handling

- 裁切輸出失敗（`canvas.toBlob` 回 null，理論上極少見）：該張視同「跳過」，不中斷佇列，繼續處理下一張。
- `attachCoverUrl` 的 `createSignedUrls` 若整批失敗（Storage 掛掉）：讓錯誤往上拋，維持現有 API 錯誤處理慣例（未特別 catch，500 由 Next.js 預設錯誤處理）。
- 空相簿（`images[0]` 不存在）：`coverUrl` 為 `null`，前端顯示灰色佔位方塊，不特別處理。

## Testing

- `activityService.test.ts` 擴充：驗證 `listAllActivities`/`listActivitiesForTeacher`/`listOpenActivitiesForStudent`/`listRegistrationsForStudent`/`getActivityDetail` 在有照片／無照片兩種情況下 `coverUrl` 正確（mock `@/lib/storage` 的 `createSignedUrls`）。
- `cropImage.ts`：canvas/Image 操作依賴瀏覽器 API，本 repo 無 DOM 測試設施可靠地測（既有 `imageCompression.ts` 也沒有單元測試），不新增測試，靠瀏覽器手動驗證。
- 瀏覽器實測：三角色列表封面顯示（含深淺色主題）、新增活動時裁切多張、既有相簿上傳裁切多張、裁切時跳過其中一張、裁切後的照片縮圖確認是方形且對齊使用者選的裁切區域。
